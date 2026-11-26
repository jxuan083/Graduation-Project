"""虛擬寵物的純計算規則。

這個模組不依賴 Firebase，讓衰減、狀態與動作規則可以被單元測試。
Firestore 的讀寫與 transaction 仍由 main.py 負責。
"""

from __future__ import annotations

import datetime
from typing import Any


GROUP_PET_STAT_DEFAULTS = {
    "pet_energy": 50.0,
    "pet_happiness": 70.0,
    "pet_cleanliness": 100.0,
}

STAT_FLOOR = 10.0
GRACE_PERIOD_HOURS = 24
PET_HP_MAX = 5

# Quality-based decay: total per 7-day cycle (1 grace + 6 decay days)
# Rates in units per hour (total / 6 days / 24 hours)
_DECAY_TOTAL = {
    "high": {"pet_energy": 6,  "pet_happiness": 6,  "pet_cleanliness": 3},
    "mid":  {"pet_energy": 12, "pet_happiness": 12, "pet_cleanliness": 6},
    "low":  {"pet_energy": 20, "pet_happiness": 20, "pet_cleanliness": 10},
}
DECAY_PER_HOUR: dict = {
    q: {stat: total / (6 * 24) for stat, total in rates.items()}
    for q, rates in _DECAY_TOTAL.items()
}

GROUP_PET_ACTION_COOLDOWN_SECONDS = 10 * 60
PET_MEETING_REMINDER_DAYS = 7
PET_RESCUE_DAYS = 30
PET_XP_PER_LEVEL = 100

# Level thresholds: PET_LEVEL_THRESHOLDS[i] = meetings required for Lv(i+1)
PET_LEVEL_THRESHOLDS = [0, 2, 4, 7, 11, 16, 22, 30, 40, 52]  # Lv1–Lv10

PET_ACCESSORY_UNLOCKS = {
    3: "bell",
    5: "bandana",
    8: "medal",
}


def _meetings_to_level(meetings: int) -> int:
    level = 1
    for i, threshold in enumerate(PET_LEVEL_THRESHOLDS):
        if meetings >= threshold:
            level = i + 1
        else:
            break
    return level


