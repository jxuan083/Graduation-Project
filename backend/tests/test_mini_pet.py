import asyncio
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault('DOCSTORE','memory')
os.environ.setdefault('AWS_EC2_METADATA_DISABLED','true')
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import docstore
import main
from fastapi import HTTPException


class MiniPetTests(unittest.TestCase):
    def setUp(self):
        self.db=docstore.Client(docstore._MemoryBackend())
        self.group=self.db.collection('groups').document('mini')
        self.original={'creator_uid':'owner','member_uids':['owner','member'],
                       'pet_character_id':'puppy-v1','pet_face_url':'puppy.png',
                       'pet_energy':72,'pet_coins':90,'pet_food_inventory':{'heart_biscuit':2}}
        self.group.set(self.original)
        self.db.collection('users').document('member').set({'nickname':'小林','photoURL':'avatar.png','email':'private@example.test'})
        self.patcher=patch.object(main,'db',self.db)
        self.patcher.start();self.addCleanup(self.patcher.stop)

    def select(self,target,uid='owner'):
        return asyncio.run(main.update_pet('mini',main.UpdatePetPayload(pet_target_uid=target),{'uid':uid}))

    def test_avatar_selection_keeps_the_full_character_and_inventory(self):
        self.select('member')
        data=self.group.get().to_dict()
        for key,value in self.original.items():
            self.assertEqual(data[key],value)
        profile=main._serialize_group(data,'mini')['pet_mini_profile']
        self.assertEqual(profile,{'uid':'member','nickname':'小林','photoURL':'avatar.png'})
        self.assertNotIn('email',profile)

    def test_noncreator_and_nonmember_targets_are_rejected(self):
        for target,uid in [('owner','member'),('outsider','owner')]:
            with self.subTest(target=target,uid=uid),self.assertRaises(HTTPException):
                self.select(target,uid)
        self.assertEqual(self.group.get().to_dict(),self.original)

    def test_clear_and_departed_members_do_not_resolve_a_profile(self):
        self.select('member');self.select('')
        self.assertIsNone(main._mini_pet_profile(self.group.get().to_dict()))
        self.group.update({'pet_target_uid':'member','member_uids':['owner']})
        self.assertIsNone(main._mini_pet_profile(self.group.get().to_dict()))
