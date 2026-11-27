"""
寵物扭蛋系統 — 服裝與裝飾道具目錄及抽取邏輯（純函式，無 I/O）

金幣（ranking_gacha_points）由聚會 finalize 依排名發放（含專注度倍率）。
單抽 30 幣（有票免費），三連抽 80 幣。每 40 抽必出珍藏（硬保底）。
"""
from __future__ import annotations

import secrets

RARITIES = {
    "common":   {"label": "普通", "level": 1, "weight": 7000},
    "rare":     {"label": "稀有", "level": 2, "weight": 2500},
    "treasure": {"label": "珍藏", "level": 3, "weight": 500},
}

DRAW_COST_SINGLE = 30   # was 50
DRAW_COST_TRIPLE = 80   # was 120
PITY_HARD = 40          # new: hard pity counter

# ── 目錄 ─────────────────────────────────────────────────────────────────────

_GACHA_IMG_BASE     = "./assets/pets/gacha/"
_GACHA_OVERLAY_BASE = "./assets/pets/gacha_overlay/"


def _buff(buff_type: str, buff_value: float, duration_hours: int) -> dict:
    return {
        "buff_type": buff_type,
        "buff_value": buff_value,
        "buff_duration_hours": duration_hours,
    }


# ── 每個 slot 按稀有度比例 (14:5:1) 分配 10000 總權重，確保各 slot 出現機率相等 ──
# head  (3c+3r+2t): denom=59 → common=2373, rare=847,  treasure=169
# neck  (1c+1r+1t): denom=20 → common=7000, rare=2500, treasure=500
# body  (1c+1r+1t): denom=20 → common=7000, rare=2500, treasure=500
# effect(2c+2r+2t): denom=40 → common=3500, rare=1250, treasure=250
_SLOT_RARITY_WEIGHT: dict[str, dict[str, int]] = {
    "head":   {"common": 2373, "rare":  847, "treasure": 169},
    "neck":   {"common": 7000, "rare": 2500, "treasure": 500},
    "body":   {"common": 7000, "rare": 2500, "treasure": 500},
    "effect": {"common": 3500, "rare": 1250, "treasure": 250},
}


def _costume(item_id, name, rarity, slot, img_file, description, buff=None):
    item = {
        "id": item_id,
        "name": name,
        "type": "costume",
        "rarity": rarity,
        "img": _GACHA_IMG_BASE + img_file,
        "overlay_img": _GACHA_OVERLAY_BASE + img_file,
        "description": description,
        "slot": slot,
        "weight": _SLOT_RARITY_WEIGHT[slot][rarity],
    }
    if buff is not None:
        item["buff"] = buff
    return item


def _decoration(item_id, name, rarity, effect, img_file, description, buff=None):
    item = {
        "id": item_id,
        "name": name,
        "type": "decoration",
        "rarity": rarity,
        "img": _GACHA_IMG_BASE + img_file,
        "overlay_img": _GACHA_OVERLAY_BASE + img_file,
        "description": description,
        "effect": effect,
        "weight": _SLOT_RARITY_WEIGHT["effect"][rarity],
    }
    if buff is not None:
        item["buff"] = buff
    return item


