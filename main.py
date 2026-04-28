import uuid
import json
import asyncio
import qrcode
import io
import base64
import socket
import datetime
import jwt
from typing import Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# ===== CORS 設定 =====
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== 寫死的假資料庫 (Mock DB) 與 Auth =====
SECRET_KEY = "super-secret-key"
ALGORITHM = "HS256"

# 預設兩組帳號讓你方便測試
users_db = {
    "host": {"username": "host", "password": "123"},
    "player": {"username": "player", "password": "123"}
}

class UserAuth(BaseModel):
    username: str
    password: str

@app.post("/api/register")
async def register(user: UserAuth):
    if user.username in users_db:
        return {"status": "error", "message": "帳號已被註冊"}
    
    users_db[user.username] = {"username": user.username, "password": user.password}
    return {"status": "success", "message": "註冊成功，請登入"}

@app.post("/api/login")
async def login(user: UserAuth):
    db_user = users_db.get(user.username)
    # 簡單的比對明文密碼 (僅限開發初期使用)
    if not db_user or db_user["password"] != user.password:
        return {"status": "error", "message": "帳號或密碼錯誤"}
    
    expiration = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    token = jwt.encode({"sub": user.username, "exp": expiration}, SECRET_KEY, algorithm=ALGORITHM)
    
    return {"status": "success", "token": token, "username": user.username}

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
        enc_msg = json.dumps(message)
        for user_id in members:
            ws = self.active_connections.get(user_id)
            if ws:
                await ws.send_text(enc_msg)

manager = ConnectionManager()

@app.get("/api/create_room")
async def create_room(frontend_url: str = None):
    room_id = str(uuid.uuid4())[:8]
    # 新增 mode 與 qa_state 屬性
    rooms[room_id] = {
        "status": "WAITING",
        "mode": "GATHERING", # 預設聚會模式
        "members": {},
        "sync_start_time": None,
        "deviations": 0,
        "qa_state": {
            "current_question": None,
            "answers": {}
        }
    }
    
    local_ip = get_local_ip()
    base_url = frontend_url if frontend_url else f"http://{local_ip}:3000"
    
    if "localhost" in base_url or "127.0.0.1" in base_url:
        base_url = base_url.replace("localhost", local_ip).replace("127.0.0.1", local_ip)
        
    host_url = f"{base_url}/?room={room_id}" 
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(host_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    
    buffered = io.BytesIO()
    img.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")

    return {"room_id": room_id, "qr_base64": img_str, "url": host_url, "backend_ip": local_ip}

@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await manager.connect(user_id, websocket)
    
    if room_id not in rooms:
        # 防呆機制
        rooms[room_id] = {"status": "WAITING", "mode": "GATHERING", "members": {}, "deviations": 0, "qa_state": {"answers": {}}}
        
    rooms[room_id]["members"][user_id] = {
        "progress": 0,
        "state": "CONNECTED"
    }
    
    await manager.broadcast_to_room(room_id, {
        "type": "ROOM_UPDATE",
        "room_state": rooms[room_id]
    })
    
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            action = data.get("action")
            
            # 1. 房主切換模式 (上課、開會、聚會、問答)
            if action == "CHANGE_MODE":
                new_mode = data.get("mode")
                rooms[room_id]["mode"] = new_mode
                await manager.broadcast_to_room(room_id, {
                    "type": "MODE_CHANGED",
                    "mode": new_mode
                })

            # 2. 房主發布問答題
            elif action == "START_QA":
                question = data.get("question") # 例如: "今天的聚會誰遲到最久？"
                options = data.get("options")   # 例如: ["A. 小明", "B. 小華", "C. 我自己"]
                rooms[room_id]["mode"] = "QA_GAME"
                rooms[room_id]["qa_state"]["current_question"] = question
                rooms[room_id]["qa_state"]["answers"] = {} # 清空上一題的答案
                
                await manager.broadcast_to_room(room_id, {
                    "type": "QA_STARTED",
                    "question": question,
                    "options": options
                })

            # 3. 參與者提交答案
            elif action == "SUBMIT_ANSWER":
                answer = data.get("answer")
                rooms[room_id]["qa_state"]["answers"][user_id] = answer
                
                # 廣播更新作答進度給所有人 (可選)
                await manager.broadcast_to_room(room_id, {
                    "type": "QA_PROGRESS",
                    "answers": rooms[room_id]["qa_state"]["answers"]
                })

            # 4. 同步進度 (原邏輯)
            elif action == "SYNC_PROGRESS":
                progress = data.get("progress", 0)
                rooms[room_id]["members"][user_id]["progress"] = progress
                
                all_100 = all(m["progress"] == 100 for m in rooms[room_id]["members"].values())
                if all_100 and rooms[room_id]["status"] != "ACTIVE":
                    rooms[room_id]["status"] = "ACTIVE"
                    await manager.broadcast_to_room(room_id, {"type": "ANCHOR_ESTABLISHED"})
                else:
                    await manager.broadcast_to_room(room_id, {"type": "PROGRESS_UPDATE", "members": rooms[room_id]["members"]})
                    
            # 5. 手機螢幕狀態偵測 (僅在非 QA 模式且已啟動時才算 Deviation)
            elif action == "VISIBILITY_CHANGE":
                state = data.get("state")
                rooms[room_id]["members"][user_id]["state"] = state
                
                # 若為問答模式，允許使用手機，不觸發警告
                if rooms[room_id]["status"] == "ACTIVE" and rooms[room_id]["mode"] != "QA_GAME":
                    if state == "visible":
                        await manager.broadcast_to_room(room_id, {"type": "USER_WOKE_SCREEN", "user_id": user_id})
                    elif state == "hidden":
                        await manager.broadcast_to_room(room_id, {"type": "USER_HID_SCREEN", "user_id": user_id})

            # 6. 紀錄偏差 (原邏輯)
            elif action == "LOG_DEVIATION":
                rooms[room_id]["deviations"] += 1
                await manager.broadcast_to_room(room_id, {
                    "type": "DEVIATION_RECORDED",
                    "user_id": user_id,
                    "total_deviations": rooms[room_id]["deviations"]
                })
                
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        if room_id in rooms and user_id in rooms[room_id]["members"]:
            del rooms[room_id]["members"][user_id]
            await manager.broadcast_to_room(room_id, {
                "type": "ROOM_UPDATE",
                "room_state": rooms[room_id]
            })

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)