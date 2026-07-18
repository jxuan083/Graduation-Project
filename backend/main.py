import uuid
import json
import asyncio
import qrcode
import io
import base64
import socket
import datetime
import time
import os
import random
import secrets
import string
import tempfile
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth, messaging as fb_messaging
from typing import Dict, Set, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException, Header, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pet_logic import (
    GROUP_PET_STAT_DEFAULTS,
    group_pet_current_stats as _group_pet_current_stats,
    group_pet_display as _group_pet_display,
    group_pet_hp as _group_pet_hp,
    group_pet_status as _group_pet_status,
    personal_pet_decay as _personal_pet_decay,
)

# Qwen 文案生成（失敗時 _build_newspaper 會 fallback 回規則版，故 import 失敗也不致命）
try:
    import llm
except Exception as _llm_err:  # noqa: BLE001
    llm = None
    print(f"[main] llm 模組載入失敗，newspaper 將只用規則版：{_llm_err}")

# ===== Firebase Storage 設定 =====
# 預設指向這個專案的 bucket；可以透過環境變數覆寫
STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET", "graduation-6ae65.firebasestorage.app")

# ===== Speech-to-text 設定 =====
# STT_ENGINE=openai-whisper 適合先做本機測試；STT_ENGINE=whisperx 可搭配 pyannote 做說話者分離。
STT_ENGINE = os.environ.get("STT_ENGINE", "openai-whisper").strip().lower()
STT_MODEL = os.environ.get("STT_MODEL", "small").strip()
STT_DEVICE = os.environ.get("STT_DEVICE", "cpu").strip()
STT_COMPUTE_TYPE = os.environ.get("STT_COMPUTE_TYPE", "int8").strip()
STT_BATCH_SIZE = int(os.environ.get("STT_BATCH_SIZE", "8"))
HUGGINGFACE_TOKEN = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
MAX_AUDIO_TRANSCRIPT_BYTES = int(os.environ.get("MAX_AUDIO_TRANSCRIPT_BYTES", str(50 * 1024 * 1024)))
ALLOWED_AUDIO_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/wav",
    "audio/webm", "audio/ogg", "video/webm", "video/mp4",
}
ALLOWED_AUDIO_EXTS = {".mp3", ".m4a", ".mp4", ".wav", ".webm", ".ogg"}
_STT_MODEL_CACHE: Dict[str, object] = {}

# 檢查是否已經有初始化的 Firebase App
if not firebase_admin._apps:
    local_key_path = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
    if os.path.exists(local_key_path):
        try:
            cred = credentials.Certificate(local_key_path)
            firebase_admin.initialize_app(cred, options={"storageBucket": STORAGE_BUCKET})
            print(f"Firebase initialized with local service account. Bucket: {STORAGE_BUCKET}")
        except Exception as e:
            print(f"Critical Error: Could not initialize Firebase with local JSON: {e}")
    else:
        try:
            # 在 Cloud Run 環境中，不需要 serviceAccountKey.json，它會自動抓取環境權限
            firebase_admin.initialize_app(options={"storageBucket": STORAGE_BUCKET})
            print(f"Firebase initialized with default credentials. Bucket: {STORAGE_BUCKET}")
        except Exception as e:
            print(f"Critical Error: Could not initialize Firebase with default credentials: {e}")

# 取得 Firestore 實例
db = firestore.client()

app = FastAPI()

# ===== CORS FOR FRONTEND SEPARATION =====
# 正式環境只允許本專案 Hosting；本機開發 origin 明確列舉，不開 wildcard。
DEFAULT_FRONTEND_ORIGINS = [
    "https://graduation-6ae65.web.app",
    "https://graduation-6ae65.firebaseapp.com",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5173",
]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", ",".join(DEFAULT_FRONTEND_ORIGINS)).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

BACKEND_VERSION = "v15.4-group-pet-avatar"
BACKEND_BUILD_DATE = "2026-06-02"  # 每次部署手動更新


def _is_guest_user_id(user_id: str) -> bool:
    """Guest ids are generated as uuid4; Firebase UIDs must not be inferred by punctuation."""
    try:
        uuid.UUID(str(user_id), version=4)
        return True
    except (ValueError, TypeError, AttributeError):
        return False


@app.get("/api/version")
async def get_version():
    """回傳後端版本 + 建置日期，前端 footer 會顯示這個"""
    return {"version": BACKEND_VERSION, "build_date": BACKEND_BUILD_DATE}


def make_qr_base64(data: str) -> str:
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


def _storage_bucket():
    from firebase_admin import storage as fb_storage
    return fb_storage.bucket()


@app.get("/api/qrcode")
async def get_qrcode(url: str):
    """回傳指定 URL 的 QR Code base64，供邀請 modal 與建立房間頁共用同一規則。"""
    if len(url) > 2048 or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="無效的 QR Code URL")
    return {"status": "success", "qr_base64": make_qr_base64(url)}


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
    handle: Optional[str] = None   # 自訂短 ID（唯一），用於加好友搜尋 / QR
    interests: Optional[List[str]] = None   # 個性/興趣標籤（最多 5 個）


MAX_INTERESTS = 5
MAX_INTEREST_LEN = 12


def _clean_interests(raw: List[str]) -> List[str]:
    """去除空白/重複，限制數量與單一標籤長度。"""
    cleaned: List[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        tag = item.strip()[:MAX_INTEREST_LEN]
        if tag and tag not in cleaned:
            cleaned.append(tag)
        if len(cleaned) >= MAX_INTERESTS:
            break
    return cleaned


@app.get("/api/me")
async def get_me(decoded: dict = Depends(verify_token)):
    """回傳目前登入者的 profile (沒有就自動建立)，並更新 last_seen（線上狀態用）"""
    profile = _ensure_user_doc(decoded)
    uid = profile.get("uid")
    if uid:
        try:
            db.collection("users").document(uid).set(
                {"last_seen": firestore.SERVER_TIMESTAMP}, merge=True
            )
        except Exception as e:
            print(f"[get_me] last_seen update failed: {e}")
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
    if payload.handle is not None:
        import re as _re
        handle = payload.handle.strip().lower()
        if handle:
            if not _re.fullmatch(r"[a-z0-9_]{3,20}", handle):
                raise HTTPException(status_code=400, detail="ID 只能用 3-20 個小寫英數字或底線")
            # 唯一性檢查：不能跟別人重複
            for d in db.collection("users").where("handle", "==", handle).limit(2).stream():
                if d.id != uid:
                    raise HTTPException(status_code=409, detail="這個 ID 已經有人使用了")
            update_data["handle"] = handle
        else:
            update_data["handle"] = ""   # 允許清空
    if payload.interests is not None:
        update_data["interests"] = _clean_interests(payload.interests)

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


# ===== 公開個人資料（給聚會中其他成員看） =====
@app.get("/api/users/{target_uid}/public")
async def get_public_profile(target_uid: str, decoded: dict = Depends(verify_token)):
    """
    回傳某個使用者的公開 profile（暱稱、頭像、bio）
    任何登入者都能呼叫（配合聚會中看其他成員資料用）
    """
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    snap = db.collection("users").document(target_uid).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個使用者")
    data = snap.to_dict() or {}
    return {
        "status": "success",
        "profile": {
            "uid": target_uid,
            "handle": data.get("handle", ""),
            "nickname": data.get("nickname", ""),
            "photoURL": data.get("photoURL", ""),
            "bio": data.get("bio", ""),
            "interests": data.get("interests", []),
        }
    }


@app.get("/api/users/by_handle/{handle}")
async def get_user_by_handle(handle: str, decoded: dict = Depends(verify_token)):
    """依自訂短 ID (handle) 找使用者，回傳公開 profile（加好友 ID 搜尋 / QR 用）。"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    h = (handle or "").strip().lower()
    if not h:
        raise HTTPException(status_code=400, detail="請提供 ID")
    found = next(iter(db.collection("users").where("handle", "==", h).limit(1).stream()), None)
    if not found:
        raise HTTPException(status_code=404, detail="找不到這個 ID 的使用者")
    data = found.to_dict() or {}
    return {"status": "success", "profile": {
        "uid": found.id,
        "handle": data.get("handle", ""),
        "nickname": data.get("nickname", ""),
        "photoURL": data.get("photoURL", ""),
        "bio": data.get("bio", ""),
    }}


@app.get("/api/users/{target_uid}/card")
async def get_user_card(target_uid: str, decoded: dict = Depends(verify_token)):
    """好友資料卡：公開 profile + 統計（好友數/聚會數/本週積分）+ 共同好友數 + 關係。"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    snap = db.collection("users").document(target_uid).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個使用者")
    data = snap.to_dict() or {}

    # 好友集合（對方 + 我）→ 共同好友
    their_friends = {d.id for d in db.collection("users").document(target_uid).collection("friends").stream()}
    my_friends = {d.id for d in db.collection("users").document(me_uid).collection("friends").stream()}
    mutual = len((their_friends & my_friends) - {me_uid, target_uid})

    # 聚會數 + 本週積分（用 users/{uid}/meetings 鏡像）
    meetings_count = 0
    weekly_score = 0
    try:
        start_utc = _week_start_utc_from_taipei()
        for d in db.collection("users").document(target_uid).collection("meetings").stream():
            md = d.to_dict() or {}
            meetings_count += 1
            ended = md.get("ended_at")
            if ended is not None and ended >= start_utc:
                weekly_score += int(md.get("score", 0) or 0)
    except Exception as e:
        print(f"[user_card] meetings agg failed: {e}")

    return {
        "status": "success",
        "profile": {
            "uid": target_uid,
            "handle": data.get("handle", ""),
            "nickname": data.get("nickname", ""),
            "photoURL": data.get("photoURL", ""),
            "bio": data.get("bio", ""),
            "interests": data.get("interests", []),
        },
        "stats": {
            "friends_count": len(their_friends),
            "meetings_count": meetings_count,
            "weekly_score": weekly_score,
        },
        "mutual_friends_count": mutual,
        "relationship": _relationship_status(me_uid, target_uid),
    }


# ===== 推播通知 (FCM) =====
class PushTokenPayload(BaseModel):
    token: str = Field(min_length=16, max_length=4096)


@app.post("/api/push_token")
async def register_push_token(payload: PushTokenPayload, decoded: dict = Depends(verify_token)):
    """前端拿到 FCM token 後上傳，存進 users/{uid}.fcm_tokens（陣列，同一人多裝置都留著）。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    token = (payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token 不可為空")

    _ensure_user_doc(decoded)
    try:
        user_ref = db.collection("users").document(uid)
        snap = user_ref.get()
        current = list((snap.to_dict() or {}).get("fcm_tokens") or [])
        # 防止無限累加過期 token 撐爆 Firestore document。
        tokens = [t for t in current if t != token][-9:] + [token]
        user_ref.update({"fcm_tokens": tokens})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"儲存 token 失敗: {e}")
    return {"status": "success"}


def send_push(uid: str, title: str, body: str, url: str = "/") -> None:
    """對某使用者名下所有已註冊裝置推播；過期/失效的 token 會被清掉。
    推播是錦上添花的通知，不應該讓主要業務流程（加好友、邀請）因為推播失敗而報錯，故一律吞例外。
    """
    try:
        snap = db.collection("users").document(uid).get()
        if not snap.exists:
            return
        tokens = (snap.to_dict() or {}).get("fcm_tokens") or []
        if not tokens:
            return

        message = fb_messaging.MulticastMessage(
            notification=fb_messaging.Notification(title=title, body=body),
            data={"url": url},
            tokens=tokens,
        )
        response = fb_messaging.send_each_for_multicast(message)

        if response.failure_count:
            dead_tokens = [
                tokens[i] for i, r in enumerate(response.responses)
                if not r.success and isinstance(r.exception, fb_messaging.UnregisteredError)
            ]
            if dead_tokens:
                db.collection("users").document(uid).update({
                    "fcm_tokens": firestore.ArrayRemove(dead_tokens),
                })
    except Exception as e:
        print(f"[push] send_push({uid}) failed: {e}")


# ===== 好友系統 =====
class FriendRequestPayload(BaseModel):
    target_uid: Optional[str] = None
    target_email: Optional[str] = None


def _relationship_status(me_uid: str, other_uid: str) -> str:
    """回傳兩個 uid 之間的關係：none / friend / outgoing_pending / incoming_pending"""
    if me_uid == other_uid:
        return "self"
    # 檢查 friends 子集合
    friend_snap = db.collection("users").document(me_uid).collection("friends").document(other_uid).get()
    if friend_snap.exists:
        return "friend"
    # 檢查我發出去的 pending
    q_out = db.collection("users").document(me_uid).collection("friend_requests") \
        .where("direction", "==", "outgoing") \
        .where("other_uid", "==", other_uid) \
        .where("status", "==", "pending") \
        .limit(1).stream()
    if any(True for _ in q_out):
        return "outgoing_pending"
    # 檢查我收到的 pending
    q_in = db.collection("users").document(me_uid).collection("friend_requests") \
        .where("direction", "==", "incoming") \
        .where("other_uid", "==", other_uid) \
        .where("status", "==", "pending") \
        .limit(1).stream()
    if any(True for _ in q_in):
        return "incoming_pending"
    return "none"


@app.get("/api/users/{target_uid}/relationship")
async def get_relationship(target_uid: str, decoded: dict = Depends(verify_token)):
    """查我和這個人目前的關係（用於顯示 ➕ 加好友 / ✓ 已是好友 / 等待回覆中）"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    status = _relationship_status(me_uid, target_uid)
    return {"status": "success", "relationship": status}


