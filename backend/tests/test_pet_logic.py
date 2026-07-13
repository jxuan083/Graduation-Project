import datetime
import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from pet_logic import (  # noqa: E402
    elapsed_hours,
    group_pet_current_stats,
    group_pet_display,
    group_pet_status,
    personal_pet_decay,
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
        self.assertEqual(stats["pet_energy"], 42)
        self.assertEqual(stats["pet_happiness"], 64)
        self.assertEqual(stats["pet_cleanliness"], 96)

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

    def test_personal_pet_read_is_deterministic_and_does_not_mutate_input(self):
        data = {
            "my_pet_last_updated": self.now - datetime.timedelta(hours=4),
            "my_pet_hunger": 70,
            "my_pet_happiness": 70,
            "my_pet_energy": 80,
            "my_pet_cleanliness": 100,
            "my_pet_is_sleeping": False,
            "my_pet_has_poop": False,
            "my_pet_has_pee": False,
        }
        first = personal_pet_decay(data, self.now)
        second = personal_pet_decay(data, self.now)
        self.assertEqual(first, second)
        self.assertEqual(first["my_pet_hunger"], 50)
        self.assertEqual(first["my_pet_energy"], 64)
        self.assertTrue(first["my_pet_has_poop"])
        self.assertTrue(first["my_pet_has_pee"])
        self.assertNotIn("my_pet_status", data)

    def test_sleep_recovers_energy(self):
        result = personal_pet_decay(
            {
                "my_pet_last_updated": self.now - datetime.timedelta(hours=2),
                "my_pet_energy": 60,
                "my_pet_is_sleeping": True,
            },
            self.now,
        )
        self.assertEqual(result["my_pet_energy"], 76)
        self.assertEqual(result["my_pet_status"], "SLEEPING")


if __name__ == "__main__":
    unittest.main()
