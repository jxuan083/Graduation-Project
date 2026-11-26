import datetime
import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pet_logic import (  # noqa: E402
    DECAY_PER_HOUR,
    GRACE_PERIOD_HOURS,
    STAT_FLOOR,
    apply_group_pet_action,
    cooldown_remaining_seconds,
    elapsed_hours,
    group_pet_current_stats,
    group_pet_display,
    group_pet_growth,
    group_pet_hp,
    group_pet_meeting_state,
    group_pet_session_hp_update,
    group_pet_session_xp,
    group_pet_status,
)


class PetLogicTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.datetime(2026, 7, 13, 12, 0, 0)

    def test_elapsed_hours_supports_timezone_aware_firestore_timestamp(self):
        last = datetime.datetime(2026, 7, 13, 2, 0, tzinfo=datetime.timezone.utc)
        now = datetime.datetime(2026, 7, 13, 12, 0, tzinfo=datetime.timezone.utc)
        self.assertEqual(elapsed_hours(last, now), 10)

    def test_group_pet_decay_uses_original_anchor(self):
        # No session → no grace period; "mid" quality decay for 2h
        mid_rate = DECAY_PER_HOUR["mid"]
        data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=2),
            "pet_energy": 50,
            "pet_happiness": 70,
            "pet_cleanliness": 100,
        }
        stats = group_pet_current_stats(data, self.now)
        expected_energy = round(50 - mid_rate["pet_energy"] * 2, 6)
        expected_happiness = round(70 - mid_rate["pet_happiness"] * 2, 6)
        expected_clean = round(100 - mid_rate["pet_cleanliness"] * 2, 6)
        self.assertAlmostEqual(stats["pet_energy"], expected_energy, places=4)
        self.assertAlmostEqual(stats["pet_happiness"], expected_happiness, places=4)
        self.assertAlmostEqual(stats["pet_cleanliness"], expected_clean, places=4)

    def test_grace_period_prevents_decay_within_24h_of_session(self):
        # Session ended 2h ago → still in grace period → no decay
        session_at = self.now - datetime.timedelta(hours=2)
        data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=3),
            "pet_last_session_at": session_at,
            "pet_last_session_quality": "mid",
            "pet_energy": 60,
            "pet_happiness": 60,
            "pet_cleanliness": 60,
        }
        stats = group_pet_current_stats(data, self.now)
        self.assertEqual(stats["pet_energy"], 60)
        self.assertEqual(stats["pet_happiness"], 60)
        self.assertEqual(stats["pet_cleanliness"], 60)

    def test_decay_starts_after_grace_period(self):
        # Session ended 25h ago → 1h of decay (25h - 24h grace)
        session_at = self.now - datetime.timedelta(hours=25)
        data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=26),
            "pet_last_session_at": session_at,
            "pet_last_session_quality": "high",
            "pet_energy": 80,
            "pet_happiness": 80,
            "pet_cleanliness": 80,
        }
        stats = group_pet_current_stats(data, self.now)
        high_rate = DECAY_PER_HOUR["high"]
        self.assertAlmostEqual(stats["pet_energy"], 80 - high_rate["pet_energy"] * 1, places=4)
        self.assertAlmostEqual(stats["pet_cleanliness"], 80 - high_rate["pet_cleanliness"] * 1, places=4)

    def test_decay_floor_prevents_going_below_10(self):
        # Extreme case: 1000h of decay → all stats clamped at STAT_FLOOR
        data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=1000),
            "pet_energy": 50,
            "pet_happiness": 50,
            "pet_cleanliness": 50,
        }
        stats = group_pet_current_stats(data, self.now)
        self.assertEqual(stats["pet_energy"], STAT_FLOOR)
        self.assertEqual(stats["pet_happiness"], STAT_FLOOR)
        self.assertEqual(stats["pet_cleanliness"], STAT_FLOOR)

    def test_quality_low_decays_faster_than_high(self):
        base_data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=48),
            "pet_energy": 80, "pet_happiness": 80, "pet_cleanliness": 80,
        }
        data_high = {**base_data, "pet_last_session_quality": "high"}
        data_low  = {**base_data, "pet_last_session_quality": "low"}
        stats_high = group_pet_current_stats(data_high, self.now)
        stats_low  = group_pet_current_stats(data_low, self.now)
        self.assertGreater(stats_high["pet_energy"], stats_low["pet_energy"])

    def test_group_pet_dirty_status_is_reachable(self):
        self.assertEqual(group_pet_status(60, 60, 20), "DIRTY")
        display = group_pet_display(
            {
                "pet_last_updated": self.now,
                "pet_energy": 60,
                "pet_happiness": 60,
                "pet_cleanliness": 20,
            },
            self.now,
        )
        self.assertEqual(display["pet_status"], "DIRTY")

    def test_happiness_has_its_own_lonely_status(self):
        self.assertEqual(group_pet_status(60, 20, 60), "LONELY")

    def test_growth_is_derived_from_meeting_count(self):
        # 7 meetings → Lv4 (threshold: 7)
        growth = group_pet_growth({"pet_accumulated_score": 245, "pet_meetings_completed": 7})
        self.assertEqual(growth["pet_level"], 4)
        self.assertEqual(growth["pet_stage"], "GROWING")
        self.assertEqual(growth["pet_accessories"], ["bell"])
        self.assertEqual(growth["pet_meetings_completed"], 7)
        # Progress within Lv4 (7 meetings, next level at 11)
        self.assertEqual(growth["pet_level_meetings_current"], 0)  # 7 - 7 = 0 meetings into Lv4
        self.assertEqual(growth["pet_level_meetings_total"], 4)    # 11 - 7 = 4 to reach Lv5

    def test_level_thresholds_are_correct(self):
        from pet_logic import _meetings_to_level
        self.assertEqual(_meetings_to_level(0), 1)
        self.assertEqual(_meetings_to_level(1), 1)
        self.assertEqual(_meetings_to_level(2), 2)
        self.assertEqual(_meetings_to_level(3), 2)
        self.assertEqual(_meetings_to_level(4), 3)
        self.assertEqual(_meetings_to_level(11), 5)
        self.assertEqual(_meetings_to_level(52), 10)
        self.assertEqual(_meetings_to_level(100), 10)  # capped at max level

    def test_max_level_pet_has_correct_progress(self):
        growth = group_pet_growth({"pet_meetings_completed": 60})
        self.assertEqual(growth["pet_level"], 10)
        self.assertIsNone(growth["pet_next_level_threshold"])

    def test_short_session_still_has_meaningful_xp(self):
        self.assertEqual(group_pet_session_xp(70, 10), 65)

    def test_session_duration_is_primary_xp_source(self):
        self.assertEqual(group_pet_session_xp(80, 30), 93)
        self.assertEqual(group_pet_session_xp(80, 60), 130)
        self.assertEqual(group_pet_session_xp(80, 120), 205)

    def test_session_xp_caps_duration_at_three_hours(self):
        self.assertEqual(group_pet_session_xp(100, 180), 285)
        self.assertEqual(group_pet_session_xp(100, 600), 285)

    def test_action_cooldown_rounds_up_remaining_second(self):
        last = self.now - datetime.timedelta(seconds=301.2)
        self.assertEqual(cooldown_remaining_seconds(last, self.now), 299)
        self.assertEqual(cooldown_remaining_seconds(self.now - datetime.timedelta(minutes=10), self.now), 0)

    def test_meeting_rescue_state_has_grace_period(self):
        created = self.now - datetime.timedelta(days=7)
        state = group_pet_meeting_state({"created_at": created, "pet_hp": 5}, self.now)
        self.assertTrue(state["pet_meeting_warning"])
        self.assertFalse(state["pet_is_caged"])
        self.assertEqual(state["pet_days_until_caged"], 23)  # 30 - 7

    def test_pet_is_caged_after_thirty_days_without_meeting(self):
        state = group_pet_meeting_state(
            {"pet_last_session_at": self.now - datetime.timedelta(days=30), "pet_hp": 5},
            self.now,
        )
        self.assertTrue(state["pet_is_caged"])
        self.assertEqual(state["pet_days_until_caged"], 0)

    def test_pet_is_caged_when_hp_is_zero(self):
        state = group_pet_meeting_state(
            {"pet_last_session_at": self.now - datetime.timedelta(days=1), "pet_hp": 0},
            self.now,
        )
        self.assertTrue(state["pet_is_caged"])

    def test_recent_meeting_releases_pet(self):
        state = group_pet_meeting_state(
            {
                "created_at": self.now - datetime.timedelta(days=90),
                "pet_last_session_at": self.now - datetime.timedelta(days=1),
            },
            self.now,
        )
        self.assertFalse(state["pet_meeting_warning"])
        self.assertFalse(state["pet_is_caged"])

    def test_group_actions_are_bounded(self):
        stats = {"pet_energy": 90.0, "pet_happiness": 50.0, "pet_cleanliness": 80.0}
        fed = apply_group_pet_action(stats, "feed")
        self.assertEqual(fed["pet_energy"], 100)
        self.assertEqual(fed["pet_happiness"], 53)
        self.assertEqual(stats["pet_energy"], 90)  # pure function: input is not mutated
        # Play action floors energy at STAT_FLOOR, not 0
        low_energy = {"pet_energy": STAT_FLOOR, "pet_happiness": 50.0, "pet_cleanliness": 80.0}
        played = apply_group_pet_action(low_energy, "play")
        self.assertEqual(played["pet_energy"], STAT_FLOOR)  # can't go below floor

    def test_session_hp_increases_when_all_stats_above_50(self):
        final = {"pet_energy": 60, "pet_happiness": 55, "pet_cleanliness": 70}
        self.assertEqual(group_pet_session_hp_update(3, final), 4)
        self.assertEqual(group_pet_session_hp_update(5, final), 5)  # capped at max

    def test_session_hp_decreases_when_any_stat_at_floor(self):
        at_floor = {"pet_energy": STAT_FLOOR, "pet_happiness": 60, "pet_cleanliness": 60}
        self.assertEqual(group_pet_session_hp_update(3, at_floor), 2)
        self.assertEqual(group_pet_session_hp_update(0, at_floor), 0)  # can't go below 0

    def test_session_hp_unchanged_when_mixed_stats(self):
        mixed = {"pet_energy": 40, "pet_happiness": 40, "pet_cleanliness": 40}
        self.assertEqual(group_pet_session_hp_update(3, mixed), 3)

    def test_group_pet_hp_reads_from_stored_value(self):
        self.assertEqual(group_pet_hp({"pet_hp": 3}), 3)
        self.assertEqual(group_pet_hp({}), 5)  # default to max
        self.assertEqual(group_pet_hp({"pet_hp": 0}), 0)
        self.assertEqual(group_pet_hp({"pet_hp": 7}), 5)  # clamped to max

if __name__ == "__main__":
    unittest.main()
