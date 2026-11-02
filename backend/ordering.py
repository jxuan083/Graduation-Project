"""掃碼點餐的「帶出 App」規則（純函式，無 I/O，可單元測試）。

一般聚會、家庭聚會、吃飯聚餐可以用 App 的「點餐」按鈕掃 QR Code：
  - 點餐網頁開在 App 內建的瀏覽器裡，只能在那家的點餐網站裡走動。人沒有離開 App，
    所以不算分心、不計時、不限次數（吃到飽一直加點也可以）。
  - 被點餐網站帶出 App（外部網頁用 Safari 開、LINE 點餐、付款 App）時才需要向後端登記一次
    「帶出」：每場最多 ORDER_TRIP_LIMIT 次；每次 ORDER_TRIP_SEC 內離開 App 不算分心，
    回到 App 就結束；第 ORDER_REMIND_SEC 秒前端會通知「還在點餐嗎？」。
    時間過了還沒回來，就照一般規則開始算分心。
成員資料（room["members"][uid]）上的欄位：
  order_trips_used、order_window_until_ms（帶出中的到期時間，0 = 沒有）、
  order_away_since_ms（帶出期間離開 App 的時間點，結算時補算超時用）。
"""
from typing import Tuple

ORDER_CONTEXTS = {"general", "family", "meal"}
ORDER_TRIP_LIMIT = 2
ORDER_TRIP_SEC = 15 * 60
ORDER_REMIND_SEC = 10 * 60


def ordering_enabled(context: str) -> bool:
    return (context or "general") in ORDER_CONTEXTS


def trips_left(member: dict) -> int:
    return max(0, ORDER_TRIP_LIMIT - int((member or {}).get("order_trips_used", 0) or 0))


def within_order_trip(member: dict, now_ms: int) -> bool:
    until = int((member or {}).get("order_window_until_ms", 0) or 0)
    return bool(until) and now_ms < until


def start_order_trip(member: dict, context: str, now_ms: int) -> Tuple[bool, str, int]:
    """登記一次「帶出 App 點餐」。回傳 (ok, reason, 到期時間)。

    已經在帶出中（例如付款頁又跳去另一個 App）就沿用同一次，不另外扣次數。
    """
    if not ordering_enabled(context):
        return False, "這個情境沒有點餐功能", 0
    if within_order_trip(member, now_ms):
        return True, "", int(member["order_window_until_ms"])
    if trips_left(member) <= 0:
        return False, "這場可以離開 App 點餐的次數用完了", 0
    member["order_trips_used"] = int(member.get("order_trips_used", 0) or 0) + 1
    member["order_window_until_ms"] = now_ms + ORDER_TRIP_SEC * 1000
    member["order_away_since_ms"] = 0
    return True, "", member["order_window_until_ms"]


def note_hidden(member: dict, now_ms: int) -> None:
    """帶出期間離開 App：記下離開的時間點（結算時若一直沒回來，用來補算超時）。"""
    if within_order_trip(member, now_ms) and not member.get("order_away_since_ms"):
        member["order_away_since_ms"] = now_ms


def end_order_trip(member: dict) -> None:
    """回到 App（或離開聚會）：這次帶出結束。"""
    if member is None:
        return
    member["order_window_until_ms"] = 0
    member["order_away_since_ms"] = 0


def overage_deviations(member: dict, now_ms: int, per_dev_sec: int) -> int:
    """結算時補算：帶出後一直沒回到 App、已經超過時間 → 超過的部分換算成分心次數。"""
    until = int((member or {}).get("order_window_until_ms", 0) or 0)
    if not until or not member.get("order_away_since_ms") or now_ms <= until:
        return 0
    return int(((now_ms - until) / 1000.0) // max(1.0, float(per_dev_sec)))
