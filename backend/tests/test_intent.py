import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from intent import (  # noqa: E402
    can_declare_intent,
    charge_on_return,
    exempt_budget,
    exempt_window_sec,
    exemption_info,
    overage_deviations,
    within_exemption,
)


class TestWindowAndBudget(unittest.TestCase):
    def test_window_by_difficulty_3_2_1_min(self):
        self.assertEqual(exempt_window_sec("L"), 180)
        self.assertEqual(exempt_window_sec("M"), 120)
        self.assertEqual(exempt_window_sec("H"), 60)

    def test_strict_contexts_have_zero_budget(self):
        self.assertEqual(exempt_budget("meeting"), 0)
        self.assertEqual(exempt_budget("class"), 0)

    def test_lenient_contexts_have_more_budget(self):
        self.assertGreater(exempt_budget("meal"), exempt_budget("date"))

    def test_exemption_info_shape(self):
        info = exemption_info("meal", "M")
        self.assertEqual(info["window_sec"], 120)
        self.assertTrue(info["enabled"])
        self.assertFalse(exemption_info("class", "H")["enabled"])


class TestCanDeclare(unittest.TestCase):
    def test_reject_when_context_not_open(self):
        ok, _ = can_declare_intent(0, 0, 1_000_000, budget=0)
        self.assertFalse(ok)

    def test_reject_when_budget_used_up(self):
        ok, _ = can_declare_intent(2, 0, 1_000_000, budget=2)
        self.assertFalse(ok)

    def test_reject_within_cooldown(self):
        now = 1_000_000
        ok, _ = can_declare_intent(1, now - 30_000, now, budget=3, cooldown_sec=90)
        self.assertFalse(ok)

    def test_allow_after_cooldown_and_within_budget(self):
        now = 1_000_000
        ok, reason = can_declare_intent(1, now - 120_000, now, budget=3, cooldown_sec=90)
        self.assertTrue(ok)
        self.assertEqual(reason, "")


class TestWithinExemption(unittest.TestCase):
    def test_within_and_after(self):
        self.assertTrue(within_exemption(2000, 1500))
        self.assertFalse(within_exemption(2000, 2500))
        self.assertFalse(within_exemption(0, 1500))  # 沒有窗口


class TestChargeOnReturn(unittest.TestCase):
    def test_first_exemption_is_free(self):
        # used_count == 1 → 全免
        self.assertEqual(charge_on_return(1000, 61_000, window_sec=120, used_count=1), 0.0)

    def test_second_onward_charges_actual_away(self):
        # 第2次，離開 60 秒 → 記 60 秒
        self.assertEqual(charge_on_return(1000, 61_000, window_sec=120, used_count=2), 60.0)

    def test_charge_capped_at_window(self):
        # 離開 300 秒但窗口只有 120 → 只記 120（超時部分由正常分心處理）
        self.assertEqual(charge_on_return(1000, 301_000, window_sec=120, used_count=2), 120.0)

    def test_no_active_episode_charges_zero(self):
        self.assertEqual(charge_on_return(0, 61_000, window_sec=120, used_count=2), 0.0)


class TestOverageDeviations(unittest.TestCase):
    def test_no_overage_before_window_ends(self):
        self.assertEqual(overage_deviations(200_000, 150_000, per_dev_sec=20), 0)

    def test_no_window_means_zero(self):
        self.assertEqual(overage_deviations(0, 150_000, per_dev_sec=20), 0)

    def test_overage_converts_to_deviations(self):
        # 窗口在 100_000ms 到期，現在 220_000ms → 超時 120 秒；每 20 秒算一次 → 6 次
        self.assertEqual(overage_deviations(100_000, 220_000, per_dev_sec=20), 6)


if __name__ == "__main__":
    unittest.main()
