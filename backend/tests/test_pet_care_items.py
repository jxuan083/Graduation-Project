import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from pet_care import CARE_ITEMS, RARITIES, apply_item_effects, care_catalog, discovered_items, draw_care_item


class CareItemsTests(unittest.TestCase):
    def test_probabilities_and_each_kind_are_complete(self):
        self.assertEqual(sum(tier['weight'] for tier in RARITIES.values()), 10000)
        self.assertEqual(len({item['id'] for item in CARE_ITEMS}), len(CARE_ITEMS))
        for kind in ['food', 'toy']:
            for rarity in RARITIES:
                self.assertTrue(any(item['kind'] == kind and item['rarity'] == rarity for item in CARE_ITEMS))

    def test_exact_draw_boundaries_and_action_kind(self):
        for roll, expected in [(0, 'common'), (6999, 'common'), (7000, 'rare'), (9499, 'rare'), (9500, 'treasure'), (9999, 'treasure')]:
            for action, kind in [('feed', 'food'), ('play', 'toy')]:
                item = draw_care_item(action, randbelow=lambda n: roll, choice=lambda items: items[0])
                self.assertEqual((item['rarity'], item['kind']), (expected, kind))
        self.assertIsNone(draw_care_item('wipe'))

    def test_item_effects_clamp_stats_and_never_change_xp(self):
        food = draw_care_item('feed', randbelow=lambda n: 9999, choice=lambda items: items[0])
        result = apply_item_effects({'pet_energy': 90, 'pet_happiness': 98, 'pet_cleanliness': 60}, food)
        self.assertEqual(result, {'pet_energy': 100, 'pet_happiness': 100, 'pet_cleanliness': 60})
        self.assertNotIn('pet_accumulated_score', result)

    def test_catalog_and_discoveries_do_not_allow_unknown_or_duplicate_items(self):
        self.assertEqual(care_catalog()['mode'], 'draw_and_use')
        self.assertEqual(discovered_items({'pet_discovered_items': ['cloth_ball', 'cloth_ball', 'fake']}), ['cloth_ball'])
