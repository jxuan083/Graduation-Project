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
        self.assertEqual(care_catalog()['mode'], 'inventory')
        self.assertEqual(discovered_items({'pet_discovered_items': ['cloth_ball', 'cloth_ball', 'fake']}), ['cloth_ball'])


class EconomyTests(unittest.TestCase):
    def test_coin_rules_require_group_time_and_cap_long_meetings(self):
        from pet_care import session_coins
        self.assertEqual(session_coins(100, 9, 2), 0)
        self.assertEqual(session_coins(100, 30, 1), 0)
        self.assertEqual(session_coins(90, 30, 2), 68)
        self.assertEqual(session_coins(100, 10000, 2), 160)

    def test_food_consumes_a_portion_and_toys_remain_owned(self):
        from pet_care import use_inventory_item
        data = {'pet_food_inventory': {'heart_biscuit': 1}, 'pet_owned_toys': ['star_plush']}
        item, result = use_inventory_item(data, 'feed', 'heart_biscuit')
        self.assertEqual(result['pet_food_inventory']['heart_biscuit'], 0)
        self.assertEqual(data['pet_food_inventory']['heart_biscuit'], 1)
        with self.assertRaises(ValueError):
            use_inventory_item(result, 'feed', 'heart_biscuit')
        _, result = use_inventory_item(data, 'play', 'star_plush')
        self.assertIn('star_plush', result['pet_owned_toys'])
        with self.assertRaises(ValueError):
            use_inventory_item(data, 'play', 'flying_disc')
        with self.assertRaises(ValueError):
            use_inventory_item(data, 'play', 'heart_biscuit')
        self.assertEqual(use_inventory_item({}, 'feed')[0]['id'], 'oat_biscuit')
        self.assertEqual(use_inventory_item({}, 'play')[0]['id'], 'cloth_ball')

    def test_draw_cost_portions_duplicates_and_insufficient_coins(self):
        from pet_care import apply_inventory_draw, item_by_id
        food, outcome = apply_inventory_draw({'pet_coins': 90}, item_by_id('heart_biscuit'))
        self.assertEqual(food['pet_coins'], 60)
        self.assertEqual(food['pet_food_inventory']['heart_biscuit'], 3)
        toy, outcome = apply_inventory_draw({'pet_coins': 90}, item_by_id('star_plush'))
        self.assertEqual(toy['pet_coins'], 30)
        duplicate, outcome = apply_inventory_draw({**toy, 'pet_coins': 90}, item_by_id('star_plush'))
        self.assertEqual(duplicate['pet_coins'], 50)
        self.assertTrue(outcome['duplicate'])
        self.assertEqual(outcome['refund'], 20)
        with self.assertRaises(ValueError):
            apply_inventory_draw({'pet_coins': 59}, item_by_id('star_plush'))

    def test_paid_toy_pool_never_includes_free_starter(self):
        from pet_care import draw_inventory_item
        for roll in [0, 7000, 9500]:
            self.assertNotEqual(draw_inventory_item('toy', lambda n: roll, lambda items: items[0])['id'], 'cloth_ball')
