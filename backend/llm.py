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

    # 參與者：只給暱稱、角色、分數、發言次數與 uid（供 spotlights 對應）
    people_lines = []
    for p in context.get("participation") or []:
        people_lines.append(
            f'- uid={p.get("uid")}｜暱稱={p.get("nickname")}｜角色={p.get("role")}｜'
            f'參與度={p.get("participation_score")}｜發言次數={p.get("utterance_count")}'
        )

    # 精選逐字稿片段（已由呼叫端挑選並清理過）
    quote_lines = []
    for q in context.get("key_points") or []:
        speaker = q.get("speaker") or ""
        text = q.get("text") or ""
        quote_lines.append(f"- {speaker}：{text}" if speaker else f"- {text}")

    uids = [p.get("uid") for p in (context.get("participation") or [])]

    return f"""這是一場聚會的資料，請據此撰寫回顧報。

【基本資訊】
- 聚會模式：{mode}
- 參與人數：{member_count}
- 持續時間：約 {duration} 分鐘
- 照片數量：{photo_count}
- 熱門話題（詞頻）：{"、".join(topics) if topics else "（無）"}

【參與者】
{chr(10).join(people_lines) if people_lines else "（無參與者資料）"}

【對話片段】
{chr(10).join(quote_lines) if quote_lines else "（本場沒有逐字稿）"}

請只輸出以下 JSON 結構（繁體中文）：
{{
  "title": "有創意的報紙主標題（8~16字）",
  "subtitle": "副標題（一句話）",
  "lead": "導語，2~3 句話總結這場聚會的氛圍與重點",
  "highlights": ["2~4 條本場亮點或趣味小報導，每條一句話"],
  "spotlights": {{ {", ".join(f'"{u}": "這位成員的花絮一句話"' for u in uids) if uids else '"": ""'} }}
}}

注意：spotlights 的 key 必須是上面提供的 uid，value 是替該成員寫的一句花絮。"""


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