@app.post("/api/friend_requests")
async def send_friend_request(
    payload: FriendRequestPayload,
    background_tasks: BackgroundTasks,
    decoded: dict = Depends(verify_token),
):
    """發送好友邀請。可以用 target_uid 或 target_email 指定對方。"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    me_profile = _ensure_user_doc(decoded)

    # 找出對方 uid
    target_uid = (payload.target_uid or "").strip()
    target_email = (payload.target_email or "").strip().lower()
    if not target_uid and not target_email:
        raise HTTPException(status_code=400, detail="請提供 target_uid 或 target_email")

    if not target_uid and target_email:
        # 用 email 找 user
        q = db.collection("users").where("email", "==", target_email).limit(1).stream()
        found = None
        for doc in q:
            found = doc
            break
        if not found:
            raise HTTPException(status_code=404, detail="找不到這個 email 的使用者（對方需要先登入過本 App）")
        target_uid = found.id

    if target_uid == me_uid:
        raise HTTPException(status_code=400, detail="不能加自己為好友")

    # 檢查對方 user doc 存在
    target_snap = db.collection("users").document(target_uid).get()
    if not target_snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個使用者")
    target_data = target_snap.to_dict() or {}

    # 檢查關係狀態
    rel = _relationship_status(me_uid, target_uid)
    if rel == "friend":
        raise HTTPException(status_code=400, detail="你們已經是好友了")
    if rel == "outgoing_pending":
        raise HTTPException(status_code=400, detail="已經送出邀請，等待對方回覆中")
    if rel == "incoming_pending":
        # === 互加情境：對方已經邀請你 → 直接 auto-accept，雙方立即成為好友 ===
        # 找出對方發給我的那份 pending request（me 這邊是 incoming 方向）
        q = db.collection("users").document(me_uid).collection("friend_requests") \
            .where("direction", "==", "incoming") \
            .where("other_uid", "==", target_uid) \
            .where("status", "==", "pending") \
            .limit(1).stream()
        my_incoming_doc = next(iter(q), None)
        if my_incoming_doc is None:
            # 理論上到不了這裡（_relationship_status 剛剛才確認過），保險 fallback
            raise HTTPException(status_code=500, detail="找不到對方的邀請資料")

        req_id = my_incoming_doc.id
        now = firestore.SERVER_TIMESTAMP
        batch = db.batch()
        # 1. 雙邊 friends
        batch.set(db.collection("users").document(me_uid).collection("friends").document(target_uid), {
            "uid": target_uid,
            "nickname_snapshot": target_data.get("nickname", ""),
            "avatar_snapshot": target_data.get("photoURL", ""),
            "created_at": now,
        })
        batch.set(db.collection("users").document(target_uid).collection("friends").document(me_uid), {
            "uid": me_uid,
            "nickname_snapshot": me_profile.get("nickname", ""),
            "avatar_snapshot": me_profile.get("photoURL", ""),
            "created_at": now,
        })
        # 2. 雙邊 request 標 accepted
        my_req_ref = db.collection("users").document(me_uid).collection("friend_requests").document(req_id)
        their_req_ref = db.collection("users").document(target_uid).collection("friend_requests").document(req_id)
        batch.update(my_req_ref, {"status": "accepted", "resolved_at": now})
        if their_req_ref.get().exists:
            batch.update(their_req_ref, {"status": "accepted", "resolved_at": now})
        try:
            batch.commit()
        except Exception as e:
            print(f"[friend_request] mutual auto-accept batch failed: {e}")
            raise HTTPException(status_code=500, detail=f"自動成為好友失敗: {e}")

        background_tasks.add_task(
            send_push, target_uid, "互相邀請成功",
            f"你和 {me_profile.get('nickname', '朋友')} 已成為好友！", "/?open=friends"
        )

        return {
            "status": "auto_accepted",
            "target_uid": target_uid,
            "message": "對方也邀請了你，你們已成為好友！",
        }

    # 建立雙邊 friend_requests
    req_id = f"{me_uid}_{target_uid}_{int(datetime.datetime.now().timestamp())}"
    my_req = {
        "direction": "outgoing",
        "other_uid": target_uid,
        "other_nickname": target_data.get("nickname", ""),
        "other_avatar": target_data.get("photoURL", ""),
        "status": "pending",
        "pair_id": req_id,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    their_req = {
        "direction": "incoming",
        "other_uid": me_uid,
        "other_nickname": me_profile.get("nickname", ""),
        "other_avatar": me_profile.get("photoURL", ""),
        "status": "pending",
        "pair_id": req_id,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    try:
        db.collection("users").document(me_uid).collection("friend_requests").document(req_id).set(my_req)
        db.collection("users").document(target_uid).collection("friend_requests").document(req_id).set(their_req)
    except Exception as e:
        print(f"[friend_request] write failed: {e}")
        raise HTTPException(status_code=500, detail=f"發送邀請失敗: {e}")

    background_tasks.add_task(
        send_push, target_uid, "新的好友邀請",
        f"{me_profile.get('nickname', '有人')} 想加你為好友", "/?open=friends"
    )

    return {"status": "success", "request_id": req_id, "target_uid": target_uid}


@app.get("/api/friend_requests")
async def list_friend_requests(decoded: dict = Depends(verify_token)):
    """列出我的 incoming + outgoing pending 邀請"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    incoming, outgoing = [], []
    try:
        q = db.collection("users").document(me_uid).collection("friend_requests") \
            .where("status", "==", "pending").stream()
        for doc in q:
            d = doc.to_dict() or {}
            d["id"] = doc.id
            if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
                d["created_at"] = d["created_at"].isoformat()
            if d.get("direction") == "incoming":
                incoming.append(d)
            else:
                outgoing.append(d)
    except Exception as e:
        print(f"[list_requests] error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "success", "incoming": incoming, "outgoing": outgoing}


@app.post("/api/friend_requests/{req_id}/accept")
async def accept_friend_request(
    req_id: str,
    background_tasks: BackgroundTasks,
    decoded: dict = Depends(verify_token),
):
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    my_req_ref = db.collection("users").document(me_uid).collection("friend_requests").document(req_id)
    my_req_snap = my_req_ref.get()
    if not my_req_snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個邀請")
    my_req = my_req_snap.to_dict() or {}
    if my_req.get("direction") != "incoming":
        raise HTTPException(status_code=400, detail="只能接受別人發給你的邀請")
    if my_req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="這個邀請已經處理過了")

    other_uid = my_req.get("other_uid")
    if not other_uid:
        raise HTTPException(status_code=500, detail="邀請資料損毀，找不到對方 uid")

    # 拿雙方 profile snapshot（存在 friend doc 裡，避免每次都查）
    me_profile = _ensure_user_doc(decoded)
    other_snap = db.collection("users").document(other_uid).get()
    other_data = other_snap.to_dict() or {} if other_snap.exists else {}

    now = firestore.SERVER_TIMESTAMP
    batch = db.batch()
    # 雙邊 friends
    batch.set(db.collection("users").document(me_uid).collection("friends").document(other_uid), {
        "uid": other_uid,
        "nickname_snapshot": other_data.get("nickname", ""),
        "avatar_snapshot": other_data.get("photoURL", ""),
        "created_at": now,
    })
    batch.set(db.collection("users").document(other_uid).collection("friends").document(me_uid), {
        "uid": me_uid,
        "nickname_snapshot": me_profile.get("nickname", ""),
        "avatar_snapshot": me_profile.get("photoURL", ""),
        "created_at": now,
    })
    # 雙邊 request 標 accepted
    batch.update(my_req_ref, {"status": "accepted", "resolved_at": now})
    their_req_ref = db.collection("users").document(other_uid).collection("friend_requests").document(req_id)
    if their_req_ref.get().exists:
        batch.update(their_req_ref, {"status": "accepted", "resolved_at": now})

    try:
        batch.commit()
    except Exception as e:
        print(f"[accept] batch commit failed: {e}")
        raise HTTPException(status_code=500, detail=f"接受失敗: {e}")

    background_tasks.add_task(
        send_push, other_uid, "好友邀請被接受",
        f"{me_profile.get('nickname', '對方')} 接受了你的好友邀請", "/?open=friends"
    )

    return {"status": "success"}


@app.post("/api/friend_requests/{req_id}/decline")
async def decline_friend_request(req_id: str, decoded: dict = Depends(verify_token)):
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    my_req_ref = db.collection("users").document(me_uid).collection("friend_requests").document(req_id)
    my_req_snap = my_req_ref.get()
    if not my_req_snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個邀請")
    my_req = my_req_snap.to_dict() or {}
    other_uid = my_req.get("other_uid")
    if my_req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="這個邀請已經處理過了")

    now = firestore.SERVER_TIMESTAMP
    batch = db.batch()
    batch.update(my_req_ref, {"status": "declined", "resolved_at": now})
    if other_uid:
        their_req_ref = db.collection("users").document(other_uid).collection("friend_requests").document(req_id)
        if their_req_ref.get().exists:
            batch.update(their_req_ref, {"status": "declined", "resolved_at": now})
    try:
        batch.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"拒絕失敗: {e}")
    return {"status": "success"}


@app.post("/api/friend_requests/{req_id}/withdraw")
async def withdraw_friend_request(req_id: str, decoded: dict = Depends(verify_token)):
    """撤回自己送出的（outgoing）好友邀請。雙邊 request 直接刪除，讓兩人的列表都乾淨。"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    my_req_ref = db.collection("users").document(me_uid).collection("friend_requests").document(req_id)
    my_req_snap = my_req_ref.get()
    if not my_req_snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個邀請")
    my_req = my_req_snap.to_dict() or {}
    if my_req.get("direction") != "outgoing":
        raise HTTPException(status_code=400, detail="只能撤回自己送出的邀請")
    if my_req.get("status") != "pending":
        raise HTTPException(status_code=400, detail="這個邀請已經處理過了")

    other_uid = my_req.get("other_uid")
    batch = db.batch()
    batch.delete(my_req_ref)
    if other_uid:
        their_req_ref = db.collection("users").document(other_uid).collection("friend_requests").document(req_id)
        if their_req_ref.get().exists:
            batch.delete(their_req_ref)
    try:
        batch.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"撤回失敗: {e}")
    return {"status": "success"}


@app.get("/api/friends")
async def list_friends(decoded: dict = Depends(verify_token)):
    """列出我的所有好友（含最新 nickname/avatar snapshot）"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    friends = []
    try:
        q = db.collection("users").document(me_uid).collection("friends").stream()
        for doc in q:
            d = doc.to_dict() or {}
            d["uid"] = doc.id
            if d.get("created_at") and hasattr(d["created_at"], "isoformat"):
                d["created_at"] = d["created_at"].isoformat()
            # 補上對方最新的 last_seen（線上/上次上線時間），friend snapshot 沒存這欄
            try:
                fu = db.collection("users").document(doc.id).get()
                if fu.exists:
                    fud = fu.to_dict() or {}
                    ls = fud.get("last_seen")
                    if ls and hasattr(ls, "isoformat"):
                        d["last_seen"] = ls.isoformat()
                    elif ls:
                        d["last_seen"] = str(ls)
            except Exception:
                pass
            friends.append(d)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success", "friends": friends}


@app.delete("/api/friends/{friend_uid}")
async def remove_friend(friend_uid: str, decoded: dict = Depends(verify_token)):
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    batch = db.batch()
    batch.delete(db.collection("users").document(me_uid).collection("friends").document(friend_uid))
    batch.delete(db.collection("users").document(friend_uid).collection("friends").document(me_uid))
    try:
        batch.commit()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"解除好友失敗: {e}")
    return {"status": "success"}


# ===== 排行榜 =====
def _compute_meeting_score(duration_minutes: int, deviations: int, is_host: bool) -> int:
    """Phase 2 評分公式"""
    focus_points = max(0, 50 - int(deviations) * 5)
    participation_points = int(duration_minutes) * 0.5
    bonus = 10 if (int(deviations) == 0 and int(duration_minutes) >= 20) else 0
    host_bonus = 5 if is_host else 0
    return int(round(focus_points + participation_points + bonus + host_bonus))


def _build_score_ranking(all_ever: dict, host_uid: Optional[str], duration_minutes: int):
    """個人計分：每個人依「自己的」分心次數算分。

    回傳 (ranking, score_by_uid, avg_score)：
      - ranking   : 分數由高到低（同分時分心少的在前），每列含 score + deviations
      - score_by_uid: uid → 個人分數
      - avg_score : 全場平均分，代表「這場聚會整體表現」（群組寵物用）
    """
    rows = []
    score_by_uid: Dict[str, int] = {}
    for uid, info in (all_ever or {}).items():
        deviations = int((info or {}).get("deviations", 0) or 0)
        score = _compute_meeting_score(duration_minutes, deviations, is_host=(uid == host_uid))
        score_by_uid[uid] = score
        rows.append({
            "uid": uid,
            "nickname": (info or {}).get("nickname", ""),
            "deviations": deviations,
            "score": score,
        })

    rows.sort(key=lambda x: (-x["score"], x["deviations"]))
    avg_score = int(round(sum(score_by_uid.values()) / len(score_by_uid))) if score_by_uid else 0
    return rows, score_by_uid, avg_score


def _score_for_uid(uid: str, score_by_uid: dict, all_ever: dict, host_uid: Optional[str],
                   duration_minutes: int) -> int:
    """取某人的分數；若他不在 all_ever（例如已斷線的房主）則現算一份。"""
    score = score_by_uid.get(uid)
    if score is None:
        deviations = int((all_ever.get(uid) or {}).get("deviations", 0) or 0)
        score = _compute_meeting_score(duration_minutes, deviations, is_host=(uid == host_uid))
    return score


