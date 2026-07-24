# 🫂 Phubbing Anchor — 聚會專注助理

> 手機可以留在手上，注意力留在彼此身上。
> 一個把手機從干擾變成共同互動媒介，讓小群體更了解彼此、記錄當下的 Web App。

[![Live Demo](https://img.shields.io/badge/demo-graduation--6ae65.web.app-4285F4?logo=firebase&logoColor=white)](https://graduation-6ae65.web.app)
[![Backend](https://img.shields.io/badge/backend-Cloud%20Run-4285F4?logo=googlecloud&logoColor=white)](https://phubbing-backend-798458690617.asia-east1.run.app/api/version)
[![Branch](https://img.shields.io/badge/branch-we1n-orange)](#)
[![Version](https://img.shields.io/badge/version-v15.4-green)](#-版本歷程)

---

## 🚀 快速開始

```bash
# 在本機跑
git clone <this-repo>
cd Graduation-Project

# 啟動 Firebase emulators + FastAPI + Hosting
./scripts/dev.sh
```

本機預設入口：

- Frontend: `http://127.0.0.1:5002`
- Backend: `http://127.0.0.1:8080`
- Health: `http://127.0.0.1:8080/api/health`

> Production 或直接連雲端 Firebase 時才需要 `serviceAccountKey.json` 或 Application Default Credentials。不要 commit 任何金鑰。

---

## ✨ 它能做什麼

<table>
<tr>
<td width="50%" valign="top">

### 🎯 聚會核心
- **建立房間** + QR Code 邀請朋友
- **同步定錨儀式**：大家一起長按開始
- **分心偵測**：手機翻起來會觸發 30 秒倒數，逾時計入分心
- **聚會模式**：朋友 / 家庭 / 開會 / 上課（不同氛圍配色）

</td>
<td width="50%" valign="top">

### 🎲 互動小遊戲
- **團體問答**：房主從題庫抽題，全員作答顯示票數＋正解
- **可編輯題庫**：個人題庫 CRUD，可從公共題庫一鍵匯入
- **Taboo 關鍵字遊戲**：手機放額頭，其他人引導你說出關鍵字

</td>
</tr>
<tr>
<td valign="top">

### 📸 記憶留存
- **聚會照片**：房主拍照／上傳（最多 10 張），可設封面
- **聚會紀錄**：所有過往聚會列表 + 詳細結算
- **拍照不觸發分心**：30 秒寬限期保護

</td>
<td valign="top">

### 👥 社交
- **Google 登入** + 個人資料（頭像／暱稱／自介）
- **好友系統**：邀請、接受、互加自動成好友
- **週排行榜**：全站週榜 + 好友圈週榜
- **聚會中加好友**：點對方頭像直接送邀請

</td>
</tr>
<tr>
<td valign="top">

### 🐾 群組 & 共同寵物
- **群組管理**：建立群組、命名、加入成員（by uid／email）
- **邀請碼**：每個群組有專屬邀請碼，可分享連結 `?group_invite=` 一鍵加入、房主可重新產生
- **共同寵物**：直接拍照合成群組寵物，用 emoji 自訂造型並設為群組頭像
- **養成互動**：餵食／玩耍／清潔累積能量，狀態隨能量在 HAPPY／NORMAL／HUNGRY／CRITICAL 間變化

</td>
<td valign="top">

### 🌐 雙語介面（i18n）
- **中 / EN 一鍵切換**：右上角語言鈕，選擇存 `localStorage`
- **DOM 翻譯引擎**：MutationObserver 自動翻譯動態插入的內容，無需在每個 view 手動標記
- **變數樣板**：`t('加入群組「{name}」', { name })` 支援插值訊息

</td>
</tr>
</table>

---

## 🏗 技術架構

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend ─ Firebase Hosting                                │
│    Vanilla JS ES Modules · Firebase Auth (Google Sign-In)   │
│    ▼                                                        │
│  Backend ─ Google Cloud Run (asia-east1)                    │
│    FastAPI · Firebase Admin SDK · WebSocket                 │
│    ▼                                                        │
│  Storage ─ Firebase                                         │
│    Firestore (rooms, meetings, users, questions)            │
│    Cloud Storage (avatars, meeting-photos)                  │
└─────────────────────────────────────────────────────────────┘
```

### 前端目錄結構

```
frontend/
├── main.js              ← 入口：載入所有 view → 啟 Firebase → 接 router
├── index.html           ← 單頁殼（#app 容器）
│
├── core/                ← 基礎層（無業務邏輯）
│   ├── api.js               ← fetch 封裝，自動帶 Firebase ID Token
│   ├── chrome.js            ← auth-bar / 浮動鈕 / 邀請橫幅 全域 UI
│   ├── config.js            ← 環境常數
│   ├── events.js            ← 全域事件匯流排
│   ├── firebase.js          ← Firebase 初始化 + auth 監聽
│   ├── router.js            ← SPA 路由
│   ├── session.js           ← 聚會 session 狀態機
│   ├── state.js             ← 全域 reactive state
│   ├── ws.js                ← WebSocket 連線管理（含 first-msg AUTH）
│   ├── wsHandlers.js        ← 所有 WS 訊息 handler 集中註冊
│   ├── i18n.js              ← DOM 翻譯引擎（MutationObserver + 語言切換）
│   ├── i18n-core.js         ← 純函式 translate()（字典查表 + {var} 插值）
│   └── i18n-dict.js         ← 中→英字典（key = 繁中原字串，逐字相符）
│
├── features/            ← 跨 view 的業務功能模組
│   └── friends · groups · leaderboard · meetings · members · photos · taboo
│
├── views/               ← 每個畫面（30+ 個獨立 HTML + JS 對）
│   └── home · join · waiting-room · host-room · sync-ritual
│       focus · qa-game · qa-source · qa-picker · question-bank
│       question-edit · taboo-prepare · taboo-countdown · taboo-card
│       buffer · summary · meetings · meeting-detail · meeting-setup
│       profile · friends · leaderboard · scanner · about · photo-lightbox
│       member-preview · invite-modal · 67-game
│       groups · group-setup · pet-swap · pet-tamagotchi
│
├── utils/               ← dom · format · toast · uuid
└── styles/              ← base · components · social · taboo · game67 · pet-tamagotchi
```

> **i18n 設計文件**：`docs/superpowers/specs/2026-06-24-frontend-i18n-zh-en-design.md`（設計）與
> `docs/superpowers/plans/2026-06-24-frontend-i18n-zh-en.md`（實作計畫）；單元測試見 `tests/i18n-core.test.js`、`tests/i18n-dict.test.js`。

### 後端 API 概覽

<details>
<summary><b>系統 / 個人資料</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/version` | 後端版本 + 建置日期 |
| GET | `/api/health` | App、Firestore、Storage 與 optional capability 狀態 |
| GET | `/api/me` | 取得自己的完整 profile |
| POST | `/api/profile` | 更新自己的 profile |
| GET | `/api/users/{uid}/public` | 取得他人公開資料 |
| GET | `/api/users/{uid}/relationship` | 查我和某人的好友關係 |
</details>

<details>
<summary><b>好友系統</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/friend_requests` | 發送好友邀請（by uid 或 email） |
| GET | `/api/friend_requests` | 查看 incoming + outgoing pending |
| POST | `/api/friend_requests/{id}/accept` | 接受邀請 |
| POST | `/api/friend_requests/{id}/decline` | 拒絕邀請 |
| GET | `/api/friends` | 我的好友列表 |
| DELETE | `/api/friends/{uid}` | 解除好友 |
</details>

<details>
<summary><b>群組 & 共同寵物</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/groups` | 建立群組（自動產生 invite_code） |
| GET | `/api/groups` | 我加入的群組列表 |
| GET | `/api/groups/{id}` | 群組詳情（成員 + 邀請碼） |
| PATCH | `/api/groups/{id}` | 改群組名稱 |
| POST | `/api/groups/{id}/members` | 加入成員（by uid 或 email） |
| DELETE | `/api/groups/{id}/members/{uid}` | 移除成員 |
| PATCH | `/api/groups/{id}/pet` | 設定寵物（emoji／名字／寵物人） |
| GET | `/api/groups/{id}/pet` | 取得寵物狀態、身體選項與成員數 |
| POST | `/api/groups/{id}/pet-face` | 上傳合成寵物臉當群組頭像 |
| POST | `/api/groups/{id}/pet/action` | 養成互動（feed／play／wipe，累積能量） |
| GET | `/api/group_invite/{code}` | 用邀請碼預覽群組（加入前確認） |
| POST | `/api/group_invite/join` | 用邀請碼加入群組 |
| POST | `/api/groups/{id}/invite_code/refresh` | 重新產生邀請碼 |

**寵物能量狀態**：`≥80 HAPPY`／`≥40 NORMAL`／`≥15 HUNGRY`／`<15 CRITICAL`；
造型 emoji 白名單 `PET_BODY_OPTIONS`（🐰🐻🐱🐶🦊🐸🐧🐼🐨🐯）。
</details>

<details>
<summary><b>排行榜</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/leaderboard/global?period=week` | 全站週榜 |
| GET | `/api/leaderboard/friends?period=week` | 好友圈週榜 |
</details>

<details>
<summary><b>聚會 / 照片</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/meetings` | 我參與過的聚會清單 |
| GET | `/api/meetings/{id}` | 某場聚會詳情 |
| POST | `/api/meetings/{id}/photos` | 上傳聚會照片（房主，最多 10 張） |
| GET | `/api/meetings/{id}/photos` | 取得聚會照片列表 |
| DELETE | `/api/meetings/{id}/photos/{pid}` | 刪除照片 |
| PATCH | `/api/meetings/{id}/photos/{pid}/cover` | 設為封面 |
</details>

<details>
<summary><b>題庫</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/questions` | 我的個人題庫 |
| POST | `/api/questions` | 新增題目 |
| PATCH | `/api/questions/{id}` | 修改 |
| DELETE | `/api/questions/{id}` | 刪除 |
| GET | `/api/public_questions` | 公共題庫 |
| POST | `/api/questions/import` | 從公共題庫匯入到個人 |
</details>

<details>
<summary><b>房間 / WebSocket</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/create_room?frontend_url=...` | 建立聚會房間（回傳 room_id 與 QR Base64） |
| WS | `/ws/{room_id}/{user_id}` | 聚會核心 WebSocket（v15.3 first-msg AUTH） |

**WS 認證流程（v15.3）**

```
client → server   open
client → server   {action:"AUTH", token: "<firebase_id_token_or_null>", nickname}
server → client   {type:"AUTH_OK"}        # 通過
                  ｜or close 4401/4403/4400  # 失敗
client ↔ server   正常 message loop
```

訪客（uuid4 含 dash）`token: null`；登入者必填且 verified uid 必須 = path user_id。
</details>

---

## 🔐 安全規則摘要

`firestore.rules` v15.2 + `storage.rules` 重點：

- **`users/{uid}`** — 只有本人可讀（其他人公開欄位走後端 `/api/users/{uid}/public`）
- **`users/{uid}/{friends,friend_requests,meetings}`** — 只有本人可讀，寫入全走後端
- **`rooms/{id}`** — 房主與成員可讀，寫入全走後端
- **`meetings/{id}`** — 只有 `participants` 陣列內的人可讀
- **Storage `meeting-photos/...`** — 登入者可讀，寫入只能後端 Admin SDK

---

## 📜 版本歷程

| 版本 | 日期 | 主要內容 |
|:---:|:---:|---|
| **v15.4** | 2026-06-24 | 🐾 群組系統（邀請碼加入）+ 共同寵物（投票選寵物人、emoji 造型、合成寵物臉頭像、餵養互動）；🌐 中英雙語 i18n（DOM 翻譯引擎 + 語言切換） |
| **v15.3** | 2026-04-28 | 🔒 WS 改 first-message handshake；LOG_DEVIATION 加 phase + rate-limit；SUBMIT_ANSWER 嚴格驗證；SVG 上傳擋掉；avatar 改 placeholder |
| **v15.2** | 2026-04-26 | 🔒 收緊 Firestore 讀取規則（其他人 email 不再可被任意登入者讀）；好友系統 + 排行榜 API |
| **v15** | — | 🏗 前端模組化重構：3000 行 app.js 拆成 60+ 個小檔 |
| **v14** | — | 🎯 Taboo 關鍵字遊戲（120+ 張本土化字卡） |
| **v13** | — | 互加自動成好友、邀請橫幅、修非房主看不到照片的 bug |
| **v12** | — | 👥 好友系統、週排行榜（全站／好友圈） |
| **v11** | — | 右上角收合選單、關於頁、版本標示 |
| **v10** | — | 📸 聚會照片上傳/刪除/設封面，拍照不觸發分心 |
| **v9** | — | 分心倒數加「我回來專心了」按鈕 |
| **v8** | — | ✏️ 可編輯題庫（個人＋公共）、可選有無正解 |
| **v7** | — | Google 登入、聚會紀錄、QR 掃描、中文化 |

---

## 🛠 本地開發

### 後端

```bash
cd backend
pip install -r requirements-core.txt

# 設定 service account key（不要 commit）
# Windows: set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
# Unix:    export GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json

uvicorn main:app --reload --port 8080
```

需要 STT / WhisperX / LLM enhancement 時再安裝：

```bash
pip install -r requirements-media.txt
```

### 前端

```bash
firebase emulators:start --only hosting
# 或
npx serve frontend
```

### 補分數腳本（一次性）

> 用途：把舊的 meetings 文件補上 `base_score` / `host_score`，並建立 `users/{uid}/meetings/{mid}` 排行榜鏡像。**Idempotent，重複執行安全**。

```bash
cd backend
GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json python backfill_scores.py
```

---

## 🚢 部署

GitHub Actions 採「CI 自動、CD 手動」：

- push 到 `main` 或對 `main` 開 PR：只執行前後端測試與語法檢查，不會部署。
- 手動執行 **CI and Manual Deploy** workflow：
  - `verify-only`：只驗證。
  - `frontend`：驗證通過後部署 Firebase Hosting 與安全規則。
  - `all`：驗證通過後部署前端與 Cloud Run 後端。

> Cloud Run 與 Artifact Registry 需要專案已啟用 GCP Billing；Billing 停用時請使用 `verify-only` 或在本機開發。

### 前端（Firebase Hosting）

```bash
firebase deploy --only hosting
```

### 後端（Cloud Run）

在 GitHub Actions 手動選擇 `all`，或使用 gcloud 手動部署：

```bash
gcloud run deploy phubbing-backend \
  --source backend \
  --region asia-east1 \
  --allow-unauthenticated
```

### ⚠️ v15.3 部署相依性

WS handshake 從 URL query 改成 first-message frame，**前後端必須一起更新**：

| 部署狀態 | 結果 |
|---------|------|
| 只部署新前端 | 舊後端從 query 拿不到 token，連線被拒 |
| 只部署新後端 | 舊前端不送 AUTH frame，5 秒後 timeout close |
| ✅ 兩端都更新 | 正常 |

建議先部署後端，確認 `/api/version` 回 `v15.3-ws-hardening`，再部署前端。

---

## ⚠️ 已知議題 / 後續改進

<details>
<summary><b>🔸 collection_group leaderboard 第一次部署需要建索引</b></summary>

排行榜 `/api/leaderboard/global` 用 `collection_group("meetings")` query，需在 Firebase Console 建立索引：

- Collection group: `meetings`
- Field: `ended_at` (Ascending)

未建索引時 API 會回空陣列且印 console warning。
</details>

<details>
<summary><b>🔸 local-first 開發環境尚未完成</b></summary>

目前已經有 `.env.example`、Firebase emulator ports、core/media dependency split、`scripts/dev.sh`、`/api/health`、前端 Auth / Storage emulator 切換與本機快速登入。Firestore seed data 尚未建立；下一步是補 seed，再做兩個 browser context 的多人 E2E。
</details>

<details>
<summary><b>🔸 後端仍是單檔大型入口</b></summary>

`backend/main.py` 同時包含 Firebase 初始化、REST routes、WebSocket protocol、Firestore query、media/STT 與 business rules。重構計畫採 strangler pattern，先補 local-first 與 characterization tests，再從 questions vertical slice 驗證 router/service/repository 邊界；不要在 shared-anchor E2E 前先大拆 WebSocket。
</details>

<details>
<summary><b>🔸 其他次要</b></summary>

- `/api/meetings` 用 `.limit(100)` 沒分頁
- `/api/leaderboard/global` 全表掃描，使用者多會慢
- nickname 長度上限不一致：profile 30 字、ws 20 字
- 題庫選項沒去重檢查
- WebSocket state 仍是 process-local，Cloud Run 必須維持 single instance
</details>

---

## 🤝 給協作者

| 任務 | 主要動到的檔案 |
|-----|--------------|
| 加新 view | `frontend/views/<name>/{name}.html, name.js}`、`frontend/main.js` 註冊 |
| 加新 WS 訊息 | `backend/main.py` WS endpoint、`frontend/core/wsHandlers.js` |
| 加新 API | `backend/main.py`、（可選）對應 `firestore.rules` |
| 改外觀 | `frontend/styles/{base,components,social,taboo}.css` |
| 加遊戲 / 模式 | 新 view + 新 WS action + 後端 ALLOWED_MODES 白名單 |
| 加群組功能 | `backend/main.py` groups API、`frontend/features/groups/controller.js`、`views/groups`·`group-setup` |
| 加翻譯字串 | 在 `frontend/core/i18n-dict.js` 補 `繁中原字串: 'English'`（含變數用 `{name}` 佔位） |

### Commit 訊息規範

延用現有風格：`v<num>: <主要功能>` 開頭，body 用條列說明。範例：

```
v15.3: WS handshake 強化 + LOG_DEVIATION 防刷 + ...

Bug 1 — LOG_DEVIATION 防刷
- 加 phase 檢查
- per-user 25 秒 rate-limit

Bug 2 — ...
```

### 安全注意

- ❌ **絕對不要 commit** `serviceAccountKey.json`、`.env`
- ❌ 不要直接從 client 寫 Firestore（rules 都設 `allow write: if false`，全走後端）
- ✅ 所有跨使用者操作走後端 Admin SDK（雙邊 friends/friend_requests 維護）
- ✅ WS 訊息要假設 client 可能傳惡意值（已對 `LOG_DEVIATION`、`SUBMIT_ANSWER`、`CHANGE_MODE`、`START_QA`、`END_*` 做 host/phase/whitelist 驗證）

---

## 📮 聯絡

有 bug、想建議功能：[112306074@g.nccu.edu.tw](mailto:112306074@g.nccu.edu.tw)

---

<sub>🤖 部分文件協作於 Claude Code · 2026-04</sub>