GACHA_ITEMS = [
    # ── 服裝：頭部 ──
    _costume("party_hat",     "派對帽",   "common",   "head", "party_hat.svg",     "慶祝時刻的必備頭飾，讓寵物充滿派對感！",    _buff("feed_boost", 1.35, 12)),
    _costume("bow_tie",       "蝴蝶結帽", "common",   "head", "bow_tie_hat.svg",   "可愛的蝴蝶結造型帽，萌度破表。",            _buff("play_boost", 1.3, 12)),
    _costume("crown",         "小王冠",   "rare",     "head", "crown.svg",         "閃亮亮的小王冠，讓寵物展現王者風範。",       _buff("feed_boost", 1.5, 24)),
    _costume("witch_hat",     "巫師帽",   "rare",     "head", "witch_hat.svg",     "神秘的巫師帽，充滿魔法氛圍。",              _buff("play_boost", 1.5, 24)),
    _costume("star_crown",    "星辰王冠", "treasure", "head", "star_crown.svg",    "匯聚星光打造的稀世王冠，閃耀全場。",         _buff("all_boost", 1.5, 48)),
    _costume("rainbow_crown", "彩虹皇冠", "treasure", "head", "rainbow_crown.svg", "七彩光芒環繞的傳說級皇冠，超級珍稀！",       _buff("all_boost", 1.6, 48)),
    _costume("cat_ears",      "貓耳頭飾", "common",   "head", "cat_ears.svg",      "軟萌的貓耳朵，讓寵物可愛翻倍。",            _buff("decay_resist", 0.65, 12)),
    _costume("star_glasses",  "星形眼鏡", "rare",     "head", "star_glasses.svg",  "閃亮的星形眼鏡，讓寵物自帶偶像感！",         _buff("play_boost", 1.6, 24)),
    # ── 服裝：頸部 ──
    _costume("scarf",           "格紋圍巾", "common",   "neck", "scarf.svg",           "溫暖的格紋圍巾，讓寵物保暖又時尚。",         _buff("decay_resist", 0.7, 24)),
    _costume("medal",           "聚會勳章", "rare",     "neck", "medal.svg",           "每次聚會精心鑄造的勳章，代表無數美好時光。", _buff("all_boost", 1.4, 24)),
    _costume("crystal_pendant", "水晶吊墜", "treasure", "neck", "crystal_pendant.svg", "純淨水晶製成的吊墜，折射出耀眼光芒。",       _buff("all_boost", 1.7, 48)),
    # ── 服裝：身體 ──
    _costume("vest",   "小背心",   "common",   "body", "vest.svg",   "輕便百搭的小背心，日常造型首選。",          _buff("wipe_boost", 1.4, 12)),
    _costume("cape",   "英雄披風", "rare",     "body", "cape.svg",   "威風凜凜的英雄披風，讓寵物化身超級英雄。", _buff("play_boost", 1.6, 24)),
    _costume("tuxedo", "燕尾服",   "treasure", "body", "tuxedo.svg", "剪裁精緻的燕尾服，優雅出席任何場合。",      _buff("all_boost", 2.0, 48)),
    # ── 裝飾 ──
    _decoration("sparkle",   "閃閃星光", "common",   "sparkle",   "sparkle.svg",   "滿天繁星環繞著你的寵物，閃耀動人。",           _buff("play_boost", 1.3, 12)),
    _decoration("music",     "音符飄飄", "common",   "music",     "music.svg",     "輕快的音符在寵物周圍飄散，充滿活力。",         _buff("play_boost", 1.3, 12)),
    _decoration("hearts",    "愛心雨",   "rare",     "hearts",    "hearts.svg",    "粉紅愛心如雨般飄落，甜蜜又療癒。",             _buff("feed_boost", 1.5, 24)),
    _decoration("rainbow",   "彩虹光環", "rare",     "rainbow",   "rainbow.svg",   "七彩光環圍繞寵物，美麗奪目。",                 _buff("decay_resist", 0.55, 24)),
    _decoration("fireworks", "聚會煙火", "treasure", "fireworks", "fireworks.svg", "璀璨煙火在寵物背後盛大綻放，慶祝聚會！",       _buff("all_boost", 1.6, 48)),
    _decoration("galaxy",    "銀河光環", "treasure", "galaxy",    "galaxy.svg",    "宇宙銀河環繞的夢幻光環，宛若穿越星際。",       _buff("all_boost", 2.0, 48)),
]

GACHA_BY_ID = {item["id"]: item for item in GACHA_ITEMS}


def _normalize_wardrobe(raw) -> dict:
    """Migrate old list format or handle new dict format.  Returns {item_id: count}."""
    if isinstance(raw, dict):
        return {k: max(1, int(v)) for k, v in raw.items() if k in GACHA_BY_ID and int(v or 0) > 0}
    elif isinstance(raw, list):
        return {item_id: 1 for item_id in raw if item_id in GACHA_BY_ID}
    return {}


def draw_gacha_item_forced_rarity(rarity: str, randbelow=None) -> dict:
    """Force-draw an item of the given rarity (used for pity)."""
    candidates = [item for item in GACHA_ITEMS if item["rarity"] == rarity]
    if not candidates:
        raise ValueError(f"no items with rarity: {rarity}")
    roll = (randbelow or secrets.randbelow)(len(candidates))
    return public_item(candidates[roll])


# ── 公開輔助 ─────────────────────────────────────────────────────────────────

def public_item(item: dict | None) -> dict | None:
    """回傳附加 rarity_label、rarity_level 的 item dict（淺拷貝）。"""
    if not item:
        return None
    rarity = RARITIES[item["rarity"]]
    return {**item, "rarity_label": rarity["label"], "rarity_level": rarity["level"]}


def gacha_catalog() -> dict:
    return {
        "version": 2,
        "draw_costs": {
            "single": DRAW_COST_SINGLE,
            "triple": DRAW_COST_TRIPLE,
            "ticket_single": True,
        },
        "pity": {"hard": PITY_HARD, "rarity": "treasure"},
        "rarities": [
            {"id": key, **meta, "probability": meta["weight"] / 10000}
            for key, meta in RARITIES.items()
        ],
        "items": [public_item(item) for item in GACHA_ITEMS],
    }


