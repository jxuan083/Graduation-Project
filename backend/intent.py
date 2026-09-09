"""意圖豁免的純規則（無 I/O，可單元測試）。

使用者在聚會中「宣告意圖」（之後前端一顆按鈕）→ 換到一段放寬窗口，期間離開 App
不算分心。防濫用靠三層疊加，而不是偵測說謊（App 本來就看不到你在別的 app 做什麼）：
  1. 次數預算：每情境限定可宣告幾次（上課/會議=0 不開放）。
  2. 冷卻：兩次宣告之間要等一段時間。
  3. 漸進成本：第 1 次全免；第 2 次起，實際離開的時間算「在場不專注」，等比例削 focus。

窗口長度依難度（嚴格→短）；次數預算依情境（正式→少）。回到 App 專注時窗口立刻
結束，只結算「實際離開」的時間（見 charge_on_return），不會預先扣滿或繼續累計。
main.py 只負責把 WS 訊號與 member 狀態接到這些純函式。
"""

# 每次宣告的窗口長度（秒），依難度：3 / 2 / 1 分
EXEMPT_WINDOW_SEC = {"L": 180, "M": 120, "H": 60}
# 每場可宣告次數（預算），依情境；0 = 不開放暫離
EXEMPT_BUDGET_BY_CONTEXT = {
    "general": 2, "meeting": 0, "family": 3, "study": 2, "class": 0,
    "meal": 3, "date": 1, "celebration": 3, "workshop": 2, "team": 2, "custom": 2,
}
EXEMPT_COOLDOWN_SEC = 90


def exempt_window_sec(difficulty: str) -> int:
    return EXEMPT_WINDOW_SEC.get((difficulty or "M").upper(), 120)


def exempt_budget(context: str) -> int:
    return EXEMPT_BUDGET_BY_CONTEXT.get(context or "general", 2)


def exemption_info(context: str, difficulty: str) -> dict:
    """給前端「開始前顯示」用的摘要（數值，不含評分方式）。"""
    budget = exempt_budget(context)
    return {
        "budget": budget,
        "window_sec": exempt_window_sec(difficulty),
        "cooldown_sec": EXEMPT_COOLDOWN_SEC,
        "enabled": budget > 0,
    }


def can_declare_intent(used_count: int, last_declared_ms: int, now_ms: int,
                       budget: int, cooldown_sec: int = EXEMPT_COOLDOWN_SEC):
    """能不能現在宣告意圖？回傳 (ok: bool, reason: str)。"""
    if budget <= 0:
        return False, "此情境不開放暫離"
    if used_count >= budget:
        return False, "暫離次數已用完"
    if last_declared_ms and now_ms - last_declared_ms < cooldown_sec * 1000:
        return False, "暫離冷卻中，請稍候"
    return True, ""


def within_exemption(window_until_ms: int, now_ms: int) -> bool:
    """現在是否仍在某次宣告的放寬窗口內（窗口內離開 → 不計分心）。"""
    return bool(window_until_ms) and now_ms < window_until_ms


def overage_deviations(window_until_ms: int, now_ms: int, per_dev_sec: int) -> int:
    """END_SESSION 補算：宣告意圖後一去不回、窗口已過的超時，換算成應補記的分心次數。

    只在「宣告後離開、直到聚會結束都沒回來」時用（回來的情況由正常分心邏輯處理）。
    per_dev_sec 用難度的 deviation_rate_limit_sec，即「多少秒算一次分心」。
    """
    if not window_until_ms or now_ms <= window_until_ms:
        return 0
    over_sec = (now_ms - window_until_ms) / 1000.0
    return int(over_sec // max(1.0, float(per_dev_sec)))


def charge_on_return(active_since_ms: int, now_ms: int, window_sec: int, used_count: int) -> float:
    """回到 App 專注時，這次要記多少『在場不專注』秒數。

    第 1 次宣告全免（回傳 0）；第 2 次起，計入實際離開時間，但上限為窗口長度
    （超過窗口的部分已由正常分心邏輯處理，不重複計）。
    """
    if not active_since_ms or now_ms <= active_since_ms:
        return 0.0
    away_sec = min((now_ms - active_since_ms) / 1000.0, float(window_sec))
    if used_count <= 1:
        return 0.0
    return away_sec
