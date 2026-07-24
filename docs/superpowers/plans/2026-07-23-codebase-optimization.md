# Phubbing Anchor codebase 與產品優化計畫

日期：2026-07-23  
狀態：提案，尚未開始重構

## 1. 結論

建議拆 codebase，但不做一次性重寫，也不改成微服務。

採用 strangler pattern：先建立可測試的架構骨架，再沿著功能邊界逐個搬移 endpoint。每一階段都維持 API、Firestore schema 與前端行為相容，可以獨立驗收、commit、回退。

優先順序：

1. 本地可完整啟動，不依賴 GCP Billing。
2. 保護「建立聚會 → 加入 → 專注 → 結束 → 回顧 → 寵物成長」核心流程。
3. 拆後端邊界與 WebSocket state machine。
4. 補 integration / E2E 測試。
5. 最後才處理前端載入效能、state 與 CSS。

不建議現在做：

- 不重寫成 React。
- 不把 Firestore 換成 SQL。
- 不拆成多個 deployable services。
- 不同時改 API contract、資料 schema 與 UI。
- 不為追求行數而機械式切檔。

## 2. Baseline

### 後端

- `backend/main.py`：4,286 行。
- 60 個 REST routes。
- 1 個 WebSocket route，其中 handler 約 706 行。
- 145 次直接 `db.*` 呼叫。
- 85 個 broad `except Exception`。
- 101 個 `print()`。
- Firebase 初始化、設定、auth、HTTP transport、business rules、Firestore query、WebSocket protocol、STT 與 LLM 全部放在同一個 import graph。
- `firebase-admin` 使用同步 Firestore client，但多數 routes 宣告為 `async def`；同步網路 I/O 會阻塞 event loop。
- `openai-whisper`、`whisperx`、NumPy 與核心 API dependencies 綁在同一份 `requirements.txt`，讓本地安裝與容器建置過重。

### 前端

- 36 個 view。
- boot 時一次 fetch 所有 HTML，再 import 所有 view modules；不是 route-level lazy loading。
- `state.js` 是單一共享 singleton，包含連線、auth、meeting、group、pet、transcript、question、leaderboard 等多個 domain。
- `pet-tamagotchi.js` 963 行、`pet-swap.js` 791 行。
- `ASSET_VERSION` 與 `?v=39` 由人工同步。
- API 呼叫並未全部經過 `apiFetch()`，錯誤、timeout、offline state 與 auth handling 不一致。
- i18n 依賴 1,155 行 dictionary 與 DOM MutationObserver，自動翻譯方便但容易漏掉語意與動態狀態。

### 測試

- 前端 27 tests：以 i18n 與 source invariant 為主。
- 後端 13 tests：只覆蓋 pure pet logic。
- 尚無 FastAPI route integration tests。
- 尚無 Firestore emulator integration tests。
- 尚無 WebSocket protocol tests。
- 尚無完整核心流程 E2E。

### 文件與營運

- README 的照片公開 URL、CORS、guest UID 三項「已知問題」其實已修正，文件已開始漂移。
- GCP Billing 關閉後 Firebase Hosting 仍可用，但 Cloud Run 回 503。
- CI/CD 已調整成 push/PR 自動驗證、部署手動觸發。

## 3. 產品優化方向

### 3.1 North Star

產品主線應收斂成：

> 一群人能在 60 秒內建立並加入聚會，透過手機上的共同活動更了解彼此，結束後得到有價值的共同回顧與群組寵物回饋。

現階段先凍結新的社交、遊戲與寵物造型功能，直到核心主線有 E2E 保護。

本產品不以「螢幕時間越少越好」為目標，而是區分：

- 共同型使用：一起回答、遊戲、拍照、照顧寵物，手機正在促進互動。
- 工具型使用：掃碼、設定、查看聚會資訊，手機正在支援互動。
- 疏離型使用：離開共同活動、獨自滑動其他內容，手機正在取代眼前互動。

