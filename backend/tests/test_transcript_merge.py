"""多支手機同時錄音：逐字稿時間對齊、說話者區分、去重複。"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import transcript_merge as tm  # noqa: E402

T0 = 1_800_000_000_000   # 聚會開始（伺服器時間）


def row(rid, by, source, text, at_s, dur=0.0, aligned=True):
    e = {"id": rid, "created_by": by, "source": source, "text": text,
         "started_at_ms": int(at_s * 1000), "duration_sec": dur}
    if aligned:
        e["abs_ms"] = T0 + int(at_s * 1000)
    return e


def texts(entries):
    return [e["text"] for e in entries]


class TestAlign(unittest.TestCase):
    def test_plausible_window(self):
        now = T0 + 3_600_000
        self.assertEqual(tm.plausible_abs_ms(T0 + 5_000, T0, now), T0 + 5_000)
        self.assertEqual(tm.plausible_abs_ms(str(T0), T0, now), T0)
        self.assertEqual(tm.plausible_abs_ms(T0 - 30_000, T0, now), T0 - 30_000)   # 時鐘差一點點可以
        self.assertIsNone(tm.plausible_abs_ms(T0 - 10 * 60_000, T0, now))         # 聚會開始前很久
        self.assertIsNone(tm.plausible_abs_ms(now + 5 * 60_000, T0, now))         # 未來
        self.assertIsNone(tm.plausible_abs_ms(None, T0, now))
        self.assertIsNone(tm.plausible_abs_ms("abc", T0, now))
        self.assertIsNone(tm.plausible_abs_ms(0, T0, now))

    def test_align_to_meeting_clock(self):
        e = {"started_at_ms": 1234}
        tm.align_entry(e, T0 + 65_000, T0)
        self.assertEqual((e["abs_ms"], e["started_at_ms"]), (T0 + 65_000, 65_000))
        e = {"started_at_ms": 1234}
        tm.align_entry(e, T0 - 2_000, T0)                  # 稍早於開始 → 0，不會是負的
        self.assertEqual(e["started_at_ms"], 0)
        e = {"started_at_ms": 1234}
        tm.align_entry(e, None, T0)                        # 沒有時間 → 不動（舊資料）
        self.assertEqual(e, {"started_at_ms": 1234})

    def test_recorder_speaker(self):
        self.assertEqual(tm.recorder_speaker("u1", "小明", "SPEAKER_1", "Speaker 1", False),
                         {"speaker_uid": "u1:SPEAKER_1", "speaker_name": "小明的錄音"})
        self.assertEqual(tm.recorder_speaker("u1", "小明", "SPEAKER_00", "Speaker 2", True)["speaker_name"],
                         "小明的錄音 · Speaker 2")
        self.assertEqual(tm.recorder_speaker("u1", "", "S", "Speaker 1", False)["speaker_name"], "成員的錄音")
        # 兩支手機的 Speaker 1 不會是同一個人
        self.assertNotEqual(tm.recorder_speaker("a", "A", "SPEAKER_1", "Speaker 1", False)["speaker_uid"],
                            tm.recorder_speaker("b", "B", "SPEAKER_1", "Speaker 1", False)["speaker_uid"])


class TestSimilarity(unittest.TestCase):
    def test_normalize_ignores_spacing_and_punctuation(self):
        self.assertEqual(tm.normalize("我們明天，去 爬山好不好？"), "我們明天去爬山好不好")
        self.assertEqual(tm.normalize("Hello, World!"), "helloworld")

    def test_contain_ratio(self):
        self.assertEqual(tm.contain_ratio("我們明天去", "我們明天去爬山好不好"), 1.0)
        self.assertGreaterEqual(tm.contain_ratio("我們明天要去爬山", "我們明天去爬山"), 0.8)   # 辨識差一個字
        self.assertLess(tm.contain_ratio("今天晚餐吃什麼", "我們明天去爬山好不好"), 0.5)


class TestMerge(unittest.TestCase):
    def test_two_phones_same_sentence_kept_once(self):
        out = tm.merge([
            row("a1", "A", "audio", "我們明天去爬山好不好", 10.0, 3.0),
            row("b1", "B", "audio", "我們明天去爬山好不好？", 10.4, 2.8),
        ])
        self.assertEqual(len(out), 1)

    def test_keeps_more_complete_version(self):
        out = tm.merge([
            row("a1", "A", "audio", "我們明天去", 10.0, 1.5),
            row("a2", "A", "audio", "爬山好不好", 12.0, 1.5),              # A 手機剛好切在句子中間
            row("b1", "B", "audio", "我們明天去爬山好不好", 10.2, 3.5),
        ])
        self.assertEqual(texts(out), ["我們明天去爬山好不好"])

    def test_later_longer_version_replaces_earlier_shorter(self):
        out = tm.merge([
            row("b1", "B", "audio", "我們明天去", 10.0, 1.5),
            row("a1", "A", "audio", "我們明天去爬山好不好", 10.3, 3.5),
        ])
        self.assertEqual([e["id"] for e in out], ["a1"])

    def test_same_phone_preview_and_whisper_deduped_prefer_whisper(self):
        out = tm.merge([
            row("w", "A", "audio", "下週三交報告", 20.0, 2.0),
            row("p", "A", "manual", "下週三交報告", 23.0),                   # 即時預覽：講完那一刻
        ])
        self.assertEqual([e["id"] for e in out], ["w"])

    def test_same_source_repeats_are_kept(self):
        out = tm.merge([
            row("a1", "A", "audio", "真的假的真的假的", 10.0, 1.0),
            row("a2", "A", "audio", "真的假的真的假的", 12.0, 1.0),
        ])
        self.assertEqual(len(out), 2)

    def test_far_apart_in_time_not_merged(self):
        out = tm.merge([
            row("a1", "A", "audio", "我們明天去爬山好不好", 10.0, 3.0),
            row("b1", "B", "audio", "我們明天去爬山好不好", 90.0, 3.0),        # 一分多鐘後又講了一次
        ])
        self.assertEqual(len(out), 2)

    def test_different_sentences_at_same_time_both_kept(self):
        out = tm.merge([
            row("a1", "A", "audio", "我覺得那家拉麵很好吃", 10.0, 3.0),
            row("b1", "B", "audio", "下次換我請客吧", 10.5, 2.0),            # 兩桌各自在講話
        ])
        self.assertEqual(len(out), 2)

    def test_similar_sentences_heard_by_both_phones_stay_separate(self):
        out = tm.merge([
            row("a1", "A", "audio", "我要去台北", 10.0, 1.2),
            row("b1", "B", "audio", "我要去台北", 10.2, 1.2),
            row("a2", "A", "audio", "我要去台中", 12.0, 1.2),   # 另一個人接著講很像的一句
            row("b2", "B", "audio", "我要去台中", 12.1, 1.2),
        ])
        self.assertEqual(texts(out), ["我要去台北", "我要去台中"])

    def test_short_replies_need_exact_and_close(self):
        self.assertEqual(len(tm.merge([row("a", "A", "audio", "好啊", 5.0, 0.5),
                                       row("b", "B", "audio", "好啊！", 5.8, 0.5)])), 1)
        self.assertEqual(len(tm.merge([row("a", "A", "audio", "好啊", 5.0, 0.5),
                                       row("b", "B", "audio", "好啊", 10.0, 0.5)])), 2)   # 隔幾秒各自回答
        self.assertEqual(len(tm.merge([row("a", "A", "audio", "好", 5.0, 0.5),
                                       row("b", "B", "audio", "對", 5.2, 0.5)])), 2)

    def test_three_phones(self):
        out = tm.merge([
            row("a", "A", "audio", "這週末有人要去看電影嗎", 30.0, 2.5),
            row("b", "B", "audio", "這週末有人要去看電影嗎", 30.2, 2.5),
            row("c", "C", "audio", "這周末有人要去看電影嗎", 30.1, 2.4),      # 同音字辨識不同
            row("bp", "B", "manual", "這週末有人要去看電影嗎", 33.0),
        ])
        self.assertEqual(len(out), 1)

    def test_sorted_by_time_and_legacy_kept(self):
        out = tm.merge([
            row("late", "A", "audio", "最後一句話了喔", 50.0, 1.0),
            row("old", "X", "audio", "很久以前上傳的", 3.0, 1.0, aligned=False),
            row("early", "B", "audio", "第一句話是這個", 5.0, 1.0),
        ])
        self.assertEqual([e["id"] for e in out], ["old", "early", "late"])

    def test_legacy_entries_never_merged(self):
        out = tm.merge([
            row("a", "A", "audio", "我們明天去爬山好不好", 10.0, 3.0, aligned=False),
            row("b", "B", "audio", "我們明天去爬山好不好", 10.0, 3.0, aligned=False),
        ])
        self.assertEqual(len(out), 2)

    def test_does_not_mutate_input(self):
        rows = [row("a", "A", "audio", "我們明天去爬山", 10.0, 2.0), row("b", "B", "audio", "我們明天去爬山", 10.1, 2.0)]
        before = [dict(r) for r in rows]
        tm.merge(rows)
        self.assertEqual(rows, before)

    def test_long_meeting_is_fast(self):
        import time
        rows = []
        for i in range(1500):   # 兩支手機各錄約一小時
            rows.append(row(f"a{i}", "A", "audio", f"第{i}句話的內容是關於主題{i % 37}", i * 2.4, 2.0))
            rows.append(row(f"b{i}", "B", "audio", f"第{i}句話的內容是關於主題{i % 37}", i * 2.4 + 0.3, 2.0))
        t = time.time()
        out = tm.merge(rows)
        self.assertLess(time.time() - t, 5.0)
        self.assertEqual(len(out), 1500)


if __name__ == "__main__":
    unittest.main()
