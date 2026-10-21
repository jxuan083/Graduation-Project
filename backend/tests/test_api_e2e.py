"""全站 API 端對端測試：三個使用者走過網站會呼叫的每一支 REST API 與聚會 WebSocket。

資料庫用真的 docstore 相容層（預設記憶體；設 E2E_DYNAMODB_TABLE=<表名> 就打真的 DynamoDB），
S3 換成記憶體假物件，登入驗證換成「token 就是 uid」。其餘都是正式程式碼。

    python -m unittest tests.test_api_e2e -v                      # 離線
    E2E_DYNAMODB_TABLE=phubbing-e2e python -m unittest tests.test_api_e2e -v
"""
import io
import json
import os
import pathlib
import sys
import unittest
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    os.environ.setdefault("DOCSTORE", "memory")
    from fastapi.testclient import TestClient
    from PIL import Image
    import docstore
    import main
except Exception as _import_err:  # noqa: BLE001
    TestClient = None
    main = None
    _SKIP_REASON = f"fastapi / main 無法載入：{_import_err}"
else:
    _SKIP_REASON = ""


class _FakeS3:
    """main.s3 的替身：只實作後端用到的方法。"""

    class exceptions:  # noqa: N801
        class ClientError(Exception):
            pass

    def __init__(self):
        self.objects = {}

    def put_object(self, Bucket, Key, Body, ContentType):  # noqa: N803
        self.objects[Key] = (Body, ContentType)

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.objects:
            raise self.exceptions.ClientError(Key)
        body, content_type = self.objects[Key]
        return {"Body": io.BytesIO(body), "ContentType": content_type}

    def head_object(self, Bucket, Key):  # noqa: N803
        if Key not in self.objects:
            raise self.exceptions.ClientError(Key)

    def delete_object(self, Bucket, Key):  # noqa: N803
        self.objects.pop(Key, None)

    def generate_presigned_post(self, Bucket, Key, Fields, Conditions, ExpiresIn):  # noqa: N803
        return {"url": f"https://{Bucket}.s3.amazonaws.com/", "fields": {"key": Key, **Fields}}


def _png():
    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


