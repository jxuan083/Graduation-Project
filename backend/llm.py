"""llm.py — Qwen (阿里雲 DashScope 國際站) 文案生成封裝。

用途：把「聚會 newspaper」裡需要創意的文案部分（標題／導語／亮點／每位成員花絮）
交給 Qwen 生成。統計數據（參與度分數、次數）仍由 main.py 的規則算，這裡不碰。

設計原則：
  - 純函式、無副作用，可在沒有 Firebase 的情況下獨立測試。
  - 任何失敗（沒 key / 套件缺失 / 逾時 / 回傳非 JSON）都回傳 None，
    由呼叫端 fallback 回原本的規則版 newspaper，絕不讓功能開天窗。
"""

import os
import re
import json

# DashScope 國際站的 OpenAI 相容端點
DASHSCOPE_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
QWEN_MODEL = "qwen-plus"
REQUEST_TIMEOUT_SEC = 25.0

# 從檔案抓 key 的正則（key 檔案是帶花括號的類 JSON，直接抓 sk- token 最穩健）
_SK_PATTERN = re.compile(r"sk-[A-Za-z0-9_\-]+")


def _load_api_key() -> str | None:
    """取得 DashScope API key。

    優先序：
      1. 環境變數 DASHSCOPE_API_KEY（正式環境 / Cloud Run 用這個）
      2. 專案根目錄或 backend/ 下的 qwenAPIKey 檔案（本地開發用，已被 gitignore）
    """
    env_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("QWEN_API_KEY")
    if env_key and env_key.strip():
        return env_key.strip()

    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "qwenAPIKey"),
        os.path.join(here, "..", "qwenAPIKey"),
    ]
    for path in candidates:
        try:
            with open(path, encoding="utf-8-sig") as f:
                raw = f.read()
        except (FileNotFoundError, OSError):
            continue
        m = _SK_PATTERN.search(raw)
        if m:
            return m.group(0)
    return None


def is_available() -> bool:
    """是否具備呼叫 Qwen 的條件（有 key 且 openai 套件可 import）。"""
    if not _load_api_key():
        return False
    try:
        import openai  # noqa: F401
    except ImportError:
        return False
    return True


def _extract_json(text: str) -> dict | None:
    """從模型回覆中健壯地取出 JSON 物件（容忍前後多餘文字 / code fence）。"""
    if not text:
        return None
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


# ── 聚會回顧報紙：兩個 prompt ──
# Prompt A 寫大標題（兩行），Prompt B 寫兩欄內文。兩個同時呼叫。
# 數字由程式算好放進「聚會資料」，AI 只能照抄；產生後再檢查一次，出現資料以外的數字就不用（改用規則版）。

NEWSPAPER_TIMEOUT_SEC = 25.0
TRANSCRIPT_MAX_CHARS = 3500
TRANSCRIPT_RICH_CHARS = 300      # 逐字稿超過這麼多字，內文就以聊天內容為主

HEADLINE_SYSTEM_PROMPT = """你是聚會回顧報紙《THE GATHERING POST》的標題編輯。根據聚會資料，替這場聚會下一個兩行的頭版大標題。

規則：
1. 繁體中文，兩行，每行 4～10 個字。第二行要補充或呼應第一行，兩行合起來像一句報紙頭條。
2. 從資料裡挑這場最有特色的一點來寫：例如人很少或很多、全場零分心、專注很久、聊天的主題、聚會情境。有逐字稿時優先用聊天主題。
3. 語氣溫暖、有畫面感，可以俏皮，但不要浮誇、不要說教。
4. 數字可以寫成中文（例如「五分鐘」），但必須跟資料完全一樣；不要寫出資料裡沒有的數字、人名、地點、事件。
5. 不要用「聚會圓滿落幕」這類空泛的句子；不要用驚嘆號、引號、emoji，行尾不加標點。
6. 只輸出 JSON：{"line1": "第一行", "line2": "第二行"}

範例（一個人、5 分鐘、0 次分心）：{"line1": "一個人的五分鐘", "line2": "零分心的專注時光"}"""

