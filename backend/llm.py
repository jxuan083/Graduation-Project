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


SYSTEM_PROMPT = (
    "你是一位替朋友聚會撰寫「聚會回顧報」的中文編輯。"
    "根據提供的聚會統計與對話片段，寫出生動、溫暖、有畫面感的繁體中文文案。"
    "只描述資料中出現的內容，不要杜撰不存在的人名、地點或事件。"
    "嚴格只輸出一個 JSON 物件，不要有任何額外說明或 markdown。"
)


def _build_user_prompt(context: dict) -> str:
    """把規則算好的資料組成給 Qwen 的輸入。"""
    mode = context.get("mode") or "聚會"
    member_count = context.get("member_count") or 0
    duration = context.get("duration_minutes") or 0
    topics = context.get("topics") or []
    photo_count = context.get("photo_count") or 0

    # 精選逐字稿片段：只提供對話內容，不提供講者，讓 AI 以整體聚會為單位分析。
    quote_lines = []
    for q in context.get("key_points") or []:
        text = q.get("text") or ""
        if text:
            quote_lines.append(f"- {text}")

    return f"""這是一場聚會的資料，請據此撰寫回顧報。

【基本資訊】
- 聚會模式：{mode}
- 參與人數：{member_count}
- 持續時間：約 {duration} 分鐘
- 照片數量：{photo_count}
- 熱門話題（詞頻）：{"、".join(topics) if topics else "（無）"}

【整體對話內容】
{chr(10).join(quote_lines) if quote_lines else "（本場沒有逐字稿）"}

請只輸出以下 JSON 結構（繁體中文）：
{{
  "title": "有創意的報紙主標題（8~16字）",
  "subtitle": "副標題（一句話）",
  "lead": "導語，2~3 句話總結這場聚會的氛圍與重點",
  "highlights": ["2~4 條整體聚會亮點，每條一句話"]
}}

注意：請總結整場聚會在聊什麼、氣氛如何、留下哪些共同記憶；不要寫成逐字稿，不要指出是誰說了哪句話。"""


def generate_newspaper_copy(context: dict) -> dict | None:
    """呼叫 Qwen 生成 newspaper 文案。

    回傳 dict（含 title/subtitle/lead/highlights/spotlights）或 None（失敗）。
    呼叫端負責在 None 時 fallback。
    """
    api_key = _load_api_key()
    if not api_key:
        return None

    try:
        from openai import OpenAI
    except ImportError:
        return None

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=DASHSCOPE_BASE_URL,
            timeout=REQUEST_TIMEOUT_SEC,
        )
        resp = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(context)},
            ],
            temperature=0.8,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
    except Exception as e:  # noqa: BLE001 — 任何 API 錯誤都退回 fallback
        print(f"[llm] Qwen 生成失敗，將 fallback：{e}")
        return None

    parsed = _extract_json(content)
    if not isinstance(parsed, dict):
        print("[llm] Qwen 回傳無法解析為 JSON，將 fallback")
        return None

    # 基本清洗，確保型別正確
    out: dict = {}
    if isinstance(parsed.get("title"), str) and parsed["title"].strip():
        out["title"] = parsed["title"].strip()[:40]
    if isinstance(parsed.get("subtitle"), str) and parsed["subtitle"].strip():
        out["subtitle"] = parsed["subtitle"].strip()[:60]
    if isinstance(parsed.get("lead"), str) and parsed["lead"].strip():
        out["lead"] = parsed["lead"].strip()[:400]
    if isinstance(parsed.get("highlights"), list):
        out["highlights"] = [
            str(h).strip()[:120] for h in parsed["highlights"] if str(h).strip()
        ][:5]
    if isinstance(parsed.get("spotlights"), dict):
        out["spotlights"] = {
            str(k): str(v).strip()[:200]
            for k, v in parsed["spotlights"].items()
            if str(v).strip()
        }

    # 至少要有 lead 才算成功，否則 fallback
    if not out.get("lead"):
        return None
    return out


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
