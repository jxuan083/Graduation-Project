# NOTES — Phubbing Anchor（Graduation Project）

專案筆記。記問題、結論、已知缺陷、待辦。每次 review 或決策要同步更新這裡，不能只留在 agent memory。

---

## 這個 repo 在哪

**唯一工作目錄：`/Users/pl/Documents/New project/Graduation-Project`**

`/Users/pl/Graduation-Project` 是**過期 clone**（停在 `ec301ad`，落後 15 commits，最後動作 2026-07-13）。不要在那裡工作。建議刪除或改名避免誤改。

- Remote：`https://github.com/jxuan083/Graduation-Project.git`
- 2026-08-05 狀態：`main == origin/main == 57ed2fc`，worktree clean，自 2026-07-24 起無新 commit。

---

## 產品定位（2026-07-23 定案，不要退回）

不是「少看手機」，是「**讓手機促進群體連結**」。

手機使用分三類：
- **共同型**：問答、Taboo、拍照、共同寵物 —— 正在促進互動
- **工具型**：掃碼、設定、查資訊 —— 正在支援互動
- **疏離型**：離開共同活動、獨自滑別的 —— 正在取代眼前互動

要降低的只有疏離型。**產品成功 ≠ 螢幕時間下降。**

North Star：interpersonal closeness / social presence / group cohesion /「是否更了解一位成員」/ repeat gathering。

Landing 文案主張：「手機可以留在手上，注意力留在彼此身上」。不要再寫成「手機越少越好」。

---

## 技術現況

| 項目 | 狀態 |
|---|---|
| 後端 | FastAPI + WebSocket，`backend/main.py` 4,366 行，同步 Firestore I/O |
| 前端 | vanilla JS 多 view，`frontend/main.js` 264 行，一次載入 36 個 view |
| 部署 | Firebase Hosting 正常；Cloud Run backend **503**（GCP Billing disabled） |
| CI/CD | CI 自動（push main / PR）；CD 只接受 `workflow_dispatch` |
| WebSocket state | process-local，Cloud Run 必須 `--max-instances 1`（有 invariant test 鎖住） |
| 快取 | 全域 cache-bust 版本號，現為 `v40` |

**本機缺**：`.venv`、Python 依賴、`backend/serviceAccountKey.json`、ADC。Firebase CLI auth 已過期。

---

## 已知缺陷

1. **無 design token 體系**：`redesign.css` 只有顏色 token，沒有間距/字級/圓角/動效時間，每個 view 節奏各做各的。
2. **CSS 殘留檔**：`frontend/styles/` 有 4 個 `.css.tmp` 未清。
3. **36 個 view 全量載入**：首屏成本高，且存在死路與重複入口（`leaderboard` / `meetings` / `meeting-detail` / `member-preview` 等待裁決）。
4. **Optimistic UI 未系統化**：只有定錨按住有本地即時填充，其餘 WebSocket 動作可能有 round-trip 空窗。
5. **`backend/main.py` 4,000+ 行**：在 shared anchor 完成真多人 E2E 前不要大拆。
6. **shared anchor 尚未完成真多人 runtime E2E**：目前只做過 Landing 的手機視覺驗收，不能宣稱已用兩台裝置驗證過定錨。
7. **無 `NOTES.md`**（本檔補上，2026-08-05）。

---

## 地雷

- 改任何 JS/CSS 必須**全域**升 cache-bust 版本號，只升部分檔案會產生 module double-instance／cache mismatch。
- i18n 有 MutationObserver，曾發生語言切換自我回饋無限迴圈（`05bbc8b` 修過）；新增動態 DOM 要確認不會再觸發。
- GCP Billing disabled，不要嘗試 Cloud Run / Artifact Registry 部署。
- Cloud Run 503 **不等於** Firestore 資料被刪，資料仍在。
- 寵物本體的 emoji 是舊產品資料與使用者選項，不可機械式清除；新 UI 一律 Lucide/SVG。

---

## 計畫文件

- `docs/superpowers/plans/2026-07-23-codebase-optimization.md` —— codebase 重構，Phase 0–7，13–21 工作天
- `docs/superpowers/plans/2026-08-05-ux-excellence.md` —— UX 升級（Duolingo/Airbnb/Linear 拆解落地），Phase A–F，17–20 工作天