ARTICLE_SYSTEM_PROMPT = """你是聚會回顧報紙《THE GATHERING POST》的記者。這份報紙是給參加的人留作回憶的，請根據聚會資料寫一篇頭版短報導。

規則：
1. 繁體中文，第三人稱、報紙新聞的口吻，溫暖、可以帶一點幽默。分段寫，每段 2～4 句。
2. 第一段用「【本報訊】」開頭，簡單交代這是什麼情境的聚會、幾個人、多長時間（用阿拉伯數字，例如「4 人」「95 分鐘」）。
3. 依照【寫作重點】決定聊天內容的篇幅：
   - 逐字稿充足：內文以「大家聊了什麼」為主，寫 2～3 段。整理出主要的話題、有趣或難忘的片段、大家提到的計畫或約定、當下的氣氛，讓大家之後重讀時能想起那天。用轉述的方式寫，最多可以引用一句很短的原話（15 字以內）。逐字稿是語音辨識出來的，可能有錯字，看不懂的句子就跳過，不要硬寫。
   - 逐字稿不多：聊天內容用一兩句帶過。
   - 沒有逐字稿：不寫聊天內容。
4. 專注的情形只寫一段，而且不寫任何數字，中文數字也不行（不寫幾次、幾分鐘，也不要提最長連續專注有多長）。根據資料給評價：沒有分心的人可以說他全程投入、參與度很高；全場都沒分心就肯定大家把時間留給了彼此；有人分心也只用輕鬆的口吻帶過，不點名責備。參加時間很短的人不要評價他專不專心。
5. 最後一段收尾，例如期待下一次相聚。
6. 不要寫到群組寵物（系統會自己加在第一段）。
7. 不要提到錄音、逐字稿、資料、系統這些字眼；不要寫任何時間點或時段（例如昨天、今晚、近日、週末、幾月幾日、早餐、午餐、晚餐、宵夜）。
8. 數字只能出現在兩個地方：第一段的人數與時長，以及轉述逐字稿裡本來就有的數字（例如「練了兩個月」）。不要自己算平均、比例或任何新數字。
9. 只能提到資料裡出現的人名。這是大家的回憶，寫錯比少寫更糟：具體的事情（誰說了什麼、做了什麼、決定了什麼、吃了什麼）都必須在逐字稿裡找得到，不要自己加情節，例如鼓掌、取名字、誰的動作或表情；可以形容氣氛。逐字稿沒有標出是誰說的：除非句子本身就點名（例如「小美你最近在學吉他嗎」），否則不要寫是誰說的、誰做的。地名只能用逐字稿裡出現過的。
10. 全文 150～450 字。只輸出 JSON：{"paragraphs": ["第一段", "第二段", "第三段"]}"""


def _transcript_excerpt(lines: list) -> str:
    """逐字稿依時間串起來；太長時平均抽樣，讓頭中尾都留到。"""
    lines = [str(t).strip() for t in lines if str(t or "").strip()]
    text = "\n".join(lines)
    if len(text) <= TRANSCRIPT_MAX_CHARS:
        return text
    keep, picked, total = [], 0, len(lines)
    step = max(1, round(len(text) / TRANSCRIPT_MAX_CHARS))
    for i in range(0, total, step):
        if picked + len(lines[i]) > TRANSCRIPT_MAX_CHARS:
            break
        keep.append(lines[i])
        picked += len(lines[i]) + 1
    return "\n".join(keep)


def _attendance_word(minutes: int, duration: int) -> str:
    if duration <= 0 or minutes * 10 >= duration * 9:
        return "全程參加"
    return "參加了大部分時間" if minutes * 2 >= duration else "參加時間短"


def _distraction_word(deviations) -> str:
    if deviations is None:
        return "不計分"
    return "沒有分心" if deviations == 0 else "偶爾分心" if deviations <= 2 else "分心次數較多"


