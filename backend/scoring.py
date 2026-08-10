"""聚會評分引擎（純函式，無 I/O，可獨立測試）。

刻意分成兩種分數，用途不同：
  personal_quality_score (0–100)：個人在這場聚會的「專注品質」。用於場內排行、
      群組寵物能量（pet_logic 期望 0–100）。難度/情境決定扣分嚴格度。
  perf_points (>=0)：計入週/總排行榜的「表現積分」= 品質 × 難度倍率 × 情境倍率。
      選越難、越正式的聚會，同樣品質累積越多分（獎勵挑戰）。

品質分採「底分 + 加分 − 扣分，最後夾在 0–100」的平衡模型：
  加分：參與時長（有出席、有待滿）＋ 連續專注（未來由感測器送）。
  扣分：deviations（每次「超出允許時間」的分心，是大扣分，無免罰額度）
        ＋ pickup（拿起手機等被動微訊號，只扣一點點，未來由感測器送）。
  上限鎖 100——像考試不會考出 120 分。

允許時間內（前端 grace window）處理完就回到 App 的短暫查看，前端根本不會送出
deviation，所以那種「回得來」的分心不吃大扣分；只有真的超時才算 deviation。

client 目前只被動送 deviations 與時長；引擎另外吃 metrics 選填欄位
（pickup_count、focus_streak_seconds…），一旦感測器開始傳送即自動更準，後端不需再改。
"""
import math
from typing import Dict, Optional

_BASE_SCORE = 50.0             # 底分：有到場的起點
_ATTENDANCE_BONUS_MAX = 50.0   # 加分：參與時長（sqrt 遞減、封頂）
_ATTENDANCE_REF_MIN = 60.0     # 到此分鐘數，出席加分達滿
_FOCUS_STREAK_BONUS_MAX = 15.0 # 加分：連續專注（未來 metrics.focus_streak_seconds）
_FOCUS_STREAK_REF_SEC = 600.0  # 連續專注到此秒數，加分達滿
_HOST_BONUS = 3.0              # 主持者的小額加分

# 每次「超出允許時間的分心」的大扣分，依難度（無免罰額度）。
_DEVIATION_PENALTY_UNIT = {"L": 4.0, "M": 7.0, "H": 10.0}
# 每次「拿起手機」等被動微訊號的小扣分，依難度（只扣一點點）。
_PICKUP_PENALTY_UNIT = {"L": 0.5, "M": 1.0, "H": 1.5}
# 情境對扣分的倍率：正式場合更重、休閒場合更輕（呼應 CONTEXT_PARAM_OVERRIDES）。
_CONTEXT_PENALTY_MULT = {
    "class": 1.30, "meeting": 1.20, "date": 1.15,
    "meal": 0.80, "celebration": 0.80, "family": 0.90,
}

# 表現積分倍率（control_flow_v2 §6.1）：越難、越正式，同品質累積越多。
_DIFFICULTY_PERF_MULT = {"L": 1.0, "M": 1.3, "H": 1.6}
_CONTEXT_PERF_MULT = {"study": 1.15, "class": 1.15, "workshop": 1.15, "meeting": 1.10}


