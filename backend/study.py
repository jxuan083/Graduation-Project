"""讀書會：番茄鐘與問題板的純規則（無 I/O，可單元測試）。

番茄鐘：聚會正式開始（active_started_ms）後，全組一起跑「專心 FOCUS_MIN 分鐘、休息 BREAK_MIN 分鐘」的循環。
  休息時段全員自動開放用手機（離開 App 不算分心、不需要暫離）；時間是固定的，
  所以每個人的手機都能自己算出下一次休息，排好通知與靈動島倒數。
問題板：專心時卡住的問題先寫下來，全組都看得到，休息時一起討論、解決了就打勾。
  房間資料 room["questions"] = [{"id", "by", "nickname", "text", "solved", "at_ms"}]
"""
from typing import List, Optional, Tuple

STUDY_CONTEXTS = {"study"}
FOCUS_MIN = 25
BREAK_MIN = 5
CYCLE_MS = (FOCUS_MIN + BREAK_MIN) * 60_000
FOCUS_MS = FOCUS_MIN * 60_000
QUESTION_MAX_LEN = 80
QUESTION_LIMIT = 50


def has_pomodoro(room: dict) -> bool:
    return room.get("context") in STUDY_CONTEXTS and bool(room.get("active_started_ms"))


def break_window(started_ms: int, now_ms: int) -> Tuple[bool, int, int]:
    """(現在是不是休息時段, 這次（或下一次）休息開始, 結束)。"""
    if not started_ms or now_ms < started_ms:
        return False, started_ms + FOCUS_MS, started_ms + CYCLE_MS
    cycle_start = started_ms + ((now_ms - started_ms) // CYCLE_MS) * CYCLE_MS
    b_start, b_end = cycle_start + FOCUS_MS, cycle_start + CYCLE_MS
    return b_start <= now_ms < b_end, b_start, b_end


def on_break(room: dict, now_ms: int) -> bool:
    return has_pomodoro(room) and break_window(int(room["active_started_ms"]), now_ms)[0]


def break_overlap_ms(started_ms: int, a_ms: int, b_ms: int) -> int:
    """[a, b] 之間落在休息時段的毫秒數（離開 App 期間碰到休息，那段不算分心）。"""
    if not started_ms or b_ms <= a_ms:
        return 0
    total = 0
    k = max(0, (a_ms - started_ms) // CYCLE_MS)
    while True:
        b_start = started_ms + k * CYCLE_MS + FOCUS_MS
        b_end = b_start + (CYCLE_MS - FOCUS_MS)
        if b_start >= b_ms:
            break
        total += max(0, min(b_end, b_ms) - max(b_start, a_ms))
        k += 1
    return total


# ── 問題板 ──

def add_question(room: dict, uid: str, nickname: str, text: str, now_ms: int, qid: str) -> Tuple[bool, str]:
    if room.get("context") not in STUDY_CONTEXTS:
        return False, "這個情境沒有問題板"
    text = " ".join(str(text or "").split())[:QUESTION_MAX_LEN]
    if not text:
        return False, "請先寫下問題"
    qs: List[dict] = room.setdefault("questions", [])
    if len(qs) >= QUESTION_LIMIT:
        return False, "問題板已經滿了"
    qs.append({"id": qid, "by": uid, "nickname": nickname or "", "text": text, "solved": False, "at_ms": now_ms})
    return True, ""


def toggle_question(room: dict, qid: str) -> Tuple[bool, str]:
    for q in room.get("questions") or []:
        if q.get("id") == qid:
            q["solved"] = not q.get("solved")
            return True, ""
    return False, "找不到這個問題"


def question_stats(room: dict) -> Optional[dict]:
    if room.get("context") not in STUDY_CONTEXTS:
        return None
    qs = room.get("questions") or []
    return {"total": len(qs), "solved": sum(1 for q in qs if q.get("solved"))}