def build_article_facts_text(facts: dict) -> str:
    """Prompt B 用的資料：專注情形只給描述、不給數字（內文只評價，數字在報紙下方的數據區）；
    也不給寵物名字（寵物那句由程式固定加在第一段）。"""
    duration = int(facts.get("duration_minutes") or 0)
    dev, longest = int(facts.get("total_deviations") or 0), facts.get("longest_focus_minutes")
    if dev == 0:
        overall = "全場沒有人分心"
    elif longest is not None and duration and longest * 2 >= duration:
        overall = "有少數幾次分心，但大部分時間大家都很專注"
    else:
        overall = "偶爾有人被手機分心，專注的時間比較零碎"
    focused = facts.get("most_focused") or []
    focused_text = "（沒有特別突出的人，不要提）"
    if focused:
        focused_text = "、".join(focused) + ("（全程沒有分心）" if facts.get("most_focused_deviations") == 0 else "（分心最少）")
    member_lines = [f"- {m['name']}：{_attendance_word(int(m['attended_minutes'] or 0), duration)}，{_distraction_word(m.get('deviations'))}"
                    for m in facts.get("members") or []]
    return f"""【寫作重點】{_writing_focus(facts)}

【聚會資料】
- 情境：{facts.get("context_label") or "聚會"}
- 總時長：{duration} 分鐘
- 參加人數：{facts.get("member_count", 0)} 人
- 專注情形：{overall}
- 最專注：{focused_text}

【出席名單】
{chr(10).join(member_lines) if member_lines else "（無）"}

【逐字稿】（依時間排序，不含講者）
{_transcript_excerpt(facts.get("transcript_lines") or []) or "（這場沒有開錄音，沒有逐字稿）"}"""


def _writing_focus(facts: dict) -> str:
    transcript = _transcript_excerpt(facts.get("transcript_lines") or [])
    if len(transcript) >= TRANSCRIPT_RICH_CHARS:
        return "逐字稿充足：內文以大家聊了什麼為主，專注情形用一段帶過。"
    if transcript:
        return "逐字稿不多：聊天內容用一兩句帶過。"
    return "沒有逐字稿：不寫聊天內容。"


def build_newspaper_facts_text(facts: dict) -> str:
    """Prompt A（大標題）用的聚會資料：完整數字。"""
    members = facts.get("members") or []
    member_lines = []
    for m in members:
        dev = "（不計分）" if m.get("deviations") is None else f"，分心 {m['deviations']} 次"
        member_lines.append(f"- {m['name']}：參加 {m['attended_minutes']} 分鐘{dev}")
    longest = facts.get("longest_focus_minutes")
    focused = facts.get("most_focused") or []
    transcript = _transcript_excerpt(facts.get("transcript_lines") or [])
    return f"""【寫作重點】{_writing_focus(facts)}

【聚會資料】
- 情境：{facts.get("context_label") or "聚會"}
- 總時長：{facts.get("duration_minutes", 0)} 分鐘
- 參加人數：{facts.get("member_count", 0)} 人
- 全場分心：{facts.get("total_deviations", 0)} 次
- 最長連續專注（整場沒有任何人分心最久的一段）：{f"{longest} 分鐘" if longest is not None else "（沒有資料，不要提）"}
- 最專注：{("、".join(focused) + f"（分心 {facts.get('most_focused_deviations', 0)} 次）") if focused else "（沒有資料，不要提）"}
- 群組寵物：{facts.get("pet_name") or "（沒有）"}
- 現場照片：{facts.get("photo_count", 0)} 張

【出席名單】
{chr(10).join(member_lines) if member_lines else "（無）"}

【逐字稿】（依時間排序，不含講者）
{transcript if transcript else "（這場沒有開錄音，沒有逐字稿；只根據上面的數據寫）"}"""


_CN_DIGITS = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
# 「下一次」「這一次」「第一次」之類是說法不是數量，前面是這些字就不算
_CN_NUMBER_RE = re.compile(r"(?<![下這那每第上同])([零〇一二兩三四五六七八九十百]+)(?=\s*(?:分鐘|小時|個人|人|位|名|次|張|分心))")


