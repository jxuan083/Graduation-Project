# Graduation Project — 聚會專注助理

一個幫助小群體在聚會時保持專注、記錄過程並增加互動趣味的 Web App。  
前端以 Firebase Hosting 部署，後端以 FastAPI 跑在 Google Cloud Run。

---

## 目錄

- [功能總覽](#功能總覽)
- [技術架構](#技術架構)
- [前端模組結構](#前端模組結構)
- [後端 API 一覽](#後端-api-一覽)
- [Firestore 資料規則](#firestore-資料規則)
- [版本歷程](#版本歷程)
- [本地開發](#本地開發)

---

## 功能總覽

| 功能 | 說明 |
|------|------|
| **聚會房間** | 建立/加入房間，WebSocket 即時同步所有成員狀態 |
| **分心偵測** | 偵測成員分心，觸發倒數警示；支援手動關閉與防呆 |
| **聚會照片** | 聚會中拍照或上傳，可設封面；拍照不觸發分心 |
| **問答遊戲** | 房主在聚會中發起 QA，支援有正解/無正解題型、答題結算 |
| **可編輯題庫** | 個人題庫 CRUD；公共題庫可一鍵匯入個人 |
| **Taboo 詞語禁忌** | 聚會小遊戲，設定禁用詞語，違者觸發提示 |
| **好友系統** | 發送/接受/拒絕好友邀請、移除好友、查看彼此關係 |
| **排行榜** | 全域排行榜 + 好友排行榜（依聚會積分計算） |
| **聚會紀錄** | 查看過往聚會清單與每場詳細結算（分心次數、積分等） |
| **個人資料** | 頭像、暱稱、自介；Google Sign-In 登入 |
| **QR 掃描加入** | 以瀏覽器掃 QR Code 直接進入聚會 |

---

## 技術架構

```
Frontend (Firebase Hosting)
  └── Vanilla JS ES Modules + HTML/CSS
  └── Firebase Auth (Google Sign-In)
  └── Firestore (部分直讀，寫入走後端)

Backend (Google Cloud Run)
  └── FastAPI (Python)
  └── Firebase Admin SDK
  └── WebSocket (/ws/{room_id}/{user_id})
  └── Cloud Storage (聚會照片)
```

---

## 前端模組結構

```
frontend/
├── main.js              # 入口：載入所有 view HTML → 初始化 Firebase → 啟動 router
├── index.html           # 單頁殼（#app 容器）
├── style.css            # 全域樣式（向下兼容舊版）
│
├── core/                # 基礎層（無業務邏輯）
│   ├── api.js           # fetch 封裝，自動帶 Firebase ID Token
│   ├── chrome.js        # auth-bar / 浮動按鈕 / 邀請橫幅 全域 UI
│   ├── config.js        # 環境常數（後端 URL、Firebase config）
│   ├── events.js        # 全域事件匯流排 (EventEmitter)
│   ├── firebase.js      # Firebase 初始化 + auth 監聽
│   ├── router.js        # SPA 路由（switchView / register）
│   ├── session.js       # 聚會 session 狀態機
│   ├── state.js         # 全域 reactive state
│   ├── ws.js            # WebSocket 連線管理
│   └── wsHandlers.js    # 所有 WS 訊息 handler 集中註冊
│
├── features/            # 跨 view 的業務功能模組
│   ├── friends/         # 好友系統邏輯
│   ├── leaderboard/     # 排行榜
│   ├── meetings/        # 聚會紀錄
│   ├── members/         # 成員卡片
│   ├── photos/          # 聚會照片
│   └── taboo/           # Taboo 遊戲
│
├── views/               # 每個畫面的 HTML + JS（各自獨立）
│   ├── home/            ├── join/           ├── waiting-room/
│   ├── host-room/       ├── sync-ritual/    ├── focus/
│   ├── qa-game/         ├── taboo-prepare/  ├── taboo-countdown/
│   ├── taboo-card/      ├── buffer/         ├── summary/
│   ├── meetings/        ├── meeting-detail/ ├── profile/
│   ├── friends/         ├── leaderboard/    ├── question-bank/
│   ├── question-edit/   ├── qa-source/      ├── qa-picker/
│   ├── scanner/         ├── photo-lightbox/ ├── member-preview/
│   ├── invite-modal/    └── about/
│
├── utils/               # 純工具函式
│   ├── dom.js           # querySelector 捷徑
│   ├── format.js        # 時間格式化
│   ├── toast.js         # Toast 通知
│   └── uuid.js          # 產生 UUID
│
└── styles/              # 拆分的 CSS
    ├── base.css         # reset + 全域變數
    ├── components.css   # 通用元件
    ├── social.css       # 好友/排行榜
    └── taboo.css        # Taboo 遊戲
```

---

## 後端 API 一覽

所有需要身分驗證的 API 請在 Header 帶 `Authorization: Bearer <Firebase ID Token>`。

### 系統
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/version` | 後端版本 + 建置日期 |

### 使用者 / 個人資料
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/me` | 取得自己的完整 profile |
| POST | `/api/profile` | 更新自己的 profile |
| GET | `/api/users/{uid}/public` | 取得他人公開資料（暱稱/頭像/bio） |
| GET | `/api/users/{uid}/relationship` | 查看與某人的好友關係 |

### 好友系統
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/friend_requests` | 發送好友邀請 |
| GET | `/api/friend_requests` | 查看收到/發出的邀請 |
| POST | `/api/friend_requests/{id}/accept` | 接受邀請 |
| POST | `/api/friend_requests/{id}/decline` | 拒絕邀請 |
| GET | `/api/friends` | 取得好友列表 |
| DELETE | `/api/friends/{uid}` | 移除好友 |

### 排行榜
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/leaderboard/global` | 全域排行榜 |
| GET | `/api/leaderboard/friends` | 好友排行榜 |

### 聚會
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/meetings` | 我的過往聚會列表 |
| GET | `/api/meetings/{id}` | 某場聚會詳情 |
| POST | `/api/meetings/{id}/photos` | 上傳聚會照片 |
| GET | `/api/meetings/{id}/photos` | 取得聚會照片列表 |
| DELETE | `/api/meetings/{id}/photos/{photo_id}` | 刪除照片 |
| PATCH | `/api/meetings/{id}/photos/{photo_id}/cover` | 設為封面 |

### 題庫
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/questions` | 我的個人題庫 |
| POST | `/api/questions` | 新增題目 |
| PATCH | `/api/questions/{id}` | 修改題目 |
| DELETE | `/api/questions/{id}` | 刪除題目 |
| GET | `/api/public_questions` | 公共題庫 |
| POST | `/api/questions/import` | 從公共題庫匯入 |

### 房間 / WebSocket
| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/create_room` | 建立聚會房間，回傳 room_id |
| WS | `/ws/{room_id}/{user_id}` | WebSocket 連線（聚會核心） |

---

## Firestore 資料規則

`firestore.rules` v15.2 安全修正重點：

- `users/{uid}` 文件：**只有本人**可讀（修正前任何登入者可讀，含 email）
- 他人公開欄位改由後端 `/api/users/{uid}/public` 代理（Admin SDK 繞過規則，僅回傳安全欄位）
- `users/{uid}/friends`、`friend_requests`、`meetings` 子集合：只有本人可讀，**寫入全走後端**

---

## 版本歷程

| 版本 | 主要內容 |
|------|----------|
| v15.2 | 安全性修正：收緊 Firestore 讀取規則；好友系統 + 排行榜 API |
| v11 | 前端架構重構：從單一 app.js 拆分為 ES Module 多檔結構 |
| v10b | 修正聚會中照片上傳（set merge=True 允許 doc 不存在） |
| v10a | 修正聚會中拍照上傳（rooms/meetings 雙重 fallback 查詢） |
| v10 | 聚會照片上傳/刪除/設封面；拍照不觸發分心 |
| v9 | 可編輯題庫（個人+公共）；分心倒數手動關閉與防呆 |
| v8 | 題庫 CRUD API；聚會中選題流程；WebSocket START_QA 支援抽題 |
| v7 | Firebase Auth（Google Sign-In）；聚會紀錄；QR 掃描；個人資料頁 |

---

## 本地開發

### 前端

```bash
# 使用 Firebase Hosting emulator
firebase emulators:start --only hosting
```

### 後端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

> 需要 `serviceAccountKey.json`（Firebase Admin SDK 金鑰），**不要 commit 到版本庫**。

### 補分數腳本（一次性執行）

```bash
cd backend
# 設定 service account key 路徑
export GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json
python backfill_scores.py
```

此腳本為 idempotent（重複執行安全），用於幫既有聚會補上 `base_score`/`host_score` 欄位，以及建立 `users/{uid}/meetings` 排行榜鏡像。

---

## 協作注意事項

- **金鑰安全**：`serviceAccountKey.json`、`.env` 類檔案已在 `.gitignore`，**絕對不要 commit**
- **後端部署**：推送到 `main` 會透過 GitHub Actions 自動部署到 Cloud Run
- **前端部署**：`firebase deploy --only hosting`
- **備份檔**：`*.bak.v*` 為本地備份，不需要追蹤
