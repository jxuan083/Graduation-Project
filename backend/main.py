import uuid
import json
import asyncio
import qrcode
import io
import base64
import socket
import datetime
import os
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth
from typing import Dict, Set, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 檢查是否已經有初始化的 Firebase App
if not firebase_admin._apps:
    try:
        # 在 Cloud Run 環境中，不需要 serviceAccountKey.json，它會自動抓取環境權限
        firebase_admin.initialize_app()
        print("Firebase initialized with default credentials.")
    except Exception as e:
        # 只有在本地環境找不到預設權限時，才嘗試讀取 JSON 檔案
        print(f"Default auth failed, trying local JSON: {e}")
        try:
            cred = credentials.Certificate("serviceAccountKey.json")
            firebase_admin.initialize_app(cred)
        except Exception as inner_e:
            print(f"Critical Error: Could not initialize Firebase: {inner_e}")

# 取得 Firestore 實例
db = firestore.client()

app = FastAPI()

# ===== CORS FOR FRONTEND SEPARATION =====
# Allow frontend domains (e.g. from Vite dev server port 5173 or simple HTTP server 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],  # 題庫需要 PATCH/DELETE
    allow_headers=["*"],
)

BACKEND_VERSION = "v9-focus-fix"


@app.get("/api/version")
async def get_version():
    """回傳後端版本，可確認 Cloud Run 是否真的部署了新版本"""
    return {"version": BACKEND_VERSION}


# ===== Firebase Auth ID Token 驗證 =====
def verify_token(authorization: Optional[str] = Header(None)) -> dict:
    """
    從 Authorization: Bearer <ID_TOKEN> 解析並驗證 Firebase ID Token。
    驗證成功回傳 decoded token (含 uid, email, name, picture 等 claims)。
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="缺少 Authorization Bearer Token")

    id_token = authorization.split(" ", 1)[1].strip()

    try:
        decoded = fb_auth.verify_id_token(id_token)
        return decoded
    except Exception as e:
        print(f"Token verification failed: {e}")
        raise HTTPException(status_code=401, detail=f"Token 驗證失敗: {e}")


def _ensure_user_doc(decoded: dict) -> dict:
    """
    若 users/{uid} 不存在則自動建立 (用 token 內的 name / picture / email 預填)。
    回傳目前 Firestore 的 user profile dict (含 uid)。
    """
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    user_ref = db.collection("users").document(uid)
    try:
        snap = user_ref.get()
        if snap.exists:
            data = snap.to_dict() or {}
        else:
            data = {
                "uid": uid,
                "email": decoded.get("email", ""),
                "nickname": decoded.get("name", "") or (decoded.get("email", "").split("@")[0] if decoded.get("email") else "Anonymous"),
                "photoURL": decoded.get("picture", ""),
                "bio": "",
                "created_at": firestore.SERVER_TIMESTAMP,
            }
            user_ref.set(data)
            # 回傳前把 SERVER_TIMESTAMP 拿掉避免序列化失敗
            data.pop("created_at", None)
    except Exception as e:
        print(f"Error ensuring user doc: {e}")
        # 即使 Firestore 出錯仍回傳 token claims 讓前端能用
        data = {
            "uid": uid,
            "email": decoded.get("email", ""),
            "nickname": decoded.get("name", ""),
            "photoURL": decoded.get("picture", ""),
            "bio": "",
        }

    data["uid"] = uid
    return data


class ProfileUpdate(BaseModel):
    nickname: Optional[str] = None
    bio: Optional[str] = None
    photoURL: Optional[str] = None


@app.get("/api/me")
async def get_me(decoded: dict = Depends(verify_token)):
    """回傳目前登入者的 profile (沒有就自動建立)"""
    profile = _ensure_user_doc(decoded)
    return {"status": "success", "profile": profile}


@app.post("/api/profile")
async def update_profile(payload: ProfileUpdate, decoded: dict = Depends(verify_token)):
    """更新目前登入者的暱稱 / 簡介 / 頭像 URL"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    # 先確保有 user doc
    _ensure_user_doc(decoded)

    update_data = {}
    if payload.nickname is not None:
        update_data["nickname"] = payload.nickname.strip()[:30]
    if payload.bio is not None:
        update_data["bio"] = payload.bio.strip()[:200]
    if payload.photoURL is not None:
        update_data["photoURL"] = payload.photoURL.strip()

    if not update_data:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    update_data["updated_at"] = firestore.SERVER_TIMESTAMP

    try:
        db.collection("users").document(uid).update(update_data)
    except Exception as e:
        print(f"Error updating profile: {e}")
        raise HTTPException(status_code=500, detail=f"更新失敗: {e}")

    # 回傳最新版本
    snap = db.collection("users").document(uid).get()
    data = snap.to_dict() or {}
    data.pop("created_at", None)
    data.pop("updated_at", None)
    data["uid"] = uid
    return {"status": "success", "profile": data}