def _cn_to_int(text: str) -> int | None:
    total, current = 0, 0
    for ch in text:
        if ch in _CN_DIGITS:
            current = _CN_DIGITS[ch]
        elif ch == "十":
            total += (current or 1) * 10
            current = 0
        elif ch == "百":
            total += (current or 1) * 100
            current = 0
        else:
            return None
    return total + current


def numbers_in_text(text: str) -> set:
    """文字裡出現的數字：阿拉伯數字，以及後面接單位（分鐘、人、次…）的中文數字。"""
    found = {int(n) for n in re.findall(r"\d+", text or "")}
    for m in _CN_NUMBER_RE.finditer(text or ""):
        value = _cn_to_int(m.group(1))
        if value is not None:
            found.add(value)
    return found


def allowed_numbers(facts: dict) -> set:
    nums = {facts.get("duration_minutes"), facts.get("member_count"), facts.get("total_deviations"),
            facts.get("longest_focus_minutes"), facts.get("photo_count"), facts.get("most_focused_deviations")}
    for m in facts.get("members") or []:
        nums.update({m.get("attended_minutes"), m.get("deviations")})
    if facts.get("member_count") == 1:
        nums.add(1)          # 「一個人」
    nums.update(numbers_in_text("\n".join(str(t) for t in facts.get("transcript_lines") or [])))   # 轉述聊天內容裡本來就有的數字
    return {int(n) for n in nums if n is not None}


def clean_headline(parsed, facts: dict) -> list | None:
    if not isinstance(parsed, dict):
        return None
    lines = [re.sub(r"[「」『』\"'！!。．.，,]+", "", str(parsed.get(k) or "")).strip() for k in ("line1", "line2")]
    if not all(2 <= len(line) <= 14 for line in lines):
        return None
    if not numbers_in_text("".join(lines)) <= allowed_numbers(facts):
        return None
    return lines


def clean_article(parsed, facts: dict) -> list | None:
    if not isinstance(parsed, dict) or not isinstance(parsed.get("paragraphs"), list):
        return None
    paragraphs = [str(p).strip() for p in parsed["paragraphs"] if str(p or "").strip()]
    if not 2 <= len(paragraphs) <= 6:
        return None
    total = sum(len(p) for p in paragraphs)
    if not 100 <= total <= 700:
        return None
    if not numbers_in_text("".join(paragraphs)) <= allowed_numbers(facts):
        return None
    transcript_numbers = numbers_in_text("\n".join(str(t) for t in facts.get("transcript_lines") or []))
    if not numbers_in_text("".join(paragraphs[1:])) <= transcript_numbers:
        return None          # 專注情形只給評價：分心次數、分鐘數只能出現在第一段（人數、時長）
    if not paragraphs[0].startswith("【本報訊】"):
        paragraphs[0] = "【本報訊】" + paragraphs[0]
    return with_pet_sentence(paragraphs, facts.get("pet_name"))


def with_pet_sentence(paragraphs: list, pet_name: str | None) -> list:
    """群組寵物固定一句、接在第一段句尾。AI 若還是寫了寵物，那幾句先拿掉，避免重複或單獨成段。"""
    if pet_name:
        cleaned = []
        for p in paragraphs:
            kept = "".join(x for x in re.split(r"(?<=[。！？])", p) if x and pet_name not in x and "見證了整場聚會" not in x)
            if kept.strip():
                cleaned.append(kept.strip())
        paragraphs = cleaned or paragraphs
        paragraphs[0] = paragraphs[0] + f"群組寵物「{pet_name}」見證了整場聚會。"
    return paragraphs


def _chat_json(system_prompt: str, user_prompt: str, temperature: float = 0.8) -> dict | None:
    api_key = _load_api_key()
    if not api_key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        client = OpenAI(api_key=api_key, base_url=DASHSCOPE_BASE_URL, timeout=NEWSPAPER_TIMEOUT_SEC)
        resp = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=temperature,
            response_format={"type": "json_object"},
        )
        return _extract_json(resp.choices[0].message.content)
    except Exception as e:  # noqa: BLE001 — 任何 API 錯誤都退回規則版
        print(f"[llm] 報紙文案生成失敗，改用規則版：{e}")
        return None