**執行順序硬性要求**：codebase Phase 0（characterization tests）+ Phase 1（local-first）先完成，才開始 UX Phase A。

---

## 待辦（2026-08-05）

- [ ] 收 codex 診斷報告，把 Phase 0–7 的真實完成度填回本檔
- [ ] 確認本機能不能跑起來（缺什麼、怎麼補）
- [ ] 刪除或改名過期 clone `/Users/pl/Graduation-Project`
- [ ] UX Phase A：design token + `feedback.js` + `optimistic.js`
- [ ] 排真人場測（產品層指標無法靠 code 驗證，口試最需要這個）

---

## 2026-08-05 原生 app 化（Capacitor）

已 Capacitor 化並實機安裝到 iPhone 17（免費 Personal Team，簽章 7 天到期）。**尚未 commit**。

建置指令（dev server 必須同時跑著，app 連 `devHost`）：

```bash
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=<裝置 UDID>' -allowProvisioningUpdates DEVELOPMENT_TEAM=SP87H7624B build
xcrun devicectl device install app --device <裝置 UDID> <path>/App.app
```

### 實機發現的問題與根因

| 問題 | 根因 | 狀態 |
|---|---|---|
| 動態島蓋住 UI | 缺 `viewport-fit=cover`，且全專案零 `env(safe-area-inset-*)`，卻設了 `apple-mobile-web-app-status-bar-style: black-translucent` | 已修 |
| bottom bar 跟著捲動 | `.view` 的 `animation: fadeIn ... forwards` 讓 `translateY(0)` 永久留存，帶 transform 的祖先成為 fixed 子元素的 containing block | 已修（移除 `forwards`） |
| 右滑返回無效 | router 完全沒有 history API，無堆疊可退；Android 返回鍵同因會直接退出 app | 已加導航堆疊 + edge-pan + `@capacitor/app` |
| **原生殼登入失敗** | `firebase.js:77` 用 `signInWithPopup`，Google 封鎖內嵌 webview OAuth，WKWebView 也擋 popup | 處理中 |
| 首頁重複入口 | `btn-open-groups` 與 `btn-home-manage-groups` 同去 `view-groups`；`btn-scan-qr` 與 `btn-home-join-guest` 同去 `view-join-method`；`btn-home-more-slot` 是空函式死按鈕 | 處理中 |
| Landing 常態顯示 | `.home-purpose` 沒被納入一次性邏輯（上一輪只處理三步驟清單與 toggle） | 處理中 |
| 按鈕「太 AI」 | `--grad-purple` 紫漸層（AI 生成 UI 頭號指紋）用在 `.btn-primary`；圓角六種以上並存；inline style 覆蓋導致同頁按鈕 48px vs 52px | 處理中 |

### 原生化的關鍵設定

- **後端位址**：原生殼頁面從 `capacitor://localhost` 載入，不能用 `window.location.hostname`。`frontend/core/config.js` 依序讀 `?devHost=` → localStorage → `PHUBBING_NATIVE_CONFIG.devHost` → production。`native-runtime-config.js` 的 `devHost` **commit 前要清空**。
- **觸覺**：`frontend/core/haptics.js`，原生走 `Capacitor.Plugins.Haptics`（Core Haptics），瀏覽器 fallback `navigator.vibrate`。iOS Safari 不支援 `navigator.vibrate`，這是包原生殼的主要動機之一。**實機是否真的會震尚未驗證。**
- **返回政策**：`MEETING_VIEW_IDS` 九個聚會中的 view 不可被手勢/返回鍵退出，`canGoBack()` 明確排除。

### 上架前必須處理

- Apple 強制要求 app 內可刪除帳號（有 Firebase Auth 帳號系統就會被審）
- 後端要活著（Cloud Run 現為 503，需恢復 GCP billing）
- 付費 Apple Developer Program（USD $99/年）；現為免費 Personal Team
- 移除 iOS/Android 的開發用 cleartext HTTP 例外
- `user-scalable=no` 是無障礙問題

## 未解決：原生 app 連不到本機後端（2026-08-06，最高優先）

**症狀**：原生 app 內所有登入方式都沒反應（訪客、Email、本機快速登入）。

