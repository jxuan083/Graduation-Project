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
from firebase_admin import credentials, firestore, auth as fb_auth, storage as fb_storage
from typing import Dict, Set, List, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends, HTTPException, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ===== Firebase Storage 設定 =====
# 預設指向這個專案的 bucket；可以透過環境變數覆寫
STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET", "graduation-6ae65.firebasestorage.app")

# 檢查是否已經有初始化的 Firebase App
if not firebase_admin._apps:
    try:
        # 在 Cloud Run 環境中，不需要 serviceAccountKey.json，它會自動抓取環境權限
        firebase_admin.initialize_app(options={"storageBucket": STORAGE_BUCKET})
        print(f"Firebase initialized with default credentials. Bucket: {STORAGE_BUCKET}")
    except Exception as e:
        # 只有在本地環境找不到預設權限時，才嘗試讀取 JSON 檔案
        print(f"Default auth failed, trying local JSON: {e}")
        try:
            cred = credentials.Certificate("serviceAccountKey.json")
            firebase_admin.initialize_app(cred, options={"storageBucket": STORAGE_BUCKET})
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

BACKEND_VERSION = "v15.2-security-fix"
BACKEND_BUILD_DATE = "2026-04-26"  # 每次部署手動更新


@app.get("/api/version")
async def get_version():
    """回傳後端版本 + 建置日期，前端 footer 會顯示這個"""
    return {"version": BACKEND_VERSION, "build_date": BACKEND_BUILD_DATE}


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
            "nickname": data.get("nickname", ""),
            "photoURL": data.get("photoURL", ""),
            "bio": data.get("bio", ""),
        }
    }


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
async def send_friend_request(payload: FriendRequestPayload, decoded: dict = Depends(verify_token)):
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
async def accept_friend_request(req_id: str, decoded: dict = Depends(verify_token)):
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
    ts = out.get("uploaded_at")
    if ts and hasattr(ts, "isoformat"):
        out["uploaded_at"] = ts.isoformat()
    elif ts:
        out["uploaded_at"] = str(ts)
    return out


