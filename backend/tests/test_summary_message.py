"""結算頁的寵物文字：prompt 內容、模型回覆的清理、分數拆解（不打外部 API）。"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import llm  # noqa: E402
import scoring  # noqa: E402

SHORT_STUDY = {
    "context": "study", "context_label": "讀書會", "context_label_en": "study group",
    "attended_minutes": 3, "duration_minutes": 3, "deviations": 0, "grace_sec": 20, "score": 58,
    "focus": 100.0, "presence": 22.36, "focus_weight": 0.75, "presence_weight": 0.25,
    "is_host": False,
}


class TestPrompt(unittest.TestCase):
    def test_zh_prompt_has_the_numbers_that_explain_the_score(self):
        p = llm.build_summary_prompt(SHORT_STUDY, "zh")
        for piece in ("讀書會", "在場時間：3 分鐘（整場 3 分鐘）", "分心次數：0 次", "超過 20 秒",
                      "分數：58 / 100", "專注 100 分（占 75%）", "陪伴 22 分（占 25%", "主持人：否"):
            self.assertIn(piece, p)

    def test_under_a_minute_is_not_zero(self):
        p = llm.build_summary_prompt({**SHORT_STUDY, "attended_minutes": 0, "duration_minutes": 0}, "zh")
        self.assertIn("在場時間：不到 1 分鐘（整場 不到 1 分鐘）", p)
        self.assertNotIn("：0 分鐘", p)
        self.assertIn("under 1 min", llm.build_summary_prompt({**SHORT_STUDY, "attended_minutes": 0}, "en"))

    def test_en_prompt(self):
        p = llm.build_summary_prompt(SHORT_STUDY, "en")
        self.assertIn("study group", p)
        self.assertIn("Distractions: 0", p)

    def test_system_prompt_covers_short_gatherings(self):
        self.assertIn("參與時間短", llm.SUMMARY_SYSTEM_PROMPT_ZH)
        self.assertIn("不能說他分心", llm.SUMMARY_SYSTEM_PROMPT_ZH)
        self.assertIn("short time", llm.SUMMARY_SYSTEM_PROMPT_EN)

    def test_pet_speaks_as_i(self):
        self.assertIn("一律用「我」自稱", llm.SUMMARY_SYSTEM_PROMPT_ZH)
        self.assertIn('"I"', llm.SUMMARY_SYSTEM_PROMPT_EN)
        self.assertIn("不要照抄", llm.SUMMARY_SYSTEM_PROMPT_ZH)
        self.assertIn("85 分以上算高分", llm.SUMMARY_SYSTEM_PROMPT_ZH)
        self.assertNotIn("小橘", llm.SUMMARY_SYSTEM_PROMPT_ZH)


class TestClean(unittest.TestCase):
    def test_strips_quotes_and_newlines(self):
        self.assertEqual(llm.clean_summary_message("「這場很短，\n但你很專注！」"), "這場很短， 但你很專注！")
        self.assertEqual(llm.clean_summary_message('"Nice work!"'), "Nice work!")

    def test_rejects_bad_output(self):
        self.assertIsNone(llm.clean_summary_message(""))
        self.assertIsNone(llm.clean_summary_message(None))
        self.assertIsNone(llm.clean_summary_message('{"message": "hi"}'))
        self.assertIsNone(llm.clean_summary_message("太長" * 60))
        en = "Short one, but you didn't get distracted once! Stay a bit longer next time and Mochi will grow even faster."
        self.assertEqual(llm.clean_summary_message(en, "en"), en)          # 英文句子比較長，不能用中文的上限
        self.assertIsNone(llm.clean_summary_message(en, "zh"))

    def test_no_key_means_no_call(self):
        saved = llm._load_api_key
        llm._load_api_key = lambda: None
        try:
            self.assertIsNone(llm.generate_summary_message(SHORT_STUDY))
        finally:
            llm._load_api_key = saved


class TestScoreParts(unittest.TestCase):
    def test_parts_rebuild_the_score(self):
        for minutes, devs, ctx in ((3, 0, "study"), (90, 6, "meal"), (60, 0, "class"), (20, 2, "date")):
            parts = scoring.score_parts(minutes, devs, "M", ctx)
            blended = parts["focus_weight"] * parts["focus"] + parts["presence_weight"] * parts["presence"]
            self.assertEqual(int(round(max(0, min(100, blended)))),
                             scoring.compute_meeting_score(minutes, devs, False, "M", ctx))

    def test_short_gathering_is_low_presence_not_low_focus(self):
        parts = scoring.score_parts(3, 0, "M", "study")
        self.assertEqual(parts["focus"], 100.0)
        self.assertLess(parts["presence"], 25)


if __name__ == "__main__":
    unittest.main()
