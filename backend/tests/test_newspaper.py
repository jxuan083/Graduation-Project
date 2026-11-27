"""聚會回顧報紙：挑照片、放寵物、檢查 AI 文字、規則版備援。"""
import io
import os
import pathlib
import random
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("DOCSTORE", "memory")

import llm  # noqa: E402
import newspaper_photo as npo  # noqa: E402


class PetPlacementTests(unittest.TestCase):
    def test_pet_never_covers_anyone(self):
        rng = random.Random(7)
        for _ in range(300):
            aspect = rng.choice([4 / 3, 16 / 9, 3 / 4, 1.0])
            faces = []
            for _ in range(rng.randint(0, 7)):
                w = rng.uniform(0.05, 0.2)
                faces.append({"x": rng.uniform(0, 1 - w), "y": rng.uniform(0, 0.7), "w": w, "h": w * aspect})
            spot = npo.place_pet(faces, aspect)
            if spot is None:
                continue
            box = (spot["x"], spot["y"], spot["x"] + spot["w"], spot["y"] + spot["w"] * aspect)
            self.assertTrue(0 <= box[0] and box[2] <= 1 and 0 <= box[1] and box[3] <= 1, spot)
            for region in npo.person_regions(faces):
                self.assertFalse(npo._overlaps(box, region), (spot, faces))

    def test_empty_photo_puts_a_big_pet_in_the_bottom_right(self):
        spot = npo.place_pet([], 4 / 3)
        self.assertEqual(spot["w"], 0.30)
        self.assertGreater(spot["x"], 0.6)
        self.assertGreater(spot["y"], 0.5)

    def test_no_room_falls_back_to_caption(self):
        faces = [{"x": x / 10, "y": y / 10, "w": 0.1, "h": 0.1} for x in range(10) for y in range(0, 10, 2)]
        self.assertIsNone(npo.place_pet(faces, 1.0))