@unittest.skipIf(main is None, _SKIP_REASON)
class ApiEndToEndTest(unittest.TestCase):
    def setUp(self):
        self._saved = (main.db, main.s3, main._verify_id_token, main.send_push, main._now_ms)
        self.now_ms = main._now_ms()
        main._now_ms = lambda: self.now_ms
        table = os.environ.get("E2E_DYNAMODB_TABLE")
        if table:
            main.db = docstore.Client(docstore._DynamoBackend(table))
        else:
            main.db = docstore.Client(docstore._MemoryBackend())
        main.s3 = _FakeS3()
        main._verify_id_token = lambda token: {
            "uid": token, "sub": token, "name": f"name-{token}", "email": f"{token}@e2e.test",
        }
        self.pushes = []
        main.send_push = lambda uid, title, body, url="/": self.pushes.append((uid, title))
        main.rooms.clear()
        main.manager.active_connections.clear()
        self._client_cm = TestClient(main.app)
        self.client = self._client_cm.__enter__()
        self._sockets = []

    def tearDown(self):
        for cm in self._sockets:
            try:
                cm.__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass
        self._client_cm.__exit__(None, None, None)
        main.db, main.s3, main._verify_id_token, main.send_push, main._now_ms = self._saved
        main.rooms.clear()
        main.manager.active_connections.clear()

    # ── helpers ──
    def call(self, method, path, uid=None, expect=200, **kwargs):
        headers = {"Authorization": f"Bearer {uid}"} if uid else {}
        res = self.client.request(method, path, headers=headers, **kwargs)
        self.assertEqual(res.status_code, expect, f"{method} {path} → {res.status_code} {res.text[:300]}")
        try:
            return res.json()
        except ValueError:
            return res

    def until(self, ws, msg_type):
        for _ in range(80):
            msg = ws.receive_json()
            if msg.get("type") == msg_type:
                return msg
        self.fail(f"never received {msg_type}")

    def connect(self, room_id, uid, token=True):
        cm = self.client.websocket_connect(f"/ws/{room_id}/{uid}?nickname={uid}")
        ws = cm.__enter__()
        self._sockets.append(cm)
        ws.send_json({"action": "AUTH", "token": uid if token else None, "nickname": uid[:8]})
        self.assertEqual(ws.receive_json()["type"], "AUTH_OK")
        return ws

    # ── 整個網站的使用流程 ──
    def test_every_api_the_site_calls(self):
        # uid 跟正式環境一樣是 uuid（Cognito sub）；訪客是 guest- + uuid
        a, b, c = (str(uuid.uuid4()) for _ in range(3))
        guest = f"guest-{uuid.uuid4()}"

        # 公開資訊
        self.assertIn("version", self.call("GET", "/api/version"))
        self.assertEqual(self.call("GET", "/api/health")["checks"]["firestore"], "ok")
        self.assertIn("qr_base64", self.call("GET", "/api/qrcode", params={"url": "https://example.com"}))
        self.call("GET", "/api/context_defaults")

        # 帳號與個人資料
        for uid in (a, b, c):
            self.assertEqual(self.call("GET", "/api/me", uid)["profile"]["uid"], uid)
        self.call("POST", "/api/profile", a, json={
            "nickname": "Alice", "bio": "hi", "handle": "e2ealice", "interests": ["咖啡"],
            "photoURL": "https://example.com/a.png",
        })
        self.assertEqual(self.call("GET", "/api/me", a)["profile"]["nickname"], "Alice")
        self.call("GET", f"/api/users/{a}/public", b)
        self.assertEqual(self.call("GET", "/api/users/by_handle/e2ealice", b)["profile"]["uid"], a)
        self.call("GET", f"/api/users/{a}/card", b)
        self.call("POST", "/api/push_token", a, json={"token": json.dumps({"endpoint": "https://push.example.com/x", "keys": {}})})
        self.call("POST", "/api/push_token", a, expect=400, json={"token": "not-a-subscription-json"})
        avatar = self.call("POST", "/api/uploads/presign", a, json={"kind": "avatar", "content_type": "image/jpeg"})
        self.assertTrue(avatar["fields"]["key"].startswith(f"avatars/{a}/"))
        self.call("POST", "/api/uploads/presign", a, expect=400, json={"kind": "avatar", "content_type": "image/svg+xml"})

        # 好友：送出 → 接受；送出 → 拒絕；送出 → 收回
        self.call("POST", "/api/friend_requests", a, json={"target_uid": b})
        incoming = self.call("GET", "/api/friend_requests", b)
        req_b = next(r for r in incoming["incoming"] if r.get("other_uid") == a)
        self.call("POST", f"/api/friend_requests/{req_b['id']}/accept", b)
        self.assertIn(b, [f["uid"] for f in self.call("GET", "/api/friends", a)["friends"]])
        self.call("GET", f"/api/users/{b}/relationship", a)

        self.call("POST", "/api/friend_requests", a, json={"target_email": f"{c}@e2e.test"})
        req_c = next(r for r in self.call("GET", "/api/friend_requests", c)["incoming"] if r.get("other_uid") == a)
        self.call("POST", f"/api/friend_requests/{req_c['id']}/decline", c)
        self.call("POST", "/api/friend_requests", a, json={"target_uid": c})
        out = next(r for r in self.call("GET", "/api/friend_requests", a)["outgoing"] if r.get("other_uid") == c)
        self.call("POST", f"/api/friend_requests/{out['id']}/withdraw", a)

        # 題庫
        main.db.collection("public_questions").document("pub_e2e").set(
            {"question": "早餐?", "options": ["蛋餅", "飯糰"], "category": "食物", "has_answer": False, "correct_index": None})
        self.assertTrue(self.call("GET", "/api/public_questions", a)["questions"])
        q = self.call("POST", "/api/questions", a, json={"question": "最愛顏色?", "options": ["紅", "藍"]})
        qid = q.get("question", q).get("id")
        self.call("PATCH", f"/api/questions/{qid}", a, json={"question": "最愛的顏色?", "options": ["紅", "藍", "綠"]})
        self.call("POST", "/api/questions/import", a, json={"public_id": "pub_e2e"})
        self.assertGreaterEqual(len(self.call("GET", "/api/questions", a)["questions"]), 2)
        self.call("DELETE", f"/api/questions/{qid}", a)

        # 群組、聊天、邀請碼、寵物
        gid = self.call("POST", "/api/groups", a, json={"name": "E2E 小組"})["group"]["group_id"]
        self.call("POST", f"/api/groups/{gid}/members", a, json={"uid": b})     # b 是好友，可以直接加
        self.assertIn(gid, [g["group_id"] for g in self.call("GET", "/api/groups", b)["groups"]])
        self.call("GET", f"/api/groups/{gid}", b)
        self.call("PATCH", f"/api/groups/{gid}", a, json={"name": "E2E 小組改名"})
        chat = self.call("POST", "/api/uploads/presign", b, json={"kind": "group-chat", "content_type": "audio/webm", "group_id": gid})
        self.assertTrue(chat["fields"]["key"].startswith(f"group-chat/{gid}/{b}/"))
        self.call("POST", "/api/uploads/presign", c, expect=403, json={"kind": "group-chat", "content_type": "image/jpeg", "group_id": gid})
        self.call("POST", f"/api/groups/{gid}/messages", b, json={"text": "嗨"})
        self.call("POST", f"/api/groups/{gid}/messages", b, json={"type": "image", "media_url": chat["public_url"]})
        self.assertGreaterEqual(len(self.call("GET", f"/api/groups/{gid}/messages", a)["messages"]), 2)
        invite = self.call("POST", f"/api/groups/{gid}/invite_code/refresh", a)
        code = invite["invite_code"]
        self.call("GET", f"/api/group_invite/{code}", c)
        self.call("POST", "/api/group_invite/join", c, json={"code": code})
        self.call("DELETE", f"/api/groups/{gid}/members/{c}", a)
        self.call("POST", f"/api/groups/{gid}/members", a, expect=403, json={"email": f"{c}@e2e.test"})  # 不是好友不能直接加
        self.call("POST", "/api/group_invite/join", c, json={"code": code})
        self.call("PATCH", f"/api/groups/{gid}/pet", a, json={"pet_name": "豆豆", "pet_body_emoji": "🐶"})
        face = self.call("POST", f"/api/groups/{gid}/pet-face", a,
                         files={"file": ("face.png", _png(), "image/png")}, data={"pet_name": "豆豆", "pet_body_emoji": "🐶"})
        self.assertTrue(face["pet_face_url"].startswith("https://"))
        self.call("GET", f"/api/groups/{gid}/pet", b)
        self.call("POST", f"/api/groups/{gid}/pet/action", b, json={"action": "play"})
        self.call("POST", f"/api/groups/{gid}/pet/action", b, expect=429, json={"action": "play"})  # 冷卻中
        self.assertIn(gid, [p.get("group_id") for p in self.call("GET", "/api/group-pets", a).get("pets", [])])

        # 聚會：建房 → 三人進房 → 同步定錨 → 問答 → 分心 → 結束
        room = self.call("POST", "/api/create_room", a, json={"context": "study", "group_id": gid, "frontend_url": "https://example.com"})
        room_id = room["room_id"]
        socks = {uid: self.connect(room_id, uid) for uid in (a, b, c)}
        socks[guest] = self.connect(room_id, guest, token=False)
        self.call("POST", f"/api/rooms/{room_id}/leave", None, expect=401, json={})   # 沒身分不能操作
        socks[a].send_json({"action": "START_SYNC"})
        for ws in socks.values():
            ws.send_json({"action": "SYNC_PROGRESS", "progress": 100})
        for ws in socks.values():
            self.until(ws, "ANCHOR_ESTABLISHED")
        socks[a].send_json({"action": "START_QA", "source": "public", "question_id": "pub_e2e"})
        self.assertEqual(self.until(socks[b], "QA_STARTED")["options"], ["蛋餅", "飯糰"])
        for uid, answer in ((a, "飯糰"), (b, "蛋餅"), (c, "蛋餅"), (guest, "飯糰")):
            socks[uid].send_json({"action": "SUBMIT_ANSWER", "answer": answer})
        self.until(socks[b], "QA_FINISHED")                          # 全員作答完才回到專注模式
        socks[b].send_json({"action": "LOG_DEVIATION", "count": 1})
        self.until(socks[b], "DEVIATION_RECORDED")
        socks[c].send_json({"action": "DECLARE_INTENT"})
        self.until(socks[c], "INTENT_GRANTED")
        socks[c].send_json({"action": "VISIBILITY_CHANGE", "state": "hidden"})
        self.until(socks[a], "USER_HID_SCREEN")
        self.now_ms = main.rooms[room_id]["members"][c]["exempt_window_until_ms"] + 5_000   # 暫離時間到
        self.call("POST", f"/api/rooms/{room_id}/intent/extend", c, json={})
        socks[c].send_json({"action": "VISIBILITY_CHANGE", "state": "visible"})
        self.now_ms += 30 * 60_000
        self.call("POST", f"/api/rooms/{room_id}/leave", c, json={"from_timeout": False})
        socks[a].send_json({"action": "END_SESSION", "duration_minutes": 30})
        self.until(socks[b], "SESSION_ENDED")
        self.call("POST", f"/api/rooms/{room_id}/end", a, json={"duration_minutes": 30})

        # 聚會紀錄、照片、逐字稿、報紙、排行榜
        meetings = self.call("GET", "/api/meetings", b)["meetings"]
        self.assertIn(room_id, [m.get("id") or m.get("room_id") for m in meetings])
        self.call("GET", f"/api/meetings/{room_id}", b)
        saved = main.db.collection("meetings").document(room_id).get().to_dict()
        self.assertEqual(sorted(saved["participants"]), sorted([a, b, c]))     # 登入者都有紀錄、訪客沒有
        self.assertEqual({m["uid"]: m["is_guest"] for m in saved["members_snapshot"]}[guest], True)
        self.assertFalse({m["uid"]: m["is_guest"] for m in saved["members_snapshot"]}[a])
        self.call("PATCH", f"/api/meetings/{room_id}/favorite", b)
        self.call("GET", f"/api/groups/{gid}/meetings", a)
        photo = self.call("POST", f"/api/meetings/{room_id}/photos", a, files={"file": ("p.png", _png(), "image/png")})["photo"]
        self.assertEqual(len(self.call("GET", f"/api/meetings/{room_id}/photos", b)["photos"]), 1)
        content = self.call("GET", f"/api/meetings/{room_id}/photos/{photo['id']}/content", b)
        self.assertEqual(content.content, _png())
        self.call("PATCH", f"/api/meetings/{room_id}/photos/{photo['id']}/cover", a)
        self.call("DELETE", f"/api/meetings/{room_id}/photos/{photo['id']}", a)
        self.call("POST", f"/api/meetings/{room_id}/transcripts", a, json={"entries": [
            {"speaker_uid": a, "speaker_name": "Alice", "text": "大家好", "started_at_ms": 1000, "duration_sec": 2.0},
        ]})
        self.assertEqual(len(self.call("GET", f"/api/meetings/{room_id}/transcripts", b)["transcripts"]), 1)
        self.call("POST", f"/api/meetings/{room_id}/newspaper/generate", a)
        self.call("GET", f"/api/meetings/{room_id}/newspaper", b)
        self.call("GET", "/api/leaderboard/global", a)
        self.call("GET", "/api/leaderboard/friends", a)

        # 收尾：刪寵物、移除好友、隱藏聚會
        self.call("DELETE", f"/api/groups/{gid}/pet", a)
        self.call("DELETE", f"/api/friends/{b}", a)
        self.call("DELETE", f"/api/meetings/{room_id}", b)
        hidden = {m["id"]: m.get("is_hidden") for m in self.call("GET", "/api/meetings", b)["meetings"]}
        self.assertTrue(hidden[room_id])                              # 前端會過濾 is_hidden


if __name__ == "__main__":
    unittest.main()
