# Phubbing Anchor UX 升級計畫（Duolingo / Airbnb / Linear 拆解落地）

- 建立日期：2026-08-05
- 前置文件：`docs/superpowers/plans/2026-07-23-codebase-optimization.md`（Phase 0–7 codebase 重構）
- 定位：本文件是**產品體感層**的計畫，與上述 codebase 計畫平行推進，不取代它。
- 基準 commit：`57ed2fc`（2026-07-24，main == origin/main，worktree clean）

---

## 1. 結論先講

三款標竿的手法不能整包搬。Phubbing Anchor 的產品目的是**降低疏離型手機使用**，而 Duolingo 的核心引擎是**最大化單人螢幕停留**。直接抄成癮迴路會做出一個自我矛盾的產品：使用者在聚會時盯著你的 app 不看朋友，指標好看但產品失敗。

因此本計畫的翻譯原則是：

| 標竿 | 原始目標 | 本產品的翻譯 |
|---|---|---|
| Duolingo | 讓人上癮（個人、每日、螢幕內） | 讓**群體**上癮於**見面**（群體資產、聚會粒度、螢幕外） |
| Airbnb | 讓人安心（交易前的不確定） | 讓人安心（**社交場合的不確定**：等一下要幹嘛、我會不會尷尬） |
| Linear | 讓人專注（工具隱形） | 讓人專注（**工具隱形，人才看得見彼此**）—— 唯一可以近乎全抄的一款 |

一句話：**Linear 全抄，Airbnb 抄結構，Duolingo 只抄回饋密度與損失厭惡，不抄留存迴路的宿主。**

North Star 沿用前計畫：interpersonal closeness / social presence / group cohesion / 「是否更了解一位成員」/ repeat gathering。本計畫所有改動都要能對回這五個之一。

---

## 2. 反目標（明確不做）

寫在最前面，因為這比要做什麼更容易被違反。

1. **不做個人每日 streak**。個人每日連擊會逼使用者在沒有聚會的日子打開 app 做無意義動作，直接製造疏離型使用。
2. **不做推播轟炸**。Duolingo 傍晚的「連擊快斷了」是把使用者拉回螢幕；本產品的推播只能有一個目的：**把人拉去見面**（聚會前提醒、揪團回應），且每個群組每週上限 2 則。
3. **不做應用內的無限內容流**。回顧報、寵物、排行榜都必須有明確結尾，讀完就沒了。
4. **不做遊戲化的個人排行榜**（現有 `leaderboard` view 需要重新定性，見 Phase C）。競爭個人分數會讓聚會變成表演。
5. **不在聚會進行中做任何拉注意力的動畫或紅點**。定錨之後，app 的正確狀態是「安靜」。

---

## 3. 現況體質（改動前的已知事實）

| 項目 | 現況 | 影響 |
|---|---|---|
| Design token | `frontend/styles/redesign.css` 只有顏色 token（`--bg` `--brown` `--gold` 等），**沒有間距、字級、圓角、動效時間、easing** | 每個 view 的節奏各做各的，視覺層級無法收斂 |
| CSS 檔案 | `base.css` / `components.css` / `redesign.css` / `social.css` / `taboo.css` / `pet-tamagotchi.css`，另有 4 個 `.tmp` 殘留檔 | 樣式來源分散，改一個 token 無法全域生效 |
| View 數量 | `frontend/views/` 共 36 個 | 資訊架構過載，存在死路與重複入口 |
| 載入方式 | `frontend/main.js`（264 行）一次載入全部 view | 首屏成本高，與「工具隱形」相反 |
| Optimistic UI | 尚未系統化；定錨按住已有本地即時填充，其餘 WebSocket 動作待查 | 每個 round-trip 都是一次體感斷點 |
| 快取機制 | 全域 cache-bust 版本號（現為 `v40`） | 改 UX 時最容易炸的地方，必須全域同步升版 |
| WebSocket state | process-local，Cloud Run 鎖 `--max-instances 1` | 樂觀 UI 的回滾邏輯不能假設多實例 |
| 專案筆記 | 無 `NOTES.md` | 違反專案慣例，本輪補上 |

（Phase 0–7 的逐項完成度、本機可跑性、實測通過數，以 codex 診斷報告為準，見 `NOTES.md` 對應段落。）

---

## 4. Phase A：設計系統地基（Linear 的克制）

**目的**：讓後續所有 UX 改動有統一的物理法則。這是唯一必須先做的 phase，跳過它後面全部會走鐘。

### A1. 補齊 design token
在 `frontend/styles/base.css` 建立單一 token 來源，`redesign.css` 只消費不定義：

