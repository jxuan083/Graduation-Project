"""API contracts with isolated Firestore transactions; never touch live data."""
import asyncio
import datetime
import os
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:1")
try:
    import main
    from fastapi import HTTPException
except Exception as error:
    main = None
    SKIP = str(error)


@unittest.skipIf(main is None, globals().get('SKIP', 'main unavailable'))
class PetCareApiTests(unittest.TestCase):
    def setUp(self):
        self.data = {'creator_uid': 'owner', 'member_uids': ['owner', 'member']}
        self.doc = Mock()
        self.doc.id = 'group'
        self.doc.get.side_effect = lambda **kwargs: Mock(exists=True, to_dict=lambda: dict(self.data))
        self.db = Mock()
        self.db.collection.return_value.document.return_value = self.doc
        self.tx = Mock()
        self.db.transaction.return_value = self.tx
        def update(ref, fields):
            def resolve(value):
                if value is main.firestore.SERVER_TIMESTAMP:
                    return datetime.datetime.now(datetime.timezone.utc)
                if isinstance(value, dict):
                    return {k: resolve(v) for k, v in value.items()}
                return value
            self.data.update(resolve(fields))
        self.tx.update.side_effect = update
        for patcher in [patch.object(main, 'db', self.db),
                        patch.object(main.firestore, 'transactional', side_effect=lambda fn: fn)]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def adopt(self, uid='owner', **payload):
        return asyncio.run(main.adopt_group_pet('group', main.AdoptPetPayload(**payload), {'uid': uid}))

    def action(self, action='feed', request_id='request-0001', uid='owner'):
        return asyncio.run(main.group_pet_action('group', main.GroupPetActionPayload(
            action=action, request_id=request_id), {'uid': uid}))

    def test_adopt_without_a_photo_is_immediately_careable(self):
        pet = self.adopt(name='奶茶')['pet']
        self.assertEqual(pet['pet_character_id'], 'puppy-v1')
        self.assertEqual(pet['pet_name'], '奶茶')
        self.assertTrue(pet['pet_face_url'].endswith('.png'))
        self.assertFalse(pet['pet_is_caged'])
        self.assertEqual(self.action()['pet_energy'], 75)

    def test_switching_character_preserves_growth_cooldowns_and_decay_anchor(self):
        anchor = datetime.datetime.now(datetime.timezone.utc)
        saved = {'pet_face_url': 'legacy.png', 'pet_accumulated_score': 450,
                 'pet_energy': 82, 'pet_last_updated': anchor,
                 'pet_meetings_completed': 7, 'pet_action_cooldowns': {'owner': {'feed': anchor}}}
        self.data.update(saved)
        self.adopt()
        for key, value in saved.items():
            if key != 'pet_face_url':
                self.assertEqual(self.data[key], value, key)

    def test_only_creator_can_adopt_and_unknown_characters_are_rejected(self):
        for kwargs, code in [({'uid': 'member'}, 403), ({'uid': 'outsider'}, 403),
                             ({'character_id': '../../other'}, 400)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(HTTPException) as ctx:
                self.adopt(**kwargs)
            self.assertEqual(ctx.exception.status_code, code)
        self.tx.update.assert_not_called()

    def test_retry_of_the_same_action_does_not_charge_or_reward_twice(self):
        self.adopt()
        first = self.action()
        writes = self.tx.update.call_count
        second = self.action()
        self.assertEqual(self.tx.update.call_count, writes)
        self.assertEqual(second['pet_energy'], first['pet_energy'])
        self.assertTrue(second['replayed'])
        self.assertLessEqual(second['pet_cooldowns']['feed'], 600)
        with self.assertRaises(HTTPException) as ctx:
            self.action(action='play')
        self.assertEqual(ctx.exception.status_code, 409)

    def test_separate_action_still_obeys_cooldown_and_membership(self):
        self.adopt()
        self.action()
        for kwargs, code in [({'request_id': 'request-0002'}, 429), ({'uid': 'outsider'}, 403)]:
            with self.subTest(kwargs=kwargs), self.assertRaises(HTTPException) as ctx:
                self.action(**kwargs)
            self.assertEqual(ctx.exception.status_code, code)

    def test_all_care_actions_update_their_own_stats(self):
        self.adopt()
        self.data.update(pet_cleanliness=50)
        clean = self.action(action='wipe')
        self.assertEqual(clean['pet_cleanliness'], 85)
        self.assertEqual(clean['changes']['pet_cleanliness'], 35)
        play = self.action(action='play', request_id='request-0002')
        self.assertEqual(play['changes']['pet_energy'], -5)
        self.assertEqual(play['changes']['pet_happiness'], 20)

    def test_full_or_rescue_pet_is_not_mutated(self):
        self.adopt()
        for fields, code in [({'pet_energy': 100}, 409),
                             ({'pet_last_session_at': datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=15)}, 423)]:
            self.data.update(fields)
            writes = self.tx.update.call_count
            with self.assertRaises(HTTPException) as ctx:
                self.action()
            self.assertEqual(ctx.exception.status_code, code)
            self.assertEqual(self.tx.update.call_count, writes)

    def test_action_receipts_never_leak_in_group_or_pet_payloads(self):
        self.adopt()
        self.action()
        self.assertNotIn('pet_action_receipts', main._serialize_group(self.data, 'group'))
        self.assertNotIn('pet_action_receipts', main._group_pet_public_payload(self.data, 'member'))

    def test_groups_without_pets_are_available_for_adoption(self):
        snap = Mock(id='group', to_dict=lambda: self.data)
        self.db.collection.return_value.where.return_value.stream.return_value = [snap]
        pets = asyncio.run(main.get_group_pets({'uid': 'owner'}))['pets']
        self.assertEqual(len(pets), 1)
        self.assertEqual(pets[0]['pet'], {})
