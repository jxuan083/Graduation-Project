"""主持人「開放使用手機」的純規則（無 I/O，可單元測試）。

開會、專心上課的主持人可以讓全場一起用手機（看資料、做線上測驗），開放期間離開 App 不算分心、
算專心。兩種開放：
  - 限時（只有上課）：老師輸入分鐘數，時間到自動結束，不能提前結束。結束時間事先知道，
    所以每個人的手機能自己排好通知與靈動島倒數，回來時由前端照一般方式補算超過的部分。
  - 直到主持人結束（開會、上課都有）：主持人回 App 按「結束開放」才結束。
    結束那一刻還在 App 外的人收不到即時通知（免費帳號沒有遠端推播），所以由後端在他回到 App 時
    補算：從「結束時間＋寬限秒數」起算，跟前端的算法相同；一直沒回來的在聚會結算時補算。
主持人在「直到結束」的開放中離開聚會 → 開放在那一刻結束（交棒的人不一定知道有開放）。

旅行的「休息一下」也用同一套（mode = "rest"）：不是主持人開，而是大家投票——在場一半以上（含）按下就開始，
最長 REST_MAX_MINUTES 分鐘；一半以上按「結束休息」或時間到就結束。提前結束時在 App 外的人收不到通知，
回到 App 時一樣由後端補算（跟「直到結束」相同）。

房間資料：room["phone_open"] = {"mode", "by", "since_ms", "until_ms"（0 = 直到結束）, "ended_ms"（0 = 進行中）}
成員資料：member["open_away_since_ms"]：開放期間離開 App 的時間點（回來或結算時用來補算）。
"""
from typing import Optional, Tuple

# 哪些情境有「開放使用手機」、可以用哪些方式
OPEN_MODES_BY_CONTEXT = {
    "meeting": ("until_end",),
    "class": ("timed", "until_end"),
}
MAX_OPEN_MINUTES = 180
# 大家投票的「休息一下」（mode = "rest"），規則依情境：
#   旅行：在場一半以上（無條件進位）按下就開始，最長 30 分鐘，一半以上按「結束休息」可提前結束
#   約會：兩個人都按才開始（全員），固定 5 分鐘，不能提前結束（想結束就口頭說）
REST_RULES = {
    "outdoor": {"minutes": 30, "needed": "half", "end_vote": True},
    "date":    {"minutes": 5,  "needed": "all",  "end_vote": False},
}
REST_CONTEXTS = set(REST_RULES)
REST_MAX_MINUTES = REST_RULES["outdoor"]["minutes"]
# 離開 App 後幾秒開始算分心（與前端 buffer.js 的 GRACE_MS_BY_DIFFICULTY 一致）
GRACE_SEC_BY_DIFFICULTY = {"L": 30, "M": 20, "H": 10}


def grace_sec(difficulty: str) -> int:
    return GRACE_SEC_BY_DIFFICULTY.get((difficulty or "M").upper(), 20)


def open_modes(context: str) -> Tuple[str, ...]:
    return OPEN_MODES_BY_CONTEXT.get(context or "general", ())


def current(room: dict) -> Optional[dict]:
    return room.get("phone_open") or None


def is_open(room: dict, now_ms: int) -> bool:
    po = current(room)
    if not po or po.get("ended_ms"):
        return False
    until = int(po.get("until_ms", 0) or 0)
    return until == 0 or now_ms < until


def ended_at(room: dict, now_ms: int) -> int:
    """這次開放結束的時間；還在開放中（或從沒開放過）回傳 0。"""
    po = current(room)
    if not po:
        return 0
    if po.get("ended_ms"):
        return int(po["ended_ms"])
    until = int(po.get("until_ms", 0) or 0)
    return until if until and now_ms >= until else 0


