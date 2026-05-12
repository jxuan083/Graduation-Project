# 🫂 Phubbing Anchor — 聚會專注助理

> 把手機放下，把眼神交給彼此。  
> 一個幫小群體在聚會時放下手機、記錄當下、一起玩遊戲的 Web App。

[![Live Demo](https://img.shields.io/badge/demo-graduation--6ae65.web.app-4285F4?logo=firebase&logoColor=white)](https://graduation-6ae65.web.app)
[![Backend](https://img.shields.io/badge/backend-Cloud%20Run-4285F4?logo=googlecloud&logoColor=white)](https://phubbing-backend-798458690617.asia-east1.run.app/api/version)
[![Branch](https://img.shields.io/badge/branch-we1n-orange)](#)
[![Version](https://img.shields.io/badge/version-v15.3-green)](#-版本歷程)

---

## 🚀 快速開始

```bash
# 直接體驗
👉 https://graduation-6ae65.web.app

# 在本機跑
git clone <this-repo>
cd Graduation-Project-main

# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Frontend (另開一個 terminal)
firebase emulators:start --only hosting
```

> ⚠️ 後端需要 `serviceAccountKey.json`（Firebase Admin SDK 金鑰），放在 `backend/` 下。**絕對不要 commit**。

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
│   └── wsHandlers.js        ← 所有 WS 訊息 handler 集中註冊
│
├── features/            ← 跨 view 的業務功能模組
│   └── friends · leaderboard · meetings · members · photos · taboo
│
├── views/               ← 每個畫面（25+ 個獨立 HTML + JS 對）
│   └── home · join · waiting-room · host-room · sync-ritual
│       focus · qa-game · qa-source · qa-picker · question-bank
│       question-edit · taboo-prepare · taboo-countdown · taboo-card
│       buffer · summary · meetings · meeting-detail · profile
│       friends · leaderboard · scanner · about · photo-lightbox
│       member-preview · invite-modal
│
├── utils/               ← dom · format · toast · uuid
└── styles/              ← base · components · social · taboo
```

### 後端 API 概覽

<details>
<summary><b>系統 / 個人資料</b></summary>

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/version` | 後端版本 + 建置日期 |
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
pip install -r requirements.txt

# 設定 service account key（不要 commit）
# Windows: set GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
# Unix:    export GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json

uvicorn main:app --reload --port 8080
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

### 前端（Firebase Hosting）

```bash
firebase deploy --only hosting
```

### 後端（Cloud Run）

推送到 `main` branch 觸發 GitHub Actions 自動部署。手動部署：

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
<summary><b>🔸 聚會照片仍使用 <code>blob.make_public()</code> 永久公開 URL</b></summary>

**現況**：`backend/main.py:upload_meeting_photo` 透過 `blob.make_public()` 讓照片 URL 永久可讀。URL 路徑由 `meeting_id`(8 字 hex) + `photo_id`(32 字 hex) 組成難猜，但只要 URL 外洩（截圖、錯誤地分享連結）就會永久存在。

**修法（需 IAM 配置）**：改用 `blob.generate_signed_url()` 產生短效（10 分鐘）簽名 URL，每次列表時動態產生。需要 Cloud Run service account 加上 `roles/iam.serviceAccountTokenCreator` 角色才能 sign blob。沒對好 IAM 會直接打壞照片功能，故未進 v15.3。
</details>

<details>
<summary><b>🔸 collection_group leaderboard 第一次部署需要建索引</b></summary>

排行榜 `/api/leaderboard/global` 用 `collection_group("meetings")` query，需在 Firebase Console 建立索引：

- Collection group: `meetings`
- Field: `ended_at` (Ascending)

未建索引時 API 會回空陣列且印 console warning。
</details>

<details>
<summary><b>🔸 CORS 過寬</b></summary>

`backend/main.py` 目前 `allow_origins=["*"]`，建議收緊到實際前端域：

```python
allow_origins=[
    "https://graduation-6ae65.web.app",
    "https://graduation-6ae65.firebaseapp.com",
]
```
</details>

<details>
<summary><b>🔸 <code>is_guest</code> 用 <code>"-" in uid</code> 判斷的脆弱假設</b></summary>

依賴「Firebase UID 不含 dash、訪客 UUID4 含 dash」這個現況。Firebase 沒保證 UID 格式不變。建議未來訪客 uid 加 `guest_` 前綴明確區分。
</details>

<details>
<summary><b>🔸 其他次要</b></summary>

- `/api/meetings` 用 `.limit(100)` 沒分頁
- `/api/leaderboard/global` 全表掃描，使用者多會慢
- nickname 長度上限不一致：profile 30 字、ws 20 字
- 題庫選項沒去重檢查
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
