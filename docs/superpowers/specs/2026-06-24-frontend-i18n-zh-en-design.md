# 前端中英切換（i18n）設計文件

- 日期：2026-06-24
- 範圍：`frontend/`（vanilla JS SPA）
- 方案：**方案A — 以繁中字串為 key 的 DOM 自動翻譯引擎**

## 1. 目標與範圍

為前端加入「中文 / English」語言切換，類似一般網站右上角的 language 切換。

**包含（要英語化）**：畫面上所有「固定 UI 文言」——按鈕、標題、提示、placeholder、toast、原生 alert/confirm 等。

**不包含（維持原語言）**：使用者輸入的資料、後端回傳的內容（問答題目本文、Taboo 語句、AI 產生的摘要等動態資料內容）。

## 2. 已確認決策

| 項目 | 決策 |
|------|------|
| 翻譯範圍 | 全部「固定 UI 文言」；不含使用者/後端資料內容 |
| 預設語言 | 永遠 `zh`（繁中）開始；使用者手動切到 `en` 後記住 |
| 持久化 | `localStorage('phubbing_lang')` |
| 切換 UI | 上方 `#auth-bar` 左側 segmented toggle `[ 中 | EN ]`，常駐、登入前後都可見 |
| 實作方式 | 方案A：繁中為 key 的字典 + DOM 走訪翻譯 + MutationObserver |
| 英文用詞 | 由實作者（Claude）決定，無特定詞彙偏好 |
| 檔案位置 | `core/i18n.js`（引擎）、`core/i18n-dict.js`（字典） |

## 3. 現況（重要前提）

- 架構：vanilla JS SPA。`main.js` 於啟動時平行 fetch 約 30 個 view 的 HTML 片段插入 `#app`，再動態 import 各 view 的 `init()`。無前端框架、無既有 i18n。
- 文字現況：繁中（zh-TW）**硬編碼**散落於 HTML（約 32 檔）與 JS（約 30 檔，包含 toast、alert、動態 render）。
- 規模量測：
  - 原生 `alert/confirm` 含中文：約 **81 處**。
  - 含變數的樣板字串（`` `...${}...` ``）含中文：約 **37 處**（與上方部分重疊）。
  - 其餘為靜態 DOM 文字，由引擎自動涵蓋。
- `#auth-bar` 位於 `index.html`、在 `#app` 之外，永遠存在（適合放常駐 toggle）。
- `core/state.js` 為跨 module 共享的 state singleton（將新增 `lang` 欄位）。

## 4. 架構總覽

新增獨立 i18n 模組，不依賴任何現有 view。核心機制：

1. **字典**以「繁中原字串」為 key，對應英文。
2. **DOM 翻譯器**走訪 `#app`（與 `#toast-container`）的文字節點與 `placeholder/title/alt` 屬性，依字典置換。
3. **MutationObserver** 監看動態插入的節點，於 EN 模式下自動翻譯——使大多數 JS render 程式碼**不需改動**。
4. 語言狀態存 `state.lang` 並持久化；預設 `zh`（零成本，不做任何 DOM 變更）。

## 5. 元件設計（單一職責）

### 5.1 `core/i18n-dict.js`（純資料）
```js
export const dict = {
  en: {
    // 靜態 UI 文字
    "聚會時間": "Meeting Time",
    "發起聚會": "Start a Gathering",
    // 含變數樣板（以繁中樣板為 key，{name} 為佔位）
    "加入群組「{name}」（{count} 位成員）？": "Join group \"{name}\" ({count} members)?",
    // ...
  },
};
```
- 只有一份。key 一律是程式碼中出現的繁中原字串（含標點，需逐字相符）。
- 兩類 key：純靜態文字、含 `{placeholder}` 的樣板。