NEWSPAPER_ATTEMPTS = 2   # 沒通過檢查就重寫一次，還是不行才用規則版


def _generate_checked(system_prompt: str, facts: dict, temperature: float, clean, build_text=None):
    user = (build_text or build_newspaper_facts_text)(facts)
    for _ in range(NEWSPAPER_ATTEMPTS):
        parsed = _chat_json(system_prompt, user, temperature)
        if parsed is None and not _load_api_key():
            return None
        result = clean(parsed, facts)
        if result:
            return result
    return None


def generate_newspaper_headline(facts: dict) -> list | None:
    """Prompt A：兩行大標題。失敗或沒通過檢查回傳 None。"""
    return _generate_checked(HEADLINE_SYSTEM_PROMPT, facts, 0.9, clean_headline)


def generate_newspaper_article(facts: dict) -> list | None:
    """Prompt B：報導內文（段落 list）。失敗或沒通過檢查回傳 None。"""
    return _generate_checked(ARTICLE_SYSTEM_PROMPT, facts, 0.8, clean_article, build_article_facts_text)


# ── 結算頁的寵物文字：依分心次數、在場時間說明這場的表現 ──

SUMMARY_TIMEOUT_SEC = 8.0
SUMMARY_MAX_CHARS = {"zh": 80, "en": 220}   # 英文一句話的字元數比中文多很多

SUMMARY_SYSTEM_PROMPT_ZH = """你是「社交定錨」App 裡的寵物吉祥物。聚會剛結束，請用一句話告訴這位使用者這場的表現。
規則：
1. 繁體中文，30～45 個字，語氣溫暖像朋友，不說教、不用命令口吻，最多一個 emoji。
2. 只能根據下面的數據，不要編造沒提供的事情。
3. 先判斷分數高低的主要原因再寫（85 分以上算高分）：
   - 分心次數多：點出分心，鼓勵下次把手機放遠一點。
   - 分心很少（0～1 次）但分數不高：原因是參與時間短（陪伴分低），要稱讚專注，並說明時間短，不能說他分心。
   - 比整場晚到或早退：提到在場時間比較短。
   - 分數高：直接稱讚。高分但分心較多時，先稱讚，再輕輕提一下分心。
4. 你是寵物本人在說話，一律用「我」自稱（例如「我今天吃得很飽」），不要提寵物的名字，也不要說「吉祥物」。
5. 不要寫出分數數字（畫面上已經有），可以提分心次數或分鐘數。
6. 只輸出那一句話，不要加引號或任何說明。
7. 下面的範例只是語氣參考，不要照抄，要依這次的數據寫。

範例：
- 3 分鐘、0 次分心 → 這場雖然很短，你一次都沒分心！下次多待一會兒，我會長得更快。
- 90 分鐘、6 次分心 → 這場分心了 6 次，我有點餓肚子，下次把手機蓋久一點吧。
- 90 分鐘、0 次分心 → 整整 90 分鐘都沒分心，我今天吃得超飽！🎉"""

SUMMARY_SYSTEM_PROMPT_EN = """You are the pet mascot in the "Phubbing Anchor" app. A gathering just ended. In one sentence, tell this user how they did.
Rules:
1. English, 12-25 words, warm and friendly like a buddy, never preachy or bossy, at most one emoji.
2. Use only the data below. Do not invent anything that isn't given.
3. First work out the main reason the score is high or low (85 or above is a high score):
   - Many distractions: mention the distractions and encourage keeping the phone further away next time.
   - Few distractions (0-1) but a low score: the reason is the short time (low presence score). Praise the focus and explain it was short. Never say they were distracted.
   - Arrived late or left early: mention their time there was shorter.
   - High score: just praise them. If the score is high but there were several distractions, praise first, then gently mention the distractions.
4. You are the pet speaking, so always refer to yourself as "I" (e.g. "I'm well fed today"). Never use the pet's name or the word "mascot".
5. Do not state the score (it's already on screen). You may mention the distraction count or minutes.
6. Output only that one sentence, with no quotes or explanation.
7. The examples below only show the tone. Don't copy them; write from this gathering's data.

Examples:
- 3 minutes, 0 distractions -> Short one, but you didn't get distracted once! Stay a bit longer next time and I'll grow even faster.
- 90 minutes, 6 distractions -> 6 distractions this time, so I'm a little hungry. Maybe keep the phone face down a bit longer next time.
- 90 minutes, 0 distractions -> A full 90 minutes without a single distraction, and I'm stuffed! 🎉"""


