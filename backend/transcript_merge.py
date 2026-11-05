"""聚會逐字稿：多支手機同時錄音時的時間對齊與去重複（純規則，無 I/O，可單元測試）。

一場聚會可能有好幾個人同時錄音，而且每支手機本身會存兩種逐字稿：
  - audio：每 8 秒一段錄音丟給 Whisper 轉的正式逐字稿
  - manual：瀏覽器即時預覽（SpeechRecognition）確認的文字
同一句話因此可能被存好幾次。原始資料全部保留，讀取（生成報紙、看逐字稿）時才合併：

時間對齊（存檔時）：
  每段都換成「伺服器時間」abs_ms，再換成「聚會開始後第幾毫秒」started_at_ms，
  不同手機才排得在同一條時間軸上。手機送來的時間不合理（時鐘壞掉、竄改）就不對齊，當舊資料處理。
說話者（存檔時）：
  Whisper 的說話者標籤（SPEAKER_00…）只在那一段錄音裡有意義，A 手機的 Speaker 1 跟 B 手機的
  Speaker 1 不是同一個人，所以 speaker_uid 前面加上錄音者 uid，名稱寫成「小明的錄音」。
去重複（讀取時）：
  只比較「不同來源」（不同手機，或同一支手機的 audio 與 manual）且時間相近的兩句：
  內容相同或一句包含另一句（≥ 80%）就算同一句，留比較完整的那句（一樣長時留 Whisper 的）。
  同一個來源內不去重複（同一個人本來就可能重複講一樣的話）。
  沒有 abs_ms 的舊資料不參與比對，原樣保留。
"""
import difflib
import unicodedata
from typing import List, Optional

# 兩句的時間區間相距多少以內算「同一時間」（即時預覽的時間是講完的那一刻，Whisper 是開始講的時間）
NEAR_MS = 6_000
# 很短的句子（「好」「對啊」）比較容易巧合，要內容完全一樣、時間更近才合併
SHORT_CHARS = 4
SHORT_NEAR_MS = 3_000
# 一句有多少比例出現在另一句裡就算同一句
CONTAIN_RATIO = 0.8
# 手機送來的時間最多可以差多少（超過就不信任，不對齊）
CLOCK_SLACK_MS = 60_000
# 往回找可能重複的句子時，最多看多久以前（避免整場兩兩比對）
LOOKBACK_MS = 120_000


# ── 存檔時：時間對齊與說話者 ──

def plausible_abs_ms(abs_ms, active_started_ms: int, now_ms: int) -> Optional[int]:
    """手機送來的伺服器時間合理才採用：不早於聚會開始前一分鐘、不晚於現在一分鐘後。"""
    try:
        abs_ms = int(abs_ms)
    except (TypeError, ValueError):
        return None
    if abs_ms <= 0 or abs_ms > now_ms + CLOCK_SLACK_MS:
        return None
    if active_started_ms and abs_ms < active_started_ms - CLOCK_SLACK_MS:
        return None
    return abs_ms


def align_entry(entry: dict, abs_ms: Optional[int], active_started_ms: int) -> None:
    """把一句逐字稿標上 abs_ms（伺服器時間）與 started_at_ms（聚會開始後第幾毫秒）。
    abs_ms 為 None（舊版前端、時間不合理）時不動，維持原本「錄音開始後第幾毫秒」的意思。"""
    if abs_ms is None:
        return
    entry["abs_ms"] = int(abs_ms)
    if active_started_ms:
        entry["started_at_ms"] = max(0, int(abs_ms) - int(active_started_ms))
    else:
        entry["started_at_ms"] = int(abs_ms)


def recorder_speaker(recorder_uid: str, recorder_name: str, raw_speaker: str, label: str, diarized: bool) -> dict:
    """Whisper 說話者 → 以錄音者區分的說話者。沒有分辨說話者時，整段都算「小明的錄音」。"""
    name = (recorder_name or "").strip() or "成員"
    return {
        "speaker_uid": f"{recorder_uid}:{raw_speaker}",
        "speaker_name": f"{name}的錄音 · {label}" if diarized else f"{name}的錄音",
    }


# ── 讀取時：去重複 ──

def normalize(text: str) -> str:
    """比對用：去掉空白、標點、符號，英文轉小寫。"""
    return "".join(
        ch for ch in (text or "").lower()
        if not ch.isspace() and unicodedata.category(ch)[0] not in ("P", "S")
    )


def contain_ratio(a: str, b: str) -> float:
    """短的那句有多少比例出現在長的那句裡（照順序比對）。"""
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if not short:
        return 0.0
    blocks = difflib.SequenceMatcher(None, short, long_, autojunk=False).get_matching_blocks()
    return sum(bl.size for bl in blocks) / len(short)


def _span(e: dict):
    start = int(e["abs_ms"])
    return start, start + int(float(e.get("duration_sec") or 0) * 1000)


def _gap_ms(a: dict, b: dict) -> int:
    (a0, a1), (b0, b1) = _span(a), _span(b)
    return max(0, max(a0, b0) - min(a1, b1))


def _stream(e: dict):
    return (e.get("created_by") or "", e.get("source") or "")


def is_duplicate(a: dict, b: dict) -> bool:
    if _stream(a) == _stream(b):
        return False
    na, nb = normalize(a.get("text")), normalize(b.get("text"))
    if not na or not nb:
        return False
    gap = _gap_ms(a, b)
    if min(len(na), len(nb)) < SHORT_CHARS:
        return na == nb and gap <= SHORT_NEAR_MS
    return gap <= NEAR_MS and contain_ratio(na, nb) >= CONTAIN_RATIO


def _better(a: dict, b: dict) -> bool:
    """a 是否比 b 適合留下：內容比較完整的；一樣長時留 Whisper（audio）的。"""
    la, lb = len(normalize(a.get("text"))), len(normalize(b.get("text")))
    if la != lb:
        return la > lb
    return a.get("source") == "audio" and b.get("source") != "audio"


def _sort_key(e: dict):
    return (int(e.get("started_at_ms") or 0), str(e.get("id") or ""))


def merge(entries: List[dict]) -> List[dict]:
    """多個來源的逐字稿合併成一份：去掉重複的句子，依時間排序。不修改傳進來的資料。"""
    aligned = sorted((e for e in entries if e.get("abs_ms")), key=lambda e: (int(e["abs_ms"]), str(e.get("id") or "")))
    legacy = [e for e in entries if not e.get("abs_ms")]
    kept: List[dict] = []
    for e in aligned:
        start = int(e["abs_ms"])
        dups = []
        for k in reversed(kept):
            if int(k["abs_ms"]) < start - LOOKBACK_MS:
                break
            if is_duplicate(k, e):
                dups.append(k)
        if any(_better(k, e) or not _better(e, k) for k in dups):
            continue   # 已經有一樣完整（或更完整）的同一句
        for k in dups:
            kept.remove(k)   # 這句比之前留下的更完整，換掉
        kept.append(e)   # aligned 已照時間排序，kept 也就一直是排好的
    return sorted(kept + legacy, key=_sort_key)