def _week_start_utc_from_taipei() -> datetime.datetime:
    """取得本週一 00:00（台北時區）對應的 UTC datetime"""
    # 台北時區 UTC+8
    tz_tw = datetime.timezone(datetime.timedelta(hours=8))
    now_tw = datetime.datetime.now(tz_tw)
    # Monday = 0
    monday_tw = (now_tw - datetime.timedelta(days=now_tw.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return monday_tw.astimezone(datetime.timezone.utc)


@app.get("/api/leaderboard/global")
async def get_leaderboard_global(
    period: str = "week",
    decoded: dict = Depends(verify_token)
):
    """全站週榜：本週台北時區週一起到現在"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    start_utc = _week_start_utc_from_taipei()

    # 用 collection_group query users/{uid}/meetings 這個鏡像
    agg: Dict[str, dict] = {}
    try:
        cg = db.collection_group("meetings").where("ended_at", ">=", start_utc)
        for doc in cg.stream():
            d = doc.to_dict() or {}
            owner_uid = d.get("owner_uid")
            if not owner_uid:
                continue
            score = int(d.get("score", 0) or 0)
            entry = agg.setdefault(owner_uid, {"uid": owner_uid, "score": 0, "meetings_count": 0})
            entry["score"] += score
            entry["meetings_count"] += 1
    except Exception as e:
        print(f"[leaderboard global] query failed: {e}")
        # collection_group 需要 index，一開始可能還沒有；回傳空清單
        return {"status": "success", "period": period, "period_start": start_utc.isoformat(), "entries": [], "note": "尚未建立索引，請到 Firebase Console 建立 collection_group index for 'meetings' on 'ended_at' asc"}

    # 把 uid 補上 nickname/avatar
    entries = []
    for uid, e in agg.items():
        snap = db.collection("users").document(uid).get()
        u = snap.to_dict() or {} if snap.exists else {}
        e["nickname"] = u.get("nickname", "")
        e["avatar_url"] = u.get("photoURL", "")
        entries.append(e)

    entries.sort(key=lambda x: x["score"], reverse=True)
    return {
        "status": "success",
        "period": period,
        "period_start": start_utc.isoformat(),
        "entries": entries[:50],
        "me_uid": me_uid,
    }


@app.get("/api/leaderboard/friends")
async def get_leaderboard_friends(
    period: str = "week",
    decoded: dict = Depends(verify_token)
):
    """好友圈週榜：自己 + 好友"""
    me_uid = decoded.get("uid") or decoded.get("user_id")
    if not me_uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    # 先取得好友 uid 清單
    uids = {me_uid}
    try:
        for doc in db.collection("users").document(me_uid).collection("friends").stream():
            uids.add(doc.id)
    except Exception as e:
        print(f"[leaderboard friends] list friends failed: {e}")

    start_utc = _week_start_utc_from_taipei()

    entries = []
    for uid in uids:
        total_score = 0
        meetings_count = 0
        try:
            q = db.collection("users").document(uid).collection("meetings") \
                .where("ended_at", ">=", start_utc).stream()
            for doc in q:
                d = doc.to_dict() or {}
                total_score += int(d.get("score", 0) or 0)
                meetings_count += 1
        except Exception as e:
            print(f"[leaderboard friends] query {uid} failed: {e}")
            continue
        snap = db.collection("users").document(uid).get()
        u = snap.to_dict() or {} if snap.exists else {}
        entries.append({
            "uid": uid,
            "score": total_score,
            "meetings_count": meetings_count,
            "nickname": u.get("nickname", ""),
            "avatar_url": u.get("photoURL", ""),
        })
    entries.sort(key=lambda x: x["score"], reverse=True)
    return {
        "status": "success",
        "period": period,
        "period_start": start_utc.isoformat(),
        "entries": entries,
        "me_uid": me_uid,
    }


# ===== 聚會紀錄 API =====
def _serialize_meeting(data: dict, doc_id: str) -> dict:
    """把 Firestore document 轉成可序列化的 dict（轉 datetime / sentinel）"""
    out = dict(data)
    out["id"] = doc_id
    # 不再回傳永久公開的 Storage URL；封面由通過身分驗證的 content API 讀取。
    out.pop("cover_url", None)
    cover_photo_id = out.get("cover_photo_id")
    if cover_photo_id:
        out["cover_content_path"] = f"/api/meetings/{doc_id}/photos/{cover_photo_id}/content"
    if out.get("ended_at") and hasattr(out["ended_at"], "isoformat"):
        out["ended_at"] = out["ended_at"].isoformat()
    elif out.get("ended_at"):
        out["ended_at"] = str(out["ended_at"])
    return out


@app.get("/api/meetings")
async def list_meetings(decoded: dict = Depends(verify_token)):
    """回傳目前使用者參與過的聚會清單（按結束時間倒序），含收藏與隱藏狀態"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    try:
        user_doc = db.collection("users").document(uid).get()
        user_data = (user_doc.to_dict() or {}) if user_doc.exists else {}
        favorited_set = set(user_data.get("favorited_meetings", []))
        hidden_set = set(user_data.get("hidden_meetings", []))

        query = db.collection("meetings").where("participants", "array_contains", uid).limit(100)
        docs = list(query.stream())
        meetings = [_serialize_meeting(d.to_dict() or {}, d.id) for d in docs]
        seen_ids = {m["id"] for m in meetings}

        # Fallback: END_SESSION 同時會寫 users/{uid}/meetings/{room_id} 鏡像。
        # 若主 meeting 文件因舊資料或 participants 欄位異常沒被 array_contains 查到，
        # 仍用鏡像補回列表，避免使用者明明有結束聚會卻看不到紀錄。
        try:
            mirror_docs = list(db.collection("users").document(uid).collection("meetings").limit(100).stream())
            for mirror_doc in mirror_docs:
                room_id = mirror_doc.id
                if room_id in seen_ids:
                    continue
                mirror_data = mirror_doc.to_dict() or {}
                main_doc = db.collection("meetings").document(room_id).get()
                if main_doc.exists:
                    data = main_doc.to_dict() or {}
                    data.setdefault("participants", [uid])
                    data.setdefault("duration_minutes", mirror_data.get("duration_minutes", 0))
                    data.setdefault("total_deviations", mirror_data.get("total_room_deviations", 0))
                    data.setdefault("ended_at", mirror_data.get("ended_at"))
                    data.setdefault("mode", mirror_data.get("mode", ""))
                else:
                    data = {
                        "room_id": room_id,
                        "participants": [uid],
                        "ended_at": mirror_data.get("ended_at"),
                        "duration_minutes": mirror_data.get("duration_minutes", 0),
                        "total_deviations": mirror_data.get("total_room_deviations", 0),
                        "mode": mirror_data.get("mode", ""),
                        "end_reason": mirror_data.get("end_reason", "host_ended"),
                        "member_count": 0,
                    }
                meetings.append(_serialize_meeting(data, room_id))
                seen_ids.add(room_id)
        except Exception as mirror_err:
            print(f"[meetings] mirror fallback failed for {uid}: {mirror_err}")

        # 依 ended_at 倒序排列（沒有的放最後）
        meetings.sort(key=lambda m: m.get("ended_at") or "", reverse=True)

        for m in meetings:
            m["is_favorited"] = m["id"] in favorited_set
            m["is_hidden"] = m["id"] in hidden_set

        return {"status": "success", "meetings": meetings}
    except Exception as e:
        print(f"Error listing meetings: {e}")
        raise HTTPException(status_code=500, detail=f"列出聚會失敗: {e}")


@app.patch("/api/meetings/{meeting_id}/favorite")
async def toggle_meeting_favorite(meeting_id: str, decoded: dict = Depends(verify_token)):
    """切換聚會的收藏狀態"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    try:
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        favorited = list((user_doc.to_dict() or {}).get("favorited_meetings", [])) if user_doc.exists else []

        if meeting_id in favorited:
            favorited.remove(meeting_id)
            is_favorited = False
        else:
            favorited.append(meeting_id)
            is_favorited = True

        user_ref.set({"favorited_meetings": favorited}, merge=True)
        return {"status": "success", "is_favorited": is_favorited}
    except Exception as e:
        print(f"Error toggling favorite: {e}")
        raise HTTPException(status_code=500, detail=f"切換收藏失敗: {e}")


@app.delete("/api/meetings/{meeting_id}")
async def hide_meeting(meeting_id: str, decoded: dict = Depends(verify_token)):
    """將聚會從使用者的列表中移除（隱藏，不刪除 Firestore 資料）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    try:
        user_ref = db.collection("users").document(uid)
        user_ref.set({
            "hidden_meetings": firestore.ArrayUnion([meeting_id]),
            "favorited_meetings": firestore.ArrayRemove([meeting_id]),
        }, merge=True)
        return {"status": "success"}
    except Exception as e:
        print(f"Error hiding meeting: {e}")
        raise HTTPException(status_code=500, detail=f"刪除聚會失敗: {e}")


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


# ===== 聚會照片 API =====
MAX_PHOTOS_PER_MEETING = 10
PHOTO_MAX_BYTES = 10 * 1024 * 1024  # 硬上限 10MB（前端壓縮後應該遠小於）


def _get_meeting_or_403(meeting_id: str, uid: str, require_host: bool = False) -> dict:
    """
    取得聚會資料：同時考慮 rooms（進行中）與 meetings（已結束/已保存）兩邊，
    只要使用者在任一邊被認定為合法身份就放行。

    背景：聚會結束後後端不會刪 rooms/{id}，但 rooms.members 只保留「目前還連線的成員」，
    中途離線的人會從 members dict 被移除。如果只看 rooms，中途離線但確實有參加過整場聚會
    的人結束後來看照片會被誤擋（bug #4）。
    meetings.participants 則是「這場聚會完整的參與者快照」，對結束的聚會最權威。
    兩邊取聯集才能同時 cover 進行中與結束後兩種情境。
    """
    meeting_doc = db.collection("meetings").document(meeting_id).get()
    room_doc = db.collection("rooms").document(meeting_id).get()

    if not meeting_doc.exists and not room_doc.exists:
        raise HTTPException(status_code=404, detail="找不到這場聚會紀錄")

    meeting_data = meeting_doc.to_dict() if meeting_doc.exists else {}
    room_data = room_doc.to_dict() if room_doc.exists else {}

    participants = meeting_data.get("participants") or []
    room_host_uid = room_data.get("host_uid")
    room_members = room_data.get("members") or {}

    # 身份聯集：meetings.participants  ∪  rooms.host_uid  ∪  rooms.members
    in_meeting = uid in participants
    in_room = (uid == room_host_uid) or (uid in room_members)

    if not (in_meeting or in_room):
        raise HTTPException(status_code=403, detail="你沒有參與這場聚會")

    # host_uid 優先看 meetings（結束後的穩定快照），沒有才看 rooms
    final_host_uid = meeting_data.get("host_uid") or room_host_uid
    if require_host and final_host_uid != uid:
        raise HTTPException(status_code=403, detail="只有房主可以執行此操作")

    # 回傳 merged 資料：以 meetings 為主，缺欄位才從 rooms 補
    merged = dict(room_data)
    for k, v in meeting_data.items():
        if v is not None:
            merged[k] = v
    return merged


def _serialize_photo(data: dict, doc_id: str) -> dict:
    out = dict(data)
    out["id"] = doc_id
    meeting_id = out.pop("meeting_id", None)
    out.pop("url", None)
    if meeting_id:
        out["content_path"] = f"/api/meetings/{meeting_id}/photos/{doc_id}/content"
    ts = out.get("uploaded_at")
    if ts and hasattr(ts, "isoformat"):
        out["uploaded_at"] = ts.isoformat()
    elif ts:
        out["uploaded_at"] = str(ts)
    return out


def _resolve_photo_upload_uid(authorization: Optional[str], guest_uid: Optional[str]) -> str:
    if authorization and authorization.startswith("Bearer "):
        id_token = authorization.split(" ", 1)[1].strip()
        try:
            decoded = fb_auth.verify_id_token(id_token)
        except Exception as e:
            print(f"Photo upload token verification failed: {e}")
            raise HTTPException(status_code=401, detail=f"Token 驗證失敗: {e}")
        uid = decoded.get("uid") or decoded.get("user_id")
        if not uid:
            raise HTTPException(status_code=401, detail="Token 內無 uid")
        return uid

    guest_uid = (guest_uid or "").strip()
    if guest_uid:
        if not _is_guest_user_id(guest_uid):
            raise HTTPException(status_code=401, detail="訪客身份無效")
        return guest_uid

    raise HTTPException(status_code=401, detail="請先登入或加入聚會")


@app.post("/api/meetings/{meeting_id}/photos")
async def upload_meeting_photo(
    meeting_id: str,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    x_guest_uid: Optional[str] = Header(None),
):
    """參與者上傳照片到 Firebase Storage，並在 Firestore 存 metadata"""
    uid = _resolve_photo_upload_uid(authorization, x_guest_uid)

    _get_meeting_or_403(meeting_id, uid)

    # 檢查數量上限
    photos_col = db.collection("meetings").document(meeting_id).collection("photos")
    existing = list(photos_col.stream())
    if len(existing) >= MAX_PHOTOS_PER_MEETING:
        raise HTTPException(status_code=400, detail=f"每場聚會最多 {MAX_PHOTOS_PER_MEETING} 張照片")

    # 🔒 [Bug 4 修正 v15.3] content_type 白名單,排除 SVG (含可執行 script,
    #     若使用者直接點 storage URL 會在 storage.googleapis.com 域下執行 JS)
    ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
    if not file.content_type or file.content_type not in ALLOWED_PHOTO_TYPES:
        raise HTTPException(status_code=400, detail="只接受 JPEG / PNG / WebP / HEIC 圖片")

    try:
        content = await file.read()
        if len(content) > PHOTO_MAX_BYTES:
            raise HTTPException(status_code=400, detail="檔案太大 (>10MB)")

        # 副檔名(白名單,並依 content_type 為主而不是 filename)
        ext_by_ct = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}
        ext = ext_by_ct[file.content_type]
        photo_id = uuid.uuid4().hex
        blob_name = f"meeting-photos/{meeting_id}/{photo_id}.{ext}"

        bucket = _storage_bucket()
        blob = bucket.blob(blob_name)
        blob.upload_from_string(content, content_type=file.content_type)
        # Blob 保持 private；前端改經過有參與者驗證的 content API 取圖。

        # 寫 Firestore
        is_first = len(existing) == 0
        payload = {
            "meeting_id": meeting_id,
            "storage_path": blob_name,
            "content_type": file.content_type,
            "uploaded_by": uid,
            "uploaded_at": firestore.SERVER_TIMESTAMP,
            "is_cover": is_first,  # 第一張自動設為封面
        }
        photos_col.document(photo_id).set(payload)

        # 如果這是第一張，更新 meeting doc 方便清單直接顯示封面縮圖
        # 用 set + merge=True：聚會進行中 meetings/{id} 還不存在也能寫入（END_SESSION 會再 merge 其餘欄位）
        if is_first:
            db.collection("meetings").document(meeting_id).set({
                "cover_photo_id": photo_id,
                "cover_url": firestore.DELETE_FIELD,
            }, merge=True)

        saved = payload.copy()
        saved["uploaded_at"] = datetime.datetime.utcnow().isoformat()
        return {"status": "success", "photo": _serialize_photo(saved, photo_id)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error uploading photo: {e}")
        raise HTTPException(status_code=500, detail=f"上傳失敗: {e}")


@app.get("/api/meetings/{meeting_id}/photos")
async def list_meeting_photos(meeting_id: str, decoded: dict = Depends(verify_token)):
    """列出聚會的所有照片（參與者即可查看）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _get_meeting_or_403(meeting_id, uid)

    photos_col = db.collection("meetings").document(meeting_id).collection("photos")
    docs = list(photos_col.stream())
    photos = [_serialize_photo(d.to_dict() or {}, d.id) for d in docs]
    for photo in photos:
        photo["content_path"] = f"/api/meetings/{meeting_id}/photos/{photo['id']}/content"
    # 封面優先，其餘照 uploaded_at 先後排列
    photos.sort(key=lambda p: (not p.get("is_cover"), p.get("uploaded_at") or ""))
    return {"status": "success", "photos": photos, "max": MAX_PHOTOS_PER_MEETING}


@app.get("/api/meetings/{meeting_id}/photos/{photo_id}/content")
async def get_meeting_photo_content(
    meeting_id: str,
    photo_id: str,
    decoded: dict = Depends(verify_token),
):
    """經過參與者驗證後回傳 private Storage 圖片。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _get_meeting_or_403(meeting_id, uid)

    photo_ref = db.collection("meetings").document(meeting_id).collection("photos").document(photo_id)
    photo_doc = photo_ref.get()
    if not photo_doc.exists:
        raise HTTPException(status_code=404, detail="找不到這張照片")
    photo = photo_doc.to_dict() or {}
    storage_path = photo.get("storage_path")
    if not storage_path:
        raise HTTPException(status_code=404, detail="照片檔案不存在")

    try:
        blob = _storage_bucket().blob(storage_path)
        content = blob.download_as_bytes()
        # 舊版本上傳過的公開 blob 在第一次合法讀取時順便收回 public ACL。
        try:
            blob.make_private()
        except Exception as acl_err:
            print(f"[photo] make_private skipped for {storage_path}: {acl_err}")
        return Response(
            content=content,
            media_type=photo.get("content_type") or blob.content_type or "image/jpeg",
            headers={"Cache-Control": "private, max-age=300"},
        )
    except Exception as e:
        print(f"[photo] download failed for {storage_path}: {e}")
        raise HTTPException(status_code=500, detail="讀取照片失敗")


@app.delete("/api/meetings/{meeting_id}/photos/{photo_id}")
async def delete_meeting_photo(
    meeting_id: str, photo_id: str, decoded: dict = Depends(verify_token)
):
    """房主刪除指定的照片（連同 Storage 裡的 blob）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _get_meeting_or_403(meeting_id, uid, require_host=True)

    photo_ref = db.collection("meetings").document(meeting_id).collection("photos").document(photo_id)
    photo_doc = photo_ref.get()
    if not photo_doc.exists:
        raise HTTPException(status_code=404, detail="找不到這張照片")
    photo_data = photo_doc.to_dict() or {}
    was_cover = bool(photo_data.get("is_cover"))

    # 刪 Storage（失敗不阻斷 Firestore 的刪除，避免殘留指向不存在檔案的 metadata）
    try:
        blob_name = photo_data.get("storage_path")
        if blob_name:
            bucket = _storage_bucket()
            blob = bucket.blob(blob_name)
            if blob.exists():
                blob.delete()
    except Exception as e:
        print(f"Warning: failed to delete blob: {e}")

    photo_ref.delete()

    # 如果刪的是封面，把第一張剩下的照片升格成封面
    if was_cover:
        remaining = list(db.collection("meetings").document(meeting_id).collection("photos").stream())
        if remaining:
            new_cover = remaining[0]
            new_cover.reference.update({"is_cover": True})
            new_data = new_cover.to_dict() or {}
            db.collection("meetings").document(meeting_id).set({
                "cover_photo_id": new_cover.id,
                "cover_url": firestore.DELETE_FIELD,
            }, merge=True)
        else:
            # 只有在 meetings doc 存在時才移除封面欄位（進行中的聚會還沒建立 doc，無須處理）
            try:
                meeting_doc = db.collection("meetings").document(meeting_id).get()
                if meeting_doc.exists:
                    db.collection("meetings").document(meeting_id).update({
                        "cover_url": firestore.DELETE_FIELD,
                        "cover_photo_id": firestore.DELETE_FIELD,
                    })
            except Exception as e:
                print(f"Warning: clear cover fields failed: {e}")

    return {"status": "success"}


@app.patch("/api/meetings/{meeting_id}/photos/{photo_id}/cover")
async def set_meeting_photo_cover(
    meeting_id: str, photo_id: str, decoded: dict = Depends(verify_token)
):
    """房主指定某張為封面"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _get_meeting_or_403(meeting_id, uid, require_host=True)

    photos_col = db.collection("meetings").document(meeting_id).collection("photos")
    target_ref = photos_col.document(photo_id)
    target_doc = target_ref.get()
    if not target_doc.exists:
        raise HTTPException(status_code=404, detail="找不到這張照片")

    # 所有照片的 is_cover 一次重寫：目標 True，其餘 False
    batch = db.batch()
    for d in photos_col.stream():
        batch.update(d.reference, {"is_cover": d.id == photo_id})
    batch.commit()

    target_data = target_doc.to_dict() or {}
    db.collection("meetings").document(meeting_id).set({
        "cover_photo_id": photo_id,
        "cover_url": firestore.DELETE_FIELD,
    }, merge=True)
    return {"status": "success"}


# ===== 聚會逐字稿 / Newspaper API =====
class TranscriptEntryPayload(BaseModel):
    speaker_uid: str
    speaker_name: Optional[str] = None
    text: str
    started_at_ms: Optional[int] = None
    duration_sec: Optional[float] = None


class TranscriptUploadPayload(BaseModel):
    entries: List[TranscriptEntryPayload]


def _serialize_transcript(data: dict, doc_id: str) -> dict:
    out = dict(data)
    out["id"] = doc_id
    ts = out.get("created_at")
    if ts and hasattr(ts, "isoformat"):
        out["created_at"] = ts.isoformat()
    elif ts:
        out["created_at"] = str(ts)
    return out


def _speech_units(text: str) -> int:
    """粗略估算發言量：英文以詞數為主，中文以非空白字元數折算。"""
    text = (text or "").strip()
    if not text:
        return 0
    words = [w for w in text.replace("\n", " ").split(" ") if w.strip()]
    non_space_chars = len("".join(text.split()))
    return max(len(words), int(non_space_chars / 2))


def _clean_transcript_text(text: str, limit: int = 180) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def _collect_meeting_transcripts(meeting_id: str) -> list:
    docs = list(
        db.collection("meetings")
        .document(meeting_id)
        .collection("transcripts")
        .order_by("started_at_ms")
        .stream()
    )
    return [_serialize_transcript(d.to_dict() or {}, d.id) for d in docs]


def _collect_meeting_photos(meeting_id: str) -> list:
    docs = list(db.collection("meetings").document(meeting_id).collection("photos").stream())
    photos = []
    for doc in docs:
        data = doc.to_dict() or {}
        data["meeting_id"] = meeting_id
        photos.append(_serialize_photo(data, doc.id))
    photos.sort(key=lambda p: (not p.get("is_cover"), p.get("uploaded_at") or ""))
    return photos


def _speaker_display_name(raw_speaker: str, speaker_map: dict) -> str:
    if raw_speaker in speaker_map:
        return speaker_map[raw_speaker]
    label = f"Speaker {len(speaker_map) + 1}"
    speaker_map[raw_speaker] = label
    return label


def _is_low_confidence_whisper_segment(segment: dict, text: str) -> bool:
    """Filter common Whisper hallucinations from short/silent meeting chunks."""
    stripped = (text or "").strip()
    if not stripped:
        return True
    duration = float(segment.get("end") or 0) - float(segment.get("start") or 0)
    no_speech_prob = segment.get("no_speech_prob")
    avg_logprob = segment.get("avg_logprob")
    compression_ratio = segment.get("compression_ratio")
    if no_speech_prob is not None and float(no_speech_prob) >= 0.55:
        return True
    if avg_logprob is not None and float(avg_logprob) < -1.0:
        return True
    if compression_ratio is not None and float(compression_ratio) > 2.4:
        return True
    if duration < 1.0 and len(stripped) <= 4:
        return True
    return False


def _normalize_stt_segments(segments: list, engine: str, language: str = "") -> list:
    speaker_map = {}
    entries = []
    for idx, seg in enumerate(segments or []):
        text = " ".join((seg.get("text") or "").split())
        if engine == "openai-whisper" and _is_low_confidence_whisper_segment(seg, text):
            print(f"[stt] dropped low-confidence segment: {text}")
            continue
        if not text:
            continue
        raw_speaker = (
            seg.get("speaker")
            or seg.get("speaker_id")
            or seg.get("speaker_uid")
            or "SPEAKER_1"
        )
        start = float(seg.get("start") or 0)
        end = float(seg.get("end") or start)
        speaker_name = _speaker_display_name(str(raw_speaker), speaker_map)
        entries.append({
            "speaker_uid": str(raw_speaker)[:80],
            "speaker_name": speaker_name,
            "text": text,
            "started_at_ms": int(start * 1000),
            "duration_sec": max(0.0, round(end - start, 2)),
            "source": "audio",
            "transcription_engine": engine,
            "language": language,
            "segment_index": idx,
        })
    return entries


def _save_transcript_entries(meeting_id: str, uid: str, entries: list, source: str = "manual") -> int:
    col = db.collection("meetings").document(meeting_id).collection("transcripts")
    batch = db.batch()
    saved_count = 0

    for entry in entries:
        text = (entry.get("text") or "").strip()
        speaker_uid = (entry.get("speaker_uid") or "").strip()
        if not text or not speaker_uid:
            continue
        doc_ref = col.document(uuid.uuid4().hex)
        batch.set(doc_ref, {
            "speaker_uid": speaker_uid[:80],
            "speaker_name": (entry.get("speaker_name") or "").strip()[:40],
            "text": text[:2000],
            "started_at_ms": int(entry.get("started_at_ms") or 0),
            "duration_sec": float(entry.get("duration_sec") or 0),
            "source": (entry.get("source") or source)[:30],
            "transcription_engine": (entry.get("transcription_engine") or "")[:40],
            "language": (entry.get("language") or "")[:20],
            "created_by": uid,
            "created_at": firestore.SERVER_TIMESTAMP,
        })
        saved_count += 1

    if saved_count:
        batch.commit()
        db.collection("meetings").document(meeting_id).set({
            "transcript_count": firestore.Increment(saved_count),
            "updated_at": firestore.SERVER_TIMESTAMP,
        }, merge=True)
    return saved_count


def _get_cached_whisperx_model():
    import whisperx

    key = f"whisperx:{STT_MODEL}:{STT_DEVICE}:{STT_COMPUTE_TYPE}"
    if key not in _STT_MODEL_CACHE:
        _STT_MODEL_CACHE[key] = whisperx.load_model(
            STT_MODEL,
            STT_DEVICE,
            compute_type=STT_COMPUTE_TYPE,
        )
    return _STT_MODEL_CACHE[key]


def _transcribe_with_whisperx(
    audio_path: str,
    language: Optional[str],
    min_speakers: Optional[int],
    max_speakers: Optional[int],
) -> dict:
    import whisperx

    model = _get_cached_whisperx_model()
    audio = whisperx.load_audio(audio_path)
    kwargs = {}
    if language:
        kwargs["language"] = language
    result = model.transcribe(audio, batch_size=STT_BATCH_SIZE, **kwargs)
    detected_language = result.get("language") or language or ""

    try:
        align_model, metadata = whisperx.load_align_model(
            language_code=detected_language,
            device=STT_DEVICE,
        )
        result = whisperx.align(
            result.get("segments", []),
            align_model,
            metadata,
            audio,
            STT_DEVICE,
            return_char_alignments=False,
        )
    except Exception as e:
        print(f"[stt] WhisperX alignment skipped: {e}")

    diarization_enabled = False
    if HUGGINGFACE_TOKEN:
        try:
            diarize_model = whisperx.DiarizationPipeline(
                use_auth_token=HUGGINGFACE_TOKEN,
                device=STT_DEVICE,
            )
            diarize_kwargs = {}
            if min_speakers:
                diarize_kwargs["min_speakers"] = int(min_speakers)
            if max_speakers:
                diarize_kwargs["max_speakers"] = int(max_speakers)
            diarize_segments = diarize_model(audio, **diarize_kwargs)
            result = whisperx.assign_word_speakers(diarize_segments, result)
            diarization_enabled = True
        except Exception as e:
            print(f"[stt] WhisperX diarization skipped: {e}")
    else:
        print("[stt] HUGGINGFACE_TOKEN not set; diarization skipped")

    entries = _normalize_stt_segments(
        result.get("segments", []),
        "whisperx",
        detected_language,
    )
    return {
        "engine": "whisperx",
        "language": detected_language,
        "diarization": diarization_enabled,
        "entries": entries,
    }


def _get_cached_openai_whisper_model():
    import whisper

    key = f"openai-whisper:{STT_MODEL}:{STT_DEVICE}"
    if key not in _STT_MODEL_CACHE:
        _STT_MODEL_CACHE[key] = whisper.load_model(STT_MODEL, device=STT_DEVICE)
    return _STT_MODEL_CACHE[key]


def _transcribe_with_openai_whisper(audio_path: str, language: Optional[str]) -> dict:
    model = _get_cached_openai_whisper_model()
    kwargs = {
        "fp16": STT_DEVICE != "cpu",
        "temperature": 0,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.55,
        "logprob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
        "initial_prompt": "以下是繁體中文的聚會對話逐字稿。",
    }
    if language:
        kwargs["language"] = language
    result = model.transcribe(audio_path, **kwargs)
    detected_language = result.get("language") or language or ""
    entries = _normalize_stt_segments(
        result.get("segments", []),
        "openai-whisper",
        detected_language,
    )
    return {
        "engine": "openai-whisper",
        "language": detected_language,
        "diarization": False,
        "entries": entries,
    }


def _transcribe_audio_file(
    audio_path: str,
    language: Optional[str],
    min_speakers: Optional[int],
    max_speakers: Optional[int],
) -> dict:
    if STT_ENGINE == "whisperx":
        return _transcribe_with_whisperx(audio_path, language, min_speakers, max_speakers)
    return _transcribe_with_openai_whisper(audio_path, language)


def _build_participation(transcripts: list, meeting: dict) -> list:
    stats: Dict[str, dict] = {}

    for entry in transcripts:
        uid = entry.get("speaker_uid") or "unknown"
        row = stats.setdefault(uid, {
            "uid": uid,
            "nickname": entry.get("speaker_name") or uid,
            "utterance_count": 0,
            "speech_units": 0,
            "talk_time_sec": 0.0,
        })
        row["utterance_count"] += 1
        row["speech_units"] += _speech_units(entry.get("text", ""))
        row["talk_time_sec"] += float(entry.get("duration_sec") or 0)
        if entry.get("speaker_name"):
            row["nickname"] = entry.get("speaker_name")

    # 沒有逐字稿時，至少用聚會成員快照產生 baseline，前端仍可顯示 newspaper。
    if not stats:
        for member in meeting.get("members_snapshot") or []:
            uid = member.get("uid") or member.get("nickname") or "unknown"
            stats[uid] = {
                "uid": uid,
                "nickname": member.get("nickname") or uid,
                "utterance_count": 0,
                "speech_units": 0,
                "talk_time_sec": 0.0,
            }

    max_units = max([v["speech_units"] for v in stats.values()] + [1])
    max_utterances = max([v["utterance_count"] for v in stats.values()] + [1])

    rows = []
    for row in stats.values():
        # 以發言內容量與發言次數混合估算參與度。
        score = int(round(
            (row["speech_units"] / max_units) * 70 +
            (row["utterance_count"] / max_utterances) * 30
        ))
        if row["utterance_count"] == 0:
            role = "Memory keeper"
        elif score >= 75:
            role = "Conversation starter"
        elif score >= 45:
            role = "Active participant"
        else:
            role = "Thoughtful listener"

        rows.append({
            **row,
            "talk_time_sec": round(row["talk_time_sec"], 1),
            "participation_score": score,
            "role": role,
        })

    rows.sort(key=lambda x: x["participation_score"], reverse=True)
    return rows


def _extract_key_points(transcripts: list) -> list:
    candidates = []
    for entry in transcripts:
        text = _clean_transcript_text(entry.get("text", ""), limit=120)
        if len(text) >= 12:
            candidates.append({
                "speaker": entry.get("speaker_name") or entry.get("speaker_uid") or "",
                "text": text,
            })

    if not candidates:
        return [
            {"speaker": "", "text": "這場聚會尚未加入逐字稿，系統先以照片與參與者資料產生回顧。"}
        ]

    # 優先挑較完整的句子，避免整份 newspaper 只出現零碎短句。
    candidates.sort(key=lambda x: len(x["text"]), reverse=True)
    return candidates[:5]


def _extract_topics(transcripts: list) -> list:
    stopwords = {
        "the", "and", "that", "this", "with", "have", "just", "really",
        "今天", "大家", "就是", "那個", "我們", "你們", "他們", "覺得", "然後", "因為", "所以"
    }
    counts: Dict[str, int] = {}
    for entry in transcripts:
        text = (entry.get("text") or "").lower()
        tokens = []
        for raw in text.replace("，", " ").replace("。", " ").replace(",", " ").replace(".", " ").split():
            token = raw.strip("!?！？、:：;；()[]{}\"'")
            if len(token) >= 2 and token not in stopwords:
                tokens.append(token)
        for token in tokens:
            counts[token] = counts.get(token, 0) + 1

    topics = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:6]
    if not topics:
        return ["聚會回顧", "照片回憶", "朋友互動"]
    return [t for t, _ in topics]


def _build_newspaper(meeting_id: str, meeting: dict, transcripts: list, photos: list) -> dict:
    participation = _build_participation(transcripts, meeting)
    key_points = _extract_key_points(transcripts)
    topics = _extract_topics(transcripts)

    title_mode = meeting.get("mode") or "Gathering"
    member_count = meeting.get("member_count") or len(meeting.get("members_snapshot") or [])
    duration = meeting.get("duration_minutes") or 0
    cover = next((p for p in photos if p.get("is_cover")), photos[0] if photos else None)

    lead = (
        f"這場 {title_mode} 聚會共有 {member_count} 位成員參與，"
        f"持續約 {duration} 分鐘。系統整理了對話重點、參與度與照片，"
        "生成這份聚會回顧報。"
    )

    top_people = participation[:3]
    spotlights = [
        {
            "uid": p["uid"],
            "nickname": p["nickname"],
            "role": p["role"],
            "participation_score": p["participation_score"],
            "summary": f"{p['nickname']} 在本次聚會中被標記為 {p['role']}，共發言 {p['utterance_count']} 次。"
        }
        for p in top_people
    ]

    newspaper = {
        "id": "newspaper",
        "meeting_id": meeting_id,
        "style": "social_newspaper",
        "title": "Party Newspaper",
        "subtitle": f"{title_mode} recap",
        "lead": lead,
        "highlights": [],
        "cover_photo": cover,
        "photo_count": len(photos),
        "photos": photos[:10],
        "topics": topics,
        "key_points": key_points,
        "participation": participation,
        "spotlights": spotlights,
        "stats": {
            "member_count": member_count,
            "duration_minutes": duration,
            "transcript_entries": len(transcripts),
            "total_deviations": meeting.get("total_deviations", 0),
        },
        "generated_by": "rules",
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }

    # ── 用 Qwen 生成更自然的文案疊加上去；任何失敗都保留上面的規則版 ──
    _enrich_newspaper_with_llm(newspaper)
    return newspaper


def _enrich_newspaper_with_llm(newspaper: dict) -> None:
    """呼叫 Qwen 生成文案並就地覆蓋 newspaper 的文字欄位。

    只覆蓋 title / subtitle / lead / highlights，以及 spotlights 的 summary（按 uid 對應）；
    參與度分數、統計數字、照片一律不動，確保數據正確。失敗則原封不動（=規則版）。
    """
    if llm is None:
        return
    context = {
        "mode": newspaper.get("subtitle", "").replace(" recap", "") or "聚會",
        "member_count": newspaper["stats"]["member_count"],
        "duration_minutes": newspaper["stats"]["duration_minutes"],
        "topics": newspaper.get("topics") or [],
        "photo_count": newspaper.get("photo_count") or 0,
        "participation": newspaper.get("participation") or [],
        "key_points": newspaper.get("key_points") or [],
    }
    try:
        copy = llm.generate_newspaper_copy(context)
    except Exception as e:  # noqa: BLE001
        print(f"[main] Qwen enrich 例外，保留規則版：{e}")
        return
    if not copy:
        return

    if copy.get("title"):
        newspaper["title"] = copy["title"]
    if copy.get("subtitle"):
        newspaper["subtitle"] = copy["subtitle"]
    if copy.get("lead"):
        newspaper["lead"] = copy["lead"]
    if copy.get("highlights"):
        newspaper["highlights"] = copy["highlights"]

    ai_spotlights = copy.get("spotlights") or {}
    for sp in newspaper.get("spotlights") or []:
        ai_text = ai_spotlights.get(sp.get("uid"))
        if ai_text:
            sp["summary"] = ai_text

    newspaper["generated_by"] = "qwen-plus"


@app.post("/api/meetings/{meeting_id}/transcripts")
async def upload_meeting_transcripts(
    meeting_id: str,
    payload: TranscriptUploadPayload,
    decoded: dict = Depends(verify_token),
):
    """儲存聚會逐字稿片段。前端錄音/STT 完成後可批次上傳。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    _get_meeting_or_403(meeting_id, uid)

    if not payload.entries:
        raise HTTPException(status_code=400, detail="entries 不能是空的")
    if len(payload.entries) > 200:
        raise HTTPException(status_code=400, detail="一次最多上傳 200 筆逐字稿")

    entries = [
        {
            "speaker_uid": entry.speaker_uid,
            "speaker_name": entry.speaker_name,
            "text": entry.text,
            "started_at_ms": entry.started_at_ms,
            "duration_sec": entry.duration_sec,
            "source": "manual",
        }
        for entry in payload.entries
    ]
    saved_count = _save_transcript_entries(meeting_id, uid, entries, source="manual")

    if saved_count == 0:
        raise HTTPException(status_code=400, detail="沒有可儲存的逐字稿內容")
    return {"status": "success", "saved": saved_count}


@app.post("/api/meetings/{meeting_id}/transcripts/audio")
async def transcribe_meeting_audio(
    meeting_id: str,
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    min_speakers: Optional[int] = Form(None),
    max_speakers: Optional[int] = Form(None),
    started_at_ms_offset: Optional[int] = Form(0),
    decoded: dict = Depends(verify_token),
):
    """上傳聚會錄音，使用 WhisperX / Whisper 轉文字並寫入逐字稿集合。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    _get_meeting_or_403(meeting_id, uid)

    filename = file.filename or ""
    _, ext = os.path.splitext(filename.lower())
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_AUDIO_TYPES and ext not in ALLOWED_AUDIO_EXTS:
        raise HTTPException(status_code=400, detail="只接受 mp3 / m4a / wav / webm / ogg / mp4 音檔")
    if min_speakers is not None and (min_speakers < 1 or min_speakers > 12):
        raise HTTPException(status_code=400, detail="min_speakers 必須介於 1 到 12")
    if max_speakers is not None and (max_speakers < 1 or max_speakers > 12):
        raise HTTPException(status_code=400, detail="max_speakers 必須介於 1 到 12")
    if min_speakers and max_speakers and min_speakers > max_speakers:
        raise HTTPException(status_code=400, detail="min_speakers 不能大於 max_speakers")

    suffix = ext if ext in ALLOWED_AUDIO_EXTS else ".audio"
    tmp_path = None
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="音檔不能是空的")
        if len(content) > MAX_AUDIO_TRANSCRIPT_BYTES:
            limit_mb = MAX_AUDIO_TRANSCRIPT_BYTES // (1024 * 1024)
            raise HTTPException(status_code=400, detail=f"音檔太大，請壓縮到 {limit_mb}MB 以下")

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = await asyncio.to_thread(
            _transcribe_audio_file,
            tmp_path,
            (language or "").strip() or None,
            min_speakers,
            max_speakers,
        )
        entries = result.get("entries") or []
        if not entries:
            raise HTTPException(status_code=422, detail="轉錄完成，但沒有辨識到可儲存的語音內容")

        offset_ms = max(0, int(started_at_ms_offset or 0))
        if offset_ms:
            for entry in entries:
                entry["started_at_ms"] = int(entry.get("started_at_ms") or 0) + offset_ms

        saved_count = _save_transcript_entries(meeting_id, uid, entries, source="audio")
        db.collection("meetings").document(meeting_id).set({
            "last_audio_transcript": {
                "filename": filename,
                "content_type": content_type,
                "engine": result.get("engine"),
                "language": result.get("language"),
                "diarization": bool(result.get("diarization")),
                "saved": saved_count,
                "created_at": firestore.SERVER_TIMESTAMP,
            }
        }, merge=True)
        return {
            "status": "success",
            "saved": saved_count,
            "engine": result.get("engine"),
            "language": result.get("language"),
            "diarization": bool(result.get("diarization")),
            "entries": entries,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[stt] audio transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"音檔轉錄失敗: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.get("/api/meetings/{meeting_id}/transcripts")
async def list_meeting_transcripts(meeting_id: str, decoded: dict = Depends(verify_token)):
    """列出聚會逐字稿。只有聚會參與者可讀。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    _get_meeting_or_403(meeting_id, uid)
    transcripts = _collect_meeting_transcripts(meeting_id)
    return {"status": "success", "transcripts": transcripts}


@app.post("/api/meetings/{meeting_id}/newspaper/generate")
async def generate_meeting_newspaper(meeting_id: str, decoded: dict = Depends(verify_token)):
    """整合逐字稿、參與度與照片，產生社交貼文風格的聚會 newspaper。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    meeting = _get_meeting_or_403(meeting_id, uid)
    transcripts = _collect_meeting_transcripts(meeting_id)
    photos = _collect_meeting_photos(meeting_id)
    newspaper = _build_newspaper(meeting_id, meeting, transcripts, photos)

    db.collection("meetings").document(meeting_id).collection("artifacts").document("newspaper").set({
        **newspaper,
        "generated_by": uid,
        "generated_at_server": firestore.SERVER_TIMESTAMP,
    })
    db.collection("meetings").document(meeting_id).set({
        "has_newspaper": True,
        "newspaper_generated_at": firestore.SERVER_TIMESTAMP,
    }, merge=True)

    return {"status": "success", "newspaper": newspaper}


@app.get("/api/meetings/{meeting_id}/newspaper")
async def get_meeting_newspaper(meeting_id: str, decoded: dict = Depends(verify_token)):
    """讀取已產生的 newspaper；若尚未產生，回傳 404。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    _get_meeting_or_403(meeting_id, uid)
    ref = db.collection("meetings").document(meeting_id).collection("artifacts").document("newspaper")
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="這場聚會尚未產生 newspaper")

    data = snap.to_dict() or {}
    ts = data.get("generated_at_server")
    if ts and hasattr(ts, "isoformat"):
        data["generated_at_server"] = ts.isoformat()
    elif ts:
        data["generated_at_server"] = str(ts)
    return {"status": "success", "newspaper": data}


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


# ===== 難度參數系統 =====
DIFFICULTY_PARAMS: Dict[str, dict] = {
    "L": {
        "buffer_sec_per_window": 90,
        "buffer_window_sec": 900,
        "quality_decay_rate": 0.5,
        "quality_recovery_rate": 0.3,
        "pickup_tolerance_sec": 15,
        "consecutive_use_penalty_threshold": 180,
        "quality_sample_interval_sec": 30,
        "buffer_check_interval_sec": 15,
        "pin_exempt_duration_sec": 600,
        "pin_exempt_max_count": 3,
        "deviation_rate_limit_sec": 30,   # LOG_DEVIATION 最短間隔
    },
    "M": {
        "buffer_sec_per_window": 45,
        "buffer_window_sec": 900,
        "quality_decay_rate": 1.0,
        "quality_recovery_rate": 0.2,
        "pickup_tolerance_sec": 8,
        "consecutive_use_penalty_threshold": 90,
        "quality_sample_interval_sec": 20,
        "buffer_check_interval_sec": 10,
        "pin_exempt_duration_sec": 300,
        "pin_exempt_max_count": 2,
        "deviation_rate_limit_sec": 25,
    },
    "H": {
        "buffer_sec_per_window": 15,
        "buffer_window_sec": 1200,
        "quality_decay_rate": 1.5,
        "quality_recovery_rate": 0.1,
        "pickup_tolerance_sec": 3,
        "consecutive_use_penalty_threshold": 45,
        "quality_sample_interval_sec": 10,
        "buffer_check_interval_sec": 10,
        "pin_exempt_duration_sec": 180,
        "pin_exempt_max_count": 1,
        "deviation_rate_limit_sec": 20,
    },
}

CONTEXT_PARAM_OVERRIDES: Dict[str, dict] = {
    "class":       {"pickup_tolerance_sec": 0, "pin_exempt_max_count": 0},
    "meeting":     {"pickup_tolerance_sec": 0},
    "meal":        {"buffer_sec_per_window": 120, "pickup_tolerance_sec": 30},
    "family":      {"pin_exempt_duration_sec": 900, "pin_exempt_max_count": 5},
    "celebration": {"buffer_sec_per_window": 150},
    "date":        {"consecutive_use_penalty_threshold": 60},
    "workshop":    {"buffer_sec_per_window": 60, "pickup_tolerance_sec": 20},
    "study":       {"buffer_sec_per_window": 30},
}

CONTEXT_DEFAULTS: Dict[str, dict] = {
    "general":     {"difficulty": "L", "expected_duration_min": 90,  "mode": "GATHERING"},
    "meeting":     {"difficulty": "H", "expected_duration_min": 60,  "mode": "MEETING"},
    "family":      {"difficulty": "L", "expected_duration_min": 120, "mode": "FAMILY"},
    "study":       {"difficulty": "M", "expected_duration_min": 90,  "mode": "CLASS"},
    "class":       {"difficulty": "H", "expected_duration_min": 50,  "mode": "CLASS"},
    "meal":        {"difficulty": "L", "expected_duration_min": 90,  "mode": "GATHERING"},
    "date":        {"difficulty": "M", "expected_duration_min": 120, "mode": "GATHERING"},
    "celebration": {"difficulty": "L", "expected_duration_min": 120, "mode": "GATHERING"},
    "workshop":    {"difficulty": "M", "expected_duration_min": 180, "mode": "MEETING"},
    "team":        {"difficulty": "M", "expected_duration_min": 120, "mode": "GATHERING"},
    "custom":      {"difficulty": "M", "expected_duration_min": 90,  "mode": "GATHERING"},
}

VALID_CONTEXTS = set(CONTEXT_DEFAULTS.keys())
VALID_DIFFICULTIES = {"L", "M", "H"}
PET_BODY_OPTIONS = ["🐰", "🐻", "🐱", "🐶", "🦊", "🐸", "🐧", "🐼", "🐨", "🐯"]


def get_session_params(context: str, difficulty: str) -> dict:
    """取得最終難度參數（基礎 + 情境覆寫）"""
    base = dict(DIFFICULTY_PARAMS.get(difficulty, DIFFICULTY_PARAMS["M"]))
    overrides = CONTEXT_PARAM_OVERRIDES.get(context, {})
    base.update(overrides)
    return base


# ===== 群組 API =====
class CreateGroupPayload(BaseModel):
    name: str
    member_uids: List[str] = Field(default_factory=list)


class UpdateGroupPayload(BaseModel):
    name: Optional[str] = None


class AddGroupMemberPayload(BaseModel):
    uid: Optional[str] = None
    email: Optional[str] = None


class PetVotePayload(BaseModel):
    target_uid: str


class UpdatePetPayload(BaseModel):
    pet_body_emoji: Optional[str] = None
    pet_name: Optional[str] = None
    pet_target_uid: Optional[str] = None


def _generate_invite_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(8))


def _serialize_group(data: dict, doc_id: str) -> dict:
    out = dict(data)
    out["group_id"] = doc_id
    for f in ("created_at", "pet_last_fed_at", "pet_face_updated_at"):
        if out.get(f) and hasattr(out[f], "isoformat"):
            out[f] = out[f].isoformat()
        elif out.get(f):
            out[f] = str(out[f])
    return out


@app.post("/api/groups")
async def create_group(payload: CreateGroupPayload, decoded: dict = Depends(verify_token)):
    """建立新群組"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    name = (payload.name or "").strip()[:30]
    if not name:
        raise HTTPException(status_code=400, detail="群組名稱不能為空")

    # 建立時只加入建立者；其他人必須經好友檢查直接加入，或自行使用邀請碼。
    member_set = {uid}

    group_data = {
        "name": name,
        "creator_uid": uid,
        "member_uids": list(member_set),
        "created_at": firestore.SERVER_TIMESTAMP,
        # 寵物系統初始值
        "pet_target_uid": None,
        "pet_body_emoji": None,
        "pet_name": "",
        "pet_energy": 50,
        "pet_happiness": 70,
        "pet_cleanliness": 100,
        "pet_max_energy": 100,
        "pet_hp": 5,
        "pet_level": 1,
        "pet_accumulated_score": 0,
        "pet_accessories": [],
        "pet_status": "NORMAL",
        "pet_last_fed_at": None,
        "pet_last_updated": None,   # 衰減計算 anchor：只在動作/讀書/設臉時更新
        # 寵物臉（同時當群組頭像）
        "pet_face_url": None,
        "pet_face_path": None,
        # 寵物投票
        "pet_votes": {},   # {voter_uid: target_uid}
        # 邀請碼
        "invite_code": _generate_invite_code(),
    }

    try:
        ref = db.collection("groups").document()
        ref.set(group_data)
        out = _serialize_group(group_data, ref.id)
        out.pop("created_at", None)
        return {"status": "success", "group": out}
    except Exception as e:
        print(f"[create_group] error: {e}")
        raise HTTPException(status_code=500, detail=f"建立群組失敗: {e}")


@app.get("/api/groups")
async def list_my_groups(decoded: dict = Depends(verify_token)):
    """列出我參與的所有群組"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    try:
        docs = list(db.collection("groups").where("member_uids", "array_contains", uid).stream())
        groups = [_serialize_group(d.to_dict() or {}, d.id) for d in docs]
        groups.sort(key=lambda g: g.get("created_at") or "", reverse=True)
        return {"status": "success", "groups": groups}
    except Exception as e:
        print(f"[list_groups] error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/groups/{group_id}")
async def get_group(group_id: str, decoded: dict = Depends(verify_token)):
    """取得群組詳情"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid not in (data.get("member_uids") or []):
        raise HTTPException(status_code=403, detail="你不是這個群組的成員")
    # 舊群組沒有 invite_code 時懶惰補上
    if not data.get("invite_code"):
        new_code = _generate_invite_code()
        doc_ref.update({"invite_code": new_code})
        data["invite_code"] = new_code

    # 展開 member_uids → members（含 nickname），前端顯示成員清單用
    member_uids = data.get("member_uids") or []
    members = []
    for m_uid in member_uids:
        try:
            u = db.collection("users").document(m_uid).get()
            ud = u.to_dict() or {} if u.exists else {}
            members.append({
                "uid": m_uid,
                "nickname": ud.get("nickname") or m_uid,
                "photoURL": ud.get("photoURL") or "",
            })
        except Exception:
            members.append({"uid": m_uid, "nickname": m_uid, "photoURL": ""})
    data["members"] = members

    return {"status": "success", "group": _serialize_group(data, group_id)}


# ===== 群組聊天室 =====
class GroupMessagePayload(BaseModel):
    text: Optional[str] = ""
    type: Optional[str] = "text"          # text | image | audio
    media_url: Optional[str] = None       # image / audio 的 Storage 下載 URL
    duration_sec: Optional[float] = None  # audio 長度（秒）


# 只接受本專案 Firebase Storage 的下載 URL，避免訊息掛任意外部連結
ALLOWED_MEDIA_PREFIXES = (
    "https://firebasestorage.googleapis.com/",
    "https://storage.googleapis.com/",
)


def _require_group_member(group_id: str, uid: str) -> dict:
    """確認 uid 是該群組成員，回傳群組 data；否則丟 403/404。"""
    doc = db.collection("groups").document(group_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid not in (data.get("member_uids") or []):
        raise HTTPException(status_code=403, detail="你不是這個群組的成員")
    return data


@app.get("/api/groups/{group_id}/messages")
async def list_group_messages(group_id: str, limit: int = 100, decoded: dict = Depends(verify_token)):
    """列出群組聊天室訊息（舊→新）。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _require_group_member(group_id, uid)
    msgs = []
    try:
        q = (db.collection("groups").document(group_id).collection("messages")
             .order_by("created_at", direction=firestore.Query.DESCENDING)
             .limit(min(max(limit, 1), 200)).stream())
        for d in q:
            m = d.to_dict() or {}
            ca = m.get("created_at")
            msgs.append({
                "id": d.id,
                "sender_uid": m.get("sender_uid", ""),
                "sender_nickname": m.get("sender_nickname", ""),
                "sender_avatar": m.get("sender_avatar", ""),
                "text": m.get("text", ""),
                "type": m.get("type", "text"),
                "media_url": m.get("media_url", ""),
                "duration_sec": m.get("duration_sec"),
                "created_at": ca.isoformat() if hasattr(ca, "isoformat") else None,
            })
        msgs.reverse()  # DESC 取最新 N 筆後翻成 舊→新
    except Exception as e:
        print(f"[group messages] list failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success", "messages": msgs}


@app.post("/api/groups/{group_id}/messages")
async def send_group_message(group_id: str, payload: GroupMessagePayload, decoded: dict = Depends(verify_token)):
    """在群組聊天室發送一則訊息。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _require_group_member(group_id, uid)
    msg_type = (payload.type or "text").strip()
    if msg_type not in ("text", "image", "audio"):
        raise HTTPException(status_code=400, detail="不支援的訊息類型")
    text = (payload.text or "").strip()[:500]
    media_url = (payload.media_url or "").strip()

    if msg_type == "text":
        if not text:
            raise HTTPException(status_code=400, detail="訊息不能為空")
        media_url = ""
    else:
        if not media_url.startswith(ALLOWED_MEDIA_PREFIXES):
            raise HTTPException(status_code=400, detail="無效的媒體網址")

    me = _ensure_user_doc(decoded)
    doc = {
        "sender_uid": uid,
        "sender_nickname": me.get("nickname", ""),
        "sender_avatar": me.get("photoURL", ""),
        "text": text,
        "type": msg_type,
        "media_url": media_url,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    if msg_type == "audio":
        try:
            doc["duration_sec"] = max(0.0, min(float(payload.duration_sec or 0), 120.0))
        except (TypeError, ValueError):
            doc["duration_sec"] = 0.0
    ref = db.collection("groups").document(group_id).collection("messages").document()
    ref.set(doc)
    return {"status": "success", "id": ref.id}


@app.get("/api/groups/{group_id}/meetings")
async def list_group_meetings(group_id: str, limit: int = 20, decoded: dict = Depends(verify_token)):
    """列出屬於這個群組的聚會紀錄（新→舊），供群組頁「最近聚會」用。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    _require_group_member(group_id, uid)
    meetings = []
    try:
        docs = list(
            db.collection("meetings").where("group_id", "==", group_id).limit(100).stream()
        )
        meetings = [_serialize_meeting(d.to_dict() or {}, d.id) for d in docs]
        meetings.sort(key=lambda m: m.get("ended_at") or "", reverse=True)
        meetings = meetings[: min(max(limit, 1), 50)]
    except Exception as e:
        print(f"[group meetings] list failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success", "meetings": meetings}


@app.patch("/api/groups/{group_id}")
async def update_group(group_id: str, payload: UpdateGroupPayload, decoded: dict = Depends(verify_token)):
    """更新群組名稱（建立者才可）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc = db.collection("groups").document(group_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if data.get("creator_uid") != uid:
        raise HTTPException(status_code=403, detail="只有建立者可以編輯群組")
    updates = {}
    if payload.name is not None:
        n = payload.name.strip()[:30]
        if n:
            updates["name"] = n
    if not updates:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")
    db.collection("groups").document(group_id).update(updates)
    return {"status": "success"}


@app.post("/api/groups/{group_id}/members")
async def add_group_member(group_id: str, payload: AddGroupMemberPayload, decoded: dict = Depends(verify_token)):
    """邀請成員加入群組"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid not in (data.get("member_uids") or []):
        raise HTTPException(status_code=403, detail="你不是這個群組的成員")

    target_uid = (payload.uid or "").strip()
    target_email = (payload.email or "").strip().lower()
    if not target_uid and not target_email:
        raise HTTPException(status_code=400, detail="請提供 uid 或 email")

    if not target_uid and target_email:
        q = db.collection("users").where("email", "==", target_email).limit(1).stream()
        found = next(iter(q), None)
        if not found:
            raise HTTPException(status_code=404, detail="找不到這個 email 的使用者")
        target_uid = found.id

    if target_uid in (data.get("member_uids") or []):
        raise HTTPException(status_code=400, detail="對方已在群組中")

    target_snap = db.collection("users").document(target_uid).get()
    if not target_snap.exists:
        raise HTTPException(status_code=404, detail="找不到這個使用者")
    friend_snap = db.collection("users").document(uid).collection("friends").document(target_uid).get()
    if not friend_snap.exists:
        raise HTTPException(status_code=403, detail="只能直接加入好友；其他人請分享群組邀請碼")

    doc_ref.update({"member_uids": firestore.ArrayUnion([target_uid])})
    return {"status": "success", "target_uid": target_uid}


@app.delete("/api/groups/{group_id}/members/{target_uid}")
async def remove_group_member(group_id: str, target_uid: str, decoded: dict = Depends(verify_token)):
    """移除群組成員（建立者可移除任人；成員可移除自己）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid != data.get("creator_uid") and uid != target_uid:
        raise HTTPException(status_code=403, detail="無權限移除此成員")
    if data.get("creator_uid") == target_uid:
        raise HTTPException(status_code=400, detail="不能移除建立者")
    votes = data.get("pet_votes") or {}
    cleaned_votes = {
        voter: voted_for for voter, voted_for in votes.items()
        if voter != target_uid and voted_for != target_uid
    }
    updates = {
        "member_uids": firestore.ArrayRemove([target_uid]),
        "pet_votes": cleaned_votes,
    }
    if data.get("pet_target_uid") == target_uid:
        updates["pet_target_uid"] = None
    doc_ref.update(updates)
    return {"status": "success"}


@app.post("/api/groups/{group_id}/pet/vote")
async def vote_pet(group_id: str, payload: PetVotePayload, decoded: dict = Depends(verify_token)):
    """投票誰當寵物（每人一票，可改票）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    members = data.get("member_uids") or []
    if uid not in members:
        raise HTTPException(status_code=403, detail="你不是群組成員")
    if payload.target_uid not in members:
        raise HTTPException(status_code=400, detail="被投票者不在群組中")

    doc_ref.update({f"pet_votes.{uid}": payload.target_uid})

    # 重新計票
    updated = doc_ref.get().to_dict() or {}
    votes = updated.get("pet_votes") or {}
    tally: Dict[str, int] = {}
    for v in votes.values():
        tally[v] = tally.get(v, 0) + 1

    # 若所有成員都投票完畢，自動確定寵物
    if len(votes) >= len(members):
        winner = max(tally, key=lambda x: tally[x])
        doc_ref.update({"pet_target_uid": winner})
        return {"status": "success", "tally": tally, "confirmed_pet_uid": winner}

    return {"status": "success", "tally": tally, "votes_cast": len(votes), "members_total": len(members)}


@app.patch("/api/groups/{group_id}/pet")
async def update_pet(group_id: str, payload: UpdatePetPayload, decoded: dict = Depends(verify_token)):
    """更新寵物設定（建立者/多數同意者才可）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid != data.get("creator_uid"):
        raise HTTPException(status_code=403, detail="只有群組建立者可以更改寵物設定")

    updates = {}
    if payload.pet_body_emoji is not None:
        if payload.pet_body_emoji not in PET_BODY_OPTIONS:
            raise HTTPException(status_code=400, detail=f"不合法的 emoji，可用：{' '.join(PET_BODY_OPTIONS)}")
        updates["pet_body_emoji"] = payload.pet_body_emoji
    if payload.pet_name is not None:
        updates["pet_name"] = payload.pet_name.strip()[:20]
    if payload.pet_target_uid is not None:
        if payload.pet_target_uid not in (data.get("member_uids") or []):
            raise HTTPException(status_code=400, detail="寵物人必須是群組成員")
        updates["pet_target_uid"] = payload.pet_target_uid

    if not updates:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    doc_ref.update(updates)
    return {"status": "success"}


@app.get("/api/groups/{group_id}/pet")
async def get_pet(group_id: str, decoded: dict = Depends(verify_token)):
    """取得群組寵物當前狀態"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc = db.collection("groups").document(group_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid not in (data.get("member_uids") or []):
        raise HTTPException(status_code=403, detail="你不是群組成員")

    pet_fields = {k: v for k, v in data.items() if k.startswith("pet_")}
    for _tf in ("pet_last_fed_at", "pet_face_updated_at", "pet_last_updated"):
        if pet_fields.get(_tf) and hasattr(pet_fields[_tf], "isoformat"):
            pet_fields[_tf] = pet_fields[_tf].isoformat()

    # 疊上時間衰減後的顯示值（只讀出來給前端，不回寫 timestamp）
    if data.get("pet_face_url"):
        pet_fields.update(_group_pet_display(data))

    # 取得寵物人的 profile（頭像）
    pet_uid = data.get("pet_target_uid")
    pet_person_profile = None
    if pet_uid:
        pet_snap = db.collection("users").document(pet_uid).get()
        if pet_snap.exists:
            pd = pet_snap.to_dict() or {}
            pet_person_profile = {
                "uid": pet_uid,
                "nickname": pd.get("nickname", ""),
                "photoURL": pd.get("photoURL", ""),
            }

    return {
        "status": "success",
        "pet": pet_fields,
        "pet_person": pet_person_profile,
        "pet_body_options": PET_BODY_OPTIONS,
        "votes": data.get("pet_votes", {}),
        "member_count": len(data.get("member_uids", [])),
    }


@app.post("/api/groups/{group_id}/pet-face")
async def set_group_pet_face(
    group_id: str,
    file: UploadFile = File(...),
    target_uid: Optional[str] = Form(default=None),
    decoded: dict = Depends(verify_token),
):
    """把已生成的寵物臉設為群組頭像（同時是寵物的臉）。只有群組建立者可設定。"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    doc_ref = db.collection("groups").document(group_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = snap.to_dict() or {}
    if uid != data.get("creator_uid"):
        raise HTTPException(status_code=403, detail="只有群組建立者可以設定寵物臉")

    # 🔒 content_type 白名單（沿用照片那套，排除 SVG 等可執行內容）
    ALLOWED = {"image/jpeg", "image/png", "image/webp"}
    if not file.content_type or file.content_type not in ALLOWED:
        raise HTTPException(status_code=400, detail="只接受 JPEG / PNG / WebP 圖片")

    content = await file.read()
    if len(content) > PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="檔案太大 (>10MB)")

    ext_by_ct = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
    ext = ext_by_ct[file.content_type]
    blob_name = f"group-pet-faces/{group_id}/{uuid.uuid4().hex}.{ext}"

    try:
        bucket = _storage_bucket()
        blob = bucket.blob(blob_name)
        blob.upload_from_string(content, content_type=file.content_type)
        blob.make_public()
        public_url = blob.public_url

        old_path = data.get("pet_face_path")
        face_updates = {
            "pet_face_url": public_url,
            "pet_face_path": blob_name,
            "pet_face_updated_at": firestore.SERVER_TIMESTAMP,
            "pet_face_target_uid": target_uid or None,
            # 設臉＝寵物誕生，補齊養成欄位並起算衰減 anchor（缺才補，不覆蓋既有進度）
            "pet_last_updated": firestore.SERVER_TIMESTAMP,
        }
        for _f, _default in GROUP_PET_STAT_DEFAULTS.items():
            if data.get(_f) is None:
                face_updates[_f] = _default
        doc_ref.update(face_updates)

        # 換圖成功後刪舊 blob（失敗不阻斷，避免殘留指向不存在檔案的 metadata）
        if old_path and old_path != blob_name:
            try:
                old_blob = bucket.blob(old_path)
                if old_blob.exists():
                    old_blob.delete()
            except Exception as e:
                print(f"Warning: failed to delete old pet face blob: {e}")

        return {"status": "success", "pet_face_url": public_url}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error setting group pet face: {e}")
        raise HTTPException(status_code=500, detail=f"設定頭像失敗: {e}")


# ── 群組寵物養成模型 ──────────────────────────────────────────────────────────
# 三條數值（飽食/快樂/清潔）隨時間衰減，靠讀書時段與照顧動作補回。
# 關鍵：衰減 anchor（pet_last_updated）只在「有動作」時更新，GET 只讀出來顯示、
# 不回寫 timestamp，避免個人寵物那套「每次 poll 重設 anchor → 衰減被截斷歸零」的坑。

class GroupPetActionPayload(BaseModel):
    action: str  # "feed" | "play" | "wipe"


@app.post("/api/groups/{group_id}/pet/action")
async def group_pet_action(group_id: str, payload: GroupPetActionPayload, decoded: dict = Depends(verify_token)):
    """群組成員對共同寵物執行互動（餵食、玩耍、清潔）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    action = payload.action
    if action not in ("feed", "play", "wipe"):
        raise HTTPException(status_code=400, detail=f"未知動作：{action}")
    doc_ref = db.collection("groups").document(group_id)
    transaction = db.transaction()

    @firestore.transactional
    def apply_action(tx):
        doc = doc_ref.get(transaction=tx)
        if not doc.exists:
            raise HTTPException(status_code=404, detail="找不到群組")
        data = doc.to_dict() or {}
        if uid not in (data.get("member_uids") or []):
            raise HTTPException(status_code=403, detail="你不是群組成員")
        if not data.get("pet_face_url"):
            raise HTTPException(status_code=400, detail="群組還沒有設定寵物臉")

        # 在 transaction 內從最新版本計算，避免多人同時操作互相覆蓋。
        stats = _group_pet_current_stats(data)
        energy = stats["pet_energy"]
        happiness = stats["pet_happiness"]
        cleanliness = stats["pet_cleanliness"]

        if action == "feed":
            energy = min(100.0, energy + 30)
            happiness = min(100.0, happiness + 5)
        elif action == "play":
            happiness = min(100.0, happiness + 25)
            energy = max(0.0, energy - 8)
        else:  # wipe
            cleanliness = 100.0
            happiness = min(100.0, happiness + 5)

        new_status = _group_pet_status(energy, happiness, cleanliness)
        updates = {
            "pet_energy": energy,
            "pet_happiness": happiness,
            "pet_cleanliness": cleanliness,
            "pet_status": new_status,
            "pet_last_updated": firestore.SERVER_TIMESTAMP,
        }
        if action == "feed":
            updates["pet_last_fed_at"] = firestore.SERVER_TIMESTAMP
        tx.update(doc_ref, updates)
        return energy, happiness, cleanliness, new_status

    try:
        energy, happiness, cleanliness, new_status = apply_action(transaction)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[group_pet_action] transaction failed: {e}")
        raise HTTPException(status_code=500, detail="寵物狀態更新失敗")

    hp = _group_pet_hp({"pet_energy": energy, "pet_happiness": happiness, "pet_cleanliness": cleanliness})
    return {
        "status": "success",
        "pet_energy": round(energy),
        "pet_happiness": round(happiness),
        "pet_cleanliness": round(cleanliness),
        "pet_status": new_status,
        "pet_hp": hp,
    }


@app.get("/api/my-pets")
async def get_my_pets(decoded: dict = Depends(verify_token)):
    """取得所有寵物：個人寵物 + 所有群組寵物"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    try:
        pets = []

        # 1. 個人寵物
        user_snap = db.collection("users").document(uid).get()
        user_data = user_snap.to_dict() or {}
        if user_data.get("my_pet_image_url"):
            personal_pet = {k: v for k, v in user_data.items() if k.startswith("my_pet_")}
            current_personal = _calc_pet_decay(user_data)
            # 統一格式：把 my_pet_* 映射成 pet_* 讓前端共用同一套顯示邏輯
            pets.append({
                "group_id":   None,
                "group_name": "個人寵物",
                "is_creator": True,
                "kind":       "personal",
                "pet": {
                    "pet_face_url": personal_pet.get("my_pet_image_url", ""),
                    "pet_name":     personal_pet.get("my_pet_name", ""),
                    "pet_energy":   current_personal["my_pet_energy"],
                    "pet_happiness": current_personal["my_pet_happiness"],
                    "pet_cleanliness": current_personal["my_pet_cleanliness"],
                    "pet_max_energy": 100,
                    "pet_hp":       5,
                    "pet_status":   current_personal["my_pet_status"],
                },
            })

        # 2. 群組寵物
        docs = list(db.collection("groups").where("member_uids", "array_contains", uid).stream())
        for doc in docs:
            data = doc.to_dict() or {}
            if not data.get("pet_face_url"):
                continue
            pet_fields = {k: v for k, v in data.items() if k.startswith("pet_")}
            for tf in ("pet_last_fed_at", "pet_face_updated_at", "pet_last_updated"):
                if pet_fields.get(tf) and hasattr(pet_fields[tf], "isoformat"):
                    pet_fields[tf] = pet_fields[tf].isoformat()
            pet_fields.update(_group_pet_display(data))   # 疊上時間衰減後的顯示值
            pets.append({
                "group_id":   doc.id,
                "group_name": data.get("name", ""),
                "is_creator": uid == data.get("creator_uid"),
                "kind":       "group",
                "pet":        pet_fields,
            })

        return {"status": "success", "pets": pets}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/groups/{group_id}/pet")
async def delete_group_pet(group_id: str, decoded: dict = Depends(verify_token)):
    """重置群組寵物（只有建立者可操作）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if uid not in (data.get("member_uids") or []):
        raise HTTPException(status_code=403, detail="你不是群組成員")
    if uid != data.get("creator_uid"):
        raise HTTPException(status_code=403, detail="只有群組建立者可以刪除寵物")
    pet_fields = [k for k in data if k.startswith("pet_")]
    clear = {f: firestore.DELETE_FIELD for f in pet_fields}
    try:
        doc_ref.update(clear)
        old_path = data.get("pet_face_path")
        if old_path:
            try:
                _storage_bucket().blob(old_path).delete()
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success"}


class JoinByInvitePayload(BaseModel):
    code: str


@app.get("/api/group_invite/{code}")
async def get_group_by_invite_code(code: str, decoded: dict = Depends(verify_token)):
    """透過邀請碼預覽群組資訊（加入前確認用，成員也可呼叫）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    clean_code = code.upper().strip()
    try:
        docs = list(db.collection("groups").where("invite_code", "==", clean_code).limit(1).stream())
        if not docs:
            raise HTTPException(status_code=404, detail="找不到對應的邀請碼")
        data = docs[0].to_dict() or {}
        group_id = docs[0].id
        already_member = uid in (data.get("member_uids") or [])
        return {
            "status": "success",
            "group_id": group_id,
            "name": data.get("name", ""),
            "member_count": len(data.get("member_uids", [])),
            "already_member": already_member,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/group_invite/join")
async def join_group_by_invite(payload: JoinByInvitePayload, decoded: dict = Depends(verify_token)):
    """透過邀請碼加入群組"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    clean_code = (payload.code or "").upper().strip()
    if not clean_code:
        raise HTTPException(status_code=400, detail="邀請碼不能為空")
    try:
        docs = list(db.collection("groups").where("invite_code", "==", clean_code).limit(1).stream())
        if not docs:
            raise HTTPException(status_code=404, detail="找不到對應的邀請碼，請確認後再試")
        doc = docs[0]
        data = doc.to_dict() or {}
        group_id = doc.id
        if uid in (data.get("member_uids") or []):
            return {"status": "success", "group_id": group_id, "already_member": True}
        doc.reference.update({"member_uids": firestore.ArrayUnion([uid])})
        _ensure_user_doc(decoded)
        return {"status": "success", "group_id": group_id, "already_member": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/groups/{group_id}/invite_code/refresh")
async def refresh_invite_code(group_id: str, decoded: dict = Depends(verify_token)):
    """重新產生邀請碼（只有建立者可以操作）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    doc_ref = db.collection("groups").document(group_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="找不到群組")
    data = doc.to_dict() or {}
    if data.get("creator_uid") != uid:
        raise HTTPException(status_code=403, detail="只有建立者可以重新產生邀請碼")
    new_code = _generate_invite_code()
    doc_ref.update({"invite_code": new_code})
    return {"status": "success", "invite_code": new_code}


@app.get("/api/context_defaults")
async def get_context_defaults():
    """回傳所有情境的預設參數（前端情境選擇器用）"""
    return {
        "status": "success",
        "contexts": CONTEXT_DEFAULTS,
        "difficulty_params": DIFFICULTY_PARAMS,
    }



# ===== 個人寵物系統 (My Pet) =====

class PersonalPetSetupPayload(BaseModel):
    image_url: str
    name: Optional[str] = ""
    animal: Optional[str] = "dog"

class PersonalPetActionPayload(BaseModel):
    action: str  # "feed" | "wipe" | "play" | "sleep" | "wake"


def _calc_pet_decay(data: dict) -> dict:
    return _personal_pet_decay(data)


@app.get("/api/my-pet")
async def get_my_pet(decoded: dict = Depends(verify_token)):
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    snap = db.collection("users").document(uid).get()
    data = snap.to_dict() or {}
    if not data.get("my_pet_image_url"):
        return {"status": "success", "pet": None}

    # GET 只計算顯示值，不重設衰減 anchor。否則頻繁 poll 會讓寵物永遠不衰減。
    pet = _calc_pet_decay(data)

    pet["my_pet_image_url"] = data.get("my_pet_image_url", "")
    pet["my_pet_name"]      = data.get("my_pet_name", "")
    pet["my_pet_animal"]    = data.get("my_pet_animal", "dog")
    return {"status": "success", "pet": pet}


@app.post("/api/my-pet/setup")
async def setup_my_pet(payload: PersonalPetSetupPayload, decoded: dict = Depends(verify_token)):
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    updates = {
        "my_pet_image_url":   payload.image_url,
        "my_pet_name":        (payload.name or "").strip()[:20],
        "my_pet_animal":      payload.animal or "dog",
        "my_pet_hunger":      70,
        "my_pet_happiness":   70,
        "my_pet_energy":      80,
        "my_pet_cleanliness": 100,
        "my_pet_is_sleeping": False,
        "my_pet_has_poop":    False,
        "my_pet_has_pee":     False,
        "my_pet_status":      "NORMAL",
        "my_pet_last_updated": firestore.SERVER_TIMESTAMP,
    }
    try:
        db.collection("users").document(uid).update(updates)
    except Exception:
        db.collection("users").document(uid).set(updates, merge=True)
    return {"status": "success"}


class PersonalPetUpdatePayload(BaseModel):
    name: Optional[str] = None
    animal: Optional[str] = None
    image_url: Optional[str] = None


@app.patch("/api/my-pet")
async def update_my_pet(payload: PersonalPetUpdatePayload, decoded: dict = Depends(verify_token)):
    """更新寵物的名字／動物／照片，但不重置養成數值（setup 會重置，這個不會）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    ref = db.collection("users").document(uid)
    data = ref.get().to_dict() or {}
    if not data.get("my_pet_image_url"):
        raise HTTPException(status_code=404, detail="還沒有寵物")

    updates = {}
    if payload.name is not None:
        updates["my_pet_name"] = payload.name.strip()[:20]
    if payload.animal is not None:
        updates["my_pet_animal"] = payload.animal or "dog"
    if payload.image_url is not None:
        updates["my_pet_image_url"] = payload.image_url
    if not updates:
        raise HTTPException(status_code=400, detail="沒有要更新的欄位")

    ref.update(updates)
    return {"status": "success", "updated": [k for k in updates if k != "my_pet_last_updated"]}


@app.delete("/api/my-pet")
async def delete_my_pet(decoded: dict = Depends(verify_token)):
    """刪除目前使用者的寵物（清掉所有 my_pet_* 欄位）"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    fields = [
        "image_url", "name", "animal", "hunger", "happiness", "energy",
        "cleanliness", "is_sleeping", "has_poop", "has_pee", "status", "last_updated",
    ]
    clear = {f"my_pet_{f}": firestore.DELETE_FIELD for f in fields}
    try:
        db.collection("users").document(uid).update(clear)
        try:
            _storage_bucket().blob(f"pet-images/{uid}/pet.jpg").delete()
        except Exception:
            pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "success"}


@app.post("/api/my-pet/action")
async def my_pet_action(payload: PersonalPetActionPayload, decoded: dict = Depends(verify_token)):
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")
    action = payload.action
    if action not in ("feed", "wipe", "play", "sleep", "wake"):
        raise HTTPException(status_code=400, detail=f"未知動作：{action}")
    ref = db.collection("users").document(uid)
    transaction = db.transaction()

    @firestore.transactional
    def apply_action(tx):
        snap = ref.get(transaction=tx)
        data = snap.to_dict() or {}
        if not data.get("my_pet_image_url"):
            raise HTTPException(status_code=404, detail="還沒有寵物")
        pet = _calc_pet_decay(data)

        if action == "feed":
            pet["my_pet_hunger"] = min(100, pet["my_pet_hunger"] + 25)
            pet["my_pet_happiness"] = min(100, pet["my_pet_happiness"] + 5)
        elif action == "wipe":
            pet["my_pet_cleanliness"] = 100
            pet["my_pet_has_poop"] = False
            pet["my_pet_has_pee"] = False
            pet["my_pet_happiness"] = min(100, pet["my_pet_happiness"] + 10)
        elif action == "play":
            pet["my_pet_happiness"] = min(100, pet["my_pet_happiness"] + 20)
            pet["my_pet_energy"] = max(0, pet["my_pet_energy"] - 10)
            pet["my_pet_hunger"] = max(0, pet["my_pet_hunger"] - 5)
        elif action == "sleep":
            pet["my_pet_is_sleeping"] = True
        else:  # wake
            pet["my_pet_is_sleeping"] = False

        if pet["my_pet_is_sleeping"]:
            pet["my_pet_status"] = "SLEEPING"
        elif pet["my_pet_has_poop"] or pet["my_pet_has_pee"]:
            pet["my_pet_status"] = "DIRTY"
        elif pet["my_pet_hunger"] < 20 or pet["my_pet_energy"] < 10:
            pet["my_pet_status"] = "CRITICAL"
        elif pet["my_pet_hunger"] < 40 or pet["my_pet_happiness"] < 30:
            pet["my_pet_status"] = "HUNGRY"
        elif pet["my_pet_hunger"] > 70 and pet["my_pet_happiness"] > 70 and pet["my_pet_energy"] > 60:
            pet["my_pet_status"] = "HAPPY"
        else:
            pet["my_pet_status"] = "NORMAL"

        tx.update(ref, {**pet, "my_pet_last_updated": firestore.SERVER_TIMESTAMP})
        return pet, data.get("my_pet_image_url", ""), data.get("my_pet_name", ""), data.get("my_pet_animal", "dog")

    try:
        pet, image_url, pet_name, pet_animal = apply_action(transaction)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[my_pet_action] transaction failed: {e}")
        raise HTTPException(status_code=500, detail="寵物狀態更新失敗")

    pet["my_pet_image_url"] = image_url
    pet["my_pet_name"] = pet_name
    pet["my_pet_animal"] = pet_animal
    return {"status": "success", "pet": pet}


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


class CreateRoomRequest(BaseModel):
    frontend_url: Optional[str] = None
    context: Optional[str] = "general"
    difficulty: Optional[str] = None        # None → 從 context 預設值取
    expected_duration_min: Optional[int] = None
    group_id: Optional[str] = None


class EndRoomRequest(BaseModel):
    reason: Optional[str] = "host_ended"
    duration_minutes: Optional[int] = 0


def _save_room_meeting_record(room_id: str, room_data: dict, reason: str, duration_minutes: int) -> dict:
    all_ever = room_data.get("all_participants") or room_data.get("members") or {}
    host_uid_local = room_data.get("host_uid")
    total_deviations = int(room_data.get("deviations", 0) or 0)
    score_ranking, score_by_uid, avg_score = _build_score_ranking(
        all_ever, host_uid_local, duration_minutes
    )

    members_snapshot = []
    participants = []
    for uid, info in all_ever.items():
        is_guest = _is_guest_user_id(uid)
        members_snapshot.append({
            "uid": uid,
            "nickname": info.get("nickname", ""),
            "is_guest": is_guest
        })
        if not is_guest:
            participants.append(uid)

    if host_uid_local:
        if host_uid_local not in participants:
            participants.append(host_uid_local)
        if not any(m.get("uid") == host_uid_local for m in members_snapshot):
            members_snapshot.append({
                "uid": host_uid_local,
                "nickname": room_data.get("host_nickname", ""),
                "is_guest": False,
            })

    # 若這場聚會屬於某群組，帶上 group_id / group_name（供群組頁「最近聚會」與聚會標籤用）
    group_id = room_data.get("group_id") or None
    group_name = ""
    if group_id:
        try:
            g_snap = db.collection("groups").document(group_id).get()
            if g_snap.exists:
                group_name = (g_snap.to_dict() or {}).get("name", "")
            else:
                group_id = None
        except Exception as g_err:
            print(f"[meeting finalize] group lookup failed for {group_id}: {g_err}")

    meeting_record = {
        "room_id": room_id,
        "host_uid": host_uid_local,
        "host_nickname": room_data.get("host_nickname", ""),
        "mode": room_data.get("mode", ""),
        "group_id": group_id,
        "group_name": group_name,
        "ended_at": firestore.SERVER_TIMESTAMP,
        "started_at_ms": room_data.get("started_at", 0),
        "duration_minutes": duration_minutes,
        "total_deviations": total_deviations,
        "member_count": len(members_snapshot),
        "members_snapshot": members_snapshot,
        "participants": participants,
        "end_reason": reason,
        "avg_score": avg_score,
        "base_score": avg_score,          # 舊欄位相容：現在代表全場平均分
        "score_ranking": score_ranking,
        "deviation_ranking": score_ranking,   # 舊欄位相容：同一份資料
    }

    db.collection("rooms").document(room_id).set({"status": "ENDED"}, merge=True)
    db.collection("meetings").document(room_id).set(meeting_record, merge=True)

    for p_uid in participants:
        my_score = _score_for_uid(p_uid, score_by_uid, all_ever, host_uid_local, duration_minutes)
        my_deviations = int((all_ever.get(p_uid) or {}).get("deviations", 0) or 0)
        mirror = {
            "owner_uid": p_uid,
            "room_id": room_id,
            "is_host": (p_uid == host_uid_local),
            "mode": room_data.get("mode", ""),
            "ended_at": firestore.SERVER_TIMESTAMP,
            "duration_minutes": duration_minutes,
            "deviations": my_deviations,
            "total_room_deviations": total_deviations,
            "score": my_score,
            "end_reason": reason,
        }
        try:
            db.collection("users").document(p_uid).collection("meetings").document(room_id).set(mirror, merge=True)
        except Exception as mm_err:
            print(f"[meeting finalize] mirror write failed for {p_uid}: {mm_err}")

    return meeting_record


@app.post("/api/create_room")
async def create_room(body: CreateRoomRequest, decoded: dict = Depends(verify_token)):
    """
    建立房間並同步存入 Firestore (需登入)
    接受 context / difficulty / expected_duration_min / group_id 參數
    """
    host_uid = decoded.get("uid") or decoded.get("user_id")
    host_profile = _ensure_user_doc(decoded)

    # 解析情境 / 難度
    ctx = body.context if body.context in VALID_CONTEXTS else "general"
    ctx_defaults = CONTEXT_DEFAULTS[ctx]
    difficulty = body.difficulty if body.difficulty in VALID_DIFFICULTIES else ctx_defaults["difficulty"]
    expected_duration_min = body.expected_duration_min or ctx_defaults["expected_duration_min"]
    default_mode = ctx_defaults["mode"]
    group_id = body.group_id or None

    # 驗證 group_id 成員資格；順便把群組寵物臉快照進房間（聚會中吉祥物用，讓全體參與者都看得到）
    group_pet_face_url = ""
    if group_id:
        try:
            g_snap = db.collection("groups").document(group_id).get()
            gd = g_snap.to_dict() if g_snap.exists else None
            if not gd or host_uid not in gd.get("member_uids", []):
                group_id = None  # 不是成員就忽略
            elif gd.get("pet_target_uid") and gd.get("pet_face_url"):
                # 只有真的生成過寵物（pet_target_uid 有值）才帶臉
                group_pet_face_url = gd.get("pet_face_url") or ""
        except Exception:
            group_id = None

    session_params = get_session_params(ctx, difficulty)
    room_id = str(uuid.uuid4())[:8]

    firestore_data = {
        "room_id": room_id,
        "host_uid": host_uid,
        "host_nickname": host_profile.get("nickname", ""),
        "status": "WAITING",
        "mode": default_mode,
        "context": ctx,
        "difficulty": difficulty,
        "expected_duration_min": expected_duration_min,
        "group_id": group_id,
        "group_pet_face_url": group_pet_face_url,
        "session_params": session_params,
        "members": {},
        "all_participants": {},  # 曾加入過的所有成員（含斷線的），不會被清除
        "sync_start_time": None,
        "deviations": 0,
        "qa_state": {"current_question": None, "answers": {}},
        "created_at": firestore.SERVER_TIMESTAMP,
    }

    memory_data = {k: v for k, v in firestore_data.items() if k != "created_at"}
    memory_data["started_at"] = int(datetime.datetime.utcnow().timestamp() * 1000)

    try:
        db.collection("rooms").document(room_id).set(firestore_data)
    except Exception as e:
        print(f"Error saving to Firestore: {e}")
    rooms[room_id] = memory_data

    # QR Code: keep the encoded URL identical to the frontend invite link.
    base_url = body.frontend_url if body.frontend_url else "http://localhost:3000"
    host_url = f"{base_url}/?room={room_id}"
    img_str = make_qr_base64(host_url)

    return {
        "room_id": room_id,
        "qr_base64": img_str,
        "url": host_url,
        "context": ctx,
        "difficulty": difficulty,
        "expected_duration_min": expected_duration_min,
        "mode": default_mode,
        "group_id": group_id,
        "session_params": session_params,
        "backend_ip": "",
    }


@app.post("/api/rooms/{room_id}/end")
async def end_room_http(room_id: str, body: EndRoomRequest, decoded: dict = Depends(verify_token)):
    """HTTP fallback for ending a meeting when the WebSocket END_SESSION message is lost."""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    snap = db.collection("rooms").document(room_id).get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="找不到房間")

    room_data = snap.to_dict() or {}
    members = room_data.get("members") or {}
    all_participants = room_data.get("all_participants") or {}
    if uid != room_data.get("host_uid") and uid not in members and uid not in all_participants:
        raise HTTPException(status_code=403, detail="你沒有參與這場聚會")

    reason = (body.reason or "host_ended").strip()[:40] or "host_ended"
    duration_minutes = max(0, int(body.duration_minutes or 0))
    meeting_record = _save_room_meeting_record(room_id, room_data, reason, duration_minutes)
    return {
        "status": "success",
        "room_id": room_id,
        "participants_count": len(meeting_record.get("participants") or []),
    }


@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    # 從 query param 取得暱稱 (僅用作 fallback,正式 nickname 由 AUTH frame 帶)
    nickname_q = websocket.query_params.get("nickname") or "訪客"
    nickname_q = nickname_q.strip()[:20] or "訪客"

    # ============================================================
    # 🔒 [Bug 5 修正 v15.3] WebSocket 身份驗證改為 first-message handshake
    # ============================================================
    # 修正前: token 放 URL query,可能會被反代理 / Cloud Run access log 記錄
    # 修正後:
    #   1. accept() 接受連線
    #   2. 5 秒內必須收到 first message {action:"AUTH", token?, nickname?}
    #   3. 已登入者: token 必填,且 verified uid 須等於 path user_id
    #      訪客: token 不必填,path user_id 須為合法 uuid4
    #   4. 失敗直接 close;成功後 send {type:"AUTH_OK"} 並進入正常 message loop
    # ============================================================
    await websocket.accept()

    is_guest_uid = _is_guest_user_id(user_id)
    token = None
    nickname = nickname_q
    try:
        first_raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        first_msg = json.loads(first_raw)
        if first_msg.get("action") != "AUTH":
            print(f"[ws-auth] reject: first action != AUTH ({first_msg.get('action')!r})")
            await websocket.close(code=4400, reason="First frame must be AUTH")
            return
        token = first_msg.get("token")
        if first_msg.get("nickname"):
            nickname = (first_msg.get("nickname") or "").strip()[:20] or "訪客"
    except asyncio.TimeoutError:
        print(f"[ws-auth] reject: AUTH timeout for {user_id!r}")
        await websocket.close(code=4401, reason="AUTH timeout")
        return
    except Exception as e:
        print(f"[ws-auth] reject: AUTH parse error for {user_id!r}: {e}")
        await websocket.close(code=4400, reason="AUTH parse error")
        return

    if is_guest_uid:
        if token:
            print(f"[ws-auth] reject: guest uid {user_id!r} should not carry token")
            await websocket.close(code=4400, reason="Guest cannot have token")
            return
        # Already validated by _is_guest_user_id above.
    else:
        if not token:
            print(f"[ws-auth] reject: non-guest uid {user_id!r} missing token")
            await websocket.close(code=4401, reason="Missing auth token")
            return
        try:
            decoded = fb_auth.verify_id_token(token)
            verified_uid = decoded.get("uid") or decoded.get("user_id")
        except Exception as e:
            print(f"[ws-auth] reject: token verify failed for path uid {user_id!r}: {e}")
            await websocket.close(code=4401, reason="Invalid auth token")
            return
        if verified_uid != user_id:
            print(f"[ws-auth] reject: path uid={user_id!r} mismatches token uid={verified_uid!r}")
            await websocket.close(code=4403, reason="Identity mismatch")
            return
        print(f"[ws-auth] OK: uid={user_id!r} (room={room_id})")

    # 通知 client AUTH 通過(不能呼叫 manager.connect 因為 connect 內含 accept,
    # 我們已經 accept 過了)
    manager.active_connections[user_id] = websocket
    try:
        await websocket.send_text(json.dumps({"type": "AUTH_OK"}))
    except Exception as e:
        print(f"[ws-auth] failed to send AUTH_OK: {e}")

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
    # 記錄所有曾加入的成員（斷線後也保留）
    if "all_participants" not in rooms[room_id]:
        rooms[room_id]["all_participants"] = {}
    rooms[room_id]["all_participants"][user_id] = {
        "nickname": existing.get("nickname") or nickname,
        "deviations": rooms[room_id]["all_participants"].get(user_id, {}).get("deviations", 0),
    }

    # 同步更新 Firestore 中的成員清單
    try:
        db.collection("rooms").document(room_id).update({
            f"members.{user_id}": rooms[room_id]["members"][user_id],
            f"all_participants.{user_id}": rooms[room_id]["all_participants"][user_id],
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
            # 房主在 WAITING 階段按「取消聚會」 → 廣播給所有成員、把房間標 CANCELLED
            # 不像 END_SESSION 那樣寫 meeting 紀錄、算分，因為聚會根本還沒開始
            if action == "CANCEL_ROOM":
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[CANCEL_ROOM] rejected: user={user_id} is not host of room {room_id}")
                    continue
                # 只允許 WAITING 階段取消（已經開始同步的要用 END_SESSION）
                current_status = rooms[room_id].get("status", "WAITING")
                if current_status not in ("WAITING",):
                    print(f"[CANCEL_ROOM] rejected: room {room_id} status is {current_status}, not WAITING")
                    continue

                rooms[room_id]["status"] = "CANCELLED"
                try:
                    db.collection("rooms").document(room_id).update({"status": "CANCELLED"})
                except Exception as e:
                    print(f"Error updating status to CANCELLED in Firestore: {e}")

                print(f"[CANCEL_ROOM] host={user_id} cancelled room={room_id}")
                await manager.broadcast_to_room(room_id, {
                    "type": "ROOM_CANCELLED",
                    "reason": "host_cancelled"
                })
                continue

            if action == "END_SESSION":
                # 任何參與者都可以結束聚會（讓所有人都能觸發紀錄寫入）
                # 如果房間已經結束就跳過
                if rooms[room_id].get("status") == "ENDED":
                    print(f"[END_SESSION] skipped: room {room_id} already ENDED")
                    continue

                reason = data.get("reason", "host_ended")
                duration_minutes = int(data.get("duration_minutes", 0))
                rooms[room_id]["status"] = "ENDED"

                # 先計算分數（廣播需要用到）
                room_data = rooms[room_id]
                all_ever = room_data.get("all_participants") or room_data.get("members", {})
                host_uid_local = room_data.get("host_uid")
                group_id_local = room_data.get("group_id")
                total_deviations = int(room_data.get("deviations", 0) or 0)
                # 個人計分：每個人依自己的分心次數算分，排行由高分到低分
                score_ranking, score_by_uid, avg_score = _build_score_ranking(
                    all_ever, host_uid_local, duration_minutes
                )

                # 先廣播，讓所有人立刻切換到結算畫面，不被 Firestore 寫入延誤
                print(f"[END_SESSION] room={room_id} reason={reason}")
                await manager.broadcast_to_room(room_id, {
                    "type": "SESSION_ENDED",
                    "reason": reason,
                    "duration_minutes": duration_minutes,
                    "total_deviations": total_deviations,
                    "avg_score": avg_score,
                    "base_score": avg_score,          # 舊欄位相容
                    "group_id": group_id_local,
                    "score_ranking": score_ranking,
                    "deviation_ranking": score_ranking,   # 舊前端相容
                })

                # 廣播之後才做 Firestore 寫入（慢但不影響 UX）
                try:
                    db.collection("rooms").document(room_id).update({"status": "ENDED"})
                except Exception as e:
                    print(f"Error updating status to ENDED in Firestore: {e}")

                # === 把這場聚會 snapshot 寫到 meetings collection ===
                try:
                    members_snapshot = []
                    participants = []
                    for uid, info in all_ever.items():
                        is_guest = _is_guest_user_id(uid)
                        members_snapshot.append({
                            "uid": uid,
                            "nickname": info.get("nickname", ""),
                            "is_guest": is_guest
                        })
                        if not is_guest:
                            participants.append(uid)

                    # 房主一定要在 participants（即使他已經斷線）
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
                        "total_deviations": total_deviations,
                        "member_count": len(members_snapshot),
                        "members_snapshot": members_snapshot,
                        "participants": participants,
                        "end_reason": reason,
                        "avg_score": avg_score,
                        "base_score": avg_score,          # 舊欄位相容：現在代表全場平均分
                        "score_ranking": score_ranking,
                        "deviation_ranking": score_ranking,   # 舊欄位相容：同一份資料
                    }
                    # merge=True 保留聚會中可能已經寫入的 cover_photo_id
                    db.collection("meetings").document(room_id).set(meeting_record, merge=True)
                    print(f"[END_SESSION] meeting record saved: {room_id}")

                    # 幫每個 firebase 使用者在 users/{uid}/meetings/{room_id} 寫一份鏡像 + score
                    for p_uid in participants:
                        my_score = _score_for_uid(
                            p_uid, score_by_uid, all_ever, host_uid_local, duration_minutes
                        )
                        my_deviations = int((all_ever.get(p_uid) or {}).get("deviations", 0) or 0)
                        mirror = {
                            "owner_uid": p_uid,
                            "room_id": room_id,
                            "is_host": (p_uid == host_uid_local),
                            "mode": room_data.get("mode", ""),
                            "ended_at": firestore.SERVER_TIMESTAMP,
                            "duration_minutes": duration_minutes,
                            "deviations": my_deviations,
                            "total_room_deviations": total_deviations,
                            "score": my_score,
                        }
                        try:
                            db.collection("users").document(p_uid).collection("meetings") \
                                .document(room_id).set(mirror, merge=True)
                        except Exception as mm_err:
                            print(f"[END_SESSION] mirror write failed for {p_uid}: {mm_err}")
                except Exception as e:
                    print(f"Error saving meeting record: {e}")

                # === 若房間屬於某個群組，根據評分更新群組寵物狀態 ===
                # score_by_uid 為空 = 沒有任何參與者留下紀錄，此時 avg_score=0 並非「表現差」，
                # 不可拿來扣寵物能量，直接跳過。
                if group_id_local and score_by_uid:
                    try:
                        g_ref = db.collection("groups").document(group_id_local)
                        pet_transaction = db.transaction()

                        @firestore.transactional
                        def apply_session_reward(tx):
                            g_snap = g_ref.get(transaction=tx)
                            if not g_snap.exists:
                                return None
                            g_data = g_snap.to_dict() or {}
                            # 先套用時間衰減拿到當前基準，讀書成績再往上/往下調
                            _s = _group_pet_current_stats(g_data)
                            pet_energy      = _s["pet_energy"]
                            pet_happiness   = _s["pet_happiness"]
                            pet_cleanliness = _s["pet_cleanliness"]
                            if avg_score >= 70:                         # 認真讀書：餵飽 + 開心
                                energy_delta = min(10 + int((avg_score - 70) / 3), 20)
                                pet_energy    = min(100.0, pet_energy + energy_delta)
                                pet_happiness = min(100.0, pet_happiness + 5)
                            elif avg_score < 40:                        # 混水摸魚：餓 + 掉心情
                                pet_energy    = max(0.0, pet_energy - 5)
                                pet_happiness = max(0.0, pet_happiness - 5)

                            new_status = _group_pet_status(pet_energy, pet_happiness, pet_cleanliness)
                            tx.update(g_ref, {
                                "pet_energy":       pet_energy,
                                "pet_happiness":    pet_happiness,
                                "pet_cleanliness":  pet_cleanliness,
                                "pet_status":       new_status,
                                "pet_last_updated": firestore.SERVER_TIMESTAMP,   # 重設衰減 anchor
                            })
                            return pet_energy, pet_happiness, new_status

                        pet_result = apply_session_reward(pet_transaction)
                        if pet_result:
                            pet_energy, pet_happiness, new_status = pet_result
                            print(f"[END_SESSION] group pet updated: group={group_id_local} energy={round(pet_energy)} happy={round(pet_happiness)} status={new_status}")
                    except Exception as pet_err:
                        print(f"[END_SESSION] group pet update failed: {pet_err}")

                continue

            # 1. 房主切換模式 (上課、開會、聚會、問答)
            # 🔒 [C4 修正 v15.2] 加上 host 檢查 + mode 白名單,防止任何成員亂改 mode
            if action == "CHANGE_MODE":
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[CHANGE_MODE] rejected: user={user_id} is not host of room {room_id}")
                    continue

                new_mode = data.get("mode")
                ALLOWED_MODES = {"GATHERING", "FAMILY", "MEETING", "CLASS"}
                if new_mode not in ALLOWED_MODES:
                    print(f"[CHANGE_MODE] rejected: invalid mode={new_mode!r}")
                    continue

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
            # 🔒 [Bug 2 修正 v15.3]
            #   - 必須處於 QA_GAME 模式且有 current_question 才接受
            #   - answer 必須是當前 options 之一(不接受任意字串)
            #   - 不接受成員重複作答(以「第一次」為準,避免後改)
            elif action == "SUBMIT_ANSWER":
                qa_state = rooms[room_id].get("qa_state") or {}
                if rooms[room_id].get("mode") != "QA_GAME" or not qa_state.get("current_question"):
                    print(f"[SUBMIT_ANSWER] rejected: no active QA in room {room_id}")
                    continue

                answer = data.get("answer")
                allowed_options = qa_state.get("current_options") or []
                if answer not in allowed_options:
                    print(f"[SUBMIT_ANSWER] rejected: answer {answer!r} not in options")
                    continue

                if user_id in qa_state.get("answers", {}):
                    print(f"[SUBMIT_ANSWER] rejected: user {user_id} already answered")
                    continue

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
            # 🔒 [Bug 1 修正 v15.3] 加上 phase + per-user rate-limit,
            #     防止任一惡意成員透過狂送 LOG_DEVIATION 把全員積分灌成 0
            elif action == "LOG_DEVIATION":
                # 只在 ACTIVE 階段且非 QA/Taboo 模式才接受
                if rooms[room_id].get("status") != "ACTIVE":
                    print(f"[LOG_DEVIATION] rejected: room {room_id} not ACTIVE")
                    continue
                if rooms[room_id].get("mode") in ("QA_GAME", "TABOO_GAME"):
                    print(f"[LOG_DEVIATION] rejected: in {rooms[room_id].get('mode')} mode")
                    continue

                # per-user rate-limit: 間隔由難度參數 deviation_rate_limit_sec 決定
                rate_limit_ms = int(rooms[room_id].get("session_params", {}).get("deviation_rate_limit_sec", 25)) * 1000
                now_ms = int(datetime.datetime.utcnow().timestamp() * 1000)
                member = rooms[room_id]["members"].get(user_id) or {}
                last_dev_ms = member.get("last_deviation_ms", 0)
                if now_ms - last_dev_ms < rate_limit_ms:
                    print(f"[LOG_DEVIATION] rate-limited user={user_id} room={room_id}")
                    continue
                rooms[room_id]["members"][user_id]["last_deviation_ms"] = now_ms

                # 支援前端傳入 count（長時間離開時一次記多次）
                count = max(1, int(data.get("count", 1)))
                rooms[room_id]["deviations"] += count

                # 同時記錄此用戶自己的分心次數
                rooms[room_id]["members"][user_id]["deviations"] = \
                    rooms[room_id]["members"][user_id].get("deviations", 0) + count
                user_deviations = rooms[room_id]["members"][user_id]["deviations"]

                # 同步更新 all_participants，確保 END_SESSION 排行榜能讀到正確數值
                if user_id in rooms[room_id].get("all_participants", {}):
                    rooms[room_id]["all_participants"][user_id]["deviations"] = user_deviations

                try:
                    db.collection("rooms").document(room_id).update({
                        "deviations": firestore.Increment(count),
                        f"members.{user_id}.deviations": firestore.Increment(count)
                    })
                except Exception as e:
                    print(f"Error logging deviation in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "DEVIATION_RECORDED",
                    "user_id": user_id,
                    "user_deviations": user_deviations,
                    "total_deviations": rooms[room_id]["deviations"]
                })

            # 7. 房主發起關鍵字遊戲 (Taboo Game)
            elif action == "START_TABOO_GAME":
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[START_TABOO_GAME] rejected: user={user_id} is not host of room {room_id}")
                    continue

                rooms[room_id]["mode"] = "TABOO_GAME"
                rooms[room_id]["gameState"] = "playing"

                try:
                    db.collection("rooms").document(room_id).update({
                        "mode": "TABOO_GAME",
                        "gameState": "playing"
                    })
                except Exception as e:
                    print(f"Error updating taboo state in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "TABOO_STARTED"
                })

            # 8. 房主結束關鍵字遊戲
            elif action == "END_TABOO_GAME":
                if rooms[room_id].get("host_uid") != user_id:
                    print(f"[END_TABOO_GAME] rejected: user={user_id} is not host of room {room_id}")
                    continue

                rooms[room_id]["mode"] = "ACTIVE"
                rooms[room_id]["gameState"] = "idle"

                try:
                    db.collection("rooms").document(room_id).update({
                        "mode": "ACTIVE",
                        "gameState": "idle"
                    })
                except Exception as e:
                    print(f"Error resetting taboo state in Firestore: {e}")

                await manager.broadcast_to_room(room_id, {
                    "type": "TABOO_ENDED"
                })

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        if room_id in rooms and user_id in rooms[room_id]["members"]:
            room_status = rooms[room_id].get("status", "WAITING")

            if room_status in ("ACTIVE", "SYNCING", "ENDED"):
                # 聚會進行中/已結束：只標記斷線狀態，保留成員資料以確保紀錄完整
                rooms[room_id]["members"][user_id]["state"] = "DISCONNECTED"
                try:
                    db.collection("rooms").document(room_id).update({
                        f"members.{user_id}.state": "DISCONNECTED"
                    })
                except Exception as e:
                    print(f"Error updating member disconnect state in Firestore: {e}")
            else:
                # WAITING 階段：直接移除成員
                del rooms[room_id]["members"][user_id]
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