- 間距：`--space-1` 到 `--space-8`，4px 基準（4/8/12/16/24/32/48/64）
- 字級：`--text-xs` 到 `--text-2xl`，1.25 modular scale，行高綁定
- 圓角：`--radius-sm/md/lg/full`
- 陰影：最多三階（`--shadow-subtle/raised/overlay`），禁止 inline 自訂陰影
- 動效時間：`--dur-instant: 80ms`（點擊回饋）、`--dur-fast: 160ms`（狀態切換）、`--dur-base: 240ms`（進場）、`--dur-slow: 400ms`（頁面轉場）
- Easing：`--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`（Linear 用的 expo-out 家族）、`--ease-in-out`

**驗收**：`grep` 全 CSS，不再有裸寫的 `px` 間距（除 1px border）、裸寫的 `ms`、裸寫的 `box-shadow`。加一條 invariant test 到 `tests/project-invariants.test.js` 鎖住這件事。

### A2. 刪除 `.tmp` 殘留檔
`frontend/styles/*.css.tmp` 四個檔全刪，確認沒有被 `index.html` 引用。

### A3. 共用回饋抽象
現在觸覺與動畫散落各 view。建立 `frontend/core/feedback.js`，對外只出三個 API：

```
feedback.tap()        // 80ms 視覺下沉 + 極輕震動，任何可點元素
feedback.success(el)  // 綠色確認 + 中度震動 + 可選音效
feedback.error(el)    // 紅色 + 雙短震動，永遠不遮擋內容
```

規則：震動一律走 `navigator.vibrate` 且尊重 `prefers-reduced-motion` 與使用者設定開關；音效預設關閉（聚會場合有人在講話，聲音是干擾不是回饋）。`sync-ritual.js` 現有的 25/50/75% 震動改為呼叫此模組。

### A4. Optimistic UI 抽象
建立 `frontend/core/optimistic.js`，包住所有 WebSocket 寫入動作：

```
optimistic.apply({
  local:    () => 立刻改本地 state 與畫面，
  send:     () => 送 WS 訊息，
  confirm:  (msg) => 收到伺服器確認，
  rollback: (reason) => 回滾並顯示非阻斷式提示,
  timeout:  3000
})
```

三條硬規則：
1. 使用者動作到畫面變化 **0ms**，不等伺服器。
2. 回滾必須有明確視覺（元素退回原狀 + 底部一行 toast），不能靜默。
3. 超時 3 秒未確認即視為失敗回滾，並顯示連線狀態指示。

**驗收**：切斷後端後手動操作，畫面即時反應後於 3 秒內乾淨回滾，無殘留錯誤狀態，console error 為 0。

**估時**：2–3 個工作天。

---

## 5. Phase B：儀式的毫秒級回饋（Duolingo 微互動 × Linear optimistic）

定錨儀式是這個產品的**唯一關鍵時刻**。所有體感投資的優先序在這裡。

### B1. 按住的多模態回饋密度
現況已有填充、縮放、pulse、百分比、里程碑震動。補：

- **按下瞬間**（0ms）：按鈕 3D 下沉 2px + `--dur-instant` 的 scale 0.98，這是 Duolingo 按鈕的核心手感
- **持續中**：圓環填充改為 `requestAnimationFrame` 驅動的連續值，不是 CSS transition 的離散跳動
- **放開**：不是瞬間歸零，而是 `--dur-base` 的回退動畫加輕震動——**失去進度必須被感覺到**（損失厭惡的正確用法）
- **完成**：全員 100% 的 completion overlay 保留現有約 950ms，但補一個「所有人的圓環同時對齊」的收束動畫，這是群體感的視覺高潮

### B2. Zeigarnik：進度條不倒退
Duolingo 答錯不倒退進度條。翻譯到本產品：**單一成員中途放開，只歸零他自己的圓環，共同進度條保留已達成的最高水位並顯示「差 1 人」**。現行是全體歸零，這在四人以上的場合會讓儀式難以完成，且製造挫敗而非期待。

需要改後端 `SYNC_PROGRESS` / `START_SYNC` 的狀態機語意：新增群體高水位欄位，`ANCHOR_ESTABLISHED` 條件仍然是**同一瞬間全員 100**（不能放寬，否則儀式失去意義），但 UI 上呈現的是「剩幾個人」而非「重來」。

**這是本計畫唯一動到後端協定的改動**，需要對應的 invariant test 與兩裝置 E2E 才能合併。

