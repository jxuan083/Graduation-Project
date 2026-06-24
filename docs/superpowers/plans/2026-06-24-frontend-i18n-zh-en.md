# 前端中英切換（i18n）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 `frontend/` SPA 加入「中 / EN」語言切換，預設繁中、可一鍵切英文並記住選擇。

**Architecture:** 方案A——以「繁中原字串為 key」的字典 + DOM 走訪翻譯器 + MutationObserver。純邏輯抽到無瀏覽器相依的 `i18n-core.js`（可 Node 單元測試）；DOM 引擎在 `i18n.js`；資料在 `i18n-dict.js`。預設 `zh` 時完全不動 DOM（零行為改變）。

**Tech Stack:** Vanilla ES Modules、瀏覽器原生 `MutationObserver` / `TreeWalker`、Node v24 內建 `node --test`（零外部依賴）。

## Global Constraints

- 不導入任何第三方 i18n 函式庫或 npm 執行期依賴。
- 翻譯範圍僅「固定 UI 文言」；**不**翻譯使用者輸入或後端回傳的資料內容（題目本文、Taboo 語句、AI 摘要等）。
- 預設語言 `zh`；切換值持久化於 `localStorage('phubbing_lang')`。
- 字典 key 一律是程式碼中出現的**繁中原字串**（含標點，需逐字相符）；含變數者以 `{name}` 佔位。
- 翻譯文字節點時保留外圍空白，只置換 `trim()` 後的核心字串。
- 翻譯根範圍為 `#app-container`（涵蓋 `#auth-bar`、`#app`、`#app-footer`、`#toast-container`、resume 按鈕）；**排除** `#lang-toggle` 自身。
- 英文用詞由實作者決定（按鈕用簡短祈使句、句首大寫；專有名詞 Phubbing Anchor 不譯）。
- 測試檔放 repo 根 `tests/`（不在 `frontend/` 內，避免被 Firebase hosting 部署）。

---

## File Structure

| 檔案 | 動作 | 責任 |
|------|------|------|
| `package.json`（repo 根） | Create | `{"type":"module"}` + `test` script，讓 Node 以 ESM 跑測試 |
| `tests/i18n-core.test.js` | Create | `i18n-core.js` 純函式單元測試 |
| `frontend/core/i18n-core.js` | Create | 純邏輯：`interpolate`、`translate`（無 DOM/localStorage） |
| `frontend/core/i18n-dict.js` | Create | 字典資料 `dict.en = { 繁中: english }` |
| `frontend/core/i18n.js` | Create | DOM 引擎：`initI18n/setLang/getLang/t/applyTo` + Observer + toggle 綁定 |
| `frontend/core/state.js` | Modify | 新增 `lang` 欄位 |
| `frontend/index.html` | Modify | `#auth-bar` 內加入 `#lang-toggle` 標記 |
| `frontend/styles/components.css` | Modify | `.lang-toggle` 樣式 |
| `frontend/main.js` | Modify | boot 流程呼叫 `initI18n()` |
| Phase 2：多個 view/feature `*.js` | Modify | 以 `t()` 包變數樣板與 `alert/confirm` |

> 註：設計文件原列 `i18n.js + i18n-dict.js`；此計畫額外抽出 `i18n-core.js` 以隔離純邏輯、便於單元測試，符合 spec「單一職責」精神。翻譯根由 spec 的 `#app` 擴大為 `#app-container`，因 `#auth-bar` 文字（「使用 Google 登入」等）在 `#app` 之外仍需翻譯。

---

## Task 1: 測試骨架 + 純邏輯核心 `i18n-core.js`（TDD）

**Files:**
- Create: `package.json`
- Create: `frontend/core/i18n-core.js`
- Test: `tests/i18n-core.test.js`

**Interfaces:**
- Produces:
  - `interpolate(template: string, params?: object) => string`
  - `translate(dict: {en: object}, lang: 'zh'|'en', zhKey: string, params?: object) => string`

- [ ] **Step 1: 建立 repo 根 `package.json`**

```json
{
  "name": "graduation-project",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: 寫失敗測試 `tests/i18n-core.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, translate } from '../frontend/core/i18n-core.js';

test('interpolate fills placeholders', () => {
  assert.equal(interpolate('你好 {name}', { name: 'A' }), '你好 A');
});

