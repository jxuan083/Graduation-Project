"""Server-owned meeting coins, item draws and shared pet inventory."""
from __future__ import annotations

import secrets

RARITIES = {
    "common": {"label": "普通", "level": 1, "weight": 7000},
    "rare": {"label": "稀有", "level": 2, "weight": 2500},
    "treasure": {"label": "珍藏", "level": 3, "weight": 500},
}


# Normalized atlas UV crops; generated objects use deliberately unequal margins.
FOOD_CROPS = [(x / 1280, y / 1280, w / 1280, h / 1280) for x,y,w,h in [
    (0,0,426,426), (426,0,427,426), (853,0,427,426),
    (0,426,426,389), (426,426,427,389), (853,426,427,389),
    (0,815,426,465), (426,815,427,465), (853,815,427,465),
]]
TOY_CROPS = [(x / 1280, y / 1280, w / 1280, h / 1280) for x,y,w,h in [
    (0,200,470,430), (470,180,370,450), (840,180,440,450),
    (0,630,440,500), (440,630,420,500), (860,630,420,500),
]]

def _food(item_id, name, rarity, index, energy, happiness):
    return {"id": item_id, "name": name, "kind": "food", "rarity": rarity,
            "visual": {"sheet": "food", "index": index, "columns": 3, "rows": 3, "crop": FOOD_CROPS[index]},
            "effects": {"pet_energy": energy, "pet_happiness": happiness}}


def _toy(item_id, name, rarity, index, motion, happiness, energy):
    return {"id": item_id, "name": name, "kind": "toy", "rarity": rarity, "motion": motion,
            "visual": {"sheet": "ball" if index < 0 else "toy", "index": max(0, index), "columns": 3, "rows": 2, "crop": (0,0,1,1) if index < 0 else TOY_CROPS[index]},
            "effects": {"pet_happiness": happiness, "pet_energy": -energy}}


CARE_ITEMS = [
    _food("oat_biscuit", "燕麥小餅", "common", 0, 25, 3),
    _food("pumpkin_crisps", "南瓜脆片", "common", 1, 23, 4),
    _food("carrot_biscuit", "胡蘿蔔小餅", "common", 2, 22, 5),
    _food("chicken_jerky", "雞肉軟條", "rare", 3, 30, 5),
    _food("salmon_bites", "鮭魚小方", "rare", 4, 32, 4),
    _food("yogurt_drops", "優格小點", "rare", 5, 28, 7),
    _food("star_biscuit", "星星慶祝餅", "treasure", 6, 40, 8),
    _food("beef_cubes", "凍乾牛肉方", "treasure", 7, 42, 6),
    _food("heart_biscuit", "手作愛心餅", "treasure", 8, 35, 12),
    _toy("cloth_ball", "拼布小球", "common", -1, "roll", 20, 5),
    _toy("knot_rope", "棉繩結", "common", 0, "tug", 18, 4),
    _toy("tennis_ball", "絨毛網球", "common", 1, "roll", 22, 6),
    _toy("squeaky_duck", "啾啾小鴨", "rare", 2, "bounce", 25, 4),
    _toy("star_plush", "星星布偶", "rare", 3, "bounce", 27, 3),
    _toy("flying_disc", "默契飛盤", "treasure", 4, "toss", 30, 3),
    _toy("puzzle_ball", "尋寶益智球", "treasure", 5, "roll", 32, 2),
]
CARE_BY_ID = {item["id"]: item for item in CARE_ITEMS}


def public_item(item):
    if not item:
        return None
    rarity = RARITIES[item["rarity"]]
    return {**item, "effects": dict(item["effects"]), "visual": dict(item["visual"]),
            "rarity_label": rarity["label"], "rarity_level": rarity["level"]}


def item_by_id(item_id):
    return public_item(CARE_BY_ID.get(item_id))


def care_catalog():
    return {"version": 2, "mode": "inventory",
            "prices": DRAW_PRICES, "food_portions": FOOD_DRAW_PORTIONS,
            "toy_duplicate_refund": TOY_DUPLICATE_REFUND,
            "base_food": BASE_FOOD, "base_toy": BASE_TOY,
            "coin_rules": {"min_minutes": 10, "min_members": 2},
            "rarities": [{"id": key, **meta, "probability": meta["weight"] / 10000}
                         for key, meta in RARITIES.items()],
            "items": [public_item(item) for item in CARE_ITEMS]}