### B3. 等待期的雙向綁定（Airbnb 手法）
成員圓環與共同狀態列要雙向對應：某人開始按住時，共同狀態列上他的名字同步亮起；點擊共同狀態列的某個名字，對應圓環放大高亮。消除「誰還沒好」的認知斷層——這正是聚會現場真正的焦慮來源。

**驗收**：兩個 browser context + 兩台實機，跑完整交錯按住、單人放開、全員完成三個腳本，雙方畫面同步且無閃爍。

**估時**：3–4 個工作天（含後端狀態機與 E2E）。

---

## 6. Phase C：資訊架構降噪（Airbnb 漸進式揭露）

36 個 view 是目前最大的結構性債。

### C1. View 稽核
把 36 個 view 分類成四桶，逐一裁決：

- **主線**（聚會不可或缺）：home / groups / group / meeting-setup / host-room / join / waiting-room / sync-ritual / focus / summary
- **活動**（聚會中內容）：qa-game / qa-picker / taboo-* / scanner / photo-lightbox / pet-*
- **管理**（低頻，可藏深）：profile / friends / friend-profile / question-bank / question-edit / question-source / group-setup / group-invite
- **待裁決**：leaderboard / meeting-news / meeting-detail / meetings / member-preview / buffer / group-chat / invite-modal / join-method

裁決標準：使用者從首頁三步內到不了、或功能與另一 view 重疊者，合併或刪除。目標把主線 + 活動壓到 20 個以內，管理類全部改成延遲載入。

### C2. 三層漸進式揭露
- **第一層（首頁）**：只留三個變數——跟誰、什麼時候、做什麼。其餘全部收起。現有的首次展開/收合 instruction 保留。
- **第二層（聚會設定）**：卡片式選擇活動，右側或下方即時預覽該活動長怎樣（Airbnb 的地圖列表雙向綁定的翻譯：選項 ↔ 預覽）。
- **第三層（規則與細節）**：計時長度、難度、誰當房主、分心 buffer 秒數等理性參數，全部推到第三層。先讓人想像「這場聚會會很好玩」，再談規則。

### C3. 延遲載入
`frontend/main.js` 改為只在首屏載入主線 view，活動與管理類用動態 `import()` 在進入前一步預載。這同時是 Phase 5 的一部分，兩邊要協調不要重工。

**驗收**：首屏請求數與 JS 傳輸量下降 50% 以上；首頁到定錨開始的點擊數 ≤ 3。

**估時**：4–5 個工作天。

---

## 7. Phase D：群體資產與損失厭惡（Duolingo，改造版）

### D1. 群體連擊，不是個人連擊
單位是**群組**，粒度是**聚會**不是天：

- 群組連擊 = 連續達成約定頻率（每週/每兩週，群組自訂）的聚會次數
- 中斷條件寬鬆：允許每季一次「保護」，因為現實生活會有事，懲罰真實生活是錯的
- 顯示位置：群組頁最顯眼處，**不是**首頁——不能讓人天天打開 app 看連擊

### D2. 共有寵物＝群體的數位資產
既有寵物系統就是天然的損失厭惡載體，但目前是裝飾。改為：寵物狀態只由**聚會成果**驅動（有沒有見面、儀式有沒有完成、活動有沒有玩完），**不由每日登入驅動**。沒聚會寵物就會想念大家，聚會後恢復。

關鍵約束：寵物不能因為疏於照顧而死亡或永久損失。這會製造焦慮與強迫性打開，違反反目標 1。

### D3. 推播的唯一合法用途
只有兩種推播：
1. 聚會前的提醒（時間、地點、誰要來）
2. 有人揪團等你回應

文案一律指向真人與見面，不指向 app。禁止「你的連擊快斷了」這類寫法。

**驗收**：推播種類在程式碼層面被列舉限制，加 invariant test 鎖住。

**估時**：3 個工作天。

---

## 8. Phase E：回顧報的信任錨定（Airbnb 評價系統）

現有 `meeting-news`（Qwen 生成的聚會回顧報）是產品的情感高點，但目前是單一文案輸出。套用 Airbnb 的結構化評分邏輯：

- 把「這場聚會如何」拆成可讀維度：**在場感**（多少時間沒有疏離型使用）、**參與度**（每個人講到幾次）、**新發現**（透過問答學到的關於某人的事）
- 呈現為橫向長條與具體事實，不是一個總分
- 每個維度必須連回一個具體時刻（「你在第 3 題知道了小明怕高」），這是信任錨定的本質：**模糊的分數建立不了意義，結構化的事實可以**
- 回顧報必須有結尾，讀完引導到唯一動作：約下一次