test('interpolate keeps unknown placeholders', () => {
  assert.equal(interpolate('x {a} {b}', { a: 1 }), 'x 1 {b}');
});

test('interpolate with no params returns template unchanged', () => {
  assert.equal(interpolate('plain text'), 'plain text');
});

const dict = {
  en: {
    '聚會時間': 'Meeting Time',
    '加入群組「{name}」（{count} 位成員）？': 'Join group "{name}" ({count} members)?',
  },
};

test('translate en: hit returns english', () => {
  assert.equal(translate(dict, 'en', '聚會時間'), 'Meeting Time');
});

test('translate en: miss falls back to zh key', () => {
  assert.equal(translate(dict, 'en', '未知字串'), '未知字串');
});

test('translate zh: returns zh with params filled', () => {
  assert.equal(
    translate(dict, 'zh', '加入群組「{name}」（{count} 位成員）？', { name: '甲', count: 3 }),
    '加入群組「甲」（3 位成員）？'
  );
});

test('translate en: with params', () => {
  assert.equal(
    translate(dict, 'en', '加入群組「{name}」（{count} 位成員）？', { name: 'X', count: 2 }),
    'Join group "X" (2 members)?'
  );
});
```

- [ ] **Step 3: 執行測試確認失敗**

Run: `node --test tests/i18n-core.test.js`
Expected: FAIL — 無法解析 `../frontend/core/i18n-core.js`（模組不存在）。

- [ ] **Step 4: 實作 `frontend/core/i18n-core.js`**

```js
// frontend/core/i18n-core.js
// 純函式：不依賴 DOM / localStorage，可於 Node 下單元測試。

/** 將 "你好 {name}" + {name:'A'} → "你好 A"；缺少的參數保留原樣 {key}。 */
export function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (m, k) =>
    (k in params && params[k] != null) ? String(params[k]) : m
  );
}

/**
 * 查字典翻譯。
 * @param {{en: Object<string,string>}} dict
 * @param {'zh'|'en'} lang
 * @param {string} zhKey 繁中原字串（呼叫端應已 trim）
 * @param {object} [params]
 * @returns {string} en 命中→英文；否則回填變數後的繁中原字串
 */
