"""個人離開／加回、主持人交棒、暫離超時的純規則（無 I/O，可單元測試）。

聚會進行中，成員可以先走（其他人繼續），之後也能加回來。規則：
  1. 在場時間分段記：進入 ACTIVE／加回時開一段，離開／聚會結束時關一段。離開期間
     不算在場、也不算分心；分數用「自己的在場分鐘數」與「自己的累計分心」算。
  2. 加回每場最多 REJOIN_LIMIT 次。加回後畫面上的分心計數從 0 開始，但
     all_participants 內的累計分心保留（離開前的扣分不會被洗掉）。
     已用暫離次數、冷卻、已計的不專注秒數都跟著成員資料延續。
  3. 連續專注每段各自起算（離開會結束目前這段），最後取各段最長。
  4. 暫離窗口到期仍未回 App：未滿 AUTO_LEAVE_AFTER_SEC 照舊補記超時分心；
     滿了就視為「窗口到期那一刻離開」，不再無上限補記。可延長一次，延長的時間
     一律算「在場不專注」。
  5. 建立者（host_uid）不變；主持人（acting_host_uid）只在一種情況換人：主持人自己
     按「離開聚會」。這時自動交給「目前連續專注最久」的在場成員，一樣久就隨機挑。
     沒有手動指派，也不因斷線換人（鎖螢幕專心時 WebSocket 本來就會斷）。

成員即時狀態放 room["members"][uid]；跨重連要保留的累計資料放
room["all_participants"][uid]。main.py 只負責把 WS／HTTP 訊號接到這些純函式並做 I/O。
"""
import random
from typing import List, Optional, Tuple

from intent import charge_on_return, overage_deviations

REJOIN_LIMIT = 2                # 每場最多加回幾次
AUTO_LEAVE_AFTER_SEC = 300      # 暫離窗口到期後多久沒回 App → 自動視為離開

STATE_LEFT = "LEFT"
STATE_DISCONNECTED = "DISCONNECTED"


def acting_host(room: dict) -> Optional[str]:
    """目前的主持人（可開遊戲／切模式／結束全場）；沒交棒過就是建立者。"""
    return room.get("acting_host_uid") or room.get("host_uid")


def is_present(member: Optional[dict]) -> bool:
    return bool(member) and member.get("state") != STATE_LEFT


def present_uids(room: dict) -> List[str]:
    return [uid for uid, m in (room.get("members") or {}).items() if is_present(m)]


def rejoins_left(room: dict, uid: str) -> int:
    ap = (room.get("all_participants") or {}).get(uid) or {}
    return max(0, REJOIN_LIMIT - int(ap.get("rejoin_count", 0) or 0))


# ── 在場分段 ──
def _open_segment(ap: dict, now_ms: int) -> None:
    ap["presence"] = "in"
    ap["ever_active"] = True
    ap["seg_start_ms"] = now_ms
    ap["focus_last_ts_ms"] = now_ms   # 連續專注從這段開頭重新起算


def _close_segment(ap: dict, at_ms: int) -> None:
    start = int(ap.get("seg_start_ms") or 0)
    if not start:
        return
    at = max(int(at_ms), start)
    ap["attended_ms"] = int(ap.get("attended_ms", 0) or 0) + (at - start)
    last = int(ap.get("focus_last_ts_ms") or start)
    gap_sec = max(0.0, (at - last) / 1000.0)
    ap["focus_streak_max_sec"] = max(float(ap.get("focus_streak_max_sec", 0.0) or 0.0), gap_sec)
    ap["seg_start_ms"] = 0


def start_active(room: dict, now_ms: int) -> None:
    """定錨完成、聚會正式開始：記下開始時間，幫每個在場成員開第一段。"""
    room["active_started_ms"] = now_ms
    all_part = room.setdefault("all_participants", {})
    for uid, m in (room.get("members") or {}).items():
        if not is_present(m):
            continue
        ap = all_part.setdefault(uid, {"nickname": m.get("nickname", ""), "deviations": 0})
        _open_segment(ap, now_ms)


