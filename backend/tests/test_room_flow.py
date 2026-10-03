"""聚會房間流程的行程內測試：真的走 FastAPI 的 HTTP + WebSocket，Firestore 換成假的。

驗證 main.py 把訊號接到 attendance.py 的接線：重連保留狀態、個人離開／加回、
主持人交棒、暫離延長與超時、單一結算路徑。需要 fastapi（CI 只跑純函式測試時自動略過）。
"""
import asyncio
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:1")   # 只為了不需要憑證；實際不會連線
    from fastapi.testclient import TestClient
    import main
except Exception as _import_err:  # noqa: BLE001
    TestClient = None
    main = None
    _SKIP_REASON = f"fastapi / main 無法載入：{_import_err}"
else:
    _SKIP_REASON = ""

MIN = 60_000
T0 = 1_700_000_000_000


class _Snap:
    exists = False

    def to_dict(self):
        return {}


class _Doc:
    def __init__(self, db, path):
        self._db, self._path = db, path

    def set(self, data, merge=False):
        self._db.writes.setdefault(self._path, {}).update(data)

    def update(self, data):
        self._db.writes.setdefault(self._path, {}).update(data)

    def get(self, *args, **kwargs):
        return _Snap()

    def collection(self, name):
        return _Col(self._db, f"{self._path}/{name}")


class _Col:
    def __init__(self, db, path):
        self._db, self._path = db, path

    def document(self, doc_id):
        return _Doc(self._db, f"{self._path}/{doc_id}")

    def where(self, *args, **kwargs):
        return self

    def limit(self, *args):
        return self

    def stream(self):
        return []


class _FakeDb:
    def __init__(self):
        self.writes = {}

    def collection(self, name):
        return _Col(self, name)


class _Clock:
    def __init__(self):
        self.now = T0

    def __call__(self):
        return self.now