export function translate(dict, lang, zhKey, params) {
  if (lang === 'en' && dict && dict.en &&
      Object.prototype.hasOwnProperty.call(dict.en, zhKey)) {
    return interpolate(dict.en[zhKey], params);
  }
  return interpolate(zhKey, params);
}
```

- [ ] **Step 5: 執行測試確認通過**

Run: `node --test tests/i18n-core.test.js`
Expected: PASS（7 個測試全綠）。

- [ ] **Step 6: Commit**

```bash
git add package.json frontend/core/i18n-core.js tests/i18n-core.test.js
git commit -m "feat(i18n): add pure translate/interpolate core with unit tests"
```

---

## Task 2: 字典 `i18n-dict.js`（資料 + 健全性測試）

**Files:**
- Create: `frontend/core/i18n-dict.js`
- Test: `tests/i18n-dict.test.js`

**Interfaces:**
- Produces: `dict` — `{ en: Object<string,string> }`，key = 繁中原字串，value = 英文。

**字典產生程序（在實作此 task 時執行）：**

1. 用以下指令列出所有 view HTML 的繁中文字節點候選（去重）：
   ```bash
   cd frontend
   grep -rhoP '(?<=>)[^<>{}]*[一-鿿][^<>{}]*(?=<)' views index.html | sed 's/^ *//;s/ *$//' | sort -u
   ```
2. 列出 `placeholder/title/alt/aria-label` 屬性中的繁中：
   ```bash
   grep -rhoP '(placeholder|title|alt|aria-label)="[^"]*[一-鿿][^"]*"' views index.html | sort -u
   ```
3. 列出 JS 中**靜態**繁中字串（單/雙引號、無 `${}`）作為補充：
   ```bash
   grep -rhoP "'[^'\\\$]*[一-鿿][^']*'|\"[^\"\\\$]*[一-鿿][^\"]*\"" views features core utils | sort -u
   ```
4. 對每個唯一繁中字串給英文翻譯，依「翻譯規則」。含變數的樣板（Task 5/6 會用到）一併以 `{name}` 佔位形式加入。

**翻譯規則：**
- 按鈕/動作：簡短祈使句、句首大寫，例「發起聚會」→ `Start a Gathering`、「查看」→ `View`、「登出」→ `Log out`。
- 標題/區塊名：名詞片語，例「聚會時間」→ `Meeting Time`、「題庫管理」→ `Question Bank`。
- 專有名詞不譯：`Phubbing Anchor`、`Google`、`QR Code`、`Taboo`。
- 標點：中文全形（「」、（）、？）在英文值改用半形對應（"", ()、?）。
- 保留前後空白由引擎處理；字典 key/value 不含外圍空白。

- [ ] **Step 1: 建立 `frontend/core/i18n-dict.js` 並填入種子條目**

> 種子為已確認頁面（auth-bar / home / footer）的真實字串；其餘依上方程序補齊。

```js
// frontend/core/i18n-dict.js
// 字典：key = 程式碼中的繁中原字串（逐字相符，含標點）；value = 英文。
// 含變數者以 {name} 佔位（供 i18n.js 的 t() 使用）。
export const dict = {
  en: {
    // --- auth-bar (index.html) ---
    '使用 Google 登入': 'Sign in with Google',
    '關於': 'About',
    '個人資料': 'Profile',
    '好友': 'Friends',
    '排行榜': 'Leaderboard',
    '登出': 'Log out',
    '返回聚會': 'Back to gathering',

    // --- home ---
    '聚會時間': 'Meeting Time',
    '放下手機，圍著火光好好聊': 'Put down your phone and chat by the fire',
    '發起聚會': 'Start a Gathering',
    '※ 發起聚會需要先登入 Google 帳號': '※ Sign in with Google to start a gathering',
    '掃描 QR Code 加入': 'Scan QR Code to join',
    '群組管理': 'Manage Groups',
    '管理你的群組': 'Manage your groups',
    '聚會紀錄': 'Meeting History',
    '查看過去聚會': 'View past meetings',
    '題庫管理': 'Question Bank',
    '自訂問答題目': 'Customize Q&A questions',
    '查看本週排名': 'See this week’s ranking',
    '我的寵物': 'My Pet',
    '陪伴你的小可愛': 'Keep your buddy company',
    '等朋友一起聚會': 'Waiting for friends to gather',
    '也可以直接用手機相機掃 QR Code 加入': 'You can also join by scanning the QR code with your phone camera',
    '查看': 'View',

    // --- 變數樣板（Phase 2 會以 t() 使用）---
    '加入群組「{name}」（{count} 位成員）？': 'Join group "{name}" ({count} members)?',
    '你已經是「{name}」的成員了！': 'You are already a member of "{name}"!',
    '目前已有 {count} 人加入，確定取消聚會嗎？': '{count} people have joined. Cancel the gathering?',

    // … 其餘條目依「字典產生程序」補齊 …
  },
};
```

- [ ] **Step 2: 依程序補齊其餘條目**

執行「字典產生程序」的 4 條指令，將所有唯一繁中字串補入 `dict.en`，套用翻譯規則。完成後人工巡視一遍確保無漏譯、無重複 key。

- [ ] **Step 3: 寫健全性測試 `tests/i18n-dict.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dict } from '../frontend/core/i18n-dict.js';

test('dict has en table', () => {
  assert.ok(dict && typeof dict.en === 'object');
});

test('all values are non-empty strings', () => {
  for (const [k, v] of Object.entries(dict.en)) {
    assert.equal(typeof v, 'string', `value for "${k}" not a string`);
    assert.ok(v.trim().length > 0, `value for "${k}" is empty`);
  }
});

test('no key has leading/trailing whitespace', () => {
  for (const k of Object.keys(dict.en)) {
    assert.equal(k, k.trim(), `key "${k}" has outer whitespace`);
  }
});

test('placeholder parity: same {tokens} on both sides', () => {
  const tokens = (s) => (s.match(/\{(\w+)\}/g) || []).sort();
  for (const [k, v] of Object.entries(dict.en)) {
    assert.deepEqual(tokens(v), tokens(k), `token mismatch for "${k}"`);
  }
});

