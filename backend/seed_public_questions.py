"""
一次性腳本：把預設的公共題庫塞到 Firestore 的 public_questions collection。

使用方式（本地端需要 serviceAccountKey.json）：
    cd backend
    python seed_public_questions.py

在 Cloud Shell 或有 Application Default Credentials 的環境直接跑也可以。
重複執行：會用固定 doc id (pub_XX) 覆蓋，不會重複塞。
"""

import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys


def init_firebase():
    if firebase_admin._apps:
        return
    key_path = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
    if os.path.exists(key_path):
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
        print(f"✓ Firebase initialized with {key_path}")
    else:
        firebase_admin.initialize_app()
        print("✓ Firebase initialized with Application Default Credentials")


# ============ 30 題公共題目 ============
# 分類：休閒 / 生活 / 旅行 / 食物 / 工作 / 人際 / 未來 / 娛樂
PUBLIC_QUESTIONS = [
    # 休閒 (4)
    {"category": "休閒", "question": "假日你最想做什麼？", "options": ["在家耍廢", "出去走走", "和朋友聚會", "運動健身"]},
    {"category": "休閒", "question": "你最喜歡的放鬆方式是？", "options": ["看劇", "聽音樂", "散步", "睡覺"]},
    {"category": "休閒", "question": "下雨的週末你會？", "options": ["躺床看片", "找朋友去咖啡廳", "打電動", "睡一整天"]},
    {"category": "休閒", "question": "如果有一整天自由時間，你會？", "options": ["追劇補番", "出門探索新地方", "補眠", "做一直想做的事"]},

    # 食物 (5)
    {"category": "食物", "question": "宵夜你會選？", "options": ["炸物", "泡麵", "滷味", "不吃"]},
    {"category": "食物", "question": "你最不能接受的食物是？", "options": ["香菜", "苦瓜", "臭豆腐", "榴槤"]},
    {"category": "食物", "question": "早餐最愛吃？", "options": ["蛋餅", "三明治", "漢堡", "飯糰"]},
    {"category": "食物", "question": "飲料選哪個？", "options": ["珍珠奶茶", "美式咖啡", "水果茶", "可樂"]},
    {"category": "食物", "question": "火鍋必點的是？", "options": ["肉盤", "海鮮", "餃類", "菇類青菜"]},

    # 旅行 (4)
    {"category": "旅行", "question": "最想去哪個國家旅遊？", "options": ["日本", "韓國", "歐洲", "美國"]},
    {"category": "旅行", "question": "旅行你偏好？", "options": ["跟團省心", "自由行", "背包客", "不太出門"]},
    {"category": "旅行", "question": "如果現在要飛出去，你會選？", "options": ["海島度假", "都市逛街", "古蹟文化", "山林健行"]},
    {"category": "旅行", "question": "旅行最在意的是？", "options": ["美食", "住宿", "景點", "購物"]},

    # 人際 (5)
    {"category": "人際", "question": "你覺得自己比較像？", "options": ["E 外向型", "I 內向型", "看場合", "不想分類"]},
    {"category": "人際", "question": "聚會時你通常是？", "options": ["炒熱氣氛的人", "默默觀察的人", "小圈圈聊天", "偶爾來插話"]},
    {"category": "人際", "question": "朋友心情不好時，你會？", "options": ["直接陪他", "傳訊息關心", "帶他吃好吃的", "給點空間"]},
    {"category": "人際", "question": "你跟朋友多久見一次面最舒服？", "options": ["每週", "每月", "每季", "想見再見"]},
    {"category": "人際", "question": "衝突發生時你會？", "options": ["直接講開", "先冷靜一下", "找人訴苦", "默默放在心裡"]},

    # 工作/學業 (3)
    {"category": "工作", "question": "你工作/讀書最在意的是？", "options": ["薪水/成績", "成就感", "穩定", "工作環境"]},
    {"category": "工作", "question": "面對 deadline 你會？", "options": ["提早完成", "最後爆肝", "慢慢推進", "直接放棄"]},
    {"category": "工作", "question": "理想的辦公/讀書環境？", "options": ["安靜獨立", "咖啡廳白噪音", "有人一起", "在家躺著"]},

    # 娛樂 (4)
    {"category": "娛樂", "question": "最愛看哪種電影？", "options": ["動作冒險", "愛情喜劇", "科幻奇幻", "恐怖懸疑"]},
    {"category": "娛樂", "question": "選一款你最能打的遊戲類型？", "options": ["射擊 FPS", "策略/塔防", "派對遊戲", "不玩遊戲"]},
    {"category": "娛樂", "question": "聽音樂你偏好？", "options": ["華語流行", "韓語 K-Pop", "西洋音樂", "日文歌曲"]},
    {"category": "娛樂", "question": "手機最常用的 App 是？", "options": ["社群媒體", "影音串流", "遊戲", "通訊聊天"]},

    # 未來 / 假設 (5)
    {"category": "未來", "question": "中樂透 1000 萬你會先做？", "options": ["買房存錢", "環遊世界", "給家人", "投資創業"]},
    {"category": "未來", "question": "你覺得自己五年後會？", "options": ["穩定工作", "繼續進修", "出國發展", "還不知道"]},
    {"category": "未來", "question": "如果只能選一個超能力？", "options": ["隱身", "瞬移", "讀心", "時間暫停"]},
    {"category": "未來", "question": "退休後最想過的生活？", "options": ["鄉下種田", "環遊世界", "城市頂樓公寓", "和朋友開店"]},
    {"category": "未來", "question": "給十年前的自己一句話，你會說？", "options": ["別怕犯錯", "多存點錢", "好好睡覺", "跟喜歡的人告白"]},
]


def seed():
    init_firebase()
    db = firestore.client()
    col = db.collection("public_questions")

    written = 0
    for i, q in enumerate(PUBLIC_QUESTIONS, start=1):
        doc_id = f"pub_{i:02d}"
        payload = {
            "question": q["question"],
            "options": q["options"],
            "category": q.get("category", "其他"),
            "has_answer": False,
            "correct_index": None,
            "source": "seed",
        }
        col.document(doc_id).set(payload)
        written += 1
        print(f"  [{doc_id}] {q['question']}  → {len(q['options'])} 個選項")

    print(f"\n✓ 共寫入 {written} 題公共題目到 public_questions collection")


if __name__ == "__main__":
    try:
        seed()
    except Exception as e:
        print(f"✗ Seed 失敗: {e}")
        sys.exit(1)