def draw_care_item(action, randbelow=None, choice=None, exclude=None):
    kind = {"feed": "food", "play": "toy"}.get(action)
    if kind is None:
        return None
    roll = (randbelow or secrets.randbelow)(10000)
    ceiling = 0
    for key, meta in RARITIES.items():
        ceiling += meta["weight"]
        if roll < ceiling:
            candidates = [item for item in CARE_ITEMS if item["kind"] == kind and item["rarity"] == key and item['id'] not in (exclude or set())]
            return public_item((choice or secrets.choice)(candidates))
    raise ValueError("care roll outside configured weights")


def apply_item_effects(stats, item):
    result = dict(stats)
    for key, delta in item["effects"].items():
        result[key] = max(0.0, min(100.0, result[key] + delta))
    return result


def discovered_items(data):
    return sorted({item_id for item_id in (data.get("pet_discovered_items") or []) if item_id in CARE_BY_ID})

DRAW_PRICES = {"food": 30, "toy": 60}
FOOD_DRAW_PORTIONS = 3
TOY_DUPLICATE_REFUND = 20
BASE_FOOD = "oat_biscuit"
BASE_TOY = "cloth_ball"


def economy_payload(data):
    food = {key: min(9999, max(0, int(value))) for key, value in (data.get('pet_food_inventory') or {}).items()
            if key in CARE_BY_ID and CARE_BY_ID[key]['kind'] == 'food' and int(value) > 0}
    toys = sorted({BASE_TOY} | {key for key in (data.get('pet_owned_toys') or [])
                              if key in CARE_BY_ID and CARE_BY_ID[key]['kind'] == 'toy'})
    return {'pet_coins': max(0, int(data.get('pet_coins', 0) or 0)),
            'pet_food_inventory': food, 'pet_owned_toys': toys}


def session_coins(avg_score, duration_minutes, member_count):
    # Only an actual group meeting earns coins; no zero-minute solo room farming.
    if duration_minutes < 10 or member_count < 2:
        return 0
    return 20 + int(min(120, duration_minutes) // 5) * 5 + round(max(0, min(100, avg_score)) * .2)


def draw_inventory_item(kind, randbelow=None, choice=None):
    # The free starter ball is excluded from the paid toy pool.
    return draw_care_item('feed' if kind == 'food' else 'play', randbelow, choice,
                          exclude={BASE_TOY} if kind == 'toy' else set())


def apply_inventory_draw(data, item):
    economy = economy_payload(data)
    cost = DRAW_PRICES[item['kind']]
    if economy['pet_coins'] < cost:
        raise ValueError('insufficient_coins')
    economy['pet_coins'] -= cost
    duplicate = item['kind'] == 'toy' and item['id'] in economy['pet_owned_toys']
    if item['kind'] == 'food':
        food = economy['pet_food_inventory']
        if food.get(item['id'], 0) > 9999 - FOOD_DRAW_PORTIONS:
            raise ValueError('inventory_full')
        food[item['id']] = food.get(item['id'], 0) + FOOD_DRAW_PORTIONS
    elif duplicate:
        economy['pet_coins'] += TOY_DUPLICATE_REFUND
    else:
        economy['pet_owned_toys'] = sorted(set(economy['pet_owned_toys']) | {item['id']})
    return economy, {'duplicate': duplicate, 'refund': TOY_DUPLICATE_REFUND if duplicate else 0,
                     'quantity': FOOD_DRAW_PORTIONS if item['kind'] == 'food' else 1, 'cost': cost}


def use_inventory_item(data, action, item_id=None):
    economy = economy_payload(data)
    kind = {'feed': 'food', 'play': 'toy'}.get(action)
    if not kind:
        return None, economy
    item = item_by_id(item_id or (BASE_FOOD if kind == 'food' else BASE_TOY))
    if not item or item['kind'] != kind:
        raise ValueError('invalid_item')
    if kind == 'food':
        quantity = economy['pet_food_inventory'].get(item['id'], 0)
        # Starter biscuit stays available even with an empty backpack.
        if item['id'] != BASE_FOOD and quantity < 1:
            raise ValueError('item_not_owned')
        if quantity:
            economy['pet_food_inventory'][item['id']] = quantity - 1
    elif item['id'] not in economy['pet_owned_toys']:
        raise ValueError('item_not_owned')
    return item, economy
