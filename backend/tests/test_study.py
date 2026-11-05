import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import study  # noqa: E402

MIN = 60_000
T0 = 1_000_000_000_000


class TestPomodoro(unittest.TestCase):
    def test_25_focus_then_5_break_repeating(self):
        self.assertEqual(study.break_window(T0, T0 + 10 * MIN), (False, T0 + 25 * MIN, T0 + 30 * MIN))
        self.assertTrue(study.break_window(T0, T0 + 25 * MIN)[0])
        self.assertTrue(study.break_window(T0, T0 + 29 * MIN)[0])
        self.assertFalse(study.break_window(T0, T0 + 30 * MIN)[0])            # 第二輪專心
        self.assertEqual(study.break_window(T0, T0 + 57 * MIN), (True, T0 + 55 * MIN, T0 + 60 * MIN))

    def test_only_study_rooms_that_started_have_breaks(self):
        self.assertTrue(study.on_break({"context": "study", "active_started_ms": T0}, T0 + 26 * MIN))
        self.assertFalse(study.on_break({"context": "general", "active_started_ms": T0}, T0 + 26 * MIN))
        self.assertFalse(study.on_break({"context": "study"}, T0 + 26 * MIN))

    def test_break_overlap_while_away(self):
        self.assertEqual(study.break_overlap_ms(T0, T0 + 10 * MIN, T0 + 20 * MIN), 0)
        self.assertEqual(study.break_overlap_ms(T0, T0 + 20 * MIN, T0 + 40 * MIN), 5 * MIN)   # 跨過一次休息
        self.assertEqual(study.break_overlap_ms(T0, T0 + 27 * MIN, T0 + 28 * MIN), 1 * MIN)   # 整段都在休息
        self.assertEqual(study.break_overlap_ms(T0, T0 + 20 * MIN, T0 + 90 * MIN), 15 * MIN)  # 三次休息


class TestQuestionBoard(unittest.TestCase):
    def test_add_toggle_and_stats(self):
        room = {"context": "study"}
        self.assertTrue(study.add_question(room, "a", "小明", "  第三題  怎麼解 ", T0, "q1")[0])
        self.assertEqual(room["questions"][0]["text"], "第三題 怎麼解")
        self.assertFalse(study.add_question(room, "a", "小明", "   ", T0, "q2")[0])
        self.assertTrue(study.toggle_question(room, "q1")[0])
        self.assertEqual(study.question_stats(room), {"total": 1, "solved": 1})
        self.assertFalse(study.toggle_question(room, "nope")[0])
        self.assertFalse(study.add_question({"context": "meeting"}, "a", "", "x", T0, "q")[0])
        self.assertIsNone(study.question_stats({"context": "meeting"}))


if __name__ == "__main__":
    unittest.main()