@app.post("/api/meetings/{meeting_id}/photos")
async def upload_meeting_photo(
    meeting_id: str,
    file: UploadFile = File(...),
    decoded: dict = Depends(verify_token),
):
    """房主上傳照片到 Firebase Storage，並在 Firestore 存 metadata"""
    uid = decoded.get("uid") or decoded.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Token 內無 uid")

    _get_meeting_or_403(meeting_id, uid, require_host=True)

    # 檢查數量上限
    photos_col = db.collection("meetings").document(meeting_id).collection("photos")
    existing = list(photos_col.stream())
    if len(existing) >= MAX_PHOTOS_PER_MEETING:
        raise HTTPException(status_code=400, detail=f"每場聚會最多 {MAX_PHOTOS_PER_MEETING} 張照片")

    # 檢查 content type
    if not (file.content_type and file.content_type.startswith("image/")):
        raise HTTPException(status_code=400, detail="只接受圖片檔")

    try:
        content = await file.read()
        if len(content) > PHOTO_MAX_BYTES:
            raise HTTPException(status_code=400, detail="檔案太大 (>10MB)")

        # 副檔名
        ext = "jpg"
        if file.filename and "." in file.filename:
            ext_cand = file.filename.split(".")[-1].lower()
            if ext_cand in ("jpg", "jpeg", "png", "webp"):
                ext = ext_cand
        photo_id = uuid.uuid4().hex
        blob_name = f"meeting-photos/{meeting_id}/{photo_id}.{ext}"

        bucket = fb_storage.bucket()
        blob = bucket.blob(blob_name)
        blob.upload_from_string(content, content_type=file.content_type)
        # 讓檔案可以透過 URL 讀取（URL 只有透過我們 API 回傳才拿得到，所以只有參與者能看到）
        blob.make_public()
        public_url = blob.public_url

        # 寫 Firestore
        is_first = len(existing) == 0
        payload = {
            "url": public_url,
            "storage_path": blob_name,
            "uploaded_by": uid,
            "uploaded_at": firestore.SERVER_TIMESTAMP,
            "is_cover": is_first,  # 第一張自動設為封面
        }
        photos_col.document(photo_id).set(payload)

        # 如果這是第一張，更新 meeting doc 方便清單直接顯示封面縮圖
        # 用 set + merge=True：聚會進行中 meetings/{id} 還不存在也能寫入（END_SESSION 會再 merge 其餘欄位）
        if is_first:
            db.collection("meetings").document(meeting_id).set({
                "cover_url": public_url,
                "cover_photo_id": photo_id,
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
    # 封面優先，其餘照 uploaded_at 先後排列
    photos.sort(key=lambda p: (not p.get("is_cover"), p.get("uploaded_at") or ""))
    return {"status": "success", "photos": photos, "max": MAX_PHOTOS_PER_MEETING}


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
            bucket = fb_storage.bucket()
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
                "cover_url": new_data.get("url"),
                "cover_photo_id": new_cover.id,
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
        "cover_url": target_data.get("url"),
        "cover_photo_id": photo_id,
    }, merge=True)
    return {"status": "success"}


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

    # ============================================================
    # 🔒 [C1 修正 v15.2] WebSocket 身份驗證
    # ============================================================
    # 修正前: user_id 直接從 URL path 信任,任何人可以冒充任何 user_id
    # 修正後:
    #   - 已登入使用者: query param 帶 ?token=<firebase_id_token>,
    #                  後端 verify_id_token,且 verified uid 必須等於 path user_id
    #   - 訪客: 不帶 token,path user_id 必須是合法 UUID4 格式 (uuid4 含 dash,
    #           firebase uid 不含 dash,以此區分)
    # ============================================================
    token = websocket.query_params.get("token")
    is_guest_uid = "-" in user_id  # uuid4 含 dash;firebase uid 不含 dash

    if is_guest_uid:
        # 訪客流程:不接受 token,且 user_id 必須是合法 uuid4 格式
        if token:
            print(f"[ws-auth] reject: guest uid {user_id!r} should not carry token")
            await websocket.close(code=4400, reason="Guest cannot have token")
            return
        try:
            uuid.UUID(user_id, version=4)
        except (ValueError, AttributeError):
            print(f"[ws-auth] reject: invalid guest uuid {user_id!r}")
            await websocket.close(code=4401, reason="Invalid guest id")
            return
    else:
        # 已登入使用者:必須帶 token,且 token 解出的 uid 必須等於 path user_id
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
        # 身份驗證通過 — 接下來 user_id 可以信任了
        print(f"[ws-auth] OK: uid={user_id!r} (room={room_id})")

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

                    total_deviations = int(room_data.get("deviations", 0) or 0)
                    # 計算這場聚會的「共享基礎分」（focus + participation + bonus，全員共享）
                    base_score = _compute_meeting_score(duration_minutes, total_deviations, is_host=False)
                    host_score = _compute_meeting_score(duration_minutes, total_deviations, is_host=True)

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
                        "base_score": base_score,
                        "host_score": host_score,
                    }
                    # merge=True 保留聚會中可能已經寫入的 cover_url / cover_photo_id
                    db.collection("meetings").document(room_id).set(meeting_record, merge=True)
                    print(f"[END_SESSION] meeting record saved: {room_id}")

                    # 幫每個 firebase 使用者在 users/{uid}/meetings/{room_id} 寫一份鏡像 + score
                    # 這樣排行榜用 collection_group('meetings') query 起來很簡單
                    for p_uid in participants:
                        my_score = host_score if p_uid == host_uid_local else base_score
                        mirror = {
                            "owner_uid": p_uid,
                            "room_id": room_id,
                            "is_host": (p_uid == host_uid_local),
                            "mode": room_data.get("mode", ""),
                            "ended_at": firestore.SERVER_TIMESTAMP,
                            "duration_minutes": duration_minutes,
                            "deviations": total_deviations,
                            "score": my_score,
                        }
                        try:
                            db.collection("users").document(p_uid).collection("meetings") \
                                .document(room_id).set(mirror, merge=True)
                        except Exception as mm_err:
                            print(f"[END_SESSION] mirror write failed for {p_uid}: {mm_err}")
                except Exception as e:
                    print(f"Error saving meeting record: {e}")

                print(f"[END_SESSION] room={room_id} reason={reason}")
                await manager.broadcast_to_room(room_id, {
                    "type": "SESSION_ENDED",
                    "reason": reason
                })
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
