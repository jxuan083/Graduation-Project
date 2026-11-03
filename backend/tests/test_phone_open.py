import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import phone_open as po  # noqa: E402

MIN = 60_000
T0 = 1_000_000_000_000


def room(context="meeting", difficulty="M", members=("a", "b")):
    return {"context": context, "difficulty": difficulty, "members": {u: {} for u in members}}


class TestOpen(unittest.TestCase):
    def test_only_host_in_meeting_or_class(self):
        self.assertFalse(po.can_open(room("general"), "h", "h", 0, T0)[0])
        self.assertFalse(po.can_open(room("meeting"), "a", "h", 0, T0)[0])
        self.assertTrue(po.can_open(room("meeting"), "h", "h", 0, T0)[0])
        self.assertTrue(po.can_open(room("class"), "h", "h", 15, T0)[0])

    def test_meeting_is_until_end_only_and_minutes_are_bounded(self):
        ok, reason = po.can_open(room("meeting"), "h", "h", 10, T0)
        self.assertFalse(ok)
        self.assertTrue(reason)
        self.assertFalse(po.can_open(room("class"), "h", "h", 999, T0)[0])
        self.assertTrue(po.can_open(room("class"), "h", "h", 0, T0)[0])   # 上課也能「直到我結束」

    def test_timed_open_expires_by_itself_and_cannot_be_closed_early(self):
        r = room("class")
        po.open_phones(r, "h", 15, T0)
        self.assertTrue(po.is_open(r, T0 + 14 * MIN))
        self.assertFalse(po.can_close(r, "h", "h", T0 + 5 * MIN)[0])
        self.assertFalse(po.is_open(r, T0 + 15 * MIN))
        self.assertEqual(po.ended_at(r, T0 + 20 * MIN), T0 + 15 * MIN)
        self.assertFalse(po.can_open(r, "h", "h", 5, T0 + 5 * MIN)[0])   # 開放中不能再開

    def test_until_end_runs_until_host_closes(self):
        r = room("meeting")
        po.open_phones(r, "h", 0, T0)
        self.assertTrue(po.is_open(r, T0 + 600 * MIN))
        self.assertTrue(po.can_close(r, "h", "h", T0 + MIN)[0])
        self.assertFalse(po.can_close(r, "a", "h", T0 + MIN)[0])
        po.close_phones(r, T0 + 30 * MIN)
        self.assertFalse(po.is_open(r, T0 + 30 * MIN))
        self.assertEqual(po.ended_at(r, T0 + 40 * MIN), T0 + 30 * MIN)


class TestReturnAfterClose(unittest.TestCase):
    def test_away_when_host_closed_counts_from_close_plus_grace(self):
        r = room("meeting", "M")     # 寬限 20 秒
        po.open_phones(r, "h", 0, T0)
        po.note_hidden(r, r["members"]["a"], T0 + MIN)
        po.close_phones(r, T0 + 10 * MIN)
        # 結束後 70 秒才回來：截止時間 = 結束 + 20 秒，過了 50 秒 → 1 + floor(50/20) = 3 次
        self.assertEqual(po.overage_on_return(r, r["members"]["a"], T0 + 10 * MIN + 70_000), 3)
        self.assertEqual(r["members"]["a"]["open_away_since_ms"], 0)
        self.assertEqual(po.overage_on_return(r, r["members"]["a"], T0 + 20 * MIN), 0)   # 不會重複算

    def test_back_within_grace_or_while_open_is_free(self):
        r = room("meeting", "M")
        po.open_phones(r, "h", 0, T0)
        po.note_hidden(r, r["members"]["a"], T0 + MIN)
        self.assertEqual(po.overage_on_return(r, r["members"]["a"], T0 + 5 * MIN), 0)   # 還在開放中
        po.note_hidden(r, r["members"]["b"], T0 + MIN)
        po.close_phones(r, T0 + 10 * MIN)
        self.assertEqual(po.overage_on_return(r, r["members"]["b"], T0 + 10 * MIN + 15_000), 0)

    def test_timed_open_overage_is_left_to_the_app(self):
        r = room("class", "H")
        po.open_phones(r, "h", 10, T0)
        po.note_hidden(r, r["members"]["a"], T0 + MIN)
        self.assertEqual(po.overage_on_return(r, r["members"]["a"], T0 + 30 * MIN), 0)

    def test_never_returned_is_charged_at_settlement(self):
        r = room("class", "H")      # 寬限 10 秒
        po.open_phones(r, "h", 10, T0)
        po.note_hidden(r, r["members"]["a"], T0 + MIN)
        self.assertEqual(po.overage_at_settle(r, r["members"]["a"], T0 + 10 * MIN + 5_000, 30), 0)
        self.assertEqual(po.overage_at_settle(r, r["members"]["a"], T0 + 10 * MIN + 10_000 + 95_000, 30), 3)

    def test_reopen_charges_the_gap_for_people_still_away(self):
        r = room("meeting", "M")
        po.open_phones(r, "h", 0, T0)
        po.note_hidden(r, r["members"]["a"], T0 + MIN)
        po.close_phones(r, T0 + 10 * MIN)
        gap = po.open_phones(r, "h", 0, T0 + 11 * MIN)   # 結束後 60 秒又開放：截止 +20 秒，過 40 秒 → 3 次
        self.assertEqual(gap, {"a": 3})
        self.assertTrue(po.is_open(r, T0 + 12 * MIN))

    def test_host_leaving_ends_an_until_end_open_but_not_a_timed_one(self):
        r = room("meeting")
        po.open_phones(r, "h", 0, T0)
        self.assertFalse(po.close_if_host_left(r, "a", T0 + MIN))
        self.assertTrue(po.close_if_host_left(r, "h", T0 + 2 * MIN))
        self.assertEqual(po.ended_at(r, T0 + 3 * MIN), T0 + 2 * MIN)
        r2 = room("class")
        po.open_phones(r2, "h", 10, T0)
        self.assertFalse(po.close_if_host_left(r2, "h", T0 + MIN))
        self.assertTrue(po.is_open(r2, T0 + 5 * MIN))


if __name__ == "__main__":
    unittest.main()
