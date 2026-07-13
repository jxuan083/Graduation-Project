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
    "pet_energy": 4.0,
    "pet_happiness": 3.0,
    "pet_cleanliness": 2.0,
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
    if energy < 15:
        return "CRITICAL"
    if cleanliness < 25:
        return "DIRTY"
    if energy < 40 or happiness < 30:
        return "HUNGRY"
    if energy > 75 and happiness > 70 and cleanliness > 70:
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
    }


def personal_pet_decay(data: dict, now: datetime.datetime | None = None) -> dict:
    hours = elapsed_hours(data.get("my_pet_last_updated"), now)
    hunger = int(data.get("my_pet_hunger", 70))
    happiness = int(data.get("my_pet_happiness", 70))
    energy = int(data.get("my_pet_energy", 80))
    cleanliness = int(data.get("my_pet_cleanliness", 100))
    is_sleeping = bool(data.get("my_pet_is_sleeping", False))
    has_poop = bool(data.get("my_pet_has_poop", False))
    has_pee = bool(data.get("my_pet_has_pee", False))

    if hours > 0:
        hunger = max(0, min(100, hunger - int(5 * hours)))
        happiness = max(0, min(100, happiness - int(3 * hours)))
        cleanliness = max(0, min(100, cleanliness - int(2 * hours)))
        energy_delta = int((8 if is_sleeping else -4) * hours)
        energy = max(0, min(100, energy + energy_delta))
        has_poop = has_poop or hours >= 4
        has_pee = has_pee or hours >= 3

    if is_sleeping:
        status = "SLEEPING"
    elif has_poop or has_pee:
        status = "DIRTY"
    elif hunger < 20 or energy < 10:
        status = "CRITICAL"
    elif hunger < 40 or happiness < 30:
        status = "HUNGRY"
    elif hunger > 70 and happiness > 70 and energy > 60:
        status = "HAPPY"
    else:
        status = "NORMAL"

    return {
        "my_pet_hunger": hunger,
        "my_pet_happiness": happiness,
        "my_pet_energy": energy,
        "my_pet_cleanliness": cleanliness,
        "my_pet_is_sleeping": is_sleeping,
        "my_pet_has_poop": has_poop,
        "my_pet_has_pee": has_pee,
        "my_pet_status": status,
    }