test('known seed entries present', () => {
  assert.equal(dict.en['聚會時間'], 'Meeting Time');
  assert.equal(dict.en['發起聚會'], 'Start a Gathering');
});
```

- [ ] **Step 4: 執行測試確認通過**

Run: `node --test tests/i18n-dict.test.js`
Expected: PASS。若 `placeholder parity` 失敗，表示某條變數樣板兩側 `{token}` 不一致，修正字典後重跑。

- [ ] **Step 5: Commit**

```bash
git add frontend/core/i18n-dict.js tests/i18n-dict.test.js
git commit -m "feat(i18n): add zh→en dictionary with sanity tests"
```

---

## Task 3: 切換 UI（state 欄位 + 標記 + 樣式）

**Files:**
- Modify: `frontend/core/state.js`
- Modify: `frontend/index.html`
- Modify: `frontend/styles/components.css`

**Interfaces:**
- Produces: DOM `#lang-toggle`（含兩顆 `.lang-btn[data-lang="zh"|"en"]`）；`state.lang` 初值。

- [ ] **Step 1: `state.js` 新增 `lang` 欄位**

在 `export const state = {` 物件內、`// === 使用者 ===` 區塊之前加入：

```js
    // === i18n ===
    lang: localStorage.getItem('phubbing_lang') === 'en' ? 'en' : 'zh',
```

- [ ] **Step 2: `index.html` 在 `#auth-bar` 內最前面加入 toggle**

將 `<header id="auth-bar">` 改為（在 `#auth-logged-out` 之前插入 `#lang-toggle`）：

```html
        <header id="auth-bar">
            <div id="lang-toggle" class="lang-toggle" role="group" aria-label="Language">
                <button type="button" data-lang="zh" class="lang-btn active">中</button>
                <button type="button" data-lang="en" class="lang-btn">EN</button>
            </div>
            <div id="auth-logged-out">
```

（其餘 auth-bar 內容不動。）

- [ ] **Step 3: `components.css` 末尾加入樣式**

```css
/* ===== 語言切換 toggle ===== */
.lang-toggle {
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  overflow: hidden;
  margin-right: 8px;
  flex: 0 0 auto;
}
.lang-toggle .lang-btn {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 4px 10px;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}
.lang-toggle .lang-btn.active {
  background: rgba(255, 255, 255, 0.9);
  color: #1a1a1a;
  opacity: 1;
  font-weight: 700;
}
```

- [ ] **Step 4: 手動驗證**

Run: `firebase emulators:start --only hosting`（或 `npx http-server frontend`）；開瀏覽器。
Expected: 載入後 `#auth-bar` 左側出現 `[ 中 | EN ]`，「中」為高亮 active；登入前後皆可見。點擊目前無作用（Task 4 才接行為）。

- [ ] **Step 5: Commit**

```bash
git add frontend/core/state.js frontend/index.html frontend/styles/components.css
git commit -m "feat(i18n): add language toggle UI in auth-bar"
```

---

## Task 4: DOM 引擎 `i18n.js` + 接入 boot

**Files:**
- Create: `frontend/core/i18n.js`
- Modify: `frontend/main.js`

**Interfaces:**
- Consumes: `state`（`state.lang`）、`dict`（`i18n-dict.js`）、`translate`（`i18n-core.js`）。
- Produces:
  - `initI18n(): void`
  - `setLang(lang: 'zh'|'en'): void`
  - `getLang(): 'zh'|'en'`
  - `t(zhKey: string, params?: object): string`
  - `applyTo(root: Element): void`

- [ ] **Step 1: 建立 `frontend/core/i18n.js`**