def _num(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def compute_meeting_score(duration_minutes: int, deviations: int, is_host: bool,
                          difficulty: str = "M", context: str = "general",
                          metrics: Optional[dict] = None) -> int:
    """個人聚會『專注品質』分數（0–100）。底分 + 加分 − 扣分，夾 0–100。

    抗操弄：加分項各自封頂、最終夾 100（不會超過滿分）；扣分無免罰額度但只針對
    真正超時的分心（回得來的短暫查看前端不會送 deviation）。
    """
    d = (difficulty or "M").upper()
    duration = max(0.0, float(duration_minutes or 0))
    metrics = metrics or {}
    ctx_pen_mult = _CONTEXT_PENALTY_MULT.get(context or "general", 1.0)

    # 加分 1：參與時長（sqrt 遞減、封頂）
    attendance_bonus = _ATTENDANCE_BONUS_MAX * min(1.0, math.sqrt(duration / _ATTENDANCE_REF_MIN))
    # 加分 2：連續專注（未來由感測器送 focus_streak_seconds；沒有則 0）
    focus_streak_sec = max(0.0, _num(metrics.get("focus_streak_seconds"), 0.0))
    focus_bonus = _FOCUS_STREAK_BONUS_MAX * min(1.0, focus_streak_sec / _FOCUS_STREAK_REF_SEC)
    host_bonus = _HOST_BONUS if is_host else 0.0

    # 扣分 1：每次超時分心（大扣分，無免罰額度）
    dev_unit = _DEVIATION_PENALTY_UNIT.get(d, 7.0)
    deviation_penalty = max(0, int(deviations)) * dev_unit * ctx_pen_mult
    # 扣分 2：每次拿起手機等被動微訊號（只扣一點點，未來 metrics.pickup_count）
    pickup_count = max(0.0, _num(metrics.get("pickup_count"), 0.0))
    pickup_penalty = pickup_count * _PICKUP_PENALTY_UNIT.get(d, 1.0) * ctx_pen_mult

    score = (_BASE_SCORE + attendance_bonus + focus_bonus + host_bonus
             - deviation_penalty - pickup_penalty)
    return int(round(max(0.0, min(100.0, score))))


def compute_perf_points(quality_score: int, difficulty: str = "M", context: str = "general") -> int:
    """表現積分（週/總排行用）= 品質 × 難度倍率 × 情境倍率。"""
    d_mult = _DIFFICULTY_PERF_MULT.get((difficulty or "M").upper(), 1.3)
    c_mult = _CONTEXT_PERF_MULT.get(context or "general", 1.0)
    return int(round(max(0, int(quality_score)) * d_mult * c_mult))


def build_score_ranking(all_ever: dict, host_uid: Optional[str], duration_minutes: int,
                        context: str = "general", difficulty: str = "M"):
    """個人計分：每個人依「自己的」分心次數（未來含感測器 metrics）算分。

    回傳 (ranking, score_by_uid, perf_by_uid, avg_score)：
      - ranking     : 依品質分由高到低（同分時分心少的在前），每列含 score + perf_points
      - score_by_uid: uid → 品質分（0–100，寵物/場內排行用）
      - perf_by_uid : uid → 表現積分（週/總排行用）
      - avg_score   : 全場平均品質分，代表「這場聚會整體表現」（群組寵物用）
    """
    rows = []
    score_by_uid: Dict[str, int] = {}
    perf_by_uid: Dict[str, int] = {}
    for uid, info in (all_ever or {}).items():
        deviations = int((info or {}).get("deviations", 0) or 0)
        metrics = (info or {}).get("quality_metrics")  # 未來 client 送的被動訊號
        score = compute_meeting_score(
            duration_minutes, deviations, is_host=(uid == host_uid),
            difficulty=difficulty, context=context, metrics=metrics,
        )
        perf = compute_perf_points(score, difficulty, context)
        score_by_uid[uid] = score
        perf_by_uid[uid] = perf
        rows.append({
            "uid": uid,
            "nickname": (info or {}).get("nickname", ""),
            "deviations": deviations,
            "score": score,
            "perf_points": perf,
        })

    rows.sort(key=lambda x: (-x["score"], x["deviations"]))
    avg_score = int(round(sum(score_by_uid.values()) / len(score_by_uid))) if score_by_uid else 0
    return rows, score_by_uid, perf_by_uid, avg_score


def score_for_uid(uid: str, score_by_uid: dict, all_ever: dict, host_uid: Optional[str],
                  duration_minutes: int, context: str = "general", difficulty: str = "M") -> int:
    """取某人的品質分；若他不在 all_ever（例如已斷線的房主）則現算一份。"""
    score = score_by_uid.get(uid)
    if score is None:
        info = all_ever.get(uid) or {}
        deviations = int(info.get("deviations", 0) or 0)
        score = compute_meeting_score(
            duration_minutes, deviations, is_host=(uid == host_uid),
            difficulty=difficulty, context=context, metrics=info.get("quality_metrics"),
        )
    return score