class HeroPhotoTests(unittest.TestCase):
    PHOTOS = [{"id": "cover", "is_cover": True}, {"id": "two"}, {"id": "three"}]

    def scans(self, **counts):
        return {pid: {"width": 400, "height": 300, "faces": [{"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1}] * n}
                for pid, n in counts.items()}

    def test_host_choice_wins(self):
        self.assertEqual(npo.choose_hero_photo(self.PHOTOS, self.scans(cover=0, two=5), "three")["id"], "three")

    def test_most_faces_then_cover_then_earliest(self):
        self.assertEqual(npo.choose_hero_photo(self.PHOTOS, self.scans(cover=1, two=4, three=4), None)["id"], "two")
        self.assertEqual(npo.choose_hero_photo(self.PHOTOS, self.scans(cover=2, two=2), None)["id"], "cover")
        self.assertEqual(npo.choose_hero_photo(self.PHOTOS[1:], {}, None)["id"], "two")

    def test_unknown_faces_never_overlay_the_pet(self):
        def unavailable(_):
            raise npo.FaceDetectionUnavailable("no opencv")
        with patch.object(npo, "detect_faces", unavailable):
            hero = npo.build_photo_hero([{"id": "p", "content_path": "/c"}], lambda p: b"", None, with_pet=True)
        self.assertEqual(hero["pet"], {"mode": "caption"})
        self.assertIsNone(npo.build_photo_hero([], lambda p: b"", None, with_pet=True))

    def test_detector_runs_on_a_real_image(self):
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (640, 480), (220, 200, 180)).save(buf, format="JPEG")
        result = npo.detect_faces(buf.getvalue())
        self.assertEqual((result["width"], result["height"], result["faces"]), (640, 480, []))


FACTS = {
    "context_label": "一般聚會", "duration_minutes": 5, "member_count": 1, "total_deviations": 0,
    "longest_focus_minutes": 5, "members": [{"name": "陳厚銘", "attended_minutes": 5, "deviations": 0}],
    "most_focused": ["陳厚銘"], "most_focused_deviations": 0, "pet_name": "狗狗", "photo_count": 0,
    "transcript_lines": [],
}


class GeneratedTextChecks(unittest.TestCase):
    def test_numbers_include_chinese_counts(self):
        self.assertEqual(llm.numbers_in_text("一個人的五分鐘，零分心，共 3 人、十二分鐘、兩次"), {0, 1, 2, 3, 5, 12})
        self.assertEqual(llm.numbers_in_text("大家一起聊天"), set())
        self.assertEqual(llm.numbers_in_text("期待下一次相聚，這一次、第一次見面"), set())

    def test_headline_must_match_the_data(self):
        self.assertEqual(llm.clean_headline({"line1": "一個人的五分鐘", "line2": "零分心的專注時光！"}, FACTS),
                         ["一個人的五分鐘", "零分心的專注時光"])
        self.assertIsNone(llm.clean_headline({"line1": "一個人的十分鐘", "line2": "零分心"}, FACTS))
        self.assertIsNone(llm.clean_headline({"line1": "這一行實在是太長了寫到十五個字", "line2": "好"}, FACTS))
        self.assertIsNone(llm.clean_headline(None, FACTS))

    def test_article_must_match_the_data(self):
        good = {"paragraphs": ["一場一般聚會在 5 分鐘內落幕，陳厚銘把注意力完整留給了眼前的事。" * 2,
                               "整場沒有人被手機打斷，陳厚銘全程投入，參與度很高。群組寵物狗狗見證了整場聚會。" * 2]}
        paragraphs = llm.clean_article(good, FACTS)
        self.assertTrue(paragraphs[0].startswith("【本報訊】"))
        # 寵物固定一句接在第一段句尾，AI 自己寫的寵物句子會被拿掉
        self.assertTrue(paragraphs[0].endswith("群組寵物「狗狗」見證了整場聚會。"))
        self.assertEqual("".join(paragraphs).count("狗狗"), 1)
        lonely = {"paragraphs": [good["paragraphs"][0], "群組寵物狗狗見證了整場聚會。", good["paragraphs"][1]]}
        self.assertEqual(len(llm.clean_article(lonely, FACTS)), 2)
        bad = {"paragraphs": [p.replace("5 分鐘內", "7 分鐘內") for p in good["paragraphs"]]}
        self.assertIsNone(llm.clean_article(bad, FACTS))
        self.assertIsNone(llm.clean_article({"paragraphs": ["太短"]}, FACTS))
        # 逐字稿裡本來就有的數字可以轉述
        chat = {**FACTS, "transcript_lines": ["我練吉他練了 2 個月，現在會彈三首歌"]}
        mention = {"paragraphs": [good["paragraphs"][0], "大家聊到吉他，練了 2 個月的成果讓人佩服。" * 3]}
        self.assertIsNotNone(llm.clean_article(mention, chat))
        self.assertIsNone(llm.clean_article(mention, FACTS))
        # 專注情形不寫數字：分心次數、分鐘數只能在第一段
        stat_in_body = {"paragraphs": [good["paragraphs"][0], "全場有長達 5 分鐘沒人分心，大家都很投入，氣氛溫暖。" * 3]}
        self.assertIsNone(llm.clean_article(stat_in_body, FACTS))

    def test_rewrites_once_before_falling_back(self):
        bad = {"line1": "一個人的十分鐘", "line2": "零分心"}
        good = {"line1": "一個人的五分鐘", "line2": "零分心的專注時光"}
        with patch.object(llm, "_load_api_key", return_value="sk-test"), \
                patch.object(llm, "_chat_json", side_effect=[bad, good]) as chat:
            self.assertEqual(llm.generate_newspaper_headline(FACTS), ["一個人的五分鐘", "零分心的專注時光"])
        self.assertEqual(chat.call_count, 2)
        with patch.object(llm, "_load_api_key", return_value="sk-test"), \
                patch.object(llm, "_chat_json", side_effect=[bad, bad]):
            self.assertIsNone(llm.generate_newspaper_headline(FACTS))

    def test_prompt_lists_facts_and_says_when_there_is_no_transcript(self):
        text = llm.build_newspaper_facts_text(FACTS)
        for piece in ["一般聚會", "5 分鐘", "陳厚銘：參加 5 分鐘，分心 0 次", "狗狗", "沒有開錄音", "沒有逐字稿：不寫聊天內容"]:
            self.assertIn(piece, text)
        self.assertIn("逐字稿不多", llm.build_newspaper_facts_text({**FACTS, "transcript_lines": ["大家好"]}))
        # Prompt B 只拿到描述、不拿到專注數字與寵物名字
        article_text = llm.build_article_facts_text({**FACTS, "members": FACTS["members"] + [{"name": "阿傑", "attended_minutes": 1, "deviations": 3}]})
        for piece in ["全場沒有人分心", "陳厚銘（全程沒有分心）", "陳厚銘：全程參加，沒有分心", "阿傑：參加時間短，分心次數較多"]:
            self.assertIn(piece, article_text)
        self.assertNotIn("狗狗", article_text)
        self.assertNotIn("最長連續專注", article_text)
        self.assertIn("逐字稿充足", llm.build_newspaper_facts_text({**FACTS, "transcript_lines": ["聊天內容" * 10] * 10}))
        long_lines = [f"第{i}句話，" + "內容" * 40 for i in range(200)]
        excerpt = llm._transcript_excerpt(long_lines)
        self.assertLessEqual(len(excerpt), llm.TRANSCRIPT_MAX_CHARS)
        self.assertIn("第0句話", excerpt)                                            # 開頭
        self.assertTrue(any(f"第{i}句話" in excerpt for i in range(150, 200)))     # 也抽到後段


try:
    import main
except Exception as error:  # noqa: BLE001
    main = None
    SKIP = str(error)


@unittest.skipIf(main is None, globals().get("SKIP", "main unavailable"))
class BuildNewspaperTests(unittest.TestCase):
    MEETING = {
        "context": "meal", "duration_minutes": 60, "member_count": 3, "total_deviations": 3,
        "longest_focus_minutes": 25, "group_id": "g", "group_pet_name": "奶糖", "group_pet_face_url": "/pet.png",
        "members_snapshot": [
            {"uid": "a", "nickname": "小明", "attended_minutes": 60},
            {"uid": "b", "nickname": "小華", "attended_minutes": 58},
            {"uid": "c", "nickname": "小美", "attended_minutes": 5},
        ],
        "score_ranking": [
            {"uid": "a", "nickname": "小明", "deviations": 2, "attended_minutes": 60},
            {"uid": "b", "nickname": "小華", "deviations": 1, "attended_minutes": 58},
            {"uid": "c", "nickname": "小美", "deviations": 0, "attended_minutes": 5},
        ],
    }

    def build(self, headline=None, article=None, meeting=None, photos=()):
        with patch.object(main.llm, "generate_newspaper_headline", return_value=headline), \
                patch.object(main.llm, "generate_newspaper_article", return_value=article):
            return main._build_newspaper("m1", meeting or self.MEETING, [], list(photos))

    def test_rules_version_when_ai_is_unavailable(self):
        paper = self.build()
        self.assertEqual((paper["headline_by"], paper["article_by"]), ("rules", "rules"))
        self.assertEqual(paper["headline"], ["3人的吃飯聚餐", "最長專注25分鐘"])
        self.assertTrue(paper["article"][0].startswith("【本報訊】"))
        # 參加不到一半時間的人不參加「最專注」評選；專注情形只給評價、不寫數字
        self.assertIn("小華最為投入，參與度最高", "".join(paper["article"]))
        self.assertEqual(llm.numbers_in_text("".join(paper["article"][1:])), set())
        self.assertEqual(paper["subhead"], "本次聚會歷時 60 分鐘，共有 3 名成員參與")

    def test_ai_text_is_used_and_data_comes_from_the_record(self):
        paper = self.build(["三人圍桌", "一頓飯的專注"], ["【本報訊】段落一", "段落二"])
        self.assertEqual(paper["headline"], ["三人圍桌", "一頓飯的專注"])
        self.assertEqual(paper["article"], ["【本報訊】段落一", "段落二"])
        self.assertEqual(paper["generated_by"], "qwen-plus")
        self.assertEqual(paper["stats"]["longest_focus_minutes"], 25)
        self.assertEqual([(r["name"], r["attended_minutes"]) for r in paper["roster"]], [("小明", 60), ("小華", 58), ("小美", 5)])
        self.assertEqual(paper["pet"], {"name": "奶糖", "face_url": "/pet.png"})
        self.assertEqual(paper["hero"], {"kind": "scene", "context": "meal"})

    def test_everyone_equal_has_no_single_winner(self):
        meeting = {**self.MEETING, "score_ranking": [{**r, "deviations": 0} for r in self.MEETING["score_ranking"]],
                   "total_deviations": 0}
        paper = self.build(meeting=meeting)
        self.assertNotIn("參與度最高", "".join(paper["article"]))
        self.assertEqual(paper["headline"][1], "全場零分心")


if __name__ == "__main__":
    unittest.main()
