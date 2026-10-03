import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import attendance as att  # noqa: E402
from scoring import build_score_ranking, compute_meeting_score  # noqa: E402

MIN = 60_000
T0 = 1_000_000_000_000   # 聚會開始（ACTIVE）的時間點
WINDOW = 120             # 難度 M 的暫離窗口秒數


def make_room(*uids, host="host"):
    """WAITING 房間 → 所有人進房 → 定錨完成（ACTIVE，時間點 T0）。"""
    room = {
        "status": "WAITING", "host_uid": host, "members": {}, "all_participants": {},
        "deviations": 0, "context": "general", "difficulty": "M",
        "session_params": {"deviation_rate_limit_sec": 25},
    }
    for i, uid in enumerate((host,) + uids):
        att.admit(room, uid, uid, T0 - 10 * MIN + i)
    room["status"] = "ACTIVE"
    att.start_active(room, T0)
    return room


class TestAdmit(unittest.TestCase):
    def test_reconnect_keeps_personal_state(self):
        room = make_room("a")
        room["members"]["a"].update({"exempt_count_used": 2, "exempt_last_declared_ms": T0 + 5})
        att.record_deviation(room, "a", 3, T0 + MIN)
        att.mark_disconnected(room, "a")

        kind, _ = att.admit(room, "a", "a", T0 + 3 * MIN)

        self.assertEqual(kind, "reconnect")
        m = room["members"]["a"]
        self.assertEqual(m["state"], "CONNECTED")
        self.assertEqual(m["exempt_count_used"], 2)
        self.assertEqual(m["deviations"], 3)
        self.assertEqual(room["all_participants"]["a"]["deviations"], 3)
        self.assertEqual(room["all_participants"]["a"].get("rejoin_count", 0), 0)

    def test_mid_session_joiner_attendance_starts_at_join(self):
        room = make_room()
        att.admit(room, "late", "late", T0 + 50 * MIN)
        att.settle_room(room, T0 + 60 * MIN, WINDOW)
        self.assertEqual(room["all_participants"]["late"]["attended_minutes"], 10)
        self.assertEqual(room["all_participants"]["host"]["attended_minutes"], 60)

    def test_waiting_room_dropout_is_not_scored(self):
        room = {"status": "WAITING", "host_uid": "host", "members": {}, "all_participants": {}}
        att.admit(room, "host", "host", T0 - MIN)
        att.admit(room, "ghost", "ghost", T0 - MIN)
        del room["members"]["ghost"]          # 等候室斷線 → 成員被移除
        room["status"] = "ACTIVE"
        att.start_active(room, T0)
        att.settle_room(room, T0 + 30 * MIN, WINDOW)
        self.assertEqual(set(att.scored_participants(room)), {"host"})