```js
// frontend/core/i18n.js — DOM 翻譯引擎（方案A）
import { state } from './state.js';
import { dict } from './i18n-dict.js';
import { translate } from './i18n-core.js';

const STORAGE_KEY = 'phubbing_lang';
const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
const SKIP_SELECTOR = '#lang-toggle';      // 不翻譯切換鈕自身（中 / EN）
const origText = new WeakMap();            // Text node -> 原始繁中
let observer = null;

export function getLang() {
  return state.lang === 'en' ? 'en' : 'zh';
}

export function t(zhKey, params) {
  return translate(dict, getLang(), String(zhKey).trim(), params);
}

function roots() {
  const el = document.getElementById('app-container');
  return el ? [el] : [];
}

function datasetKey(attr) {
  // 'aria-label' -> 'i18nOrigAriaLabel'
  const camel = attr.replace(/(^|-)(\w)/g, (m, _, c) => c.toUpperCase());
  return 'i18nOrig' + camel;
}

function translateTextNode(node, lang) {
  const parent = node.parentElement;
  if (!parent) return;
  const tag = parent.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE') return;
  if (parent.closest && parent.closest(SKIP_SELECTOR)) return;

  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;

  if (!origText.has(node)) origText.set(node, raw);
  const original = origText.get(node);
  const key = original.trim();

  if (lang === 'en') {
    const translated = translate(dict, 'en', key);
    if (translated !== key) node.nodeValue = original.replace(key, translated);
  } else if (node.nodeValue !== original) {
    node.nodeValue = original;
  }
}

function translateAttrs(el, lang) {
  if (el.closest && el.closest(SKIP_SELECTOR)) return;
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const dk = datasetKey(attr);
    if (el.dataset[dk] === undefined) el.dataset[dk] = el.getAttribute(attr);
    const original = el.dataset[dk] || '';
    const key = original.trim();
    if (!key) continue;
    if (lang === 'en') {
      const translated = translate(dict, 'en', key);
      if (translated !== key) el.setAttribute(attr, original.replace(key, translated));
    } else {
      el.setAttribute(attr, original);
    }
  }
}

function walk(root, lang) {
  if (root.nodeType === 1 && root.closest && root.closest(SKIP_SELECTOR)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  let n;
  while ((n = tw.nextNode())) texts.push(n);
  for (const tn of texts) translateTextNode(tn, lang);

  if (root.nodeType === 1) {
    const sel = ATTRS.map((a) => `[${a}]`).join(',');
    root.querySelectorAll(sel).forEach((el) => translateAttrs(el, lang));
    if (ATTRS.some((a) => root.hasAttribute(a))) translateAttrs(root, lang);
  }
}

export function applyTo(root) {
  if (root) walk(root, getLang());
}

function applyAll() {
  for (const r of roots()) walk(r, getLang());
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (getLang() !== 'en') return;   // zh 模式：DOM 本就是繁中，無需處理
    for (const m of mutations) {
      if (m.type === 'characterData') {
        translateTextNode(m.target, 'en');
      } else if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 3) translateTextNode(node, 'en');
          else if (node.nodeType === 1) walk(node, 'en');
        });
      }
    }
  });
  for (const r of roots()) {
    observer.observe(r, { childList: true, subtree: true, characterData: true });
  }
}

function updateToggleUI() {
  document.querySelectorAll('#lang-toggle .lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === getLang());
  });
}

function applyHtmlMeta() {
  document.documentElement.setAttribute('lang', getLang() === 'en' ? 'en' : 'zh-TW');
  document.title = getLang() === 'en' ? 'Phubbing Anchor' : '社交定錨 | Phubbing Anchor';
}

export function setLang(lang) {
  state.lang = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(STORAGE_KEY, state.lang); } catch (_) {}
  applyHtmlMeta();
  applyAll();
  updateToggleUI();
}

export function initI18n() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
  state.lang = saved === 'en' ? 'en' : 'zh';

  const toggle = document.getElementById('lang-toggle');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) setLang(btn.dataset.lang);
    });
  }

  startObserver();
  applyHtmlMeta();
  if (getLang() === 'en') applyAll();   // 還原時機由 setLang 處理；初始 zh 不動 DOM
  updateToggleUI();
}
```

- [ ] **Step 2: `main.js` 接入 `initI18n()`**

在 `main.js` 頂部 import 區加入：

```js
import { initI18n } from './core/i18n.js';
```

在 `boot()` 內，於 `if (window.lucide) window.lucide.createIcons();`（步驟 3）之後、`registerAllWsHandlers();`（步驟 4）之前加入：

```js
        // 3.5 初始化 i18n（HTML 已插入、icons 已建立後）
        initI18n();
```

- [ ] **Step 3: 純函式回歸測試（確認未破壞核心）**

Run: `node --test tests/`
Expected: PASS（Task 1、2 測試全綠；i18n.js 為 DOM 模組，不在 Node 測試範圍）。

- [ ] **Step 4: 手動瀏覽器驗證**