**已確認的事實**（不要重新假設）：
- Firebase Auth emulator 帳號數 **0** —— 從頭到尾沒有任何一次登入成功
- 後端 log **零筆來自手機的請求**（只有 Mac 自己 curl 的 `172.16.17.50`）
- 從 Mac 用 curl 打 `http://172.16.17.50:8080/api/health`、`:9099`、`:5002` 全部 **HTTP 200**

**結論：問題不在登入邏輯，是手機根本連不到 Mac。**

**已嘗試但未解決**：
1. `capacitor.config.json` 設 `iosScheme/androidScheme: "http"` + `cleartext: true`
   （原假設：`capacitor://localhost` 是安全來源，對 `http://` 後端會被當 mixed content 擋掉）
2. `Info.plist` 補 `NSLocalNetworkUsageDescription`
   （iOS 14 起沒有這個宣告，存取區網 IP 不會跳授權框、連線靜默失敗。Leo 在 FlowDeck tvOS 專案踩過同一件事）
3. ATS 已有 `NSAllowsArbitraryLoadsInWebContent` + `NSAllowsLocalNetworking`

**下一步（擇一）**：
- **做 app 內連線診斷頁**（放在目前空白的 `view-more`）：顯示 `IS_NATIVE_APP`、解析出的 `devHost` / `BACKEND_HOST` / emulator hosts，並提供「測試連線」按鈕把 fetch 的錯誤訊息直接印在畫面上。不需要 Mac 接線就能自我診斷。**建議先做這個。**
- Safari Web Inspector：iPhone 設定 → Apps → Safari → 進階 → 開啟「網頁檢閱器」，再用 Mac Safari 的「開發」選單接上 app 的 webview 看 console。

**其他要確認的**：手機是否真的與 Mac 同一個 WiFi（曾出現 IP 短暫跳成 `192.168.2.105`）；iOS 設定內「社交定錨 → 區域網路」是否已開啟。

## 重要：devHost 已清空

`frontend/native-runtime-config.js` 的 `devHost` 為了進版控已清成 `''`。

**要繼續在手機上測，必須先填回當前 LAN IP 再 build**，否則 app 會去連正式 Cloud Run（現為 503）：

```bash
# 1. 查 IP
ipconfig getifaddr en0
# 2. 填進 frontend/native-runtime-config.js 的 devHost
# 3. 重新 build
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'id=9D800519-30D5-5107-A80B-28888A35B894' \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=SP87H7624B \
  -derivedDataPath /tmp/dd build
xcrun devicectl device install app --device 9D800519-30D5-5107-A80B-28888A35B894 \
  /tmp/dd/Build/Products/Debug-iphoneos/App.app
```

`devHost` 是本機設定檔，**不要 commit 個人 IP**。

## 待決策

- **空狀態改版**：方案已提（三段式：這裡會出現什麼／一句價值／一顆主要按鈕；用寵物當視覺取代通用圖示；示範卡片展示填滿後的樣子）。尚未實作。
- **儀式變體**：研究已完成（見 `docs/superpowers/specs/2026-08-06-ux-research.md`），是低頻留存問題的核心答案，也是可量測的研究變項。尚未實作。
- **Apple Developer $99**：先問政大／指導教授有沒有機構開發者帳號（教育機構可費用豁免），通了就免費用 TestFlight。場測其實用 PWA 即可，$99 可延後到真的要上架。
- **雲端費用核銷**：主計室已確認訂閱制可核銷（2-3 個月一次），但**雲端用量型費用尚未確認**。這決定後端能不能上雲，是 PWA 場測與 TestFlight 的共同前提。

## 變更紀錄

- 2026-08-05（下午）：Capacitor 原生化，實機跑起來；修動態島安全區、bottom bar fixed bug、導航堆疊與右滑返回；發現原生殼登入失效（`signInWithPopup`）。全部未 commit。
- 2026-08-05：建立本檔；新增 UX 升級計畫；確認 repo 雙 clone 問題。
- 2026-07-24：local-first CI、後端 sync 強化、shared anchor UI、requirements 拆分、scheduled gatherings 併入 start flow（`36e44ee`..`57ed2fc`）。
- 2026-07-23：產品重新定位、CI/CD 分流、codebase 優化計畫成文。
