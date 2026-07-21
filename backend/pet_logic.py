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
GROUP_PET_DECAY_PER_HOUR = {
    # 一天未互動仍可維持可照顧狀態，避免隔夜直接歸零。
    "pet_energy": 0.75,
    "pet_happiness": 0.5,
    "pet_cleanliness": 0.35,
}
GROUP_PET_ACTION_COOLDOWN_SECONDS = 10 * 60
PET_MEETING_REMINDER_DAYS = 7
PET_RESCUE_DAYS = 14
PET_XP_PER_LEVEL = 100
PET_ACCESSORY_UNLOCKS = {
    3: "bell",
    5: "bandana",
    8: "medal",
}


def _as_naive_utc(value: Any) -> datetime.datetime | None:
    if not isinstance(value, datetime.datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


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
    hours = elapsed_hours(data.get("pet_last_updated"), now)
    stats = {
        key: float(data.get(key, default))
        for key, default in GROUP_PET_STAT_DEFAULTS.items()
    }
    for key, rate in GROUP_PET_DECAY_PER_HOUR.items():
        stats[key] = max(0.0, stats[key] - rate * hours)
    return stats


def group_pet_hp(stats: dict) -> int:
    average = (
        stats["pet_energy"]
        + stats["pet_happiness"]
        + stats["pet_cleanliness"]
    ) / 3
    return max(0, min(5, round(average / 20)))


def group_pet_growth(data: dict) -> dict:
    """以累積聚會 XP 推導等級、階段與解鎖物，避免儲存值互相漂移。"""
    xp = max(0, int(data.get("pet_accumulated_score", 0) or 0))
    level = xp // PET_XP_PER_LEVEL + 1
    if level < 3:
        stage = "YOUNG"
    elif level < 6:
        stage = "GROWING"
    else:
        stage = "PARTNER"
    accessories = [key for unlock_level, key in PET_ACCESSORY_UNLOCKS.items() if level >= unlock_level]
    return {
        "pet_level": level,
        "pet_xp": xp,
        "pet_xp_current": xp % PET_XP_PER_LEVEL,
        "pet_xp_to_next": PET_XP_PER_LEVEL,
        "pet_stage": stage,
        "pet_accessories": accessories,
        "pet_meetings_completed": max(0, int(data.get("pet_meetings_completed", 0) or 0)),
        "pet_last_session_score": data.get("pet_last_session_score"),
        "pet_last_reward_xp": max(0, int(data.get("pet_last_reward_xp", 0) or 0)),
    }


def group_pet_meeting_state(data: dict, now: datetime.datetime | None = None) -> dict:
    """依最後聚會時間判斷提醒／待救援狀態；新寵物以建立時間起算。"""
    anchor = data.get("pet_last_session_at") or data.get("pet_face_updated_at") or data.get("created_at")
    if _as_naive_utc(anchor) is None:
        days_since = 0
    else:
        days_since = int(elapsed_hours(anchor, now) // 24)
    is_caged = days_since >= PET_RESCUE_DAYS
    return {
        "pet_days_since_meeting": days_since,
        "pet_meeting_warning": PET_MEETING_REMINDER_DAYS <= days_since < PET_RESCUE_DAYS,
        "pet_is_caged": is_caged,
        "pet_days_until_caged": max(0, PET_RESCUE_DAYS - days_since),
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


def apply_group_pet_action(stats: dict, action: str) -> dict:
    """套用一次有效照顧動作；前置條件由 API 在 transaction 內檢查。"""
    result = dict(stats)
    if action == "feed":
        result["pet_energy"] = min(100.0, result["pet_energy"] + 25)
        result["pet_happiness"] = min(100.0, result["pet_happiness"] + 3)
    elif action == "play":
        result["pet_happiness"] = min(100.0, result["pet_happiness"] + 20)
        result["pet_energy"] = max(0.0, result["pet_energy"] - 5)
    elif action == "wipe":
        result["pet_cleanliness"] = min(100.0, result["pet_cleanliness"] + 35)
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
        "pet_hp": group_pet_hp(stats),
        **group_pet_growth(data),
        **group_pet_meeting_state(data, now),
    }