@unittest.skipIf(main is None, _SKIP_REASON)
class RoomFlowTest(unittest.TestCase):
    def setUp(self):
        self._saved = (main.db, main._now_ms, main.fb_auth.verify_id_token)
        self.db = _FakeDb()
        self.clock = _Clock()
        main.db = self.db
        main._now_ms = self.clock
        main.fb_auth.verify_id_token = lambda token: {"uid": token, "name": token}   # 測試用：token 就是 uid
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
        main.db, main._now_ms, main.fb_auth.verify_id_token = self._saved
        main.rooms.clear()
        main.manager.active_connections.clear()

    # ── helpers ──
    def auth(self, uid):
        return {"Authorization": f"Bearer {uid}"}

    def connect(self, room_id, uid):
        cm = self.client.websocket_connect(f"/ws/{room_id}/{uid}?nickname={uid}")
        ws = cm.__enter__()
        self._sockets.append(cm)
        ws.send_json({"action": "AUTH", "token": uid, "nickname": uid})
        self.assertEqual(ws.receive_json()["type"], "AUTH_OK")
        return ws

    def until(self, ws, msg_type):
        """讀到指定類型的訊息為止（中間的略過）。"""
        for _ in range(50):
            msg = ws.receive_json()
            if msg["type"] == msg_type:
                return msg
        self.fail(f"never received {msg_type}")

    def start(self, *member_uids, context="general", difficulty="M"):
        """host 建房 → 所有人進房 → 同步定錨 → ACTIVE（時間點 T0）。"""
        res = self.client.post("/api/create_room", headers=self.auth("host"),
                               json={"context": context, "difficulty": difficulty})
        self.assertEqual(res.status_code, 200, res.text)
        room_id = res.json()["room_id"]
        socks = {}
        for uid in ("host",) + member_uids:
            socks[uid] = self.connect(room_id, uid)
        socks["host"].send_json({"action": "START_SYNC"})
        for uid, ws in socks.items():
            ws.send_json({"action": "SYNC_PROGRESS", "progress": 100})
        for ws in socks.values():
            self.until(ws, "ANCHOR_ESTABLISHED")
        self.assertEqual(main.rooms[room_id]["status"], "ACTIVE")
        return room_id, socks

    def leave(self, room_id, uid, **body):
        return self.client.post(f"/api/rooms/{room_id}/leave", headers=self.auth(uid), json=body)

    def mirror(self, room_id, uid):
        return self.db.writes.get(f"users/{uid}/meetings/{room_id}")

    # ── tests ──
    def test_reconnect_keeps_deviations_and_exemption_budget(self):
        room_id, socks = self.start("a")
        self.clock.now = T0 + 2 * MIN
        socks["a"].send_json({"action": "DECLARE_INTENT"})
        self.assertEqual(self.until(socks["a"], "INTENT_GRANTED")["remaining"], 1)
        socks["a"].send_json({"action": "VISIBILITY_CHANGE", "state": "visible"})
        self.clock.now = T0 + 6 * MIN
        socks["a"].send_json({"action": "LOG_DEVIATION", "count": 2})
        self.until(socks["a"], "DEVIATION_RECORDED")

        socks["a"].close()
        self.until(socks["host"], "DEVIATION_RECORDED")
        self.until(socks["host"], "ROOM_UPDATE")                    # a 斷線
        self.assertEqual(main.rooms[room_id]["members"]["a"]["state"], "DISCONNECTED")
        self.connect(room_id, "a")

        m = main.rooms[room_id]["members"]["a"]
        self.assertEqual(m["state"], "CONNECTED")
        self.assertEqual(m["exempt_count_used"], 1)                 # 重連不會把暫離次數補回來
        self.assertEqual(m["deviations"], 2)
        self.assertEqual(main.rooms[room_id]["all_participants"]["a"]["deviations"], 2)
        self.assertEqual(main.rooms[room_id]["all_participants"]["a"].get("rejoin_count", 0), 0)

    def test_leave_rejoin_handover_and_single_settlement(self):
        room_id, socks = self.start("a", "b")
        room = main.rooms[room_id]

        self.clock.now = T0 + 5 * MIN
        socks["a"].send_json({"action": "LOG_DEVIATION", "count": 2})
        self.until(socks["a"], "DEVIATION_RECORDED")

        # a 在第 20 分鐘離開：當下結算並存檔，其他人繼續
        self.clock.now = T0 + 20 * MIN
        res = self.leave(room_id, "a")
        self.assertEqual(res.status_code, 200, res.text)
        left = res.json()
        self.assertEqual((left["duration_minutes"], left["deviations"], left["rejoins_left"]), (20, 2, 2))
        self.assertEqual(self.mirror(room_id, "a")["score"], left["score"])
        self.assertTrue(self.mirror(room_id, "a")["left_early"])
        self.assertEqual(self.until(socks["b"], "MEMBER_LEFT")["user_id"], "a")
        self.assertEqual(room["status"], "ACTIVE")
        self.assertEqual(self.leave(room_id, "a").status_code, 409)   # 已離開不能再離開一次

        # 非主持人不能結束整場
        socks["b"].send_json({"action": "END_SESSION", "duration_minutes": 20})
        self.assertEqual(self.until(socks["b"], "ACTION_REJECTED")["action"], "END_SESSION")
        self.assertEqual(self.client.post(f"/api/rooms/{room_id}/end", headers=self.auth("b"),
                                          json={"duration_minutes": 20}).status_code, 403)
        self.assertEqual(room["status"], "ACTIVE")

        # a 在第 35 分鐘加回：畫面分心歸零、累計保留
        self.clock.now = T0 + 35 * MIN
        socks["a"] = self.connect(room_id, "a")
        self.assertEqual(self.until(socks["b"], "MEMBER_REJOINED")["user_id"], "a")
        self.assertEqual(room["members"]["a"]["deviations"], 0)
        self.assertEqual(room["all_participants"]["a"]["deviations"], 2)
        self.assertEqual(room["all_participants"]["a"]["rejoin_count"], 1)

        # 房主在第 40 分鐘離開 → 自動交棒給目前專注最久的 b（a 第 35 分鐘才加回），聚會繼續
        self.clock.now = T0 + 40 * MIN
        res = self.leave(room_id, "host")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(self.until(socks["a"], "HOST_CHANGED")["host_uid"], "b")
        self.assertEqual(room["host_uid"], "host")                    # 建立者不變
        self.assertEqual(room["acting_host_uid"], "b")
        self.assertEqual(room["status"], "ACTIVE")

        # 新主持人在第 60 分鐘結束 → 全員結算
        self.clock.now = T0 + 60 * MIN
        socks["b"].send_json({"action": "END_SESSION", "duration_minutes": 999})
        ended = self.until(socks["a"], "SESSION_ENDED")
        self.assertEqual(ended["duration_minutes"], 60)               # 以伺服器時間為準，不信前端傳的 999
        rows = {r["uid"]: r for r in ended["score_ranking"]}
        self.assertEqual({u: r["attended_minutes"] for u, r in rows.items()}, {"host": 40, "a": 45, "b": 60})
        self.assertEqual(rows["a"]["deviations"], 2)
        self.assertTrue(rows["host"]["left_early"])
        self.assertFalse(rows["a"]["left_early"])

        # 存檔與畫面同一份結果；重複結束（前端的 HTTP 保底）不會重算
        self.assertEqual(self.mirror(room_id, "a")["score"], rows["a"]["score"])
        self.assertEqual(self.mirror(room_id, "a")["attended_minutes"], 45)
        self.assertFalse(self.mirror(room_id, "a")["left_early"])
        self.assertEqual(self.db.writes[f"meetings/{room_id}"]["score_ranking"], ended["score_ranking"])
        self.clock.now = T0 + 90 * MIN
        again = self.client.post(f"/api/rooms/{room_id}/end", headers=self.auth("b"), json={"duration_minutes": 90})
        self.assertEqual(again.status_code, 200)
        self.assertEqual(self.db.writes[f"meetings/{room_id}"]["duration_minutes"], 60)

    def test_rejoin_limit(self):
        room_id, socks = self.start("a")
        for i in range(2):
            self.clock.now += 2 * MIN
            self.assertEqual(self.leave(room_id, "a").status_code, 200)
            self.clock.now += MIN
            socks["a"] = self.connect(room_id, "a")
        self.clock.now += 2 * MIN
        self.assertEqual(self.leave(room_id, "a").json()["rejoins_left"], 0)

        cm = self.client.websocket_connect(f"/ws/{room_id}/a?nickname=a")
        ws = cm.__enter__()
        self._sockets.append(cm)
        ws.send_json({"action": "AUTH", "token": "a", "nickname": "a"})
        self.assertEqual(ws.receive_json()["type"], "AUTH_OK")
        self.assertEqual(ws.receive_json()["type"], "JOIN_REJECTED")
        self.assertEqual(main.rooms[room_id]["members"]["a"]["state"], "LEFT")

    def test_silent_reconnect_after_leaving_is_not_a_rejoin(self):
        room_id, socks = self.start("a")
        self.clock.now = T0 + 10 * MIN
        self.assertEqual(self.leave(room_id, "a").status_code, 200)

        cm = self.client.websocket_connect(f"/ws/{room_id}/a?nickname=a")
        ws = cm.__enter__()
        self._sockets.append(cm)
        ws.send_json({"action": "AUTH", "token": "a", "nickname": "a", "silent": True})
        self.assertEqual(ws.receive_json()["type"], "AUTH_OK")
        rejected = ws.receive_json()
        self.assertEqual(rejected["type"], "JOIN_REJECTED")
        self.assertTrue(rejected["silent"])
        self.assertEqual(rejected["result"]["duration_minutes"], 10)
        self.assertEqual(rejected["result"]["rejoins_left"], 2)           # 沒有被偷扣加回次數
        self.assertEqual(main.rooms[room_id]["members"]["a"]["state"], "LEFT")

        self.connect(room_id, "a")                                         # 使用者自己按加回才算
        self.assertEqual(main.rooms[room_id]["all_participants"]["a"]["rejoin_count"], 1)

    def test_last_person_leaving_ends_the_session(self):
        room_id, socks = self.start("a")
        self.clock.now = T0 + 10 * MIN
        self.assertEqual(self.leave(room_id, "a").status_code, 200)
        self.clock.now = T0 + 30 * MIN
        res = self.leave(room_id, "host")
        self.assertTrue(res.json()["session_ended"])
        self.assertEqual(main.rooms[room_id]["status"], "ENDED")
        record = self.db.writes[f"meetings/{room_id}"]
        self.assertEqual(record["end_reason"], "all_left")
        self.assertEqual(record["duration_minutes"], 30)
        self.assertEqual(sorted(record["participants"]), ["a", "host"])

    def test_host_role_only_moves_when_the_host_leaves(self):
        room_id, socks = self.start("a", "b")
        room = main.rooms[room_id]

        # 沒有手動交棒，也不能因為主持人斷線就接手：這兩個動作後端都不認
        socks["host"].send_json({"action": "TRANSFER_HOST", "to": "b"})
        socks["host"].close()                                      # 主持人鎖螢幕 → 連線斷了
        self.until(socks["a"], "ROOM_UPDATE")
        self.clock.now += 30 * MIN
        socks["a"].send_json({"action": "CLAIM_HOST"})
        socks["a"].send_json({"action": "START_TABOO_GAME"})       # 不是主持人 → 開不了遊戲
        socks["a"].send_json({"action": "LOG_DEVIATION"})          # a 分心一次（收到回應＝前面的訊息都處理完了）
        self.until(socks["a"], "DEVIATION_RECORDED")
        self.assertEqual(main._att.acting_host(room), "host")
        self.assertNotEqual(room["mode"], "TABOO_GAME")
        self.assertEqual(room["members"]["host"]["state"], "DISCONNECTED")

        # 主持人按「離開聚會」→ 自動交給目前連續專注最久的 b（a 剛分心過）
        self.clock.now += 5 * MIN
        self.assertEqual(self.leave(room_id, "host").status_code, 200)
        self.assertEqual(self.until(socks["b"], "HOST_CHANGED")["host_uid"], "b")
        self.assertEqual(room["acting_host_uid"], "b")
        socks["b"].send_json({"action": "START_TABOO_GAME"})
        self.until(socks["a"], "TABOO_STARTED")

    def test_question_round_does_not_wait_for_someone_who_left(self):
        room_id, socks = self.start("a", "b")
        socks["host"].send_json({"action": "START_QA", "question": "Q", "options": ["x", "y"]})
        self.until(socks["a"], "QA_STARTED")
        socks["host"].send_json({"action": "SUBMIT_ANSWER", "answer": "x"})
        socks["a"].send_json({"action": "SUBMIT_ANSWER", "answer": "y"})
        self.assertEqual(self.until(socks["a"], "QA_PROGRESS")["total_count"], 3)
        self.assertEqual(main.rooms[room_id]["mode"], "QA_GAME")
        self.assertEqual(self.leave(room_id, "b").status_code, 200)    # b 沒作答就離開
        self.until(socks["a"], "QA_FINISHED")
        self.assertEqual(main.rooms[room_id]["mode"], "ACTIVE")

    def test_exemption_extend_then_timeout_auto_leave(self):
        room_id, socks = self.start("a")
        room = main.rooms[room_id]
        window_ms = 120_000

        self.clock.now = T0 + 10 * MIN
        socks["a"].send_json({"action": "DECLARE_INTENT"})
        self.until(socks["a"], "INTENT_GRANTED")
        self.clock.now += 1_000
        socks["a"].send_json({"action": "VISIBILITY_CHANGE", "state": "hidden"})
        self.until(socks["host"], "USER_HID_SCREEN")
        until = room["members"]["a"]["exempt_window_until_ms"]
        self.assertEqual(until, T0 + 10 * MIN + window_ms)

        # 到期後按「延長一次」：從原到期時間再加一個窗口，且只能延長一次
        self.clock.now = until + 10_000
        res = self.client.post(f"/api/rooms/{room_id}/intent/extend", headers=self.auth("a"))
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["remaining_sec"], 110)
        self.assertEqual(room["members"]["a"]["exempt_window_until_ms"], until + window_ms)
        self.assertEqual(self.client.post(f"/api/rooms/{room_id}/intent/extend",
                                          headers=self.auth("a")).status_code, 409)
        self.assertEqual(self.client.post(f"/api/rooms/{room_id}/intent/extend",
                                          headers=self.auth("host")).status_code, 409)

        # 延長後仍沒回來：未滿 5 分鐘不動，滿了就視為「延長到期那一刻」離開
        for cm in self._sockets:
            cm.__exit__(None, None, None)
        self._sockets.clear()
        new_until = until + window_ms
        self.clock.now = new_until + 4 * MIN
        asyncio.run(main._sweep_rooms())
        self.assertEqual(room["members"]["a"]["state"], "DISCONNECTED")
        self.clock.now = new_until + 5 * MIN
        asyncio.run(main._sweep_rooms())
        self.assertEqual(room["members"]["a"]["state"], "LEFT")
        ap = room["all_participants"]["a"]
        self.assertEqual(ap["left_at_ms"], new_until)
        self.assertEqual(ap["leave_reason"], "exempt_timeout")
        self.assertEqual(ap["deviations"], 0)
        self.assertEqual(ap["quality_metrics"]["exempt_charged_seconds"], 120.0)   # 延長的那一截算在場不專注
        self.assertEqual(self.mirror(room_id, "a")["duration_minutes"], 14)
        self.assertEqual(room["status"], "ACTIVE")                                 # 房主還在，聚會繼續

    def test_leave_from_timeout_notification_is_dated_at_expiry(self):
        room_id, socks = self.start("a")
        self.clock.now = T0 + 10 * MIN
        socks["a"].send_json({"action": "DECLARE_INTENT"})
        self.until(socks["a"], "INTENT_GRANTED")
        socks["a"].send_json({"action": "VISIBILITY_CHANGE", "state": "hidden"})
        self.until(socks["host"], "USER_HID_SCREEN")
        self.clock.now = T0 + 15 * MIN                                 # 窗口第 12 分鐘到期，第 15 分鐘才按離開
        res = self.leave(room_id, "a", from_timeout=True)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["duration_minutes"], 12)
        self.assertEqual(res.json()["deviations"], 0)
        self.assertEqual(main.rooms[room_id]["all_participants"]["a"]["leave_reason"], "exempt_timeout")


if __name__ == "__main__":
    unittest.main()