# ── 進房：新加入／重連／加回 ──
def admit(room: dict, uid: str, nickname: str, now_ms: int) -> Tuple[str, str]:
    """WebSocket 連線進房。回傳 (kind, reason)，kind 為 new／reconnect／rejoin／rejected。

    重連一律保留既有成員資料（分心、暫離次數、冷卻、不專注秒數），只更新連線狀態。
    """
    members = room.setdefault("members", {})
    all_part = room.setdefault("all_participants", {})
    existing = dict(members.get(uid) or {})
    ap = all_part.get(uid)
    status = room.get("status", "WAITING")
    name = existing.get("nickname") or (ap or {}).get("nickname") or nickname

    kind = "reconnect"
    if ap is None:
        kind = "new"
        ap = {"deviations": 0, "first_join_ms": now_ms}
        all_part[uid] = ap
    elif status == "ACTIVE" and (ap.get("presence") == "left" or existing.get("state") == STATE_LEFT):
        used = int(ap.get("rejoin_count", 0) or 0)
        if used >= REJOIN_LIMIT:
            return "rejected", "這場聚會的加回次數已用完"
        kind = "rejoin"
        ap["rejoin_count"] = used + 1
        ap.pop("left_at_ms", None)
        ap.pop("leave_reason", None)
        existing.pop("left_at_ms", None)
        existing["deviations"] = 0   # 畫面上的分心從 0 重新開始；累計在 all_participants
        _open_segment(ap, now_ms)

    # 聚會進行中才進來（中途加入，或等候室斷線後才回來）→ 從現在開始算在場
    if status == "ACTIVE" and ap.get("presence") != "left" and not ap.get("seg_start_ms") \
            and not ap.get("ever_active"):
        _open_segment(ap, now_ms)

    ap["nickname"] = name
    existing.update({"progress": 0, "state": "CONNECTED", "nickname": name})
    members[uid] = existing
    return kind, ""


def mark_disconnected(room: dict, uid: str) -> None:
    """連線斷了（鎖螢幕專心也會斷）：仍算在場，只是標記離線；已離開的人不動。"""
    m = (room.get("members") or {}).get(uid)
    if not m or m.get("state") == STATE_LEFT:
        return
    m["state"] = STATE_DISCONNECTED


# ── 分心與連續專注 ──
def note_focus_break(room: dict, uid: str, now_ms: int) -> None:
    """發生一次真正分心 → 結束目前這段連續專注，更新最長專注秒數。"""
    ap = (room.get("all_participants") or {}).get(uid)
    if ap is None:
        return
    start_ms = int(ap.get("focus_last_ts_ms") or ap.get("seg_start_ms")
                   or room.get("active_started_ms") or room.get("started_at") or now_ms)
    gap_sec = max(0.0, (now_ms - start_ms) / 1000.0)
    ap["focus_streak_max_sec"] = max(float(ap.get("focus_streak_max_sec", 0.0) or 0.0), gap_sec)
    ap["focus_last_ts_ms"] = now_ms


def record_deviation(room: dict, uid: str, count: int, now_ms: int) -> Tuple[int, int]:
    """記 count 次分心。回傳 (這一段的分心, 全場總分心)。

    members[uid].deviations 是畫面用的「這一段」計數（加回後歸零）；
    all_participants[uid].deviations 是計分用的累計，兩者分開加。
    """
    count = max(1, int(count))
    m = room["members"][uid]
    m["deviations"] = int(m.get("deviations", 0) or 0) + count
    room["deviations"] = int(room.get("deviations", 0) or 0) + count
    ap = (room.get("all_participants") or {}).get(uid)
    if ap is not None:
        ap["deviations"] = int(ap.get("deviations", 0) or 0) + count
    note_focus_break(room, uid, now_ms)
    return m["deviations"], room["deviations"]


# ── 暫離窗口：結算、延長、超時 ──
def settle_exemption(room: dict, uid: str, at_ms: int, window_sec: int) -> float:
    """暫離結束（回到 App 或離開聚會）：結算『在場不專注』秒數並清掉窗口。

    原窗口沿用 charge_on_return（第 1 次全免、第 2 次起計實際離開時間）；
    延長的那一截不論第幾次都計。回傳這次計入的秒數。
    """
    m = (room.get("members") or {}).get(uid)
    if m is None:
        return 0.0
    active_since = int(m.get("exempt_active_since_ms", 0) or 0)
    charged = 0.0
    if active_since:
        until = int(m.get("exempt_window_until_ms", 0) or 0)
        ext_from = int(m.get("exempt_ext_from_ms", 0) or 0)
        used = int(m.get("exempt_count_used", 0) or 0)
        base_end = min(at_ms, ext_from) if ext_from else at_ms
        charged = charge_on_return(active_since, base_end, window_sec, used)
        if ext_from:
            ext_end = min(at_ms, until) if until else at_ms
            charged += max(0.0, (ext_end - max(ext_from, active_since)) / 1000.0)
        if charged > 0:
            total = float(m.get("exempt_charged_sec", 0.0) or 0.0) + charged
            m["exempt_charged_sec"] = total
            m.setdefault("quality_metrics", {})["exempt_charged_seconds"] = total
            ap = (room.get("all_participants") or {}).get(uid)
            if ap is not None:
                qm = ap.get("quality_metrics")
                if not isinstance(qm, dict):
                    qm = {}
                    ap["quality_metrics"] = qm
                qm["exempt_charged_seconds"] = total
    m["exempt_active_since_ms"] = 0
    m["exempt_window_until_ms"] = 0
    m["exempt_ext_from_ms"] = 0
    return charged