def can_open(room: dict, uid: str, host_uid: Optional[str], minutes, now_ms: int) -> Tuple[bool, str]:
    modes = open_modes(room.get("context", "general"))
    if not modes:
        return False, "這個情境不能開放使用手機"
    if uid != host_uid:
        return False, "只有主持人可以開放使用手機"
    if is_open(room, now_ms):
        return False, "已經在開放中"
    if minutes:
        if "timed" not in modes:
            return False, "這個情境只能開放到主持人結束"
        if not (1 <= int(minutes) <= MAX_OPEN_MINUTES):
            return False, f"開放時間請輸入 1～{MAX_OPEN_MINUTES} 分鐘"
    elif "until_end" not in modes:
        return False, "請輸入開放的分鐘數"
    return True, ""


def open_phones(room: dict, uid: str, minutes, now_ms: int) -> dict:
    """開始開放。上一次開放結束後還一直沒回來的人，先把「上次結束到這次開始」之間補算掉
    （這段不算開放），回傳 {uid: 要補記的分心次數}。"""
    gap = _settle_gap_before_reopen(room, now_ms)
    minutes = int(minutes or 0)
    room["phone_open"] = {
        "mode": "timed" if minutes else "until_end",
        "by": uid,
        "since_ms": now_ms,
        "until_ms": now_ms + minutes * 60_000 if minutes else 0,
        "ended_ms": 0,
    }
    return gap


def can_close(room: dict, uid: str, host_uid: Optional[str], now_ms: int) -> Tuple[bool, str]:
    if uid != host_uid:
        return False, "只有主持人可以結束開放"
    if not is_open(room, now_ms):
        return False, "目前沒有在開放"
    if current(room).get("mode") == "rest":
        return False, "休息要大家投票結束"
    if int(current(room).get("until_ms", 0) or 0):
        return False, "限時開放不能提前結束"
    return True, ""


def close_phones(room: dict, now_ms: int) -> None:
    po = current(room)
    if po and not po.get("ended_ms"):
        po["ended_ms"] = now_ms


def close_if_host_left(room: dict, uid: str, at_ms: int) -> bool:
    """主持人在「直到結束」的開放中離開聚會 → 開放在那一刻結束。回傳有沒有結束。"""
    po = current(room)
    if not po or po.get("by") != uid or not is_open(room, at_ms) or int(po.get("until_ms", 0) or 0):
        return False
    po["ended_ms"] = at_ms
    return True


def note_hidden(room: dict, member: dict, now_ms: int) -> None:
    """開放期間離開 App：記下時間點（開放結束後才回來時，用來判斷要不要補算）。"""
    if member is not None and is_open(room, now_ms) and not member.get("open_away_since_ms"):
        member["open_away_since_ms"] = now_ms