def _as_naive_utc(value: Any) -> datetime.datetime | None:
    if not isinstance(value, datetime.datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def get_active_buff(data: dict, now: datetime.datetime | None = None) -> dict | None:
    """回傳尚未過期的啟用 buff，否則回傳 None。"""
    buff = data.get("pet_active_buff")
    if not buff or not buff.get("buff_type"):
        return None
    expires_at = buff.get("buff_expires_at")
    if not expires_at:
        return None
    expires_naive = _as_naive_utc(expires_at)
    current = _as_naive_utc(now or datetime.datetime.utcnow())
    if expires_naive and current and current < expires_naive:
        return buff
    return None


def elapsed_hours(last_updated: Any, now: datetime.datetime | None = None) -> float:
    last = _as_naive_utc(last_updated)
    if last is None:
        return 0.0
    current = _as_naive_utc(now or datetime.datetime.utcnow())
    if current is None:
        return 0.0
    return max(0.0, (current - last).total_seconds() / 3600)


def group_pet_status(energy: float, happiness: float, cleanliness: float) -> str:
    if min(energy, happiness, cleanliness) < 10:
        return "CRITICAL"
    if cleanliness < 30:
        return "DIRTY"
    if energy < 30:
        return "HUNGRY"
    if happiness < 30:
        return "LONELY"
    if min(energy, happiness, cleanliness) > 75:
        return "HAPPY"
    return "NORMAL"


def group_pet_current_stats(data: dict, now: datetime.datetime | None = None) -> dict:
    stats = {
        key: float(data.get(key, default))
        for key, default in GROUP_PET_STAT_DEFAULTS.items()
    }
    last_updated = _as_naive_utc(data.get("pet_last_updated"))
    current = _as_naive_utc(now or datetime.datetime.utcnow())
    if last_updated is None or current is None:
        return stats

    quality = str(data.get("pet_last_session_quality") or "mid")
    if quality not in DECAY_PER_HOUR:
        quality = "mid"
    rates = DECAY_PER_HOUR[quality]

    # Decay only starts after GRACE_PERIOD_HOURS following the last session
    last_session = _as_naive_utc(data.get("pet_last_session_at"))
    if last_session is not None:
        grace_end = last_session + datetime.timedelta(hours=GRACE_PERIOD_HOURS)
        decay_start = max(last_updated, grace_end)
    else:
        decay_start = last_updated  # no session yet → no grace period

    decay_hours = max(0.0, (current - decay_start).total_seconds() / 3600)

    active_buff = get_active_buff(data, now)
    buff_multiplier = 1.0
    if active_buff and active_buff.get("buff_type") == "decay_resist":
        buff_multiplier = float(active_buff.get("buff_value", 1.0))

    for stat, rate in rates.items():
        stats[stat] = max(STAT_FLOOR, stats[stat] - rate * decay_hours * buff_multiplier)
    return stats


def group_pet_hp(data: dict) -> int:
    """Return stored HP (0–5); defaults to max on first use."""
    hp = data.get("pet_hp")
    if hp is None:
        return PET_HP_MAX
    return max(0, min(PET_HP_MAX, int(hp)))


def group_pet_session_hp_update(current_hp: int, final_stats: dict) -> int:
    """Compute new HP after a meeting based on the final saved stats.

    Any stat at floor → HP-1; all stats ≥50 → HP+1.
    """
    energy = final_stats.get("pet_energy", 0.0)
    happiness = final_stats.get("pet_happiness", 0.0)
    cleanliness = final_stats.get("pet_cleanliness", 0.0)
    new_hp = current_hp
    if energy <= STAT_FLOOR or happiness <= STAT_FLOOR or cleanliness <= STAT_FLOOR:
        new_hp -= 1
    elif energy >= 50 and happiness >= 50 and cleanliness >= 50:
        new_hp += 1
    return max(0, min(PET_HP_MAX, new_hp))


def group_pet_growth(data: dict) -> dict:
    """以累積聚會場數推導等級、階段與解鎖物，避免儲存值互相漂移。"""
    meetings = max(0, int(data.get("pet_meetings_completed", 0) or 0))
    xp = max(0, int(data.get("pet_accumulated_score", 0) or 0))
    level = _meetings_to_level(meetings)
    if level < 3:
        stage = "YOUNG"
    elif level < 6:
        stage = "GROWING"
    else:
        stage = "PARTNER"
    accessories = [key for unlock_level, key in PET_ACCESSORY_UNLOCKS.items() if level >= unlock_level]
    # Level progress based on meetings
    curr_threshold = PET_LEVEL_THRESHOLDS[level - 1]
    next_threshold = PET_LEVEL_THRESHOLDS[level] if level < len(PET_LEVEL_THRESHOLDS) else None
    meetings_in_level = meetings - curr_threshold
    meetings_for_level = (next_threshold - curr_threshold) if next_threshold is not None else meetings_in_level or 1
    return {
        "pet_level": level,
        "pet_xp": xp,
        "pet_xp_current": meetings_in_level,
        "pet_xp_to_next": meetings_for_level,
        "pet_stage": stage,
        "pet_accessories": accessories,
        "pet_meetings_completed": meetings,
        "pet_level_meetings_current": meetings_in_level,
        "pet_level_meetings_total": meetings_for_level,
        "pet_next_level_threshold": next_threshold,
        "pet_last_session_score": data.get("pet_last_session_score"),
        "pet_last_reward_xp": max(0, int(data.get("pet_last_reward_xp", 0) or 0)),
    }


def group_pet_meeting_state(data: dict, now: datetime.datetime | None = None) -> dict:
    """依最後聚會時間與 HP 判斷提醒／待救援狀態；新寵物以建立時間起算。"""
    anchor = data.get("pet_last_session_at") or data.get("pet_face_updated_at") or data.get("created_at")
    if _as_naive_utc(anchor) is None:
        days_since = 0
    else:
        days_since = int(elapsed_hours(anchor, now) // 24)
    hp = group_pet_hp(data)
    is_caged = days_since >= PET_RESCUE_DAYS or hp == 0
    days_until_no_care = max(0, PET_RESCUE_DAYS - days_since)
    return {
        "pet_days_since_meeting": days_since,
        "pet_meeting_warning": PET_MEETING_REMINDER_DAYS <= days_since < PET_RESCUE_DAYS,
        "pet_is_caged": is_caged,
        "pet_days_until_caged": days_until_no_care,
    }


def group_pet_session_xp(avg_score: int | float, duration_minutes: int | float) -> int:
    """低頻聚會採高回饋：完成保底、時數為主，專注品質提供小幅加成。"""
    score = max(0.0, min(100.0, float(avg_score)))
    # 最多計入三小時，避免忘記結束房間造成異常灌值。
    duration = max(0.0, min(180.0, float(duration_minutes)))
    completion_xp = 35
    duration_xp = round(duration * 1.25)
    quality_xp = round(score * 0.25)
    return completion_xp + duration_xp + quality_xp


def cooldown_remaining_seconds(
    last_action_at: Any,
    now: datetime.datetime | None = None,
    cooldown_seconds: int = GROUP_PET_ACTION_COOLDOWN_SECONDS,
) -> int:
    last = _as_naive_utc(last_action_at)
    current = _as_naive_utc(now or datetime.datetime.utcnow())
    if last is None or current is None:
        return 0
    elapsed = max(0.0, (current - last).total_seconds())
    return max(0, int(cooldown_seconds - elapsed + 0.999))


def apply_group_pet_action(stats: dict, action: str, buff: dict | None = None) -> dict:
    """套用一次有效照顧動作；前置條件由 API 在 transaction 內檢查。"""
    result = dict(stats)
    multiplier = 1.0
    if buff:
        btype = buff.get("buff_type", "")
        if btype == "all_boost" or btype == f"{action}_boost":
            multiplier = float(buff.get("buff_value", 1.0))
    if action == "feed":
        result["pet_energy"] = min(100.0, result["pet_energy"] + 25 * multiplier)
        result["pet_happiness"] = min(100.0, result["pet_happiness"] + 3)
    elif action == "play":
        result["pet_happiness"] = min(100.0, result["pet_happiness"] + 20 * multiplier)
        result["pet_energy"] = max(STAT_FLOOR, result["pet_energy"] - 5)
    elif action == "wipe":
        result["pet_cleanliness"] = min(100.0, result["pet_cleanliness"] + 35 * multiplier)
        result["pet_happiness"] = min(100.0, result["pet_happiness"] + 3)
    else:
        raise ValueError(f"unknown pet action: {action}")
    return result


def group_pet_display(data: dict, now: datetime.datetime | None = None) -> dict:
    stats = group_pet_current_stats(data, now)
    return {
        "pet_energy": round(stats["pet_energy"]),
        "pet_happiness": round(stats["pet_happiness"]),
        "pet_cleanliness": round(stats["pet_cleanliness"]),
        "pet_max_energy": 100,
        "pet_status": group_pet_status(
            stats["pet_energy"], stats["pet_happiness"], stats["pet_cleanliness"]
        ),
        "pet_hp": group_pet_hp(data),
        **group_pet_growth(data),
        **group_pet_meeting_state(data, now),
    }