產品真正要降低的是疏離型使用。只要成員更了解彼此、感受到更高的社會臨場感與群體凝聚，即使正在使用手機也算達成目標。

### 3.2 P0：核心流程可靠性

優化項目：

- 建立房間、QR 加入、WebSocket AUTH、重連與結束流程。
- 專注判定必須辨識共同活動，不能把遊戲、回答或共同拍照算成分心。
- 重複點擊、斷線重送、重連後重複結算必須 idempotent。
- 房主離線、參與者離線、聚會已結束後重連要有明確狀態。
- 前端統一顯示 connecting、offline、retrying、failed、restored。
- 後端無法使用時，首頁不得只留下無解的 loading state。

驗收：

- 兩個瀏覽器 context 可完成核心流程。
- 中途強制斷線 10 秒後可恢復。
- `END_SESSION` 重送不會重複寫入 meeting、score 或 pet XP。
- 任何失敗都能看到可行動的錯誤訊息。

### 3.3 P1：回顧與寵物形成閉環

優化項目：

- summary 清楚呈現時間、分心、成員貢獻與 pet XP 的因果關係。
- newspaper、STT 與照片是 enhancement；失敗不能阻斷基本 summary。
- 寵物狀態變化要說明「因為本次聚會發生什麼」，而不是只更新數值。
- 群組頁直接顯示下一個可執行動作，例如餵食冷卻、距離升級差多少 XP。

驗收：

- 不使用 LLM、Whisper 或照片，也能生成完整 rule-based recap。
- 同一份 meeting 只產生一次核心 reward。
- 使用者能從 summary 回到對應群組與寵物。

### 3.4 P2：資訊架構與功能降噪

建議主導航只保留三個入口：

- 聚會
- 群組／寵物
- 回憶

好友、排行榜、題庫、遊戲改為各主流程內的 secondary action，避免 36 個 view 同等重要。

驗收：

- 首次使用者不用理解所有功能即可發起聚會。
- 首頁 primary CTA 只有一個。
- 核心流程不需要跨越不相關頁面。

### 3.5 成效指標

主要 outcome：

- 聚會前後的 interpersonal closeness。
- 「今天更了解其中一位成員」的同意程度。
- social presence 與 group cohesion。
- 同一群組再次聚會的比例。

輔助 diagnostic：

- 共同型、工具型與疏離型手機使用時間。
- QR 加入成功率與第一次聚會完成率。
- 問答、遊戲、共同回顧中的互動參與率。

螢幕時間與拿起手機次數不能單獨當成成功指標，否則會把產品本身促成的共同互動誤判成失敗。

## 4. 目標架構

### 4.1 Backend

```text
backend/
├── app/
│   ├── main.py                  # create_app、middleware、router registration
│   ├── core/
│   │   ├── config.py            # pydantic-settings / env
│   │   ├── firebase.py          # production / emulator initialization
│   │   ├── auth.py              # token dependency
│   │   ├── errors.py            # domain error → HTTP mapping
│   │   └── logging.py           # structured logging / request_id
│   ├── domains/
│   │   ├── users/
│   │   │   ├── router.py
│   │   │   ├── schemas.py
│   │   │   ├── service.py
│   │   │   └── repository.py
│   │   ├── social/
│   │   ├── questions/
│   │   ├── meetings/
│   │   ├── groups/
│   │   ├── pets/
│   │   └── media/
│   ├── rooms/
│   │   ├── router.py
│   │   ├── websocket.py         # handshake + dispatch only
│   │   ├── protocol.py          # typed inbound/outbound messages
│   │   ├── state_machine.py     # pure transition rules
│   │   ├── service.py
│   │   └── repository.py
│   └── integrations/
│       ├── storage.py
│       ├── transcription.py
│       └── newspaper.py
├── tests/
│   ├── unit/
│   ├── api/
│   ├── integration/
│   └── websocket/
├── requirements-core.txt
├── requirements-media.txt
└── Dockerfile
```