# ===== 聚會紀錄 API =====
def _serialize_meeting(data: dict, doc_id: str) -> dict:
    """把 Firestore document 轉成可序列化的 dict（轉 datetime / sentinel）"""
    out = dict(data)
    out["id"] = doc_id
    if out.get("ended_at") and hasattr(out["ended_at"], "isoformat"):
        out["ended_at"] = out["ended_at"].isoformat()
    elif out.get("ended_at"):
        out["ended_at"] = str(out["ended_at"])
    return out


@app.get("/api/meetings")
async def list_meetings(decoded: dict = Depends(verify_token)):
    """回傳目前使用者參與過的聚會清單（按結束時間倒序）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    try:
        # 註：array_contains + order_by 會需要組合索引；先省略 order_by，回傳後在 Python 排序
        query = db.collection("meetings").where("participants", "array_contains", uid).limit(100)
        docs = list(query.stream())
        meetings = [_serialize_meeting(d.to_dict() or {}, d.id) for d in docs]
        # 依 ended_at 倒序排列（沒有的放最後）
        meetings.sort(key=lambda m: m.get("ended_at") or "", reverse=True)
        return {"status": "success", "meetings": meetings}
    except Exception as e:
        print(f"Error listing meetings: {e}")
        raise HTTPException(status_code=500, detail=f"列出聚會失敗: {e}")


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, decoded: dict = Depends(verify_token)):
    """回傳特定聚會的詳細資料（必須是參與者）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    try:
        doc = db.collection("meetings").document(meeting_id).get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="找不到這場聚會紀錄")
        data = doc.to_dict() or {}
        if uid not in (data.get("participants") or []):
            raise HTTPException(status_code=403, detail="你沒有參與這場聚會")
        return {"status": "success", "meeting": _serialize_meeting(data, meeting_id)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error getting meeting: {e}")
        raise HTTPException(status_code=500, detail=f"讀取聚會失敗: {e}")


# ===== 題庫 API =====
class QuestionPayload(BaseModel):
    question: str
    options: List[str]
    has_answer: Optional[bool] = False
    correct_index: Optional[int] = None


def _validate_question_payload(payload: QuestionPayload) -> dict:
    """檢查題目合法性並回傳整理過的 dict"""
    q = (payload.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="題目不能是空的")
    if len(q) > 120:
        raise HTTPException(status_code=400, detail="題目最多 120 字")

    opts = [str(o).strip() for o in (payload.options or []) if str(o).strip()]
    if len(opts) < 2:
        raise HTTPException(status_code=400, detail="至少要 2 個選項")
    if len(opts) > 6:
        raise HTTPException(status_code=400, detail="最多只能 6 個選項")
    for o in opts:
        if len(o) > 40:
            raise HTTPException(status_code=400, detail="單一選項最多 40 字")

    has_answer = bool(payload.has_answer)
    correct_index = None
    if has_answer:
        correct_index = payload.correct_index
        if correct_index is None or not isinstance(correct_index, int):
            raise HTTPException(status_code=400, detail="勾選了有正解，請指定正解")
        if correct_index < 0 or correct_index >= len(opts):
            raise HTTPException(status_code=400, detail="正解索引超出選項範圍")

    return {
        "question": q,
        "options": opts,
        "has_answer": has_answer,
        "correct_index": correct_index,
    }


def _serialize_question(data: dict, doc_id: str) -> dict:
    """把 Firestore question document 轉成可序列化 dict"""
    out = dict(data)
    out["id"] = doc_id
    for ts_field in ("created_at", "updated_at"):
        if out.get(ts_field) and hasattr(out[ts_field], "isoformat"):
            out[ts_field] = out[ts_field].isoformat()
        elif out.get(ts_field):
            out[ts_field] = str(out[ts_field])
    return out


@app.get("/api/questions")
async def list_my_questions(decoded: dict = Depends(verify_token)):
    """列出目前登入者的個人題庫"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    try:
        docs = list(db.collection("users").document(uid).collection("questions").stream())
        questions = [_serialize_question(d.to_dict() or {}, d.id) for d in docs]
        questions.sort(key=lambda q: q.get("created_at") or "", reverse=True)
        return {"status": "success", "questions": questions}
    except Exception as e:
        print(f"Error listing questions: {e}")
        raise HTTPException(status_code=500, detail=f"讀取題庫失敗: {e}")


@app.post("/api/questions")
async def create_question(payload: QuestionPayload, decoded: dict = Depends(verify_token)):
    """新增一題到個人題庫"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    cleaned = _validate_question_payload(payload)
    cleaned["created_at"] = firestore.SERVER_TIMESTAMP
    cleaned["updated_at"] = firestore.SERVER_TIMESTAMP

    try:
        ref = db.collection("users").document(uid).collection("questions").document()
        ref.set(cleaned)
        # 回傳時去掉 sentinel
        out = dict(cleaned)
        out.pop("created_at", None)
        out.pop("updated_at", None)
        out["id"] = ref.id
        return {"status": "success", "question": out}
    except Exception as e:
        print(f"Error creating question: {e}")
        raise HTTPException(status_code=500, detail=f"新增失敗: {e}")


@app.patch("/api/questions/{qid}")
async def update_question(qid: str, payload: QuestionPayload, decoded: dict = Depends(verify_token)):
    """編輯個人題庫中的某一題"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    ref = db.collection("users").document(uid).collection("questions").document(qid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到這題")

    cleaned = _validate_question_payload(payload)
    cleaned["updated_at"] = firestore.SERVER_TIMESTAMP

    try:
        ref.update(cleaned)
        out = dict(cleaned)
        out.pop("updated_at", None)
        out["id"] = qid
        return {"status": "success", "question": out}
    except Exception as e:
        print(f"Error updating question: {e}")
        raise HTTPException(status_code=500, detail=f"更新失敗: {e}")


@app.delete("/api/questions/{qid}")
async def delete_question(qid: str, decoded: dict = Depends(verify_token)):
    """刪除個人題庫中的某一題"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    ref = db.collection("users").document(uid).collection("questions").document(qid)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到這題")
    try:
        ref.delete()
        return {"status": "success", "id": qid}
    except Exception as e:
        print(f"Error deleting question: {e}")
        raise HTTPException(status_code=500, detail=f"刪除失敗: {e}")