**驗收**：回顧報能明確回答「這場聚會讓我更了解了誰的什麼」——這正是 North Star 的第四項。

**估時**：3 個工作天。

---

## 9. Phase F：主持人控制（Linear 命令面板的正確翻譯）

Cmd+K 在手機聚會場景沒有意義，不要照抄。真正的等價物是：**房主在聚會中需要零摩擦地控制流程，而且是單手、不用找按鈕、不用低頭看螢幕**。

- 房主專屬的常駐底部控制列（拇指可達區），最多三個動作：下一個活動 / 暫停 / 結束
- 所有房主動作走 Phase A4 的 optimistic 通道，0 延遲
- 大按鈕、高對比、不需要精準點擊——與 Linear 的 16×16 icon 完全相反的物理環境，但解決的是同一個問題：把操作摩擦降到趨近於零

**估時**：2 個工作天。

---

## 10. 指標與驗收

每個 Phase 合併前必須通過：

**體感層（可自動化）**
- 任何使用者動作到首次畫面變化 ≤ 100ms（含 WebSocket 動作，靠 optimistic）
- 首頁到定錨開始 ≤ 3 次點擊
- 首屏 JS 傳輸量較 baseline 下降 50%
- console error 為 0（440×900 手機 viewport）
- `npm test` 與 `python3 -m unittest discover -s backend/tests` 全綠

**產品層（需真人測試，畢專驗證用）**
- 單場聚會的疏離型使用時間佔比（相對 baseline）
- 儀式完成率（開始定錨 → 全員 100% 的比例）
- 「這場聚會後我更了解某位成員」的自陳比例
- 群組的第二次聚會發生率

產品層指標無法靠改 code 驗證，必須排真人場測。這是畢專口試最有說服力的證據，優先序不低於任何一個 Phase。

---

## 11. 排程

考量現實：GRE 11/29 是唯一主線，實習佔白天，可支配時間是晚上與週末。

| 順序 | Phase | 估時 | 是否阻塞後續 |
|---|---|---|---|
| 1 | A 設計系統地基 | 2–3 天 | 是，全部後續都依賴 |
| 2 | B 儀式回饋 | 3–4 天 | 否 |
| 3 | C 資訊架構降噪 | 4–5 天 | 與 codebase 計畫 Phase 5 有重疊，需協調 |
| 4 | F 主持人控制 | 2 天 | 否 |
| 5 | E 回顧報 | 3 天 | 否 |
| 6 | D 群體資產 | 3 天 | 否，但需要真人場測資料才有意義 |

合計 17–20 個專注工作天。按每週可投入 2 個工作天計，約 9–10 週。

**如果時間不夠，砍的順序是：D → E → F**。A 與 B 不能砍：A 是地基，B 是產品的唯一關鍵時刻。C 半砍可行（只做 C2 三層揭露，不做 C1 全面稽核）。

---

## 12. 與既有 codebase 計畫的關係

| 本計畫 | 對應 `2026-07-23-codebase-optimization.md` | 協調方式 |
|---|---|---|
| A（design token） | Phase 6 前端樣式整理 | 本計畫先行，Phase 6 收尾 |
| B（後端狀態機） | Phase 4 WebSocket protocol | **必須等 Phase 0 characterization test 就位才動**，否則沒有安全網 |
| C3（延遲載入） | Phase 5 前端核心可靠性 | 同一件事，合併執行不要重工 |
| 全部 | Phase 1 local-first | **硬前置**：沒有本機可跑環境就無法做 UX 迭代與 E2E |

**執行順序的唯一硬性要求**：codebase Phase 0（characterization tests）+ Phase 1（local-first）必須先完成，才開始本計畫的 Phase A。目前這兩者的實際完成度以 codex 診斷報告為準。

---

## 13. 地雷

- 改任何 JS/CSS 都要全域升 cache-bust 版本號（現 `v40`），不可只升部分檔案，否則會產生 module double-instance。
- i18n 有 MutationObserver，過去發生過自我回饋無限迴圈；新增動態 DOM 時務必確認不會再觸發。
- WebSocket state 是 process-local，樂觀 UI 的回滾不可假設多實例；Cloud Run 仍鎖 `--max-instances 1`。
- GCP Billing 目前 disabled，不要嘗試 Cloud Run 部署。
- 寵物本體的 emoji 是舊產品資料與使用者選項，不可機械式清除；新 UI 一律用 Lucide/SVG。
- `/Users/pl/Graduation-Project` 是過期 clone（落後 15 commits），**所有工作都在 `/Users/pl/Documents/New project/Graduation-Project`**。建議直接刪除或改名前者以免誤改。