邊界規則：

- router：只負責 transport、validation、status code。
- service：負責 use case 與 transaction boundary。
- repository：唯一允許直接使用 Firestore client 的位置。
- domain/state machine：pure function，不 import FastAPI 或 Firebase。
- integrations：Storage、LLM、STT 等可失敗的外部能力。
- `app/main.py` 不直接執行 query 或 business rule。

### 4.2 Frontend

保留 Vanilla JS，先改善邊界：

```text
frontend/
├── app/
│   ├── bootstrap.js
│   ├── router.js
│   └── config.js
├── core/
│   ├── api-client.js
│   ├── auth.js
│   ├── websocket-client.js
│   ├── events.js
│   └── errors.js
├── features/
│   ├── meeting/
│   ├── groups/
│   ├── pets/
│   ├── memories/
│   ├── social/
│   └── questions/
├── shared/
│   ├── components/
│   ├── styles/
│   └── i18n/
└── main.js
```

邊界規則：

- feature 只能透過 API client 與 websocket client 連後端。
- state 依 domain 分 slice，不再增加 root singleton 欄位。
- view 在 route 第一次進入時才載入。
- UI module 不直接組 Authorization header。
- build tool 負責 asset hashing，不再手動維護 `?v=39`。

## 5. 執行階段

### Phase 0：建立安全基線

估時：0.5–1 天

工作：

- 將目前 CI/CD 調整獨立 commit。
- 修正 README 已過期的 known issues。
- 記錄現有 REST paths、request/response examples 與 WebSocket message types。
- 為核心 endpoint 加 characterization tests，先鎖住現況，不急著改善內部。
- 保存一組去識別化的 Firestore emulator seed data。
- 定義 feature freeze：重構期間不新增橫向功能。

驗收：

- 現有 40 tests 全過。
- 核心 API contract 有 snapshot 或明確 schema。
- 重構前後可用相同測試比較。

回退：

- 此階段不改 runtime behavior。

### Phase 1：Local-first 開發環境

估時：1–2 天

工作：

- 新增 `.env.example`，集中 project ID、emulator hosts、ports 與 optional integrations。
- 將 Firebase import-time 初始化改為 `create_firebase_clients(settings)`。
- 支援 Firebase Auth、Firestore、Storage emulator。
- 新增 `scripts/dev.sh` 或 `make dev`：
  - 建立 `.venv`
  - 安裝 core dependencies
  - 啟動 Firebase emulators
  - seed 測試資料
  - 啟動 FastAPI 與前端
- 拆分 dependencies：
  - `requirements-core.txt`
  - `requirements-media.txt`
- STT / LLM 未安裝時以明確 capability flag 降級，不影響核心 API。
- 新增 `/api/health`，回報 app、Firestore、Storage 與 optional integrations 狀態。

驗收：

- 全新 clone 不需要 service-account JSON，也能在本機完成核心流程。
- 一個命令啟動，Ctrl-C 能完整回收 child processes。
- 本地資料只寫 emulator。
- 未安裝 WhisperX 時，除 STT 外功能正常。

### Phase 2：後端骨架與第一個 vertical slice

估時：1–2 天

先搬最單純的 `questions` domain，驗證架構，而不是先碰 WebSocket。

工作：

- 建立 app factory、settings、auth dependency、error mapping 與 logging。
- 建立 repository interface 與 production Firestore implementation。
- 搬移 questions schemas/router/service/repository。
- API path 與 response 保持不變。
- 加入 dependency override，測試可注入 fake repository。
- 建立 invariant：`backend/app/domains/**/repository.py` 以外不得直接出現 `db.*`。

驗收：

- questions API contract 與現況相同。
- questions unit/API/emulator tests 完整。
- 舊 `main.py` 只 include 新 router，不保留雙份實作。

### Phase 3：REST domains 漸進搬移

估時：3–5 天

