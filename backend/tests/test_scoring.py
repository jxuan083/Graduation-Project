import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from scoring import (  # noqa: E402
    build_score_ranking,
    compute_meeting_score,
    compute_perf_points,
    score_for_uid,
)


class TestMeetingScore(unittest.TestCase):
    def test_perfect_attendance_no_distraction_is_100(self):
        for d in ("L", "M", "H"):
            self.assertEqual(compute_meeting_score(60, 0, False, difficulty=d), 100)

    def test_score_always_bounded_0_100(self):
        # 上限鎖 100（不會 120），下限 0
        for d in ("L", "M", "H"):
            for dev in (0, 1, 5, 20, 100):
                for dur in (0, 5, 60, 180):
                    s = compute_meeting_score(dur, dev, True, difficulty=d)
                    self.assertGreaterEqual(s, 0)
                    self.assertLessEqual(s, 100)

    def test_stricter_difficulty_scores_lower_for_same_distraction(self):
        s_l = compute_meeting_score(60, 8, False, difficulty="L")
        s_m = compute_meeting_score(60, 8, False, difficulty="M")
        s_h = compute_meeting_score(60, 8, False, difficulty="H")
        self.assertGreater(s_l, s_m)
        self.assertGreater(s_m, s_h)

    def test_no_free_budget_first_deviation_costs_something(self):
        # 拿掉免罰額度：第一次超時分心就實扣（但 L 每次只扣一點）
        clean = compute_meeting_score(60, 0, False, difficulty="L")
        one = compute_meeting_score(60, 1, False, difficulty="L")
        self.assertLess(one, clean)
        self.assertGreaterEqual(one, 95)  # L 每次僅小扣

    def test_heavy_distraction_can_reach_zero(self):
        # 沒有下限保護：極度分心可以到 0（真扣分）
        self.assertLessEqual(compute_meeting_score(60, 100, False, difficulty="H"), 5)

    def test_not_easily_inflated_by_duration(self):
        # 枯坐很久但一直分心 → 不會因時長把分數灌高
        self.assertLess(compute_meeting_score(180, 60, False, difficulty="M"), 60)
        # 完美長聚會仍夾在 100
        self.assertEqual(compute_meeting_score(180, 0, False, difficulty="L"), 100)

    def test_context_changes_strictness(self):
        base = compute_meeting_score(60, 6, False, difficulty="M", context="general")
        strict = compute_meeting_score(60, 6, False, difficulty="M", context="class")
        loose = compute_meeting_score(60, 6, False, difficulty="M", context="meal")
        self.assertLess(strict, base)
        self.assertGreater(loose, base)

    def test_pickup_is_small_penalty(self):
        # 拿起手機（被動微訊號）只扣一點點
        no_pickup = compute_meeting_score(60, 0, False, difficulty="M")
        with_pickup = compute_meeting_score(60, 0, False, difficulty="M",
                                            metrics={"pickup_count": 8})
        self.assertLess(with_pickup, no_pickup)
        self.assertGreaterEqual(with_pickup, no_pickup - 15)  # 只是「一點點」

    def test_focus_streak_bonus_earns_points_back(self):
        # 加分機制：連續專注可以賺回一些分（但不超過 100）
        distracted = compute_meeting_score(60, 5, False, difficulty="M")
        with_streak = compute_meeting_score(60, 5, False, difficulty="M",
                                            metrics={"focus_streak_seconds": 600})
        self.assertGreater(with_streak, distracted)

    def test_bonus_never_exceeds_100(self):
        # 像考試不會 120：所有加分疊滿仍夾 100
        s = compute_meeting_score(120, 0, True, difficulty="L",
                                  metrics={"focus_streak_seconds": 100000})
        self.assertEqual(s, 100)

    def test_host_bonus_is_small(self):
        host = compute_meeting_score(60, 4, True, difficulty="M")
        guest = compute_meeting_score(60, 4, False, difficulty="M")
        self.assertGreaterEqual(host, guest)
        self.assertLessEqual(host - guest, 5)


class TestPerfPoints(unittest.TestCase):
    def test_harder_difficulty_yields_more_perf(self):
        self.assertLess(compute_perf_points(80, "L"), compute_perf_points(80, "H"))

    def test_valued_context_yields_more_perf(self):
        self.assertGreater(
            compute_perf_points(80, "M", "study"),
            compute_perf_points(80, "M", "general"),
        )

    def test_perf_nonnegative(self):
        self.assertGreaterEqual(compute_perf_points(0, "H"), 0)


class TestRanking(unittest.TestCase):
    def test_ranking_shape_and_sort(self):
        all_ever = {
            "u1": {"deviations": 0, "nickname": "A"},
            "u2": {"deviations": 10, "nickname": "B"},
        }
        rows, score_by_uid, perf_by_uid, avg = build_score_ranking(
            all_ever, "u1", 60, "general", "M"
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["uid"], "u1")  # 分心少 → 排前面
        self.assertIn("perf_points", rows[0])
        self.assertEqual(set(score_by_uid), {"u1", "u2"})
        self.assertEqual(set(perf_by_uid), {"u1", "u2"})
        self.assertEqual(avg, round((score_by_uid["u1"] + score_by_uid["u2"]) / 2))

    def test_avg_score_stays_in_pet_range(self):
        all_ever = {"u1": {"deviations": 3}, "u2": {"deviations": 7}}
        _, _, _, avg = build_score_ranking(all_ever, "u1", 90, "general", "L")
        self.assertGreaterEqual(avg, 0)
        self.assertLessEqual(avg, 100)

    def test_absent_uid_is_computed_fresh(self):
        s = score_for_uid("u1", {"u2": 80}, {"u2": {"deviations": 5}}, "u1", 60, "general", "M")
        self.assertGreaterEqual(s, 0)
        self.assertLessEqual(s, 100)

    def test_empty_ranking(self):
        rows, score_by_uid, perf_by_uid, avg = build_score_ranking({}, None, 60)
        self.assertEqual(rows, [])
        self.assertEqual(score_by_uid, {})
        self.assertEqual(perf_by_uid, {})
        self.assertEqual(avg, 0)


class TestPetCouplingThresholds(unittest.TestCase):
    # 群組寵物：avg_score>=70 餵食、<40 挨餓。確認新分數在對的情境落在對的區間。
    def test_focused_loose_meeting_feeds_pet(self):
        all_ever = {"u1": {"deviations": 1}, "u2": {"deviations": 2}}
        _, _, _, avg = build_score_ranking(all_ever, "u1", 60, "general", "L")
        self.assertGreaterEqual(avg, 70)

    def test_very_distracted_strict_meeting_starves_pet(self):
        all_ever = {"u1": {"deviations": 30}, "u2": {"deviations": 25}}
        _, _, _, avg = build_score_ranking(all_ever, "u1", 50, "class", "H")
        self.assertLess(avg, 40)


if __name__ == "__main__":
    unittest.main()
