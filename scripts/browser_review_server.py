"""Local-only browser QA server. Uses memory; it never connects to production AWS.

Run explicitly with uvicorn browser_review_server:app --app-dir scripts.
Production continues to load backend/main.py directly and never imports this file.
"""
import os
import pathlib
import sys

os.environ['DOCSTORE'] = 'memory'
os.environ['AWS_EC2_METADATA_DISABLED'] = 'true'
os.environ['AWS_ACCESS_KEY_ID'] = 'testing'
os.environ['AWS_SECRET_ACCESS_KEY'] = 'testing'
os.environ['ALLOWED_ORIGINS'] = 'http://127.0.0.1:5191'
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1] / 'backend'))
# 每次測試都從乾淨資料開始：不讀寫本機開發用的 backend/dev_db.json
import docstore
docstore._MemoryBackend._load = lambda self: None
docstore._MemoryBackend._save = lambda self: None
import main

OWNER = 'browser-owner'
main._verify_id_token = lambda token: {'uid':OWNER,'sub':OWNER,'email':'browser@example.test'}
# 前端在 127.0.0.1 會改用開發 token；讓它對應到同一個測試使用者，金幣與群組資料才一致
main._DEV_USER = {'uid':OWNER,'sub':OWNER,'email':'browser@example.test','name':'本機測試'}
group = main.db.collection('groups').document('browser-group')
user_doc = main.db.collection('users').document(OWNER)
from pet_gacha import GACHA_BY_ID
DUPLICATE_COSTUME = next(iter(GACHA_BY_ID))
def reset():
    user_doc.set({'nickname':'本機測試','email':'browser@example.test','ranking_gacha_points':204,'gacha_tickets':1})
    group.set({'creator_uid':OWNER,'member_uids':[OWNER,'browser-peer'],'name':'寵物驗收群組',
           'pet_wardrobe':{DUPLICATE_COSTUME:4},
           'pet_face_url':'/assets/pets/illustrated/puppy-poster-v1.png',
           'pet_character_id':'puppy-v1','pet_name':'奶糖','pet_energy':50,'pet_happiness':50,
           'pet_cleanliness':50,
           'pet_owned_toys':['cloth_ball','knot_rope','star_plush','flying_disc']})
    return {'status':'ok'}
reset()
app = main.app

@app.post('/__test/reset')
def reset_browser_fixture():
    return reset()