class TestLeaveAndRejoin(unittest.TestCase):
    def test_leave_scores_only_time_attended(self):
        room = make_room("a")
        self.assertTrue(att.leave(room, "a", T0 + 20 * MIN, "left_early", WINDOW))
        ap = att.settle_participant(room, "a")
        self.assertEqual(ap["attended_minutes"], 20)
        self.assertEqual(room["members"]["a"]["state"], att.STATE_LEFT)
        self.assertEqual(att.present_uids(room), ["host"])

    def test_events_after_leaving_do_not_reopen_presence(self):
        room = make_room("a")
        att.leave(room, "a", T0 + 20 * MIN, "left_early", WINDOW)
        self.assertFalse(att.leave(room, "a", T0 + 25 * MIN, "left_early", WINDOW))
        att.mark_disconnected(room, "a")
        self.assertEqual(room["members"]["a"]["state"], att.STATE_LEFT)

    def test_user_example_leave_at_20_rejoin_at_35_end_at_60(self):
        room = make_room("a")
        att.record_deviation(room, "a", 1, T0 + 4 * MIN)
        att.record_deviation(room, "a", 1, T0 + 8 * MIN)     # 之後 12 分鐘沒分心
        att.leave(room, "a", T0 + 20 * MIN, "left_early", WINDOW)

        kind, _ = att.admit(room, "a", "a", T0 + 35 * MIN)
        self.assertEqual(kind, "rejoin")
        self.assertEqual(room["members"]["a"]["deviations"], 0)            # 畫面從 0 重新開始
        self.assertEqual(room["all_participants"]["a"]["deviations"], 2)   # 累計扣分保留

        att.record_deviation(room, "a", 1, T0 + 40 * MIN)
        minutes = att.settle_room(room, T0 + 60 * MIN, WINDOW)

        ap = room["all_participants"]["a"]
        self.assertEqual(minutes, 60)
        self.assertEqual(ap["attended_minutes"], 45)                       # 20 + 25，離開的 15 分鐘不算
        self.assertEqual(ap["deviations"], 3)
        self.assertEqual(room["members"]["a"]["deviations"], 1)
        # 連續專注：離開前最長 12 分鐘；加回後 5 分鐘、20 分鐘 → 取 20 分鐘，不跨過離開的空檔
        self.assertEqual(ap["quality_metrics"]["focus_streak_seconds"], 20 * 60)

    def test_rejoin_cannot_wash_away_earlier_penalty(self):
        stayed = make_room("a")
        att.record_deviation(stayed, "a", 3, T0 + 5 * MIN)
        att.settle_room(stayed, T0 + 60 * MIN, WINDOW)

        washed = make_room("a")
        att.record_deviation(washed, "a", 3, T0 + 5 * MIN)
        att.leave(washed, "a", T0 + 6 * MIN, "left_early", WINDOW)
        att.admit(washed, "a", "a", T0 + 7 * MIN)
        att.settle_room(washed, T0 + 60 * MIN, WINDOW)

        def score(room):
            _, by_uid, _, _ = build_score_ranking(att.scored_participants(room), "host", 60, "general", "M")
            return by_uid["a"]

        self.assertLessEqual(score(washed), score(stayed))

    def test_rejoin_limit_is_two(self):
        room = make_room("a")
        t = T0
        for expected in ("rejoin", "rejoin"):
            t += 5 * MIN
            att.leave(room, "a", t, "left_early", WINDOW)
            t += MIN
            self.assertEqual(att.admit(room, "a", "a", t)[0], expected)
        self.assertEqual(att.rejoins_left(room, "a"), 0)
        att.leave(room, "a", t + MIN, "left_early", WINDOW)
        kind, reason = att.admit(room, "a", "a", t + 2 * MIN)
        self.assertEqual(kind, "rejected")
        self.assertTrue(reason)
        self.assertEqual(room["members"]["a"]["state"], att.STATE_LEFT)

    def test_rejoin_keeps_exemption_budget_and_cooldown(self):
        room = make_room("a")
        room["members"]["a"].update({"exempt_count_used": 1, "exempt_last_declared_ms": T0 + MIN})
        att.leave(room, "a", T0 + 5 * MIN, "left_early", WINDOW)
        att.admit(room, "a", "a", T0 + 6 * MIN)
        self.assertEqual(room["members"]["a"]["exempt_count_used"], 1)
        self.assertEqual(room["members"]["a"]["exempt_last_declared_ms"], T0 + MIN)

    def test_leaver_who_never_returns_keeps_leave_time_score_at_end(self):
        room = make_room("a")
        att.leave(room, "a", T0 + 20 * MIN, "left_early", WINDOW)
        att.settle_room(room, T0 + 60 * MIN, WINDOW)
        self.assertEqual(room["all_participants"]["a"]["attended_minutes"], 20)
        rows, _, _, _ = build_score_ranking(att.scored_participants(room), "host", 60, "general", "M")
        row = next(r for r in rows if r["uid"] == "a")
        self.assertTrue(row["left_early"])
        self.assertEqual(row["attended_minutes"], 20)
        self.assertEqual(row["score"], compute_meeting_score(20, 0, False, "M", "general",
                                                             {"focus_streak_seconds": 20 * 60}))

    def test_everyone_left_ends_at_last_departure(self):
        room = make_room("a")
        att.leave(room, "a", T0 + 10 * MIN, "left_early", WINDOW)
        att.leave(room, "host", T0 + 30 * MIN, "left_early", WINDOW)
        self.assertEqual(att.settle_room(room, T0 + 90 * MIN, WINDOW), 30)


