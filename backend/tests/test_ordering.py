import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import ordering as od  # noqa: E402

MIN = 60_000
T0 = 1_000_000_000_000


class TestOrderTrip(unittest.TestCase):
    def test_only_some_contexts_have_ordering(self):
        self.assertTrue(od.ordering_enabled("general"))
        self.assertTrue(od.ordering_enabled("family"))
        self.assertTrue(od.ordering_enabled("meal"))
        self.assertFalse(od.ordering_enabled("meeting"))
        self.assertFalse(od.ordering_enabled("class"))
        ok, reason, _ = od.start_order_trip({}, "meeting", T0)
        self.assertFalse(ok)
        self.assertTrue(reason)

    def test_trip_gives_fifteen_minutes_and_uses_one(self):
        m = {}
        ok, _, until = od.start_order_trip(m, "meal", T0)
        self.assertTrue(ok)
        self.assertEqual(until, T0 + 15 * MIN)
        self.assertEqual(od.trips_left(m), 1)
        self.assertTrue(od.within_order_trip(m, T0 + 14 * MIN))
        self.assertFalse(od.within_order_trip(m, T0 + 15 * MIN))

    def test_bouncing_between_apps_in_one_trip_does_not_use_another(self):
        m = {}
        od.start_order_trip(m, "meal", T0)
        ok, _, until = od.start_order_trip(m, "meal", T0 + 3 * MIN)   # 付款頁又跳去銀行 App
        self.assertTrue(ok)
        self.assertEqual(until, T0 + 15 * MIN)
        self.assertEqual(od.trips_left(m), 1)

    def test_limit_two_per_gathering(self):
        m = {}
        for i in range(2):
            self.assertTrue(od.start_order_trip(m, "general", T0 + i * 20 * MIN)[0])
            od.end_order_trip(m)
        ok, reason, _ = od.start_order_trip(m, "general", T0 + 60 * MIN)
        self.assertFalse(ok)
        self.assertIn("用完", reason)

    def test_returning_ends_the_trip(self):
        m = {}
        od.start_order_trip(m, "family", T0)
        od.note_hidden(m, T0 + 1000)
        od.end_order_trip(m)
        self.assertFalse(od.within_order_trip(m, T0 + 2 * MIN))
        self.assertEqual(od.overage_deviations(m, T0 + 40 * MIN, 25), 0)

    def test_never_coming_back_counts_only_the_overage(self):
        m = {}
        od.start_order_trip(m, "meal", T0)
        od.note_hidden(m, T0 + 1000)
        self.assertEqual(od.overage_deviations(m, T0 + 10 * MIN, 25), 0)
        self.assertEqual(od.overage_deviations(m, T0 + 15 * MIN + 100_000, 25), 4)   # 超過 100 秒

    def test_hidden_outside_trip_is_not_recorded(self):
        m = {}
        od.note_hidden(m, T0)
        self.assertFalse(m.get("order_away_since_ms"))


if __name__ == "__main__":
    unittest.main()