def extend_exemption(room: dict, uid: str, now_ms: int, window_sec: int) -> Tuple[bool, str, int]:
    """暫離延長一次：從原到期時間再加一個窗口。回傳 (ok, reason, 新的到期時間)。"""
    m = (room.get("members") or {}).get(uid)
    if not is_present(m) or room.get("status") != "ACTIVE":
        return False, "你不在這場聚會中", 0
    until = int(m.get("exempt_window_until_ms", 0) or 0)
    if not until or not m.get("exempt_active_since_ms"):
        return False, "目前沒有進行中的暫離", 0
    if m.get("exempt_ext_from_ms"):
        return False, "這次暫離已經延長過了", 0
    if now_ms >= until + AUTO_LEAVE_AFTER_SEC * 1000:
        return False, "暫離已超時太久", 0
    m["exempt_ext_from_ms"] = until
    m["exempt_window_until_ms"] = until + int(window_sec) * 1000
    return True, "", m["exempt_window_until_ms"]


def leave_time(room: dict, uid: str, now_ms: int, from_timeout: bool = False) -> int:
    """離開的時間點：一般是現在；暫離超時後才按離開，算在窗口到期那一刻。"""
    m = (room.get("members") or {}).get(uid) or {}
    until = int(m.get("exempt_window_until_ms", 0) or 0)
    if from_timeout and m.get("exempt_active_since_ms") and until and now_ms > until:
        return until
    return now_ms


def leave(room: dict, uid: str, at_ms: int, reason: str, window_sec: int) -> bool:
    """成員離開進行中的聚會：結算暫離、關掉在場段與連續專注、標記已離開。"""
    m = (room.get("members") or {}).get(uid)
    if room.get("status") != "ACTIVE" or not is_present(m):
        return False
    settle_exemption(room, uid, at_ms, window_sec)
    ap = room.setdefault("all_participants", {}).setdefault(
        uid, {"nickname": m.get("nickname", ""), "deviations": int(m.get("deviations", 0) or 0)})
    _close_segment(ap, at_ms)
    ap["presence"] = "left"
    ap["left_at_ms"] = at_ms
    ap["leave_reason"] = reason
    m["state"] = STATE_LEFT
    m["left_at_ms"] = at_ms
    return True


def overdue_exemptions(room: dict, now_ms: int) -> List[Tuple[str, int]]:
    """暫離到期後滿 AUTO_LEAVE_AFTER_SEC 仍未回 App 的在場成員：[(uid, 窗口到期時間)]。"""
    if room.get("status") != "ACTIVE":
        return []
    overdue = []
    for uid, m in (room.get("members") or {}).items():
        if not is_present(m) or not m.get("exempt_active_since_ms"):
            continue
        until = int(m.get("exempt_window_until_ms", 0) or 0)
        if until and now_ms >= until + AUTO_LEAVE_AFTER_SEC * 1000:
            overdue.append((uid, until))
    return overdue


def apply_exempt_timeouts(room: dict, now_ms: int, window_sec: int) -> List[str]:
    """把 overdue_exemptions 的成員標記為「窗口到期那一刻離開」。回傳被離開的 uid。"""
    return [uid for uid, until in overdue_exemptions(room, now_ms)
            if leave(room, uid, until, "exempt_timeout", window_sec)]


def apply_intent_overage(room: dict, now_ms: int) -> None:
    """結算時補算：宣告暫離後還沒回來、窗口已過（但未滿自動離開門檻）的超時 → 補記分心。"""
    params = room.get("session_params", {}) or {}
    per_dev_sec = int(params.get("deviation_rate_limit_sec", 25) or 25)
    all_part = room.get("all_participants", {}) or {}
    for uid, m in (room.get("members") or {}).items():
        if not is_present(m) or not m.get("exempt_active_since_ms"):
            continue
        add = overage_deviations(int(m.get("exempt_window_until_ms", 0) or 0), now_ms, per_dev_sec)
        if add <= 0:
            continue
        m["deviations"] = int(m.get("deviations", 0) or 0) + add
        room["deviations"] = int(room.get("deviations", 0) or 0) + add
        if uid in all_part:
            all_part[uid]["deviations"] = int(all_part[uid].get("deviations", 0) or 0) + add