@app.get("/api/public_questions")
async def list_public_questions(decoded: dict = Depends(verify_token)):
    """列出公共題庫"""
    try:
        docs = list(db.collection("public_questions").stream())
        questions = [_serialize_question(d.to_dict() or {}, d.id) for d in docs]
        questions.sort(key=lambda q: q.get("category") or "")
        return {"status": "success", "questions": questions}
    except Exception as e:
        print(f"Error listing public questions: {e}")
        raise HTTPException(status_code=500, detail=f"讀取公共題庫失敗: {e}")


class ImportQuestionPayload(BaseModel):
    public_id: str


@app.post("/api/questions/import")
async def import_public_question(payload: ImportQuestionPayload, decoded: dict = Depends(verify_token)):
    """從公共題庫複製一題到自己的個人題庫"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    src = db.collection("public_questions").document(payload.public_id).get()
    if not src.exists:
        raise HTTPException(status_code=404, detail="公共題庫找不到這題")

    src_data = src.to_dict() or {}
    new_q = {
        "question": src_data.get("question", ""),
        "options": src_data.get("options", []),
        "has_answer": bool(src_data.get("has_answer", False)),
        "correct_index": src_data.get("correct_index"),
        "imported_from_public": payload.public_id,
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
    }

    try:
        ref = db.collection("users").document(uid).collection("questions").document()
        ref.set(new_q)
        out = {
            "id": ref.id,
            "question": new_q["question"],
            "options": new_q["options"],
            "has_answer": new_q["has_answer"],
            "correct_index": new_q["correct_index"],
        }
        return {"status": "success", "question": out}
    except Exception as e:
        print(f"Error importing question: {e}")
        raise HTTPException(status_code=500, detail=f"複製失敗: {e}")


def _pick_question_for_host(host_uid: str, source: str, question_id: Optional[str]) -> Optional[dict]:
    """
    根據 source 決定用哪一題：
    - "mine":    從 host 個人題庫隨機
    - "public":  從公共題庫隨機
    - "specific":精準用 question_id（可能是 mine 或 public）
    回傳 dict: {question, options, has_answer, correct_index}；找不到回 None
    """
    import random

    if source == "mine":
        docs = list(db.collection("users").document(host_uid).collection("questions").stream())
        if not docs:
            return None
        pick = random.choice(docs)
        d = pick.to_dict() or {}
        return {
            "question": d.get("question", ""),
            "options": d.get("options", []),
            "has_answer": bool(d.get("has_answer", False)),
            "correct_index": d.get("correct_index"),
        }

    if source == "public":
        docs = list(db.collection("public_questions").stream())
        if not docs:
            return None
        pick = random.choice(docs)
        d = pick.to_dict() or {}
        return {
            "question": d.get("question", ""),
            "options": d.get("options", []),
            "has_answer": bool(d.get("has_answer", False)),
            "correct_index": d.get("correct_index"),
        }

    if source == "specific" and question_id:
        # 先試個人題庫，再試公共題庫
        ref1 = db.collection("users").document(host_uid).collection("questions").document(question_id).get()
        if ref1.exists:
            d = ref1.to_dict() or {}
            return {
                "question": d.get("question", ""),
                "options": d.get("options", []),
                "has_answer": bool(d.get("has_answer", False)),
                "correct_index": d.get("correct_index"),
            }
        ref2 = db.collection("public_questions").document(question_id).get()
        if ref2.exists:
            d = ref2.to_dict() or {}
            return {
                "question": d.get("question", ""),
                "options": d.get("options", []),
                "has_answer": bool(d.get("has_answer", False)),
                "correct_index": d.get("correct_index"),
            }

    return None


# ===== 系統工具函數 =====
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


# ===== 房間與 WebSocket 管理 =====
rooms: Dict[str, Dict] = {}


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]

    async def broadcast_to_room(self, room_id: str, message: dict):
        if room_id not in rooms:
            return
        members = rooms[room_id]["members"].keys()
        try:
            enc_msg = json.dumps(message, default=str)  # default=str: datetime 等型別轉字串而非報錯
        except Exception as e:
            print(f"Broadcast serialization error for room {room_id}: {e}")
            return
        for user_id in members:
            ws = self.active_connections.get(user_id)
            if ws:
                try:
                    await ws.send_text(enc_msg)
                except Exception as e:
                    print(f"Failed to send to {user_id}: {e}")


manager = ConnectionManager()


@app.get("/api/create_room")
async def create_room(frontend_url: str = None, decoded: dict = Depends(verify_token)):
    """
    建立房間並同步存入 Firestore (需登入)
    """
    host_uid = decoded.get("uid") or decoded.get("user_id")
    # 確保 host 有 user doc
    host_profile = _ensure_user_doc(decoded)

    room_id = str(uuid.uuid4())[:8]

    # 1. 準備要存入 Firestore 的資料結構（含 SERVER_TIMESTAMP 給 Firestore 用）
    firestore_data = {
        "room_id": room_id,
        "host_uid": host_uid,
        "host_nickname": host_profile.get("nickname", ""),
        "status": "WAITING",
        "mode": "GATHERING",  # 預設聚會模式
        "members": {},
        "sync_start_time": None,
        "deviations": 0,
        "qa_state": {
            "current_question": None,
            "answers": {}
        },
        "created_at": firestore.SERVER_TIMESTAMP  # 使用 Firebase 伺服器時間
    }

    # 記憶體版本不能含 SERVER_TIMESTAMP（無法 JSON 序列化，會讓 WebSocket 廣播失敗）
    memory_data = {k: v for k, v in firestore_data.items() if k != "created_at"}
    # 額外記下開始時間（毫秒 epoch），結束聚會時用來計算時長
    memory_data["started_at"] = int(datetime.datetime.utcnow().timestamp() * 1000)

    # 2. 寫入 Firestore 資料庫 (集合名稱設為 'rooms')
    try:
        db.collection("rooms").document(room_id).set(firestore_data)
    except Exception as e:
        print(f"Error saving to Firestore: {e}")
        # 即使 Firestore 寫入失敗，記憶體仍可運作
    rooms[room_id] = memory_data

    # --- QR Code 生成邏輯 ---
    base_url = frontend_url if frontend_url else "http://localhost:3000"

    if "localhost" in base_url or "127.0.0.1" in base_url:
        try:
            local_ip = get_local_ip()
            base_url = base_url.replace("localhost", local_ip).replace("127.0.0.1", local_ip)
        except Exception:
            pass

    host_url = f"{base_url}/?room={room_id}"
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(host_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

    return {
        "room_id": room_id,
        "qr_base64": img_str,
        "url": host_url,
        "backend_ip": ""
    }


@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    # 從 query param 取得暱稱 (ws 沒有 header 能塞 token，所以用 query)
    nickname = websocket.query_params.get("nickname") or "訪客"
    nickname = nickname.strip()[:20] or "訪客"

    await manager.connect(user_id, websocket)

    # 1. 檢查房間是否存在，若不在記憶體則嘗試從 Firestore 恢復或初始化
    if room_id not in rooms:
        # 嘗試從 Firestore 抓取現有資料
        try:
            doc = db.collection("rooms").document(room_id).get()
            if doc.exists:
                room_dict = doc.to_dict()
                # 移除無法 JSON 序列化的欄位 (datetime, sentinel)
                room_dict.pop("created_at", None)
                rooms[room_id] = room_dict
            else:
                rooms[room_id] = {
                    "status": "WAITING",
                    "mode": "GATHERING",
                    "members": {},
                    "sync_start_time": None,
                    "deviations": 0,
                    "qa_state": {"current_question": None, "answers": {}}
                }
        except Exception as e:
            print(f"Error reading room from Firestore: {e}")
            rooms[room_id] = {
                "status": "WAITING",
                "mode": "GATHERING",
                "members": {},
                "sync_start_time": None,
                "deviations": 0,
                "qa_state": {"current_question": None, "answers": {}}
            }

    # 確保 qa_state 存在 (相容舊資料)
    if "qa_state" not in rooms[room_id]:
        rooms[room_id]["qa_state"] = {"current_question": None, "answers": {}}
    if "mode" not in rooms[room_id]:
        rooms[room_id]["mode"] = "GATHERING"

    # 更新成員在記憶體中的狀態 (保留已有的暱稱、若有；否則用本次帶來的)
    existing = rooms[room_id]["members"].get(user_id, {})
    rooms[room_id]["members"][user_id] = {
        "progress": 0,
        "state": "CONNECTED",
        "nickname": existing.get("nickname") or nickname,
    }

    # 同步更新 Firestore 中的成員清單
    try:
        db.collection("rooms").document(room_id).update({
            f"members.{user_id}": rooms[room_id]["members"][user_id]
        })
    except Exception as e:
        print(f"Error updating member in Firestore: {e}")

    await manager.broadcast_to_room(room_id, {
        "type": "ROOM_UPDATE",
        "room_state": rooms[room_id]
    })

    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            action = data.get("action")

            # 0. 房主按「開始同步定錨」→ 廣播給全員一起進 HOLD 介面
            if action == "START_SYNC":
                rooms[room_id]["status"] = "SYNCING"
                try:
                    db.collection("rooms").document(room_id).update({"status": "SYNCING"})
                except Exception as e:
                    print(f"Error updating status to SYNCING in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "SYNC_STARTED"
                })
                continue

            # 0.5. 房主結束聚會 / 房主離開（登出）→ 通知所有成員聚會結束
            if action == "END_SESSION":
                # 只有房主可以結束聚會
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[END_SESSION] rejected: user={user_id} is not host of room {room_id}")
                    continue

                reason = data.get("reason", "host_ended")
                duration_minutes = int(data.get("duration_minutes", 0))
                rooms[room_id]["status"] = "ENDED"
                try:
                    db.collection("rooms").document(room_id).update({"status": "ENDED"})
                except Exception as e:
                    print(f"Error updating status to ENDED in Firestore: {e}")

                # === 把這場聚會 snapshot 寫到 meetings collection ===
                try:
                    room_data = rooms[room_id]
                    members = room_data.get("members", {})

                    # 用 dash 判斷是訪客 (uuid 有 dash) 還是 firebase uid (沒 dash)
                    members_snapshot = []
                    participants = []
                    for uid, info in members.items():
                        is_guest = "-" in uid
                        members_snapshot.append({
                            "uid": uid,
                            "nickname": info.get("nickname", ""),
                            "is_guest": is_guest
                        })
                        if not is_guest:
                            participants.append(uid)

                    # 房主一定要在 participants（即使他已經斷線）
                    host_uid_local = room_data.get("host_uid")
                    if host_uid_local and host_uid_local not in participants:
                        participants.append(host_uid_local)

                    meeting_record = {
                        "room_id": room_id,
                        "host_uid": host_uid_local,
                        "host_nickname": room_data.get("host_nickname", ""),
                        "mode": room_data.get("mode", ""),
                        "ended_at": firestore.SERVER_TIMESTAMP,
                        "started_at_ms": room_data.get("started_at", 0),
                        "duration_minutes": duration_minutes,
                        "total_deviations": room_data.get("deviations", 0),
                        "member_count": len(members_snapshot),
                        "members_snapshot": members_snapshot,
                        "participants": participants,
                        "end_reason": reason,
                    }
                    db.collection("meetings").document(room_id).set(meeting_record)
                    print(f"[END_SESSION] meeting record saved: {room_id}")
                except Exception as e:
                    print(f"Error saving meeting record: {e}")

                print(f"[END_SESSION] room={room_id} reason={reason}")
                await manager.broadcast_to_room(room_id, {
                    "type": "SESSION_ENDED",
                    "reason": reason
                })
                continue

            # 1. 房主切換模式 (上課、開會、聚會、問答)
            if action == "CHANGE_MODE":
                new_mode = data.get("mode")
                rooms[room_id]["mode"] = new_mode

                try:
                    db.collection("rooms").document(room_id).update({"mode": new_mode})
                except Exception as e:
                    print(f"Error updating mode in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "MODE_CHANGED",
                    "mode": new_mode
                })

            # 2. 房主發布問答題
            # 支援兩種格式：
            # (新) { action:"START_QA", source:"mine|public|specific", question_id?:"..." }
            # (舊) { action:"START_QA", question:"...", options:[...] } → 房主手動傳題目(沒有正解)
            elif action == "START_QA":
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[START_QA] rejected: user={user_id} is not host of room {room_id}")
                    continue

                source = data.get("source")
                picked = None
                if source in ("mine", "public", "specific"):
                    host_uid_local = rooms[room_id].get("host_uid") or user_id
                    picked = _pick_question_for_host(host_uid_local, source, data.get("question_id"))
                    if not picked:
                        # 題庫是空的或找不到該題
                        await websocket.send_text(json.dumps({
                            "type": "QA_ERROR",
                            "message": "找不到可用的題目，請到題庫管理新增題目"
                        }))
                        continue
                else:
                    # 相容舊格式：直接帶題目內容
                    picked = {
                        "question": data.get("question", ""),
                        "options": data.get("options", []),
                        "has_answer": False,
                        "correct_index": None,
                    }

                question_text = picked["question"]
                options_list = picked["options"]
                has_answer = bool(picked.get("has_answer"))
                correct_index = picked.get("correct_index")

                rooms[room_id]["mode"] = "QA_GAME"
                rooms[room_id]["qa_state"]["current_question"] = question_text
                rooms[room_id]["qa_state"]["current_options"] = options_list
                rooms[room_id]["qa_state"]["has_answer"] = has_answer
                rooms[room_id]["qa_state"]["correct_index"] = correct_index
                rooms[room_id]["qa_state"]["answers"] = {}

                try:
                    db.collection("rooms").document(room_id).update({
                        "mode": "QA_GAME",
                        "qa_state.current_question": question_text,
                        "qa_state.answers": {}
                    })
                except Exception as e:
                    print(f"Error updating QA in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "QA_STARTED",
                    "question": question_text,
                    "options": options_list,
                    "has_answer": has_answer
                    # 注意：故意不廣播 correct_index，避免前端能偷看正解
                })

            # 3. 參與者提交答案
            elif action == "SUBMIT_ANSWER":
                answer = data.get("answer")
                rooms[room_id]["qa_state"]["answers"][user_id] = answer

                try:
                    db.collection("rooms").document(room_id).update({
                        f"qa_state.answers.{user_id}": answer
                    })
                except Exception as e:
                    print(f"Error updating answer in Firestore: {e}")

                # 先廣播當前作答進度 (例如 "2/4 已作答")
                answers = rooms[room_id]["qa_state"]["answers"]
                members = rooms[room_id]["members"]

                print(f"[QA] room={room_id} user={user_id} answered={answer} | progress={len(answers)}/{len(members)}")

                await manager.broadcast_to_room(room_id, {
                    "type": "QA_PROGRESS",
                    "answered_count": len(answers),
                    "total_count": len(members)
                })

                # 全員答完 → 統計票數並廣播結果，自動回到 ACTIVE 模式
                if len(answers) >= len(members) and len(members) > 0:
                    print(f"[QA] room={room_id} ALL ANSWERED → broadcasting QA_FINISHED")
                    # 統計每個選項票數
                    results = {}
                    for ans in answers.values():
                        results[ans] = results.get(ans, 0) + 1

                    # 如果這題有正解，回傳正解 + 答對人數
                    qa_state_prev = rooms[room_id].get("qa_state") or {}
                    has_answer = bool(qa_state_prev.get("has_answer"))
                    correct_index = qa_state_prev.get("correct_index")
                    correct_option = None
                    correct_count = None
                    if has_answer and correct_index is not None:
                        opts_prev = qa_state_prev.get("current_options") or []
                        if 0 <= correct_index < len(opts_prev):
                            correct_option = opts_prev[correct_index]
                            correct_count = sum(1 for a in answers.values() if a == correct_option)

                    # 模式回到 ACTIVE (定錨)，清空題目
                    rooms[room_id]["mode"] = "ACTIVE"
                    rooms[room_id]["qa_state"] = {"current_question": None, "answers": {}}

                    try:
                        db.collection("rooms").document(room_id).update({
                            "mode": "ACTIVE",
                            "qa_state.current_question": None,
                            "qa_state.answers": {}
                        })
                    except Exception as e:
                        print(f"Error resetting QA state in Firestore: {e}")

                    finished_msg = {
                        "type": "QA_FINISHED",
                        "results": results,
                        "has_answer": has_answer,
                    }
                    if has_answer and correct_option is not None:
                        finished_msg["correct_option"] = correct_option
                        finished_msg["correct_count"] = correct_count
                    await manager.broadcast_to_room(room_id, finished_msg)

            # 4. 同步進度
            elif action == "SYNC_PROGRESS":
                progress = data.get("progress", 0)
                rooms[room_id]["members"][user_id]["progress"] = progress

                all_100 = all(m["progress"] == 100 for m in rooms[room_id]["members"].values())

                if all_100 and rooms[room_id]["status"] != "ACTIVE":
                    rooms[room_id]["status"] = "ACTIVE"

                    # 關鍵狀態變更：同步到 Firestore
                    try:
                        db.collection("rooms").document(room_id).update({
                            "status": "ACTIVE",
                            "members": rooms[room_id]["members"]
                        })
                    except Exception as e:
                        print(f"Error updating status in Firestore: {e}")

                    await manager.broadcast_to_room(room_id, {
                        "type": "ANCHOR_ESTABLISHED"
                    })
                else:
                    # 進度更新太頻繁，通常只廣播不寫入資料庫，以節省資源
                    await manager.broadcast_to_room(room_id, {
                        "type": "PROGRESS_UPDATE",
                        "members": rooms[room_id]["members"]
                    })

            # 5. 手機螢幕狀態偵測 (僅在非 QA 模式且已啟動時才廣播)
            elif action == "VISIBILITY_CHANGE":
                state = data.get("state")
                rooms[room_id]["members"][user_id]["state"] = state

                if rooms[room_id]["status"] == "ACTIVE" and rooms[room_id].get("mode") != "QA_GAME":
                    # 同步更新資料庫中的使用者狀態
                    try:
                        db.collection("rooms").document(room_id).update({
                            f"members.{user_id}.state": state
                        })
                    except Exception as e:
                        print(f"Error updating visibility in Firestore: {e}")

                    msg_type = "USER_WOKE_SCREEN" if state == "visible" else "USER_HID_SCREEN"
                    await manager.broadcast_to_room(room_id, {
                        "type": msg_type,
                        "user_id": user_id
                    })

            # 6. 紀錄偏差：這是重要數據，直接寫入並使用 Increment 原子操作
            elif action == "LOG_DEVIATION":
                rooms[room_id]["deviations"] += 1

                try:
                    db.collection("rooms").document(room_id).update({
                        "deviations": firestore.Increment(1)
                    })
                except Exception as e:
                    print(f"Error logging deviation in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "DEVIATION_RECORDED",
                    "user_id": user_id,
                    "total_deviations": rooms[room_id]["deviations"]
                })

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        if room_id in rooms and user_id in rooms[room_id]["members"]:
            # 從記憶體移除
            del rooms[room_id]["members"][user_id]

            # 從 Firestore 移除該成員
            try:
                db.collection("rooms").document(room_id).update({
                    f"members.{user_id}": firestore.DELETE_FIELD
                })
            except Exception as e:
                print(f"Error removing member from Firestore: {e}")

            await manager.broadcast_to_room(room_id, {
                "type": "ROOM_UPDATE",
                "room_state": rooms[room_id]
            })


if __name__ == "__main__":
    import uvicorn
    # 雲端環境會給一個 PORT 環境變數，如果沒有就預設用 8080
    port = int(os.environ.get("PORT", 8080))
    # 拿掉 reload=True，正式環境不需要熱重載
    uvicorn.run("main:app", host="0.0.0.0", port=port)