def _count_after(deadline_ms: int, now_ms: int, grace: int) -> int:
    """跟前端 reconcileDeviations 同一個算法：過了截止時間記 1 次，之後每滿一個寬限再記 1 次。"""
    if now_ms < deadline_ms:
        return 0
    return int((now_ms - deadline_ms) // (grace * 1000)) + 1


def overage_on_return(room: dict, member: dict, now_ms: int) -> int:
    """回到 App：「直到結束」的開放已在他離開期間結束 → 回傳要補記的分心次數，並清掉離開紀錄。
    限時開放的結束時間前端本來就知道，由前端自己補算，這裡回傳 0（避免重複）。"""
    if member is None:
        return 0
    away_since = int(member.get("open_away_since_ms", 0) or 0)
    member["open_away_since_ms"] = 0
    po = current(room)
    if not away_since or not po or po.get("mode") == "timed":
        return 0
    end = ended_at(room, now_ms)
    if not end or end <= away_since:
        return 0
    g = grace_sec(room.get("difficulty", "M"))
    return _count_after(end + g * 1000, now_ms, g)


def overage_at_settle(room: dict, member: dict, now_ms: int, per_dev_sec: int) -> int:
    """聚會結算：開放結束後一直沒回來的人，把超過的部分補算（與暫離、點餐的結算補算同一種算法）。"""
    if member is None or not member.get("open_away_since_ms"):
        return 0
    end = ended_at(room, now_ms)
    if not end:
        return 0
    start = end + grace_sec(room.get("difficulty", "M")) * 1000
    if now_ms <= start:
        return 0
    return int(((now_ms - start) / 1000.0) // max(1.0, float(per_dev_sec)))


def _settle_gap_before_reopen(room: dict, now_ms: int) -> dict:
    """上一次開放結束後還沒回來、現在又要重新開放：補算兩次開放之間的那一段。"""
    out = {}
    po = current(room)
    end = ended_at(room, now_ms) if po else 0
    if not end or po.get("mode") == "timed":
        return out   # 限時開放的超時由前端自己算，這裡不重複
    g = grace_sec(room.get("difficulty", "M"))
    for uid, m in (room.get("members") or {}).items():
        away_since = int((m or {}).get("open_away_since_ms", 0) or 0)
        if not away_since or end <= away_since:
            continue
        n = _count_after(end + g * 1000, now_ms, g)
        if n > 0:
            out[uid] = n
        m["open_away_since_ms"] = now_ms   # 還在外面，接著算進這次開放
    return out


# ── 旅行：投票休息 ──

def _present(room: dict):
    return [uid for uid, m in (room.get("members") or {}).items() if m is not None and m.get("state") != "LEFT"]


def rest_rule(room: dict) -> Optional[dict]:
    return REST_RULES.get(room.get("context"))


def rest_needed(room: dict) -> int:
    """開始／結束休息要幾票：旅行是在場人數的一半（無條件進位，兩人時一票），約會是全員。"""
    n = len(_present(room))
    rule = rest_rule(room) or {}
    return max(1, n if rule.get("needed") == "all" else (n + 1) // 2)


def _toggle_vote(room: dict, key: str, uid: str) -> bool:
    present = set(_present(room))
    votes = [u for u in (room.get(key) or []) if u in present]
    voted = uid not in votes
    if voted:
        votes.append(uid)
    else:
        votes.remove(uid)
    room[key] = votes
    return voted


def rest_vote(room: dict, uid: str, now_ms: int) -> Tuple[bool, str, str]:
    """按「休息一下」（再按一次取消）。回傳 (ok, 原因, 結果 voted/unvoted/started)；
    started 時另外回傳要補算的人放在 room["_rest_gap"]（呼叫端取走）。"""
    rule = rest_rule(room)
    if not rule:
        return False, "這個情境沒有休息投票", ""
    if uid not in _present(room):
        return False, "你不在這場聚會裡", ""
    if is_open(room, now_ms):
        return False, "已經在休息了", ""
    voted = _toggle_vote(room, "rest_votes", uid)
    if len(room["rest_votes"]) < rest_needed(room):
        return True, "", "voted" if voted else "unvoted"
    room["_rest_gap"] = _settle_gap_before_reopen(room, now_ms)
    room["phone_open"] = {
        "mode": "rest",
        "by": uid,
        "since_ms": now_ms,
        "until_ms": now_ms + rule["minutes"] * 60_000,
        "ended_ms": 0,
    }
    room["rest_votes"] = []
    room["rest_end_votes"] = []
    return True, "", "started"


def rest_end_vote(room: dict, uid: str, now_ms: int) -> Tuple[bool, str, str]:
    """按「結束休息」（再按一次取消）。一半以上就結束。回傳 (ok, 原因, voted/unvoted/ended)。"""
    po = current(room)
    if not po or po.get("mode") != "rest" or not is_open(room, now_ms):
        return False, "現在沒有在休息", ""
    if not (rest_rule(room) or {}).get("end_vote"):
        return False, "休息時間到了就會自動結束", ""
    if uid not in _present(room):
        return False, "你不在這場聚會裡", ""
    voted = _toggle_vote(room, "rest_end_votes", uid)
    if len(room["rest_end_votes"]) < rest_needed(room):
        return True, "", "voted" if voted else "unvoted"
    close_phones(room, now_ms)
    room["rest_end_votes"] = []
    return True, "", "ended"


def forget_member(member: dict) -> None:
    if member is not None:
        member["open_away_since_ms"] = 0