class TestExemptionTimeout(unittest.TestCase):
    def _declare_and_go(self, room, uid, declared_ms, used=1):
        m = room["members"][uid]
        m["exempt_count_used"] = used
        m["exempt_window_until_ms"] = declared_ms + WINDOW * 1000
        m["exempt_active_since_ms"] = declared_ms + 1000
        return m["exempt_window_until_ms"]

    def test_auto_leave_after_five_minutes_dated_at_window_expiry(self):
        room = make_room("a")
        until = self._declare_and_go(room, "a", T0 + 10 * MIN)
        self.assertEqual(att.apply_exempt_timeouts(room, until + 299_000, WINDOW), [])
        self.assertEqual(att.apply_exempt_timeouts(room, until + 300_000, WINDOW), ["a"])
        ap = room["all_participants"]["a"]
        self.assertEqual(ap["left_at_ms"], until)
        self.assertEqual(ap["leave_reason"], "exempt_timeout")
        self.assertEqual(ap["deviations"], 0)          # 不補記超時分心

    def test_short_overage_still_counts_as_deviations_at_end(self):
        room = make_room("a")
        until = self._declare_and_go(room, "a", T0 + 10 * MIN)
        att.settle_room(room, until + 100_000, WINDOW)      # 超時 100 秒，未滿 5 分鐘
        self.assertEqual(room["all_participants"]["a"]["deviations"], 4)   # 100 // 25
        self.assertNotEqual(room["all_participants"]["a"].get("presence"), "left")

    def test_long_overage_at_end_becomes_leave_not_unbounded_deviations(self):
        room = make_room("a")
        until = self._declare_and_go(room, "a", T0 + 10 * MIN)
        att.settle_room(room, until + 40 * MIN, WINDOW)
        ap = room["all_participants"]["a"]
        self.assertEqual(ap["deviations"], 0)
        self.assertEqual(ap["presence"], "left")
        self.assertEqual(ap["attended_minutes"], 12)

    def test_leaving_during_window_adds_no_overage(self):
        room = make_room("a")
        self._declare_and_go(room, "a", T0 + 10 * MIN)
        att.leave(room, "a", T0 + 11 * MIN, "left_early", WINDOW)
        att.settle_room(room, T0 + 60 * MIN, WINDOW)
        self.assertEqual(room["all_participants"]["a"]["deviations"], 0)
        self.assertEqual(room["members"]["a"]["exempt_window_until_ms"], 0)

    def test_leave_from_timeout_notification_is_dated_at_expiry(self):
        room = make_room("a")
        until = self._declare_and_go(room, "a", T0 + 10 * MIN)
        self.assertEqual(att.leave_time(room, "a", until + 90_000, from_timeout=True), until)
        self.assertEqual(att.leave_time(room, "a", until + 90_000), until + 90_000)
        self.assertEqual(att.leave_time(room, "host", T0 + MIN, from_timeout=True), T0 + MIN)

    def test_extension_once_and_always_charged(self):
        room = make_room("a")
        until = self._declare_and_go(room, "a", T0 + 10 * MIN, used=1)   # 第 1 次暫離：原窗口全免
        ok, _, new_until = att.extend_exemption(room, "a", until + 5_000, WINDOW)
        self.assertTrue(ok)
        self.assertEqual(new_until, until + WINDOW * 1000)               # 從原到期時間起算，不是從按下起算
        self.assertFalse(att.extend_exemption(room, "a", until + 6_000, WINDOW)[0])

        charged = att.settle_exemption(room, "a", until + 60_000, WINDOW)  # 延長後 60 秒回來
        self.assertEqual(charged, 60.0)
        self.assertEqual(room["all_participants"]["a"]["quality_metrics"]["exempt_charged_seconds"], 60.0)
        self.assertEqual(room["members"]["a"]["exempt_ext_from_ms"], 0)

    def test_second_use_charges_base_window_plus_extension(self):
        room = make_room("a")
        declared = T0 + 10 * MIN
        until = self._declare_and_go(room, "a", declared, used=2)
        att.extend_exemption(room, "a", until + 1_000, WINDOW)
        charged = att.settle_exemption(room, "a", until + 30_000, WINDOW)
        self.assertAlmostEqual(charged, (WINDOW - 1) + 30.0)             # 原窗口實際離開 119 秒 + 延長 30 秒

    def test_extension_refused_when_not_away_or_too_late(self):
        room = make_room("a")
        self.assertFalse(att.extend_exemption(room, "a", T0 + MIN, WINDOW)[0])
        until = self._declare_and_go(room, "a", T0 + 10 * MIN)
        self.assertFalse(att.extend_exemption(room, "a", until + 300_000, WINDOW)[0])

    def test_return_without_extension_matches_original_rule(self):
        room = make_room("a")
        declared = T0 + 10 * MIN
        self._declare_and_go(room, "a", declared, used=1)
        self.assertEqual(att.settle_exemption(room, "a", declared + 50_000, WINDOW), 0.0)
        self._declare_and_go(room, "a", declared + 5 * MIN, used=2)
        self.assertEqual(att.settle_exemption(room, "a", declared + 5 * MIN + 41_000, WINDOW), 40.0)


