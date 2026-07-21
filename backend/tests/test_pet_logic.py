import datetime
import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pet_logic import (  # noqa: E402
    apply_group_pet_action,
    cooldown_remaining_seconds,
    elapsed_hours,
    group_pet_current_stats,
    group_pet_display,
    group_pet_growth,
    group_pet_meeting_state,
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
        data = {
            "pet_last_updated": self.now - datetime.timedelta(hours=2),
            "pet_energy": 50,
            "pet_happiness": 70,
            "pet_cleanliness": 100,
        }
        stats = group_pet_current_stats(data, self.now)
        self.assertEqual(stats["pet_energy"], 48.5)
        self.assertEqual(stats["pet_happiness"], 69)
        self.assertEqual(stats["pet_cleanliness"], 99.3)

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

    def test_growth_is_derived_from_meeting_xp(self):
        growth = group_pet_growth({"pet_accumulated_score": 245, "pet_meetings_completed": 7})
        self.assertEqual(growth["pet_level"], 3)
        self.assertEqual(growth["pet_xp_current"], 45)
        self.assertEqual(growth["pet_stage"], "GROWING")
        self.assertEqual(growth["pet_accessories"], ["bell"])
        self.assertEqual(growth["pet_meetings_completed"], 7)

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
        state = group_pet_meeting_state({"created_at": created}, self.now)
        self.assertTrue(state["pet_meeting_warning"])
        self.assertFalse(state["pet_is_caged"])
        self.assertEqual(state["pet_days_until_caged"], 7)

    def test_pet_is_caged_after_fourteen_days_without_meeting(self):
        state = group_pet_meeting_state(
            {"pet_last_session_at": self.now - datetime.timedelta(days=14)},
            self.now,
        )
        self.assertTrue(state["pet_is_caged"])
        self.assertEqual(state["pet_days_until_caged"], 0)

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

if __name__ == "__main__":
    unittest.main()
