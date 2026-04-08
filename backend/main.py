import uuid
import json
import asyncio
import qrcode
import io
import base64
import socket
from typing import Dict, Set, List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# ===== CORS FOR FRONTEND SEPARATION =====
# Allow frontend domains (e.g. from Vite dev server port 5173 or simple HTTP server 3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    """
    frontend_url: Allows a separated frontend to tell backend where to point the QR code.
    If None, fallback to guessing local IP + port 3000 config.
    """
    room_id = str(uuid.uuid4())[:8]
    rooms[room_id] = {
        "status": "WAITING",
        "members": {},
        "sync_start_time": None,
        "deviations": 0
    }
    
    local_ip = get_local_ip()
    base_url = frontend_url if frontend_url else f"http://{local_ip}:3000"
    
    # Smart overwrite: If PC opens localhost, ensure mobile still gets real IP
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

    return {
        "room_id": room_id, 
        "qr_base64": img_str, 
        "url": host_url,
        "backend_ip": local_ip
    }


@app.websocket("/ws/{room_id}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_id: str):
    await manager.connect(user_id, websocket)
    
    if room_id not in rooms:
        rooms[room_id] = {"status": "WAITING", "members": {}, "sync_start_time": None, "deviations": 0}
        
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
            
            if action == "SYNC_PROGRESS":
                progress = data.get("progress", 0)
                rooms[room_id]["members"][user_id]["progress"] = progress
                
                # Check if all reached 100
                all_100 = all(m["progress"] == 100 for m in rooms[room_id]["members"].values())
                if all_100 and rooms[room_id]["status"] != "ACTIVE":
                    rooms[room_id]["status"] = "ACTIVE"
                    await manager.broadcast_to_room(room_id, {
                        "type": "ANCHOR_ESTABLISHED"
                    })
                else:
                    await manager.broadcast_to_room(room_id, {
                        "type": "PROGRESS_UPDATE",
                        "members": rooms[room_id]["members"]
                    })
                    
            elif action == "VISIBILITY_CHANGE":
                state = data.get("state")
                rooms[room_id]["members"][user_id]["state"] = state
                
                if rooms[room_id]["status"] == "ACTIVE":
                    if state == "visible":
                        await manager.broadcast_to_room(room_id, {
                            "type": "USER_WOKE_SCREEN",
                            "user_id": user_id
                        })
                    elif state == "hidden":
                        await manager.broadcast_to_room(room_id, {
                            "type": "USER_HID_SCREEN",
                            "user_id": user_id
                        })

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