def build_summary_prompt(data: dict, lang: str = "zh") -> str:
    """把結算數據組成給 Qwen 的輸入（純函式，可單元測試）。"""
    minutes = int(data.get("attended_minutes") or 0)
    total = int(data.get("duration_minutes") or 0)
    devs = int(data.get("deviations") or 0)
    grace = int(data.get("grace_sec") or 20)
    score = int(data.get("score") or 0)
    focus, presence = round(float(data.get("focus") or 0)), round(float(data.get("presence") or 0))
    fw, pw = round(float(data.get("focus_weight") or 0) * 100), round(float(data.get("presence_weight") or 0) * 100)
    host = bool(data.get("is_host"))
    # 結算以分鐘為單位，不到 1 分鐘會是 0；直接寫「0 分鐘」模型會以為他沒到場
    mins_zh = f"{minutes} 分鐘" if minutes > 0 else "不到 1 分鐘"
    total_zh = f"{total} 分鐘" if total > 0 else "不到 1 分鐘"
    mins_en = f"{minutes} min" if minutes > 0 else "under 1 min"
    total_en = f"{total} min" if total > 0 else "under 1 min"
    if lang == "en":
        return "\n".join([
            f"Gathering type: {data.get('context_label_en') or data.get('context') or 'gathering'}",
            f"Time there: {mins_en} (whole gathering {total_en})",
            f"Distractions: {devs} (each time they left the app for more than {grace} seconds)",
            f"Score: {score} / 100",
            f"Score breakdown: focus {focus} ({fw}%), presence {presence} ({pw}%, full marks after 60 minutes)",
            f"Host: {'yes' if host else 'no'}",
        ])
    return "\n".join([
        f"情境：{data.get('context_label') or data.get('context') or '聚會'}",
        f"在場時間：{mins_zh}（整場 {total_zh}）",
        f"分心次數：{devs} 次（離開 App 超過 {grace} 秒算一次）",
        f"分數：{score} / 100",
        f"分數組成：專注 {focus} 分（占 {fw}%）、陪伴 {presence} 分（占 {pw}%，待滿 60 分鐘才拿滿）",
        f"是否為主持人：{'是' if host else '否'}",
    ])


def clean_summary_message(text, lang: str = "zh") -> str | None:
    """模型回覆 → 一行乾淨的句子；不合格（空的、太長、像 JSON）回傳 None，由前端用規則版。"""
    if not isinstance(text, str):
        return None
    line = " ".join(text.strip().split())
    line = line.strip("「」『』\"'“”‘’ ")
    if not line or len(line) > SUMMARY_MAX_CHARS.get(lang, 80) or line.startswith(("{", "[")):
        return None
    return line


def generate_summary_message(data: dict, lang: str = "zh") -> str | None:
    """呼叫 Qwen 寫結算頁的寵物文字；任何失敗都回傳 None（前端保留規則版）。"""
    api_key = _load_api_key()
    if not api_key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        client = OpenAI(api_key=api_key, base_url=DASHSCOPE_BASE_URL, timeout=SUMMARY_TIMEOUT_SEC)
        resp = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[
                {"role": "system", "content": SUMMARY_SYSTEM_PROMPT_EN if lang == "en" else SUMMARY_SYSTEM_PROMPT_ZH},
                {"role": "user", "content": build_summary_prompt(data, lang)},
            ],
            temperature=0.8,
            max_tokens=120,
        )
        return clean_summary_message(resp.choices[0].message.content, lang)
    except Exception as e:  # noqa: BLE001 — 任何 API 錯誤都退回規則版
        print(f"[llm] 結算文字生成失敗，前端用規則版：{e}")
        return None