Run: `firebase emulators:start --only hosting`（或 `npx http-server frontend`）。
驗證項目：
1. 預設顯示繁中；點「EN」→ home 標題變 `Meeting Time`、按鈕變 `Start a Gathering`、auth-bar 變 `Sign in with Google`/`About`。
2. 點「中」→ 完整還原繁中。
3. 切到 EN 後重新整理 → 仍為 EN（localStorage 持久化）。
4. 切到 EN 後操作會動態插入文字的流程（例如開啟「群組管理」清單）→ 新插入的已知字串自動顯示英文（Observer 生效）。
5. Console 無錯誤。

Expected: 上述 1–5 全部符合。

- [ ] **Step 5: Commit**

```bash
git add frontend/core/i18n.js frontend/main.js
git commit -m "feat(i18n): add DOM translation engine and wire into boot"
```

---

## Task 5: Phase 2a — 以 `t()` 包「含變數樣板」（~37 處）

**Files:**
- Modify: 含變數中文樣板的 view/feature `*.js`（用下方指令列舉）
- Modify: `frontend/core/i18n-dict.js`（補對應變數樣板 key）

**Interfaces:**
- Consumes: `t(zhKey, params)`（Task 4）。

**列舉所有目標：**
```bash
cd frontend
grep -rnoP '`[^`]*\$\{[^`]*`' views features core | grep '[一-鿿]'
```

**轉換規則：** 把 `` `…${expr}…` ``（含中文、屬於 UI 文字者）改為 `t('…{token}…', { token: expr })`，並在 `i18n-dict.js` 補上該繁中樣板→英文。**HTML 片段樣板（含標籤）維持原樣不包**——其中的中文文字由 Observer 處理；僅包「整段是顯示文字」者。

- [ ] **Step 1: 逐一改寫（真實範例）**

`views/groups/groups.js:45`
```js
// before
const ok = confirm(`加入群組「${info.name}」（${info.member_count} 位成員）？`);
// after
const ok = confirm(t('加入群組「{name}」（{count} 位成員）？', { name: info.name, count: info.member_count }));
```

`views/groups/groups.js:41`
```js
// before
alert(`你已經是「${info.name}」的成員了！`);
// after
alert(t('你已經是「{name}」的成員了！', { name: info.name }));
```

`views/host-room/host-room.js:58`
```js
// before
const ok = confirm(`目前已有 ${memberCount} 人加入,確定取消聚會嗎?`);
// after
const ok = confirm(t('目前已有 {count} 人加入，確定取消聚會嗎？', { count: memberCount }));
```

`views/group-setup/group-setup.js:203`
```js
// before
showToast(`已選定：${target?.nickname || petTargetUid} 為群組寵物`);
// after
showToast(t('已選定：{name} 為群組寵物', { name: target?.nickname || petTargetUid }));
```

每個檔案頂部若尚未 import，加入：
```js
import { t } from '../../core/i18n.js';   // 路徑依檔案深度調整（features/* 用 '../../core/i18n.js'）
```

對 grep 列出的每一處，套用相同模式；HTML 片段樣板（如 `group-setup.js:165` 的 `<button …>移除</button>`）**跳過**（中文 `移除` 由字典+Observer 處理，只需確保 `移除` 在字典內）。

- [ ] **Step 2: 補字典**

把本 task 用到的每個繁中樣板 key 加入 `i18n-dict.js`（若 Task 2 未涵蓋），例如：
```js
    '已選定：{name} 為群組寵物': 'Selected {name} as the group pet',
```

- [ ] **Step 3: 字典健全性回歸**

Run: `node --test tests/i18n-dict.test.js`
Expected: PASS（特別是 placeholder parity——確認每個樣板兩側 `{token}` 一致）。

- [ ] **Step 4: 手動驗證**

EN 模式下觸發各確認框/toast（加入群組、取消聚會、選定寵物等），確認顯示英文且變數正確帶入。

- [ ] **Step 5: Commit**

```bash
git add frontend/views frontend/features frontend/core/i18n-dict.js
git commit -m "feat(i18n): translate interpolated UI strings via t()"
```

---

## Task 6: Phase 2b — 以 `t()` 包原生 `alert/confirm`（~81 處）

**Files:**
- Modify: 含中文的 `alert(...)` / `confirm(...)` 的 view/feature `*.js`
- Modify: `frontend/core/i18n-dict.js`（補對應 key）