建議順序：

1. users/profile/auth
2. social/friends/leaderboards
3. meetings/photos
4. transcripts/newspaper/media
5. groups
6. pets

每個 domain 都遵守同一循環：

1. 補 characterization tests。
2. 定義 schemas。
3. 搬 repository query。
4. 搬 service rule。
5. 搬 router。
6. 跑全測試。
7. 刪除舊實作。
8. 獨立 commit。

同步改善：

- 將 endpoint 中同步 Firestore I/O 移到 threadpool，或讓同步 route 使用 FastAPI threadpool。
- transaction boundary 放在 service/repository，不散落 router。
- 使用 domain exceptions，不把 Firebase exception 或 token 驗證細節回傳給 client。
- 將 85 個 broad exceptions 收斂到真正的 integration boundaries。
- 將 101 個 print 改成 structured logs。
- 修正 friend list 與 group detail 的 N+1 reads。
- 對 meetings、messages、leaderboards 加 cursor pagination。

驗收：

- `backend/main.py` 降到 200 行以下，只保留 compatibility entrypoint。
- 非 repository 檔案沒有直接 Firestore query。
- 每個 domain 至少有 service unit tests 與 router tests。
- 所有舊 endpoint URL 保持相容。

### Phase 4：WebSocket protocol 與 room state machine

估時：2–3 天

這是風險最高的一段，必須最後拆。

工作：

- 將 AUTH handshake 與 action payload 定義成 typed models。
- 將 706 行 handler 拆成：
  - handshake
  - message parsing
  - authorization
  - action dispatcher
  - pure state transitions
  - persistence effects
  - broadcast
- 每個 action 建立 handler：
  - `START_SYNC`
  - `CANCEL_ROOM`
  - `END_SESSION`
  - `CHANGE_MODE`
  - QA actions
  - visibility/deviation actions
  - Taboo actions
- 對 `END_SESSION`、pet reward、score mirror 加 idempotency key。
- 把 `rooms` global dict 包進 `RoomStore` interface：
  - 第一版仍用 in-memory implementation。
  - Firestore 只負責 persistence/recovery。
- 明確記錄單 instance 限制；本地階段不急著導入 Redis。

驗收：

- WebSocket endpoint 本身少於 100 行。
- 每個 action transition 可不用網路、Firebase 直接 unit test。
- handshake、權限、重連、重複 END、房主離線都有 protocol tests。
- E2E 能模擬兩個 client 完成一次聚會。

### Phase 5：前端核心可靠性

估時：2–3 天

工作：

- 所有 API 呼叫統一經過 `api-client`。
- 加入 timeout、AbortController、統一 error type 與 auth-expired handling。
- websocket client 負責 reconnect、backoff、outbox 與 connection state。
- 將 `state.js` 拆成：
  - auth
  - meeting
  - group/pet
  - memories
  - transient UI
- 核心流程 view 先按 feature 收斂。
- 加入 route-level lazy loading；不再啟動時下載 36 個 views。
- 導入 Vite，只處理 module graph、dev server、asset hash 與 build；不更換 UI framework。
- 移除手動 `ASSET_VERSION` / `?v=39`。

驗收：

- 首頁只載入必要的 view/module。
- backend offline、auth expired、WebSocket reconnect 都有一致 UI。
- 核心流程 E2E 全過。
- 不再有繞過 API client 的 authenticated fetch。

### Phase 6：前端 feature 與樣式整理

估時：2–4 天

工作：

- 拆 `pet-tamagotchi.js` 與 `pet-swap.js`：
  - state
  - camera/media
  - rendering
  - API commands
  - view lifecycle
- 建立 design tokens 與 component styles。
- 逐步清理 4,000+ 行 CSS 中的重複 selector 與 override。
- i18n 從任意 DOM 文字攔截，逐步改成明確 key；MutationObserver 暫留作 fallback。
- 依「聚會／群組寵物／回憶」重整導航。