### 5.2 `core/i18n.js`（引擎）
對外 API：
- `initI18n()`：boot 時呼叫一次。讀 localStorage；若為 `en` 立即 `applyTo(document.getElementById('app'))`；設定 `<html lang>`；啟動 Observer。
- `setLang('zh'|'en')`：寫入 `state.lang` + localStorage；更新 `<html lang>` 與 `document.title`；對 `#app` 套用（EN）或還原（ZH）；更新 toggle 的 active 樣式。
- `getLang()`：回傳目前語言。
- `t(zhKey, params?)`：給 JS 呼叫。EN 模式下查字典並以 `params` 填入 `{placeholder}`；ZH 模式或查無 key 時，回傳填好變數的繁中原字串（永遠有合理 fallback）。
- `applyTo(root)`：走訪 root 下文字節點與屬性，依目前語言翻譯/還原。

內部機制：
- **原文保存與還原**：文字節點原始繁中存於 `WeakMap<Text, string>`；屬性原文存於對應元素的 `data-i18n-orig-*`（element 支援 dataset）。切回中文時由保存的原文還原，避免反查歧義。
- **空白保留**：以 `nodeValue.trim()` 當查詢 key，置換時保留外圍空白（只換核心字串）。
- **Observer**：對 `#app`、`#toast-container` 監看 `childList`（subtree）與 `characterData`；EN 模式下對新增/變更節點呼叫翻譯。切到 ZH 時停用翻譯路徑並還原。

### 5.3 切換 UI
- 於 `index.html` 的 `#auth-bar` 內、`#auth-logged-out` / `#auth-logged-in` 之前，加入：
  ```html
  <div id="lang-toggle" class="lang-toggle" role="group" aria-label="Language">
    <button data-lang="zh" class="lang-btn active">中</button>
    <button data-lang="en" class="lang-btn">EN</button>
  </div>
  ```
- 樣式加入 `styles/components.css`：小尺寸 segmented，active 高亮，行動裝置易點。
- 事件綁定於 `i18n.js`（或 `core/chrome.js` 的 initChrome），點擊 → `setLang(data-lang)`。

### 5.4 整合
- `core/state.js`：新增 `lang: localStorage.getItem('phubbing_lang') || 'zh'`。
- `main.js` boot：在 `loadAllViewHtml()` 之後、`initChrome()` 附近呼叫 `initI18n()`（需在 view HTML 已插入、Lucide icons 建立之後）。

## 6. 資料流

- **啟動**：`initI18n()` 讀語言 → `en` 則 `applyTo(#app)`；`zh` 則不動 DOM。
- **切換**：`setLang()` → 持久化 → 更新 `<html lang>` / title / toggle → `applyTo(#app)` 套用或還原 → 之後任何重繪由 Observer 處理。
- **動態內容**：view 重繪插入的繁中文字，Observer 於 EN 模式自動翻譯；多數 JS 無需改動。

## 7. 邊界處理（需個別包 `t()`）

| 情況 | 數量 | 做法 |
|------|------|------|
| 含變數樣板 | ~37 | 改寫為 `t('…{name}…', {name})`，繁中樣板為 key |
| 原生 `alert/confirm` | ~81 | 改為 `alert(t('…'))`；Observer 抓不到 DOM 外對話框 |
| `document.title` | 少數 | 於 `setLang` 內更新 |
| 同字不同義 | 極少 | 字典加上下文後綴 key，個案處理 |

## 8. 分階段交付

- **Phase 1**：`i18n.js` + `i18n-dict.js` + 切換 UI + 字典（靜態文字 + 大多數動態 textContent）。上線即可切換多數頁面。
- **Phase 2**：逐一以 `t()` 包 ~37 變數樣板 + ~81 alert/confirm，補齊覆蓋率。
- 字典英文內容由實作者從原始碼抽取繁中、去重後產生。

## 9. 測試計畫

- 切換後巡檢各 view：靜態文字、placeholder、toast、動態列表（群組/聚會/好友）皆變英文；切回中文完整還原。
- 重新整理後語言維持；登入前後（auth-bar 兩種狀態）toggle 皆可見可用。
- 邊界：含變數確認框、相機/錯誤 toast、`document.title`。
- 回歸：ZH 預設模式下 DOM 不受影響（零行為改變）。

## 10. 非目標（YAGNI）

- 不導入第三方 i18n 函式庫。
- 不翻譯後端/使用者資料內容。
- 不支援第三種語言（但字典結構保留擴充空間）。
- 不做 URL 語系路由（`/en/...`）。