class TestHost(unittest.TestCase):
    def test_acting_host_defaults_to_creator(self):
        room = make_room("a")
        self.assertEqual(att.acting_host(room), "host")
        room["acting_host_uid"] = "a"
        self.assertEqual(att.acting_host(room), "a")

    def test_successor_is_whoever_has_focused_longest_right_now(self):
        room = make_room("a", "b", "c")
        att.record_deviation(room, "a", 1, T0 + 10 * MIN)     # a 從第 10 分鐘重新起算
        att.record_deviation(room, "b", 1, T0 + 4 * MIN)      # b 從第 4 分鐘重新起算
        att.record_deviation(room, "c", 1, T0 + 12 * MIN)     # c 從第 12 分鐘重新起算
        now = T0 + 20 * MIN
        self.assertEqual(att.current_focus_ms(room, "b", now), 16 * MIN)
        self.assertEqual(att.pick_successor(room, "host", now), "b")
        att.leave(room, "b", now, "left_early", WINDOW)        # 已離開的人不會被選到
        self.assertEqual(att.pick_successor(room, "host", now), "a")

    def test_disconnected_member_still_counts_as_focused(self):
        room = make_room("a", "b")
        att.record_deviation(room, "b", 1, T0 + 5 * MIN)
        att.mark_disconnected(room, "a")                       # 鎖螢幕專心 → 連線斷了，仍在場
        self.assertEqual(att.pick_successor(room, "host", T0 + 20 * MIN), "a")

    def test_tie_is_broken_at_random_among_the_tied(self):
        room = make_room("a", "b", "c")
        att.record_deviation(room, "c", 1, T0 + 5 * MIN)       # a、b 都沒分心過 → 一樣久
        picked = []

        class FakeRng:
            def choice(self, options):
                picked.append(list(options))
                return options[-1]

        self.assertEqual(att.pick_successor(room, "host", T0 + 20 * MIN, rng=FakeRng()), "b")
        self.assertEqual(picked, [["a", "b"]])
        seen = {att.pick_successor(room, "host", T0 + 20 * MIN) for _ in range(60)}
        self.assertEqual(seen, {"a", "b"})                     # 真的隨機：兩個都會被選到，c 不會

    def test_rejoined_member_focus_restarts_at_rejoin(self):
        room = make_room("a", "b")
        att.record_deviation(room, "b", 1, T0 + 2 * MIN)
        att.leave(room, "a", T0 + 3 * MIN, "left_early", WINDOW)
        att.admit(room, "a", "a", T0 + 10 * MIN)
        self.assertEqual(att.pick_successor(room, "host", T0 + 20 * MIN), "b")

    def test_no_successor_when_host_is_last_present(self):
        room = make_room("a")
        att.leave(room, "a", T0 + MIN, "left_early", WINDOW)
        self.assertIsNone(att.pick_successor(room, "host", T0 + 2 * MIN))

    def test_host_bonus_stays_with_creator(self):
        room = make_room("a")
        room["acting_host_uid"] = "a"
        att.settle_room(room, T0 + 60 * MIN, WINDOW)
        _, by_uid, _, _ = build_score_ranking(att.scored_participants(room), room["host_uid"], 60, "general", "M")
        self.assertEqual(by_uid["host"], 100)
        self.assertEqual(by_uid["a"], 100)   # 兩人都滿分封頂；加分對象看 host_uid，不看主持人


class TestSettleRoom(unittest.TestCase):
    def test_full_attendance_matches_session_minutes(self):
        room = make_room("a")
        minutes = att.settle_room(room, T0 + 47 * MIN + 20_000, WINDOW)
        self.assertEqual(minutes, 47)
        self.assertEqual(room["all_participants"]["a"]["attended_minutes"], 47)

    def test_streak_broken_by_deviation(self):
        room = make_room("a")
        att.record_deviation(room, "a", 1, T0 + 25 * MIN)
        att.settle_room(room, T0 + 40 * MIN, WINDOW)
        self.assertEqual(room["all_participants"]["a"]["quality_metrics"]["focus_streak_seconds"], 25 * 60)
        self.assertEqual(room["all_participants"]["host"]["quality_metrics"]["focus_streak_seconds"], 40 * 60)

    def test_settling_twice_does_not_double_count(self):
        room = make_room("a")
        att.settle_room(room, T0 + 30 * MIN, WINDOW)
        att.settle_room(room, T0 + 45 * MIN, WINDOW)
        self.assertEqual(room["all_participants"]["a"]["attended_minutes"], 30)

    def test_legacy_room_without_active_start_uses_client_duration(self):
        room = {"status": "ACTIVE", "host_uid": "h", "members": {"h": {"state": "CONNECTED"}},
                "all_participants": {"h": {"nickname": "h", "deviations": 1}}}
        self.assertEqual(att.settle_room(room, T0, WINDOW, fallback_minutes=33), 33)
        self.assertNotIn("attended_minutes", room["all_participants"]["h"])
        self.assertEqual(set(att.scored_participants(room)), {"h"})


if __name__ == "__main__":
    unittest.main()