# ── 主持人 ──
def current_focus_ms(room: dict, uid: str, now_ms: int) -> int:
    """這個人到現在為止已經連續專注多久（上次分心／這段在場開始算起）。"""
    ap = (room.get("all_participants") or {}).get(uid) or {}
    start = int(ap.get("focus_last_ts_ms") or ap.get("seg_start_ms")
                or room.get("active_started_ms") or now_ms)
    return max(0, now_ms - start)


def pick_successor(room: dict, exclude_uid: Optional[str], now_ms: int, rng=random) -> Optional[str]:
    """主持人離開時自動挑接手的人：目前連續專注最久的在場成員；一樣久就隨機挑一個。"""
    candidates = [uid for uid in present_uids(room) if uid != exclude_uid]
    if not candidates:
        return None
    focus = {uid: current_focus_ms(room, uid, now_ms) for uid in candidates}
    longest = max(focus.values())
    top = [uid for uid in candidates if focus[uid] == longest]
    return top[0] if len(top) == 1 else rng.choice(top)


# ── 結算 ──
def _attended_minutes(ap: dict) -> int:
    return int(round(int(ap.get("attended_ms", 0) or 0) / 60000.0))


def _write_streak_metric(ap: dict) -> None:
    qm = ap.get("quality_metrics")
    if not isinstance(qm, dict):
        qm = {}
        ap["quality_metrics"] = qm
    qm["focus_streak_seconds"] = float(ap.get("focus_streak_max_sec", 0.0) or 0.0)


def settle_participant(room: dict, uid: str) -> dict:
    """離開當下的個人結算資料（已離開者的在場段已關）。回傳該成員的 all_participants 資料。"""
    ap = (room.get("all_participants") or {}).get(uid) or {}
    ap["attended_minutes"] = _attended_minutes(ap)
    _write_streak_metric(ap)
    return ap


def settle_room(room: dict, end_ms: int, window_sec: int, fallback_minutes: int = 0) -> int:
    """聚會結束結算：處理暫離超時、關掉在場者的在場段、寫每人的在場分鐘與連續專注。

    回傳整場分鐘數。沒有 active_started_ms（舊房間／記憶體遺失後從 Firestore 還原）
    時退回用前端傳來的 fallback_minutes，且每個人都用同一個時長（舊行為）。
    """
    apply_exempt_timeouts(room, end_ms, window_sec)
    apply_intent_overage(room, end_ms)
    all_part = room.get("all_participants") or {}
    started = int(room.get("active_started_ms") or 0)
    if not started:
        fallback_start = int(room.get("started_at") or 0)
        for ap in all_part.values():
            start_ms = int(ap.get("focus_last_ts_ms") or fallback_start or end_ms)
            gap_sec = max(0.0, (end_ms - start_ms) / 1000.0)
            ap["focus_streak_max_sec"] = max(float(ap.get("focus_streak_max_sec", 0.0) or 0.0), gap_sec)
            _write_streak_metric(ap)
        return max(0, int(fallback_minutes or 0))

    # 全員都已離開 → 聚會結束時間算在最後一個人離開那一刻
    if not present_uids(room):
        last_left = [int(ap.get("left_at_ms", 0) or 0) for ap in all_part.values()]
        if last_left and max(last_left) > 0:
            end_ms = min(end_ms, max(last_left))
    for ap in all_part.values():
        if ap.get("presence") != "left":
            _close_segment(ap, end_ms)
        ap["attended_minutes"] = _attended_minutes(ap)
        _write_streak_metric(ap)
    return max(0, int(round((end_ms - started) / 60000.0)))


def scored_participants(room: dict) -> dict:
    """要列入計分與排行的人：有真的進到聚會（開過在場段）的才算。

    舊房間沒有分段資料時維持舊行為（all_participants 全部列入）。
    """
    all_part = room.get("all_participants") or room.get("members") or {}
    if not room.get("active_started_ms"):
        return all_part
    return {uid: ap for uid, ap in all_part.items() if (ap or {}).get("ever_active")}