def draw_gacha_item(randbelow=None) -> dict:
    """
    依每個道具的 weight 加權抽取一件道具，回傳 public_item dict。

    各 slot 的 weight 總和均為 10000，所以 4 個 slot 各佔整體 25%；
    slot 內 common:rare:treasure 比例 ≈ 14:5:1。
    """
    total_weight = sum(item["weight"] for item in GACHA_ITEMS)
    roll = (randbelow or secrets.randbelow)(total_weight)
    ceiling = 0
    for item in GACHA_ITEMS:
        ceiling += item["weight"]
        if roll < ceiling:
            return public_item(item)
    raise ValueError("gacha roll outside configured weights")


def apply_gacha_draw(
    group_data: dict,
    user_data: dict,
    item: dict,
    draw_cost: int,
    pity_count: int = 0,
) -> tuple[dict, dict, dict]:
    current_points = int(user_data.get("ranking_gacha_points") or 0)
    user_tickets = int(user_data.get("gacha_tickets") or 0)
    using_ticket = draw_cost == 0

    if not using_ticket and current_points < draw_cost:
        raise ValueError("insufficient_points")

    wardrobe = _normalize_wardrobe(group_data.get("pet_wardrobe"))
    duplicate = item["id"] in wardrobe

    new_points = current_points - draw_cost
    new_pity = 0 if item["rarity"] == "treasure" else pity_count + 1

    if duplicate:
        wardrobe[item["id"]] = wardrobe[item["id"]] + 1
    else:
        wardrobe[item["id"]] = 1

    wardrobe_update = {"pet_wardrobe": wardrobe, "pet_gacha_pity": new_pity}
    points_update = {"ranking_gacha_points": new_points}
    if using_ticket:
        points_update["gacha_tickets"] = max(0, user_tickets - 1)

    outcome = {
        "duplicate": duplicate,
        "refund": 0,
        "cost": draw_cost,
        "used_ticket": using_ticket,
        "pity_triggered": pity_count >= PITY_HARD,
    }
    return wardrobe_update, points_update, outcome


def wardrobe_items(group_data: dict) -> list[dict]:
    wardrobe = _normalize_wardrobe(group_data.get("pet_wardrobe"))
    return [
        {**public_item(GACHA_BY_ID[item_id]), "count": count}
        for item_id, count in wardrobe.items()
        if item_id in GACHA_BY_ID
    ]


def equipped_items(group_data: dict) -> dict:
    """
    回傳 {slot_or_effect: public_item_dict} 的已裝備 dict。
    pet_equipped 儲存格式：{slot: item_id}，例如 {"head": "crown", "effect": "sparkle"}。
    """
    equipped: dict = group_data.get("pet_equipped") or {}
    result = {}
    for slot, item_id in equipped.items():
        if item_id and item_id in GACHA_BY_ID:
            result[slot] = public_item(GACHA_BY_ID[item_id])
    return result


# ── 重複道具兌換個人抽獎卷（服裝與玩具共用同一規則）──
# 每 3 件換 1 張：3 件 → 1 張（剩 0）、6 件 → 2 張（剩 0）。
EXCHANGE_COPIES_PER_TICKET = 3
EXCHANGE_KEEP = 0


def exchangeable_sets(count: int) -> int:
    """這款道具目前最多可換幾張券。"""
    return max(0, (int(count or 0) - EXCHANGE_KEEP) // EXCHANGE_COPIES_PER_TICKET)


def exchange_duplicates_for_tickets(wardrobe: dict, exchange_items: list[dict]) -> tuple[dict, int]:
    """
    Deduct duplicates and return (new_wardrobe, total_tickets).
    exchange_items: list of {"item_id": str, "exchange_sets": int}
    Each set costs 3 copies; at least 1 copy of every item is always kept.
    """
    new_wardrobe = dict(wardrobe)
    total_tickets = 0
    for entry in exchange_items:
        item_id = entry.get("item_id")
        exchange_sets = int(entry.get("exchange_sets", 0))
        if not item_id or item_id not in new_wardrobe or exchange_sets <= 0:
            continue
        count = new_wardrobe[item_id]
        if exchange_sets > exchangeable_sets(count):
            raise ValueError(f"not_enough_duplicates:{item_id}")
        new_wardrobe[item_id] = count - exchange_sets * EXCHANGE_COPIES_PER_TICKET
        total_tickets += exchange_sets
    return new_wardrobe, total_tickets
