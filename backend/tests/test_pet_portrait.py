"""Photo identity stays separate from avatar composites; uploads are transactional."""
import asyncio
import io
import os
import pathlib
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "127.0.0.1:1")

try:
    import main
    from fastapi import HTTPException, UploadFile
    from starlette.datastructures import Headers
except Exception as error:
    main = None
    SKIP = str(error)

PNG = b'\x89PNG\r\n\x1a\n' + b'test portrait bytes'


def upload(content=PNG, kind='image/png'):
    return UploadFile(io.BytesIO(content), filename='photo.png', headers=Headers({'content-type': kind}))


@unittest.skipIf(main is None, globals().get('SKIP', 'main unavailable'))
class PetPortraitTests(unittest.TestCase):
    def setUp(self):
        self.doc = Mock()
        self.data = {
            'creator_uid': 'owner', 'member_uids': ['owner', 'member'],
            'pet_face_path': 'old-composite', 'pet_portrait_path': 'old-portrait',
            'pet_level': 4, 'pet_energy': 82,
        }
        self.doc.get.return_value.exists = True
        self.doc.get.return_value.to_dict.return_value = self.data
        self.db = Mock()
        self.db.collection.return_value.document.return_value = self.doc
        self.bucket = Mock()
        self.blobs = {}
        self.bucket.blob.side_effect = lambda path: self.blobs.setdefault(path, Mock())
        self.patchers = [patch.object(main, 'db', self.db), patch.object(main, '_storage_bucket', return_value=self.bucket),
                         patch.object(main, '_storage_media_url', side_effect=lambda path: f'https://example.test/{path}')]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, portrait=None, uid='owner'):
        return asyncio.run(main.set_group_pet_face('group', upload(), None, '小狗', '🐶', portrait, {'uid': uid}))

    def test_new_portrait_is_stored_independently_without_overwriting_growth(self):
        result = self.save(upload())
        updates = self.doc.update.call_args.args[0]
        self.assertNotEqual(result['pet_portrait_url'], result['pet_face_url'])
        self.assertTrue(updates['pet_portrait_path'].endswith('-portrait.png'))
        self.assertNotIn('pet_level', updates)
        self.assertNotIn('pet_energy', updates)
        self.blobs['old-portrait'].delete.assert_called_once()
        self.blobs['old-composite'].delete.assert_called_once()

    def test_legacy_upload_clears_a_stale_portrait_instead_of_showing_wrong_person(self):
        result = self.save()
        self.assertIsNone(result['pet_portrait_url'])
        self.assertIsNone(self.doc.update.call_args.args[0]['pet_portrait_path'])
        self.blobs['old-portrait'].delete.assert_called_once()

    def test_non_owner_cannot_upload_portrait(self):
        with self.assertRaises(HTTPException) as ctx:
            self.save(upload(), uid='member')
        self.assertEqual(ctx.exception.status_code, 403)
        self.bucket.blob.assert_not_called()

    def test_invalid_portrait_is_rejected_before_any_upload(self):
        for content, kind in [(b'not a png', 'image/png'), (b'', 'image/png'), (PNG, 'image/jpeg')]:
            with self.subTest(kind=kind, content=content):
                with self.assertRaises(HTTPException) as ctx:
                    self.save(upload(content, kind))
                self.assertEqual(ctx.exception.status_code, 400)
        self.bucket.blob.assert_not_called()

    def test_metadata_failure_cleans_new_blobs_and_keeps_old_portrait(self):
        self.doc.update.side_effect = RuntimeError('database unavailable')
        with self.assertRaises(HTTPException):
            self.save(upload())
        self.assertNotIn('old-portrait', self.blobs)
        self.assertNotIn('old-composite', self.blobs)
        self.assertEqual(len(self.blobs), 2)
        for blob in self.blobs.values():
            blob.delete.assert_called_once()

    def test_public_payload_exposes_url_but_no_storage_path(self):
        data = {**self.data, 'pet_face_url': 'avatar', 'pet_portrait_url': 'portrait'}
        payload = main._group_pet_public_payload(data, 'owner')
        self.assertEqual(payload['pet_portrait_url'], 'portrait')
        self.assertNotIn('pet_portrait_path', payload)
        self.assertNotIn('pet_portrait_path', main._serialize_group(data, 'group'))