驗收：

- feature module 不超過 400–500 行的 soft limit；超過必須說明 cohesion 理由。
- view lifecycle 不殘留 timer、media stream、object URL 或 event listener。
- 中英文核心流程 E2E 全過。

### Phase 7：資料與營運品質

估時：1–2 天

工作：

- 建立 Firestore schema 文件與必要 composite indexes。
- 排行榜改成 write-time aggregate 或 scheduled materialization，避免全表掃描。
- 對 meeting、message、photo、leaderboard 加 pagination。
- 加 request ID、latency、error category 與核心 domain event logs。
- CI 分層：
  - PR：lint、unit、API tests
  - main：再加 emulator integration
  - 手動：E2E 與 deploy
- 部署前檢查 billing、required secrets 與 health；不滿足就明確 skip/fail。

驗收：

- 不再依賴未界定上限的 `.stream()`。
- 可以從 log 還原一次 meeting 的 create/join/end/reward 流程。
- deployment failure 能指出 billing、auth、test 或 runtime 的確切階段。

## 6. 測試策略

不追求一次把整體 coverage 拉到任意百分比，先覆蓋高風險 contract。

### Unit

- pet/score/session pure rules
- room state transitions
- permissions
- serialization/validation
- newspaper fallback

### API

- FastAPI `TestClient`
- fake repository
- 驗證 auth、status code、response schema、error mapping

### Integration

- Firebase emulator
- transactions、ArrayUnion、collection group、storage rules
- production-like seed data

### WebSocket

- handshake timeout
- guest/auth UID mismatch
- host-only action
- reconnect
- duplicate action
- end-session idempotency

### E2E

至少四條：

1. 登入 → 建立聚會 → 第二人加入 → 結束 → summary
2. 斷線 → 重連 → 恢復正確 phase
3. 群組聚會 → reward → pet XP 只增加一次
4. backend offline → UI 顯示可恢復狀態

## 7. Definition of Done

整體重構完成需同時滿足：

- 新 clone 可一個命令啟動 emulator + backend + frontend。
- 核心開發不需要 GCP Billing 或 service-account key。
- `backend/main.py` 僅為 compatibility entrypoint。
- Firestore query 只存在 repository/integration layer。
- WebSocket endpoint 只做 handshake、dispatch 與 transport。
- 核心 meeting flow 有 API、WebSocket 與 E2E 保護。
- frontend 不再一次載入全部 36 views。
- authenticated requests 不繞過統一 API client。
- README 與實際啟動／部署方式一致。
- 每階段都保留可 deploy、可回退的 commit。

## 8. 建議排程

若以一人專注執行估算：

| Milestone | 範圍 | 估時 |
|---|---|---:|
| M0 | 安全基線與 local-first | 2–3 天 |
| M1 | 後端骨架與 questions slice | 1–2 天 |
| M2 | REST domains 搬移 | 3–5 天 |
| M3 | WebSocket state machine | 2–3 天 |
| M4 | 前端核心可靠性 | 2–3 天 |
| M5 | UI、資料與營運整理 | 3–5 天 |
| 總計 | 不含新功能 | 約 13–21 個專注工作天 |

若時間有限，完成 M0–M3 就已能顯著提高可維護性與面試展示價值；M4–M5 可按實際產品需求延後。

## 9. 第一個實作批次

建議下一個 batch 僅做以下內容，不直接拆全部 domains：

1. commit 目前 CI/CD 調整。
2. 修正 README stale known issues。
3. 加 Firebase emulator 設定與 `.env.example`。
4. 拆 core/media dependencies。
5. 建立一鍵 local dev script。
6. 加 `/api/health`。
7. 用 questions domain 驗證 router/service/repository 架構。

完成後再 review 一次：

- local workflow 是否真的順。
- 目錄邊界是否過度設計。
- repository abstraction 是否適合 Firestore。
- 再決定是否照原順序搬剩餘 domains。
