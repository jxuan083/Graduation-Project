"""聚會評分引擎（純函式，無 I/O，可獨立測試）。

刻意分成兩種分數，用途不同：
  personal_quality_score (0–100)：個人在這場聚會的「專注品質」。用於場內排行、
      群組寵物能量（pet_logic 期望 0–100）。難度/情境決定扣分嚴格度。
  perf_points (>=0)：計入週/總排行榜的「表現積分」= 品質 × 難度倍率 × 情境倍率。
      選越難、越正式的聚會，同樣品質累積越多分（獎勵挑戰）。

品質分 = 依「情境 profile」把 focus 分與 presence 分加權混合，夾在 0–100：
  focus 分（專注）：滿分扣掉「真分心」與「第2次起的意圖豁免時間（在場不專注）」。
  presence 分（陪伴）：到場/待滿（sqrt 遞減、封頂）。
  情境決定 focus:presence 權重、分心倍率、表現積分價值；難度決定每次分心扣多重。
  → 讀書會重專注（分心很痛）、聚餐重陪伴（到場才是重點），同樣行為分數明顯不同。
  上限鎖 100——像考試不會考出 120 分。

允許時間內（前端 grace window）處理完就回到 App 的短暫查看，前端根本不會送出
deviation，所以那種「回得來」的分心不吃大扣分；只有真的超時才算 deviation。

client 目前只被動送 deviations 與時長；引擎另外吃 metrics 選填欄位
（pickup_count、focus_streak_seconds、exempt_charged_seconds…），一旦開始傳送即自動
生效，後端不需再改。
"""
import math
from typing import Dict, Optional

_ATTENDANCE_REF_MIN = 60.0     # presence：到此分鐘數，陪伴分達滿
_FOCUS_STREAK_BONUS_MAX = 15.0 # focus 加分：連續專注（未來 metrics.focus_streak_seconds）
_FOCUS_STREAK_REF_SEC = 600.0  # 連續專注到此秒數，加分達滿
_HOST_BONUS = 3.0              # 主持者的小額加分

# 每次「超出允許時間的分心」的大扣分，依難度（無免罰額度）。
_DEVIATION_PENALTY_UNIT = {"L": 4.0, "M": 7.0, "H": 10.0}
# 每次「拿起手機」等被動微訊號的小扣分，依難度（只扣一點點）。
_PICKUP_PENALTY_UNIT = {"L": 0.5, "M": 1.0, "H": 1.5}
# 表現積分的難度倍率（control_flow_v2 §6.1）：越難，同品質累積越多。
_DIFFICULTY_PERF_MULT = {"L": 1.0, "M": 1.3, "H": 1.6}

# 每個情境自己的計分 profile：
#   focus/presence：重專注還是重陪伴（兩者和為 1）
#   dev_mult      ：分心扣分倍率（正式場合更重、休閒場合更輕）
#   value         ：表現積分價值倍率（讀書會/會議較高）
_CONTEXT_PROFILE = {
    #                focus  presence  dev_mult  value
    "general":     {"focus": 0.50, "presence": 0.50, "dev_mult": 1.00, "value": 1.00},
    "meeting":     {"focus": 0.70, "presence": 0.30, "dev_mult": 1.20, "value": 1.15},
    "family":      {"focus": 0.35, "presence": 0.65, "dev_mult": 0.90, "value": 1.00},
    "study":       {"focus": 0.75, "presence": 0.25, "dev_mult": 1.00, "value": 1.15},
    "class":       {"focus": 0.80, "presence": 0.20, "dev_mult": 1.30, "value": 1.15},
    "meal":        {"focus": 0.40, "presence": 0.60, "dev_mult": 0.80, "value": 1.00},
    "date":        {"focus": 0.60, "presence": 0.40, "dev_mult": 1.15, "value": 1.05},
    "celebration": {"focus": 0.35, "presence": 0.65, "dev_mult": 0.80, "value": 1.00},
    "workshop":    {"focus": 0.60, "presence": 0.40, "dev_mult": 1.00, "value": 1.10},
    "team":        {"focus": 0.50, "presence": 0.50, "dev_mult": 1.00, "value": 1.05},
    "custom":      {"focus": 0.50, "presence": 0.50, "dev_mult": 1.00, "value": 1.00},
}
_DEFAULT_PROFILE = {"focus": 0.50, "presence": 0.50, "dev_mult": 1.00, "value": 1.00}


def _num(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _profile(context: str) -> dict:
    return _CONTEXT_PROFILE.get(context or "general", _DEFAULT_PROFILE)


def compute_meeting_score(duration_minutes: int, deviations: int, is_host: bool,
                          difficulty: str = "M", context: str = "general",
                          metrics: Optional[dict] = None) -> int:
    """個人聚會『專注品質』分數（0–100）= 情境加權(focus 分, presence 分)，夾 0–100。

    抗操弄：完美專注全勤各情境都是 100；長時間分心會真的掉；第2次起的意圖豁免
    時間算「在場不專注」→ 等比例削 focus，越用越低（漸進成本）。
    """
    d = (difficulty or "M").upper()
    duration = max(0.0, float(duration_minutes or 0))
    metrics = metrics or {}
    prof = _profile(context)

    # ── focus 分（0–100）：滿分扣掉真分心與 pickup ──
    dev_unit = _DEVIATION_PENALTY_UNIT.get(d, 7.0)
    deviation_penalty = max(0, int(deviations)) * dev_unit * prof["dev_mult"]
    pickup_count = max(0.0, _num(metrics.get("pickup_count"), 0.0))
    pickup_penalty = pickup_count * _PICKUP_PENALTY_UNIT.get(d, 1.0) * prof["dev_mult"]
    focus_score = 100.0 - deviation_penalty - pickup_penalty
    # 第2次起的意圖豁免時間：算在場、不算專注 → 依占聚會比例等比例削 focus（漸進成本）
    exempt_charged_sec = max(0.0, _num(metrics.get("exempt_charged_seconds"), 0.0))
    if duration > 0:
        charged_fraction = min(1.0, (exempt_charged_sec / 60.0) / duration)
        focus_score *= (1.0 - charged_fraction)
    # 連續專注加分（未來由感測器送）
    focus_streak_sec = max(0.0, _num(metrics.get("focus_streak_seconds"), 0.0))
    focus_score += _FOCUS_STREAK_BONUS_MAX * min(1.0, focus_streak_sec / _FOCUS_STREAK_REF_SEC)
    focus_score = max(0.0, min(100.0, focus_score))

    # ── presence 分（0–100）：到場/待滿（sqrt 遞減、封頂） ──
    presence_score = 100.0 * min(1.0, math.sqrt(duration / _ATTENDANCE_REF_MIN))

    # ── 依情境權重混合 ──
    quality = prof["focus"] * focus_score + prof["presence"] * presence_score
    if is_host:
        quality += _HOST_BONUS
    return int(round(max(0.0, min(100.0, quality))))


def compute_perf_points(quality_score: int, difficulty: str = "M", context: str = "general") -> int:
    """表現積分（週/總排行用）= 品質 × 難度倍率 × 情境價值倍率。"""
    d_mult = _DIFFICULTY_PERF_MULT.get((difficulty or "M").upper(), 1.3)
    c_mult = _profile(context)["value"]
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