**Interfaces:**
- Consumes: `t(zhKey, params)`。

**列舉所有目標：**
```bash
cd frontend
grep -rnP '(alert|confirm)\([^)]*[一-鿿]' views features core utils
```

> 註：Task 5 已處理「含變數」的 alert/confirm；本 task 處理**純靜態字串**者。

- [ ] **Step 1: 逐一改寫（真實範例）**

`main.js:173`
```js
// before
alert('請先登入 Google 帳號，才能透過邀請碼加入群組');
// after
alert(t('請先登入 Google 帳號，才能透過邀請碼加入群組'));
```

`main.js:193`
```js
// before
alert('成功加入群組！');
// after
alert(t('成功加入群組！'));
```

對 grep 列出的每一處純靜態 alert/confirm 字串，包上 `t('…')`，並確保該繁中字串已在 `i18n-dict.js`（依規則翻譯）。每個檔案頂部視需要 import `t`（路徑依深度）。

- [ ] **Step 2: 補字典**

把本 task 涉及但 Task 2 未涵蓋的純靜態 alert/confirm 字串加入 `i18n-dict.js` 並翻譯。

- [ ] **Step 3: 字典健全性回歸**

Run: `node --test tests/`
Expected: PASS。

- [ ] **Step 4: 手動驗證**

EN 模式下觸發數個 alert/confirm 路徑（登入提示、各種失敗訊息），確認顯示英文。

- [ ] **Step 5: Commit**

```bash
git add frontend/main.js frontend/views frontend/features frontend/core/i18n-dict.js
git commit -m "feat(i18n): translate native alert/confirm strings via t()"
```

---

## Task 7: 全域巡檢與收尾

**Files:**
- Modify: `frontend/core/i18n-dict.js`（補漏譯）

- [ ] **Step 1: 逐頁巡檢漏譯**

EN 模式下逐一開啟每個 view（home、scanner、meetings、meeting-detail、friends、leaderboard、about、question-bank、question-edit、qa-*、profile、join、waiting-room、host-room、sync-ritual、focus、qa-game、taboo-*、67-game、buffer、summary、member-preview、invite-modal、meeting-setup、groups、group-setup、pet-swap、pet-tamagotchi），記下仍為繁中的固定 UI 文字。

- [ ] **Step 2: 補字典並複驗**

把漏掉的字串加入 `i18n-dict.js`；重新整理頁面複驗。對含變數而未處理者，回頭套 Task 5 模式。

- [ ] **Step 3: 切回中文回歸**

切「中」逐頁確認完整還原、無殘留英文、無錯位。

- [ ] **Step 4: 測試 + Commit**

```bash
node --test tests/
git add frontend/core/i18n-dict.js
git commit -m "feat(i18n): fill translation gaps from full-app sweep"
```

---

## Self-Review（撰寫者自查）

**Spec 覆蓋對照：**
- 切換範圍（固定 UI 文言）→ Task 2/5/6/7。
- 預設 zh + localStorage 持久化 → Task 1（package）、3（state）、4（initI18n/setLang）。
- 切換 UI（auth-bar segmented toggle）→ Task 3、4（綁定）。
- 方案A（字典 + DOM 走訪 + Observer）→ Task 4。
- 變數樣板 / alert/confirm 邊界 → Task 5、6。
- `document.title` / `<html lang>` → Task 4（applyHtmlMeta）。
- 不翻譯後端/使用者資料 → 設計上字典僅含 UI key，資料字串不入字典，自然不譯。
- 測試計畫 → 純邏輯 `node --test`（Task 1/2）+ 手動瀏覽器（Task 3/4/5/6/7）。

**Placeholder 掃描：** 字典「其餘條目依程序補齊」非佔位，而是定義了明確的抽取指令 + 翻譯規則 + 種子 + 驗收測試（placeholder parity / 非空），屬可執行程序。

**型別/命名一致性：** `t/setLang/getLang/applyTo/initI18n` 在 Task 4 定義，Task 5/6 僅消費 `t`；`dict.en` 結構在 Task 1 測試、Task 2 產生、Task 4 消費，一致。`#lang-toggle` / `.lang-btn` / `data-lang` 在 Task 3 建立、Task 4 綁定，一致。`localStorage('phubbing_lang')` 三處（state.js、setLang、initI18n）一致。
