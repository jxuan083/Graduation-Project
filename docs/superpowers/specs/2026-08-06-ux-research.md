# Phubbing Anchor UX 深度研究：Onboarding、定錨儀式變體、共同寵物深化

- 建立日期：2026-08-06
- 查證日期：2026-08-06
- 適用專案：Phubbing Anchor，台灣國科會大專生研究計畫，研究期程至 2027-02-28
- 本文件範圍：首次啟動 onboarding、定錨儀式變體、共同寵物機制與 IP 深化。

## 0. 範圍與前提

### 查證到的事實

- 本研究不重做 `docs/virtual-pet-market-2026.md` 已完成的市場掃描。既有結論已指定產品方向為「Focus Friend 式現實行為換照顧資源、Widgetable 式共同飼養、Tamagotchi 式分支進化」，並明確排除 AI 聊天寵物，因為聊天寵物會鼓勵聚會中持續看手機，與產品定位衝突。來源：本 repo 文件 `docs/virtual-pet-market-2026.md`，查閱日期 2026-08-06。
- 本研究必須相容於 `docs/superpowers/specs/2026-08-05-interaction-spec.md`：最小命中區 44 x 44 pt、按下回饋 100ms、狀態切換 200ms、頁面轉場 300ms、成功/慶祝 400-500ms、iOS haptic 以 `impact`、`selection`、`notification` 語意設計。來源：本 repo 文件，查閱日期 2026-08-06。
- 目前可直接沿用的寵物圖像資產只有 `frontend/views/pet-swap/assets/cat.png`、`dog.png`、`fox.png`、`rabbit.png`。來源：本機檔案列表，查閱日期 2026-08-06。
- Capacitor 官方文件把 Capacitor 定位為讓 Web app 進入原生容器、透過 plugin API 存取 Swift、Java 與 JavaScript 原生能力的 runtime。來源：https://capacitorjs.com/docs ，查證日期 2026-08-06。

### 推論

Phubbing Anchor 不是「少用手機」產品，而是「把手機使用重新導向群體連結」的產品。因此本文件所有建議都使用同一條判準：聚會中留在 app 內做共享、工具、紀錄用途是合理的；聚會外用通知、每日任務、寵物壓力把人拉回 app，會製造疏離型使用，應避免。

---

## 1. Topic 1：首次啟動 Onboarding UX

### 1.1 社交/活動/群組 app 的首次啟動模式

#### 查證到的事實

- Apple HIG 建議：只有核心功能需要帳號時才要求建立帳號；否則應讓使用者先體驗 app 或遊戲，並盡可能延後登入，因為使用者常在「什麼都還不能做」前被迫登入時流失。來源：https://developer.apple.com/design/human-interface-guidelines/managing-accounts ，查證日期 2026-08-06。
- Discord 行動版首次使用要求註冊帳號，註冊資料包含 display name、username、email 或 phone、password；Discord 也支援透過 invite link 加入 server，但新使用者點 invite link 後仍會被導到登入/註冊流程。來源：https://support.discord.com/hc/en-us/articles/360046618751-Getting-Started-on-Mobile 與 https://support.discord.com/hc/en-us/articles/31676852332439-Discord-Sign-Up-and-Registration-Guide ，查證日期 2026-08-06。
- Meetup 的公開說明指出，要加入 Meetup group 或參加 event，需要建立免費 Meetup 帳號；Meetup app 的價值主張是找附近 group、建立現實連結、活動後保持聯繫、讓 organizer 管理活動。來源：https://help.meetup.com/hc/en-us/articles/39232700471181-How-do-I-sign-up-for-a-Meetup-account 與 https://www.meetup.com/apps/ ，查證日期 2026-08-06。
- Strava 支援「把一起運動但沒有記錄的人加到活動」：若對方不是 Strava 使用者，邀請連結會引導對方建立帳號，接受後該活動會出現在新帳號。來源：https://support.strava.com/en-us/articles/15401797-inviting-a-friend-to-your-activity ，查證日期 2026-08-06。
- Bumble BFF 要開始交友必須建立帳號，且為了降低 bot/spam，帳號綁定真實電話號碼，並要求照片與自拍驗證。來源：https://support.bumblebff.com/hc/en-us/articles/30291649228061-Creating-an-account ，查證日期 2026-08-06。

#### 推論

社交/群組 app 不是都應延後登入。判斷關鍵不是「社交 app 是否一定要帳號」，而是「第一個價值瞬間是否需要持久身份與信任」。Discord、Meetup、Bumble BFF 的核心價值牽涉安全、身份、社群權限，所以登入前置合理；Strava 的「被朋友加到活動」比較接近 Phubbing Anchor 的 join flow：使用者先被社交情境拉進來，再在價值已產生後補身份。

Phubbing Anchor 目前「可免登入加入聚會、開聚會才登入」符合 Apple HIG 的延後登入原則，也符合產品現場情境：來賓在聚會中不應被帳號流程卡住；主持人建立可回訪的群組與聚會紀錄，才需要身份。

### 1.2 零內容 empty state：沒有群組、朋友、歷史時怎麼不空洞

#### 查證到的事實

- Lazyweb Research 2026-07-07 對 809 個行動 app、44,873 張截圖的分析指出，plain empty state 出現在 373 個 app，sample/demo content 出現在 100 個 app，social seeding 出現在 64 個 app，strict setup checklist 出現在 107 個 app。來源：https://www.lazyweb.com/research/empty-state-patterns-prevalence-mobile-apps ，查證日期 2026-08-06。
- UserOnboard 把 empty state 定義為 first-run 時本該有內容但尚未有內容的空容器，並指出 empty state 若沒有教育、提示或可執行下一步，就是 dead end。來源：https://www.useronboard.com/onboarding-ux-patterns/empty-states/ ，查證日期 2026-08-06。
- Nielsen Design System 的 empty state 指南建議：第一次使用的 blank slate 應幫助使用者理解內容區用途、保持文案短、通常只放一個主要按鈕。來源：https://nielsendesignsystem.com/components/empty-state/ ，查證日期 2026-08-06。

#### 推論

Phubbing Anchor 的零內容不是「資料空」，而是「社交情境尚未開始」。首頁不應展示假的群組或假的寵物成長，因為這會削弱研究資料可信度。更好的 blank slate 是讓使用者選擇一個真實社交入口：

- 我正在和朋友在一起：加入聚會。
- 我要發起一場聚會：開始聚會。
- 我想為固定成員保留紀錄：建立群組。

這三個入口對應真實狀態，不需要用 demo content 假裝已有歷史。

### 1.3 登入時機：先試用還是先登入

#### 查證到的事實

- Apple HIG 明確建議延後 sign-in，除非核心功能需要帳號；若要求帳號，應說明原因與好處。來源：https://developer.apple.com/design/human-interface-guidelines/managing-accounts ，查證日期 2026-08-06。
- Discord invite link 的註冊流程顯示，即使是被邀請加入 server 的情境，新使用者仍須註冊帳號。來源：https://support.discord.com/hc/en-us/articles/31676852332439-Discord-Sign-Up-and-Registration-Guide ，查證日期 2026-08-06。
- Meetup 要加入 group 或 attend event 前需要免費帳號。來源：https://help.meetup.com/hc/en-us/articles/39232700471181-How-do-I-sign-up-for-a-Meetup-account ，查證日期 2026-08-06。
- Strava 可由既有使用者邀請非使用者加入一筆活動紀錄，新使用者從邀請建立帳號後，活動會出現在個人 feed。來源：https://support.strava.com/en-us/articles/15401797-inviting-a-friend-to-your-activity ，查證日期 2026-08-06。

#### 推論

Phubbing Anchor 的登入規則應維持：

- 加入聚會：不登入也可進入，因為這是現場互動，登入會破壞節奏。
- 開始聚會：要求登入，因為主持人會建立房間、QR、聚會紀錄與群組資產。
- 建立群組：要求登入，因為群組、共同寵物、相簿與 recap 都是持久資產。
- 聚會結束後：給來賓「把這次聚會保存到帳號」的 soft sign-up，類似 Strava 活動邀請後建立帳號承接紀錄。

### 1.4 對話式 onboarding 的 pacing

#### 查證到的事實

- Apple Developer 對 Duolingo 設計訪談指出，Duolingo 的角色與動畫是其互動和動機設計的一部分，角色回饋讓學習路徑更像有情緒的產品。來源：https://developer.apple.com/news/?id=jhkvppla ，查證日期 2026-08-06。
- Duolingo 官方品牌指南指出 Duo 以文字與 speech bubble 溝通，不用聲音；Duo 的行為是支持、情緒化、稍微笨拙，但避免突然或快速動作。來源：https://design.duolingo.com/writing/duo ，查證日期 2026-08-06。
- Lazyweb Research 2026-07-07 對 129 個 canonical onboarding flow 的分析指出，30 步以上的 onboarding 是 outlier，只有 12/129，median 為 11，p90 約 27；長流程主要出現在健康/健身與教育類個人化問卷。來源：https://www.lazyweb.com/research/is-30-onboarding-steps-too-many ，查證日期 2026-08-06。
- Nielsen Norman Group 在公開貼文中主張 onboarding instructions 若要求使用者先消化才可開始使用，會增加注意力與努力成本，應盡可能避免；該貼文連到 NN/g「Onboarding: Skip it When Possible」。來源：https://www.linkedin.com/posts/nielsen-norman-group_onboarding-skip-it-when-possible-video-activity-6758060886260367360-dG8h ，查證日期 2026-08-06。

#### 推論

目前已實作的「寵物出現、五個 chat bubbles 依序出現、可跳過、看過後永久 dismissed」方向正確，但需要更明確地把它當作 greeting，不是功能 tour。

建議 pacing：

- 訊息數：維持 4 到 5 則，不超過 5 則。理由是 Phubbing Anchor 不是教育/健康長問卷，沒有資格用 30+ 步建立個人化承諾。
- 每則長度：中文 12 到 20 字，單一語意，不塞教學。
- 顯示間隔：第一則 250ms 後出現，後續每則 700 到 900ms；若使用者點任意位置，立即顯示下一則或全部展開。
- typing animation：不建議逐字打字。使用「bubble pop-in + 淡入」即可。原因是逐字動畫會把 onboarding 變成等待，且本產品第一價值在現場行動，不在讀文字。
- skip：保留，而且要是 44pt 可點區；文案用「先開始」比「跳過」更符合產品氣質。

### 1.5 Onboarding 完成後的第一動作

#### 查證到的事實

- Meetup 的 app 頁面把找附近活動、保持社群連結、管理活動列為核心用途。來源：https://www.meetup.com/apps/ ，查證日期 2026-08-06。
- Discord mobile guide 在註冊後的核心行動包含加入 server、建立 DM/group chat、開始 voice call。來源：https://support.discord.com/hc/en-us/articles/360046618751-Getting-Started-on-Mobile ，查證日期 2026-08-06。
- Strava 的邀請活動流程顯示，被邀請者的第一價值不是建立 profile，而是承接一筆已與朋友共同發生的活動。來源：https://support.strava.com/en-us/articles/15401797-inviting-a-friend-to-your-activity ，查證日期 2026-08-06。

#### 推論

Phubbing Anchor onboarding 完成後的第一動作不應固定為「建立群組」。第一次開 app 的使用者可能是主持人，也可能只是掃 QR 的來賓。建議首頁完成 onboarding 後直接顯示兩個任務導向入口：

1. 主要：開始聚會
2. 次要：加入聚會
3. 第三層：建立群組

原因：產品第一價值是「此刻這群人開始一場共享互動」。群組是重複聚會的容器，不是第一次使用的必要前置。

### 1.6 可執行建議

#### P0：保留現有對話式 onboarding，但改成短 greeting

- 查證到的事實：Duolingo 的 mascot 透過文字 bubble 與溫和動作建立角色感；Duo 不用聲音，也避免突兀快速動作。來源：https://design.duolingo.com/writing/duo ，查證日期 2026-08-06。
- 推論：Phubbing Anchor 的寵物首次出現應該說明產品邊界，而不是列功能。建議五句：
  1. 我不是來叫你少用手機。
  2. 我是來幫你們一起用手機。
  3. 聚會中，共享使用是好的。
  4. 只有各滑各的，才是我們要避開的。
  5. 準備好就把大家帶進來。

#### P0：完成後第一屏以「開始聚會」為主，不以「建立群組」為主

- 查證到的事實：Apple HIG 建議讓使用者先體驗價值，再要求帳號。來源：https://developer.apple.com/design/human-interface-guidelines/managing-accounts ，查證日期 2026-08-06。
- 推論：首次體驗的最短價值路徑是「開始聚會或加入聚會」，不是「整理群組資料」。建立群組放在 secondary link 或首次聚會結束後。

#### P1：空狀態改成三入口 blank slate

- 查證到的事實：empty state 應說明為什麼空、這裡將來會有什麼、提供一個直接下一步。來源：https://nielsendesignsystem.com/components/empty-state/ 與 https://www.useronboard.com/onboarding-ux-patterns/empty-states/ ，查證日期 2026-08-06。
- 推論：首頁零內容時不要顯示「還沒有群組」這種死訊息。改成一句情境句加三個入口：「你們現在在一起嗎？」主按鈕「開始聚會」，次按鈕「加入聚會」，文字連結「先建立固定群組」。

#### P1：加入聚會後的 soft sign-up

- 查證到的事實：Strava 可讓被邀請的新使用者建立帳號後承接一筆朋友活動。來源：https://support.strava.com/en-us/articles/15401797-inviting-a-friend-to-your-activity ，查證日期 2026-08-06。
- 推論：聚會結束 recap 頁才是來賓註冊的最佳時機，文案應是「保存這次回憶」，不是「建立帳號」。

---

## 2. Topic 2：定錨儀式變體

這是本文件最高優先區。若定錨儀式只有「所有人長按到 100%」一種，週聚會第 8 次後會被視為進場障礙。儀式變體的核心不是炫技，而是讓「同步投入」保持新鮮、具身、可被群體記住。

### 2.1 候選變體總覽

| 變體 | 核心互動 | 查證到的技術基礎 | 推論：社交價值 | 推論：工程成本 | 建議 |
|---|---|---|---|---|---|
| 同步深呼吸 | 所有人依同一呼吸節奏吸/吐，最後一拍一起完成 | WebView 可使用 microphone/camera 需權限；Capacitor 可接 native plugin；haptics 可做節奏提示 | 高，具身同步且不需離席 | 中高，若要真偵測呼吸較難 | 第二或第三波，不當第二實作首選 |
| 團體合照定錨 | 全員進入倒數，主持人或所有人拍同一張聚會照 | Capacitor Camera 官方支援 iOS/Android 拍照 | 高，直接產生 shared memory，可進 recap | 中，影像與權限處理 | 最佳第二實作候選 |
| 同步動作/手勢 | 每人同時搖一下、翻面、抬起手機 | Capacitor Motion 官方支援 accelerometer/orientation | 中高，有明顯同步感 | 中，感測器雜訊需容錯 | 第三候選 |
| 共同 NFC tag | 每人輪流或同時掃桌上同一 NFC tag | iOS Core NFC 可讀 NDEF；Android NFC 可透過 plugin；但硬體與 iOS session 限制多 | 高，物理錨點強 | 高，硬體與支援風險 | 場測道具版，不建議先做 |
| 群體倒數 | 房主按開始，所有人跟 3-2-1 同步點一下 | WebSocket + haptics 即可 | 中，成本低但新鮮度有限 | 低 | 可作 fallback/低成本變體 |

### 2.2 技術可行性：Capacitor / iOS / Android

#### 2.2.1 Camera：團體合照、拍攝特定物件

##### 查證到的事實

- Capacitor Camera API 可拍照或選取相簿照片；iOS 需在 `Info.plist` 加 `NSCameraUsageDescription`、`NSPhotoLibraryAddUsageDescription`、`NSPhotoLibraryUsageDescription`；Android 使用 Camera plugin 拍照本身通常不需額外 permission，除非 `saveToGallery: true`，且 Android camera 會啟動獨立 Activity，需處理 app 被 OS 終止後的 restored result。來源：https://capacitorjs.com/docs/apis/camera ，查證日期 2026-08-06。
- Capacitor Camera v8 新 API 包含 `takePhoto`、`chooseFromGallery`、`recordVideo`、`editPhoto`，`takePhoto` 結果可用 `webPath` 顯示，native full-resolution base64 需透過 Filesystem 讀 `uri`。來源：https://capacitorjs.com/docs/apis/camera ，查證日期 2026-08-06。
- HCI 研究 Mobiphos 探討 collocated mobile users 的即時拍照與分享，指出照片長期是創造記憶與共同說故事的 artifact，並研究共處群體同步 capture/share 如何影響互動。來源：Patel, Clawson, Voida, Lyons, 2009, International Journal of Human-Computer Studies, DOI 10.1016/j.ijhcs.2009.09.002；查證頁：https://www.sciencedirect.com/science/article/abs/pii/S1071581909001244 ，查證日期 2026-08-06。
- Van House 2009 在 International Journal of Human-Computer Studies 討論 collocated photo sharing、storytelling 與 self performance，指出共處觀看照片是即興、情境化的說故事互動，照片與口語敘事共同建構身份與關係。來源：https://www.sciencedirect.com/science/article/abs/pii/S1071581909001256 ，查證日期 2026-08-06。

##### 推論

團體合照定錨很適合作為第二實作，因為它同時滿足三個目標：

1. 儀式有新鮮度：從「按住」換成「一起入鏡」。
2. 產物可留存：照片可直接成為 recap report 與共同寵物能量來源。
3. 技術風險可控：Capacitor Camera 是官方 plugin，不需要自寫 native bridge。

不建議做「拍攝特定物件解鎖」作為第二實作。這種模式適合單人 blocker 的自我約束，但 Phubbing Anchor 的價值是群體同步。拍物件會把注意力從人轉到物，且要做物件辨識會增加 AI 或 CV 成本。

#### 2.2.2 Microphone / 呼吸偵測

##### 查證到的事實

- Apple WebKit 2020 年說明指出 iOS 14.3 beta 起，`navigator.mediaDevices.getUserMedia` 可被暴露給 WKWebView app，前提是嵌入 app 具備原生 audio/video capture 能力；camera/microphone access 仍由使用者 prompt 控制。來源：https://webkit.org/blog/11353/mediarecorder-api/ ，查證日期 2026-08-06。
- Android WebView 的 camera/microphone 網頁權限會透過 `WebChromeClient.onPermissionRequest`，且必須先取得 Android runtime permissions，例如 `CAMERA`、`RECORD_AUDIO`。來源：https://developer.android.com/develop/ui/compose/migrate/interoperability-apis/wrap-webview-in-compose 與 https://developer.android.com/reference/android/webkit/PermissionRequest ，查證日期 2026-08-06。
- Apple WKWebView 文件列出 `cameraCaptureState`、`microphoneCaptureState`、`setCameraCaptureState`、`setMicrophoneCaptureState` 等管理 camera/microphone capture 的 API。來源：https://developer.apple.com/documentation/webkit/wkwebview ，查證日期 2026-08-06。
- 2026 年 Konvalinka、Sebanz、Knoblich 在 Annals of the New York Academy of Sciences 的研究指出，參與者在雙向同步呼吸時會產生心律 in-phase synchrony，但也觀察到個體內呼吸-心律耦合被打散的 trade-off。來源：https://nyaspubs.onlinelibrary.wiley.com/doi/abs/10.1111/nyas.70285 ，查證日期 2026-08-06。

##### 推論

同步深呼吸的 UX 潛力很高，但工程上要分兩層：

- P1 可做「引導式同步呼吸」：不用麥克風偵測，只用全員同一節奏動畫、haptics、按住/放開確認。這可避開 microphone 權限與雜訊。
- P2 再做「粗略呼吸偵測」：用 microphone 音量包絡或前鏡頭胸口/臉部微動估計呼吸。這部分需要真人場測，否則誤判會破壞儀式。

若要放進研究論文，呼吸儀式要避免宣稱「一定提升親密感」。較嚴謹的說法是：同步呼吸是一種具身同步設計，生理同步與關係結果的關聯在文獻中存在但效果小且異質性高。

#### 2.2.3 Motion：同步動作/手勢

##### 查證到的事實

- Capacitor Motion API 追蹤 accelerometer 與 device orientation；iOS 裝置必須在 user-initiated action 後請求 `DeviceMotionEvent.requestPermission()` 或 `DeviceOrientationEvent.requestPermission()`；API 可監聽 `accel` 與 `orientation`。來源：https://capacitorjs.com/docs/apis/motion ，查證日期 2026-08-06。
- Motion event 提供三軸 acceleration、accelerationIncludingGravity、rotationRate 與 interval。來源：https://capacitorjs.com/docs/apis/motion ，查證日期 2026-08-06。

##### 推論

同步動作可設計為「所有人一起把手機面朝下，再一起翻回來」或「倒數後一起輕搖」。比深呼吸更容易偵測，但要處理：

- iOS motion permission 必須由使用者動作觸發，不能 app 一開就要。
- 不同手機 IMU 取樣率與噪聲不同，判定需寬鬆。
- 聚餐桌面不適合大幅甩動，最好用「翻面」而非「搖晃」。

建議門檻：在 server 指定的 1.2 秒窗口內，每台裝置偵測到一次 rotation/acceleration peak 即算完成，不要求波形完全一致。

#### 2.2.4 NFC：共同物理錨點

##### 查證到的事實

- Apple Core NFC 可偵測 NFC tag、讀取 NDEF data，也可寫入 tag，且需要支援 NFC 的裝置；Apple 文件建議啟動 reader session 前檢查 `readingAvailable`。來源：https://developer.apple.com/documentation/CoreNFC ，查證日期 2026-08-06。
- Apple 的 NFC tag reader sample 要求開啟 Near Field Communication Tag Reading capability，並在 `Info.plist` 加 `NFCReaderUsageDescription`；缺少該 key 時 app 會退出。來源：https://developer.apple.com/documentation/CoreNFC/building-an-nfc-tag-reader-app ，查證日期 2026-08-06。
- Apple HIG 指出 background tag reading 可讓使用者不用先打開 app 就掃 tag；但背景讀取在多種情況不可用，例如 reader session 進行中、Wallet/Apple Pay 使用中、相機使用中、飛航模式、重新開機後尚未解鎖等。來源：https://developer.apple.com/design/human-interface-guidelines/nfc 與 https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading ，查證日期 2026-08-06。
- `@exxili/capacitor-nfc` 是第三方 Capacitor NFC plugin，支援 iOS/Android 讀寫 NDEF，並提供 `isSupported()`、`startScan()`、`cancelScan()`、`writeNDEF()` 與 read listener；文件指出 iOS NFC 僅在相容裝置與 iOS 13+ 可用。來源：https://github.com/Exxili/capacitor-nfc ，查證日期 2026-08-06。
- Lock - NFC App Blocker 的 Google Play 說明顯示其用 NFC tag 啟動/解除阻擋，主張「physical gesture, not a tap」與「friction creates intention」，需求為 Android 14+ 與 NFC。來源：https://play.google.com/store/apps/details?id=com.nathanb.lock ，查證日期 2026-08-06。
- Bloka 官方頁面主張以 NFC tag 或 AI camera object scan 建立 focus trigger。來源：https://bloka.shop/ ，查證日期 2026-08-06。
- Noff 官方頁面主張 iPhone NFC app blocker 可用使用者自備相容 NFC tag，核心流程 offline-first，launch price 9.99 歐元。來源：https://noff.app/ ，查證日期 2026-08-06。

##### 推論

NFC 是「儀式感」最強的變體之一，因為它把 anchor 變成桌上一個共同物件。但不建議作為第二實作：

- 需要實體 tag，增加場測部署成本。
- iOS NFC session UI 與權限限制會中斷沉浸。
- 「所有人同時掃同一 tag」物理上可能不方便，實務上會變成輪流掃，降低同步性。

更合理的使用方式是「研究場測道具」或「高級模式」：固定聚會群組可把 NFC 貼在桌邊，聚會開始時每人掃一次。它比較像「進場簽到儀式」，不是最通用第二儀式。

#### 2.2.5 Haptics：所有儀式共用節奏語言

##### 查證到的事實

- Capacitor Haptics API 提供 `impact`、`notification`、`vibrate`、`selectionStart`、`selectionChanged`、`selectionEnd`；沒有 Taptic Engine 或 vibrator 的裝置會 resolve 但不執行實際回饋。來源：https://capacitorjs.com/docs/apis/haptics ，查證日期 2026-08-06。
- Capacitor Haptics 文件把 `impact` 連到 iOS `UIImpactFeedbackGenerator`，`notification` 連到 `UINotificationFeedbackGenerator`，`selection` 用於 selection changed。來源：https://capacitorjs.com/docs/apis/haptics ，查證日期 2026-08-06。
- Apple Core Haptics 可組合 transient 與 continuous haptic events，用於自訂 iOS haptic/audio feedback pattern。來源：https://developer.apple.com/documentation/corehaptics ，查證日期 2026-08-06。
- Android Developers haptics 文件指出現代 Android 裝置有不同 vibration actuator 能力，且可設計 richer haptic effects；文件也要求注意 accessibility best practices。來源：https://developer.android.com/develop/ui/views/haptics ，查證日期 2026-08-06。

##### 推論

本產品不需要一開始就用 Core Haptics 自寫複雜 pattern。先用 Capacitor Haptics 對齊既有互動規格即可：

- 倒數每拍：`selectionChanged` 或 light impact。
- 個人完成：heavy impact。
- 全員完成：notification success。
- 失敗/逾時：notification error。

### 2.3 什麼叫「同步」：毫秒門檻與人類感知

#### 查證到的事實

- PLOS One 2019 對 event timing 的回顧指出，simultaneity threshold 依感官通道而異：聽覺可低到 2-3ms；視覺通常是數十毫秒，例如 50-60ms；觸覺約 20-30ms；跨模態 simultaneity threshold 可超過 100ms。來源：https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0226122 ，查證日期 2026-08-06。
- Networked Music Performance 研究常把 ensemble performance threshold 設在 25ms 左右；Lakiotakis et al. 2019 指出 NMP 的最大 end-to-end delay 應小於 25ms。來源：https://onlinelibrary.wiley.com/doi/full/10.1002/cpe.4730 ，查證日期 2026-08-06。
- 2025 MDPI Future Internet 的 Network Music Performance 實驗指出，節奏表演 QoE 在最高 40ms delay 仍可接受，並提到過往 hand-clap synchronization 研究認為超過 25-30ms 會有問題。來源：https://www.mdpi.com/1999-5903/17/8/337 ，查證日期 2026-08-06。
- Synchrony in Psychotherapy review 指出 Tschacher et al. 2013 在 51 對同性交談 dyad 的影片分析中，身體動作在約 6 秒窗口內顯著相關，超出該窗口後接近 chance，並把這種時間窗口連到「social present」。來源：https://pmc.ncbi.nlm.nih.gov/articles/PMC4907088/ ，查證日期 2026-08-06。

#### 推論

Phubbing Anchor 不需要達到音樂合奏的 25-40ms 門檻，因為定錨不是節奏演奏，也不是遠端合奏。使用者只需要感到「我們一起完成」。建議採三層同步判準：

- UI 感知同步：畫面倒數、haptic、全員完成動畫應在本機 0ms 反應，server 確認後校正。目標是使用者感到同步，不是 server log 完全同時。
- 完成判定同步：所有成員的 completion timestamp 落在 server 指定窗口內。長按儀式可用 300ms；倒數點擊可用 500ms；動作/翻面可用 1,200ms；呼吸可用 2,000ms。
- 研究分析同步：若要寫論文，不只記「是否成功」，也記每位成員 offset distribution，例如標準差、max-min、成功前嘗試次數，才能分析 ritual synchrony 與 closeness/社會臨場感的關聯。

### 2.4 WebSocket + optimistic UI 架構

#### 查證到的事實

- 既有 UX 升級計畫已要求 WebSocket 寫入採 optimistic UI：使用者動作到畫面變化 0ms，不等 server；3 秒未確認就回滾並顯示非阻斷提示。來源：本 repo `docs/superpowers/plans/2026-08-05-ux-excellence.md`，查閱日期 2026-08-06。

#### 推論

建議儀式共用協定：

```text
SERVER:
  ritual_id
  variant
  server_start_at_ms
  window_ms
  participants[]
  status: waiting | countdown | active | resolving | success | failed

CLIENT:
  on RITUAL_PREPARE:
    estimate clock_offset = server_now - client_now using ping/pong median
    preload haptic/camera/motion permission priming if needed

  on RITUAL_COUNTDOWN:
    render countdown based on server_start_at_ms - clock_offset
    run local haptic ticks

  on user action:
    immediate local completion animation
    send RITUAL_SIGNAL {
      ritual_id,
      participant_id,
      client_action_at_ms,
      estimated_server_action_at_ms,
      signal_type,
      confidence
    }

SERVER:
  canonical timestamp = server receive time adjusted by optional client offset
  success if all required participants have signal confidence >= threshold
  and max(timestamp) - min(timestamp) <= variant.window_ms
```

同步設計要避免「等 server 才動」：這會讓每台手機看到不同延遲，儀式感反而變差。正確做法是 server 發共同起點，client 本地倒數與 haptic；server 只判定最終是否成功。

### 2.5 行為同步與社會連結的學術文獻

#### 2.5.1 同步行為對 prosociality / affiliation 的效果

##### 查證到的事實

- Rennung & Göritz 2016 在 Social Psychology 發表 `Prosocial Consequences of Interpersonal Synchrony: A Meta-Analysis`，整合 60 個 published/unpublished experiments，發現 interpersonal synchrony 對 prosociality 有中等效果；文中報告 general prosociality g = 0.48，prosocial behavior 35 個獨立研究 g = 0.45, 95% CI [0.30, 0.60], p < .0001，但也指出行為效果受 experimenter blindedness 與 intentionality 影響，且有方法學偏誤風險。來源：https://pmc.ncbi.nlm.nih.gov/articles/PMC5137339/ ，查證日期 2026-08-06。
- Hove & Risen 2009 在 Social Cognition 發表 `It's All in the Timing: Interpersonal Synchrony Increases Affiliation`，以 finger movement matching 操弄同步，發現同步程度預測 affiliation ratings；第三個實驗指出 affiliation effect 是 interpersonal synchrony 特有，不只是 mimicry。來源：https://guilfordjournals.com/doi/10.1521/soco.2009.27.6.949 ，查證日期 2026-08-06。
- Wiltermuth & Heath 2009 在 Psychological Science 發表 `Synchrony and Cooperation`，研究 marching、singing、dancing 等同步活動與合作；PubMed 摘要確認其主題為軍隊、教會、組織與社群常透過 march/sing/dance 讓成員同步行動。來源：https://pubmed.ncbi.nlm.nih.gov/19152536/ ，查證日期 2026-08-06。
- Mogan, Fischer & Bulbulia 2017 在 Journal of Experimental Social Psychology 發表 `To be in synchrony or not? A meta-analysis of synchrony's effects on behavior, perception, cognition and affect`；ScienceDirect 摘要指出 prosocial behavior 的 weighted random-effect mean effect size 為 0.28, SE 0.03, p < .001, 95% CI [0.22, 0.34]。來源：https://www.sciencedirect.com/science/article/pii/S0022103116306114 ，查證日期 2026-08-06。
- Jackson et al. 2018 在 Scientific Reports 發表 `Synchrony and Physiological Arousal Increase Cohesion and Cooperation in Large Naturalistic Groups`，在體育場操弄同步/非同步行走與高/低 arousal，觀察 group formation、dispersal、cooperation；摘要指出 synchrony 與 arousal 都預測更大群組、更緊密 clustering 與更多合作，且 synchrony 與 arousal 在 clustering/cooperation 上互動。來源：https://pmc.ncbi.nlm.nih.gov/articles/PMC5760525/ ，查證日期 2026-08-06。
- Gordon et al. 2020 在 Scientific Reports 發表 `Physiological and Behavioral Synchrony Predict Group Cohesion and Performance`，51 個三人組被分配到 synchronized 或 asynchronized drumming；摘要指出 drumming task 提高心臟 interbeat interval 的 physiological synchrony，behavioral/physiological synchrony 預測 group cohesion，physiological synchrony 也預測後續 group drumming performance。來源：https://www.nature.com/articles/s41598-020-65670-1 ，查證日期 2026-08-06。

##### 推論

對畢業專題最有力的論述不是「同步一定讓人更親密」，而是：

1. 多篇實驗與 meta-analysis 支持「同步行為」與 prosociality、affiliation、group cohesion 有正向關係。
2. 效果大小不是無限大，且受方法學與情境影響。
3. Phubbing Anchor 的定錨儀式可被定位為一個低成本、可重複、可變體化的 behavioral synchrony intervention。

這樣寫比把 ritual 包裝成心理魔法更嚴謹，也更適合國科會報告。

#### 2.5.2 生理同步與呼吸同步：可用但要保守

##### 查證到的事實

- Mayo, Lavidor & Gordon 2021 在 Physiology & Behavior 發表 `Interpersonal autonomic nervous system synchrony and its association to relationship and performance - a systematic review and meta-analysis`。PubMed 摘要指出 relationship outcomes 的整體相關效果小且邊緣不顯著 ES = 0.09, p > .10, I2 = 76.0%；performance outcomes 的效果小但顯著 ES = 0.26, p < .01, I2 = 52.7%；不同自律神經分支效果不同。來源：https://pubmed.ncbi.nlm.nih.gov/33744259/ ，查證日期 2026-08-06。
- Marzoratti & Evans 2022 在 Cognitive, Affective, & Behavioral Neuroscience 發表 `Measurement of interpersonal physiological synchrony in dyads: A review of timing parameters used in the literature`，指出 IPS 沒有單一定義，研究者應根據生理系統與心理歷程決定時間窗口。來源：https://pubmed.ncbi.nlm.nih.gov/35556231/ ，查證日期 2026-08-06。
- Gordon & Bartsch 2026 在 Nature Reviews Psychology 發表 review，摘要指出 interpersonal physiological synchrony 的心理意義仍 ambiguous，並指出 2020-2024 文獻中 social-oriented、performance-oriented、self-oriented correlates 皆有 critical issues。來源：https://www.nature.com/articles/s44159-026-00535-4.pdf ，查證日期 2026-08-06。
- Konvalinka, Sebanz & Knoblich 2026 在 Annals of the New York Academy of Sciences 的 breathing synchronization 研究發現同步呼吸會引發心律 in-phase synchronization，但也伴隨個體內 cardiorespiratory decoupling。來源：https://nyaspubs.onlinelibrary.wiley.com/doi/abs/10.1111/nyas.70285 ，查證日期 2026-08-06。

##### 推論

同步深呼吸很適合作為「儀式變體」而非「療癒功能」。產品文案應避免「一起呼吸會讓你們更親密」這種超出證據的說法。研究假設可以寫成：

「相較於單純長按，同步呼吸定錨可能提升主觀 social presence 與 group cohesion，因為它增加了具身同步與共同注意；但生理同步與關係結果的關聯在文獻中效果小且異質，因此需以場測資料驗證。」

#### 2.5.3 共享經驗、合照與回憶

##### 查證到的事實

- Chung & Mennella 2024 在 Royal Society Open Science 發表 `Social bonding through shared experiences: the role of emotional intensity`，研究 unacquainted dyads 共同觀看影片，發現強烈情緒 arousal 與 dyad 內 reciprocal prosocial attitudes 出現有關，且該效果依賴 joint attention；研究沒有觀察到 dyad emotion convergence/synchronization，因此相似情緒不是 bonding 的必要條件。來源：https://pmc.ncbi.nlm.nih.gov/articles/PMC11521598/ ，查證日期 2026-08-06。
- Patel et al. 2009 的 Mobiphos 研究指出照片是記憶與共同說故事 artifact，並研究 collocated mobile users 即時拍攝/分享如何影響群體與環境互動。來源：https://www.sciencedirect.com/science/article/abs/pii/S1071581909001244 ，查證日期 2026-08-06。
- Van House 2009 指出共處照片觀看是一種 situated interaction，透過故事講述者、觀眾、影像共同建構身份與關係。來源：https://www.sciencedirect.com/science/article/abs/pii/S1071581909001256 ，查證日期 2026-08-06。
- 2026 年 Journal of Computer-Mediated Communication 論文 `Virtual placemaking` 的新聞稿指出，集體重訪共享記憶與 self-built virtual replicas 可增加 group cohesion 與 collective psychological ownership；這是 VR 情境，不是手機合照。來源：https://www.jou.ufl.edu/2026/01/13/using-virtual-reality-to-share-memories-can-increase-group-bonding/ ，查證日期 2026-08-06。

##### 推論

團體合照定錨的核心不是「拍照本身會讓人親密」，而是它把儀式完成轉成可被共同回看、共同講述、共同擁有的 artifact。這與 Phubbing Anchor 的 recap report、gathering photos、共同寵物都能自然接起來，因此比純倒數更能推動 North Star。

### 2.6 誰選變體、多久輪換、是否情境推薦

#### 查證到的事實

- 使用者提供的 Focus Lab 2026-07-29 公開貼文線索指出 blocker developer 發現 novelty 維持使用，並設計多種 unlock methods；本研究透過 web search 未找到可核驗原文。查證日期 2026-08-06。
- 可核驗的 blocker 類產品來源顯示：Lock 用 NFC tag 做 physical gesture；Bloka 用 NFC tag 或 AI camera scan object；Noff 用 iPhone NFC tag 作為 intentional break。來源：https://play.google.com/store/apps/details?id=com.nathanb.lock 、https://bloka.shop/ 、https://noff.app/ ，查證日期 2026-08-06。

#### 推論

變體選擇權應屬於房主，但 app 可給預設推薦。理由：房主承擔現場節奏控制，讓所有人投票會把開始流程拉長。建議：

- 預設自動輪換：同一群組連續聚會時，避免連續 2 次使用同一 ritual。
- 房主可覆寫：開始前一個 segmented control 選「經典長按 / 合照 / 倒數 / 呼吸 / 翻面」。
- 情境推薦：
  - 餐廳/咖啡廳：合照或倒數，不建議大幅動作。
  - 會議/讀書會：深呼吸或長按，安靜不打擾。
  - 家庭聚會：合照，因為回憶價值高。
  - 戶外活動：同步動作或合照。
  - 沒授權 camera/motion：自動 fallback 到長按或倒數。

### 2.7 第二實作候選排序

#### 推論：推薦第二實作為「團體合照定錨」

理由：

1. 工程成本與風險最低：Capacitor Camera 是官方 plugin；不需要 NFC 硬體、microphone 生理偵測、複雜 motion 分類。
2. 社交產物最強：照片可直接成為 gathering photos、recap report、共同寵物成長素材。
3. 與 North Star 對齊：合照不是單人手機操作，而是共同注意、共同回憶、共同身份。
4. 與產品定位不衝突：聚會中拿起手機拍全員共享照片屬於 shared use，不是 isolating use。

建議 MVP 流程：

1. 房主選「合照定錨」。
2. App 顯示 3 秒全員倒數，每台手機同步 haptic。
3. 倒數結束後，房主手機打開 camera；其他人看到「看向房主鏡頭」。
4. 房主拍照後，server 收到 photo anchor event。
5. 所有人手機同時顯示照片縮圖與「本次聚會已定錨」成功動畫。
6. 照片進入本次 gathering photos，recap report 可引用「開場合照」。

為了避免「只有房主在操作」，其他成員需要在倒數前按住或點一下「我在鏡頭裡」確認。這讓每個人仍有參與感，也保留 ritual synchrony 資料。

### 2.8 可執行建議

#### P0：儀式引擎先抽象 variant，不要只為長按寫死

- 查證到的事實：既有 UX 計畫已要求 optimistic WebSocket 動作抽象。來源：`docs/superpowers/plans/2026-08-05-ux-excellence.md`，查閱日期 2026-08-06。
- 推論：資料模型加入 `ritual_variant`、`window_ms`、`participant_signals`、`artifact_ids`。長按、合照、呼吸、翻面都走同一個 resolving 狀態機。

#### P0：第二實作做「團體合照定錨」

- 查證到的事實：Capacitor Camera 可跨 iOS/Android 拍照；collocated photo sharing 文獻支持照片作為記憶與共同敘事 artifact。來源：https://capacitorjs.com/docs/apis/camera 、Patel et al. 2009、Van House 2009，查證日期 2026-08-06。
- 推論：它是最好的成本/影響比。實作後可直接在 thesis 寫「shared media artifact + synchronous entry ritual」。

#### P1：加入低成本「群體倒數」作 fallback

- 查證到的事實：Capacitor Haptics 支援 selection/impact/notification。來源：https://capacitorjs.com/docs/apis/haptics ，查證日期 2026-08-06。
- 推論：倒數本身不夠新，但可當所有感測器/權限失敗時的低成本 ritual，避免流程卡死。

#### P1：第三候選做「手機翻面同步」

- 查證到的事實：Capacitor Motion 支援 accelerometer/orientation，iOS 需 user-initiated permission。來源：https://capacitorjs.com/docs/apis/motion ，查證日期 2026-08-06。
- 推論：翻面比搖晃更安靜、更適合餐桌，也比呼吸偵測容易驗證。

#### P2：同步深呼吸先做引導版，不做偵測版

- 查證到的事實：呼吸同步與生理同步有研究基礎，但自律神經同步和關係結果的 meta-analysis 顯示效果小、異質性高。來源：Mayo et al. 2021、Marzoratti & Evans 2022、Konvalinka et al. 2026，查證日期 2026-08-06。
- 推論：先用動畫/haptic 引導呼吸，場測主觀 closeness/social presence。等資料支持後再投資 microphone/camera 呼吸偵測。

#### P2：NFC 作研究場測道具，不作一般使用者主線

- 查證到的事實：Apple Core NFC 與第三方 Capacitor NFC plugin 可行，但 iOS capability、Info.plist、裝置支援與 reader session 限制都存在。來源：https://developer.apple.com/documentation/CoreNFC 、https://github.com/Exxili/capacitor-nfc ，查證日期 2026-08-06。
- 推論：NFC 很有儀式感，但部署成本高。適合畢專展示或固定實驗場域，不適合作為第二實作。

---

## 3. Topic 3：深化共同寵物

### 3a. 機制深化

#### 3a.1 哪些聚會行為驅動寵物狀態

##### 查證到的事實

- Finch 官方 Google Play 說明指出，使用者完成 self-care exercises 會讓寵物成長、獲得 rewards；早晨 mood checks 可 energize pet 去探索，晚上寵物回來分享故事。來源：https://play.google.com/store/apps/details?id=com.finch.finch ，查證日期 2026-08-06。
- Finch App Store 頁面指出，完成 self-care exercises 可 grow your pet、earn rewards；Apple Editor's Choice 文案也指出 Finch 以 companion 幫使用者完成 goals、guided journeys，並隨一致性揭露更多 virtual pet personality。來源：https://apps.apple.com/us/app/finch-self-care-pet/id1528595748 ，查證日期 2026-08-06。
- Widgetable Google Play 說明指出，其功能包含與朋友 co-parent virtual pets、feed/play/watch them grow，並以 lock/home screen widgets 維繫 besties/loved ones。來源：https://play.google.com/store/apps/details?id=com.widgetable.theme.android ，查證日期 2026-08-06。
- Widgetable App Store 版本紀錄 2026-05-28 顯示新增 `Co-Care Pet Mode in Shared Space`，不再輪流照顧，而是可一起同時照顧寵物。來源：https://apps.apple.com/ca/app/widgetable-besties-couples/id1641107226 ，查證日期 2026-08-06。
- Pokipet Google Play 說明指出使用者可與朋友、家人、同事 create a group pet，並共同餵食、玩耍、散步、清潔、裝飾、聊天。來源：https://play.google.com/store/apps/details?id=com.Moonbear.Pokipet ，查證日期 2026-08-06。
- Bandai Tamagotchi Paradise 商品頁指出，照顧方式與環境會影響成長，Paradise 有 12 種 species、超過 50 種 tamagotchi，並可透過繁殖/基因產生更多外觀變化。來源：https://toy.bandai.co.jp/en/article/detail/?cate=item&path=01_5439 ，查證日期 2026-08-06。
- Bandai 2025-07-09 press release 指出 Tamagotchi 截至 2025 年 3 月累計出貨 9,810 萬個，Tamagotchi Paradise 預購數超過前作 Tamagotchi Uni 的 400%。來源：https://www.bandai.co.jp/press/2025/250709.php ，查證日期 2026-08-06。

##### 推論

Phubbing Anchor 的寵物能量只能來自「真實面對面聚會」，不能來自每日登入、點擊、廣告或單人任務。可驅動 pet state 的行為應分成四類：

- 聚會出席：有多人在同一場 gathering 內完成定錨，給基礎能量。
- 共同在場：focus mode 期間 isolating use 少，給穩定能量。
- 共享互動：Q&A、Taboo、合照、共同 recap reaction，給特質素材。
- 重複見面：同一群組按約定頻率再次聚會，給成長階段進度。

不應驅動 pet state 的行為：

- 每日打開 app。
- 單人餵食/清潔點擊。
- 看廣告拿食物。
- 聚會外聊天陪寵物。
- 因未登入、未點擊而扣血。

#### 3a.2 成長曲線

##### 推論

建議使用「聚會粒度」而非「天粒度」：

```text
Stage 0：剛被大家遇見
  需求：首次完成群組定錨
  回饋：寵物獲得群組名稱與第一張聚會記憶

Stage 1：認得大家
  需求：2 場有效聚會
  回饋：寵物開始在 recap 中提到成員名字

Stage 2：有群組習慣
  需求：4 場有效聚會，且至少 2 次包含共享活動
  回饋：解鎖第一個行為特質，例如「愛問問題」或「愛合照」

Stage 3：形成分支
  需求：8 場有效聚會
  回饋：依主要聚會行為進化外觀/稱號

Stage 4：群組傳說
  需求：12 場有效聚會或一個學期結束
  回饋：生成學期共同回憶頁，寵物作為旁白
```

Stage 數字要讓一個每週聚會的群組在 8 週左右看到分支，剛好對應「第 8 次長按會疲乏」的問題。寵物進化與 ritual variant rotation 應同步：第 4 場後解鎖第二儀式，第 8 場觸發分支進化。

#### 3a.3 分支進化觸發

##### 查證到的事實

- Bandai Tamagotchi Paradise 商品頁明確把照顧與環境連到不同 species 與外觀發現。來源：https://toy.bandai.co.jp/en/article/detail/?cate=item&path=01_5439 ，查證日期 2026-08-06。
- Finch 以完成自我照顧任務驅動寵物探索與個性揭露。來源：https://apps.apple.com/us/app/finch-self-care-pet/id1528595748 ，查證日期 2026-08-06。

##### 推論

Phubbing Anchor 分支不應由「照顧好/照顧壞」決定，而應由「這群人如何相處」決定：

- 問答型：Q&A 完成率高，recap 中「更了解某人」事件多。進化為好奇型。
- 遊戲型：Taboo/活動參與率高。進化為熱場型。
- 回憶型：合照、聚會照片、recap reaction 多。進化為收藏型。
- 穩定型：定期聚會、focus mode 完成率高。進化為守候型。
- 混合型：各項平均，進化為平衡型。

分支文案不可暗示優劣。不要說「你們太少互動，所以變成普通型」。應說「牠長成了很會守住固定相聚節奏的樣子」。

#### 3a.4 沒聚會時的狀態

##### 查證到的事實

- Pokipet 與 Widgetable 的商店說明都包含傳統照顧行為，如 feed、play、clean、walk；Google Play 使用者評論也反映廣告/照顧壓力可能造成挫折。來源：https://play.google.com/store/apps/details?id=com.Moonbear.Pokipet 與 https://play.google.com/store/apps/details?id=com.widgetable.theme.android ，查證日期 2026-08-06。

##### 推論

Phubbing Anchor 必須避免 Tamagotchi 式死亡/生病/逃走懲罰。沒聚會時寵物狀態只有三種：

- 正常等待：距離上次聚會不久。
- 想念大家：距離約定頻率超過一段時間。
- 準備下次：有人建立新聚會或 RSVP。

文案方向：

- 可以：「牠把上次的合照翻出來看了。」
- 可以：「牠好像在等大家約下一次。」
- 不可以：「牠餓了，快回來餵牠。」
- 不可以：「再不打開 app 牠會生病。」

#### 3a.5 多人共同飼養：貢獻顯示與壓力控制

##### 查證到的事實

- Widgetable 主打 co-parent pets，並在 2026-05-28 App Store 版本紀錄推出可同時共同照顧的 Co-Care Pet Mode。來源：https://apps.apple.com/ca/app/widgetable-besties-couples/id1641107226 ，查證日期 2026-08-06。
- Pokipet 主打 group pet，可和朋友/家人/同事共同擁有與照顧。來源：https://play.google.com/store/apps/details?id=com.Moonbear.Pokipet ，查證日期 2026-08-06。

##### 推論

Phubbing Anchor 的共同飼養不應顯示個人排行榜。貢獻呈現要從「誰做最多」改成「每個人留下的痕跡」：

- 顯示個人 contribution stamp：某次聚會小明帶來 Q&A 題目、小華完成合照定錨、阿仁答出 Taboo 關鍵詞。
- 不顯示總分排名。
- 不顯示「某人害大家少拿能量」。
- 若有人中途使用手機，不扣寵物血，只是該段不產生能量。
- 餵食權不是任意點擊，而是聚會結束後由系統把本次能量自動轉成一頓「大家一起帶回來的食物」。

### 3a. 可執行建議

#### P0：把 pet energy 改名成 gathering energy

- 查證到的事實：Finch 的 energy 來自 self-care 行為；Widgetable/Pokipet 的照顧可由 feed/play 等 app 內行為觸發。來源：Finch、Widgetable、Pokipet 商店頁，查證日期 2026-08-06。
- 推論：Phubbing Anchor 必須避免 app 內點擊餵養。命名上直接鎖定 `gathering_energy`，並在資料層禁止 daily login reward。

#### P0：聚會結束才結算寵物成長

- 推論：成長回饋放在 summary/recap，不在 focus mode 中跳動畫。聚會進行中 app 要安靜，聚會後才開獎。

#### P1：用行為特質做分支，不用好壞照顧做分支

- 查證到的事實：Tamagotchi Paradise 照顧與環境影響物種/外觀。來源：https://toy.bandai.co.jp/en/article/detail/?cate=item&path=01_5439 ，查證日期 2026-08-06。
- 推論：本產品把「照顧品質」翻譯成「群組互動風格」，避免罪惡感。

#### P1：貢獻顯示採「痕跡牆」而非排行榜

- 推論：每個成員在寵物頁有 1 到 3 個小痕跡，例如「帶來第一張合照」「答對最多題」「上次讓大家笑最久」。這能提高 ownership，不製造 free-riding 指責。

---

### 3b. Character / IP 深化

#### 3b.1 什麼讓虛擬角色有記憶點

##### 查證到的事實

- Duolingo 官方 blog `Building character` 指出，Duolingo 角色被設計進多數練習中，讓角色「說」學習者正在翻譯的句子，且每個角色有獨特 correct answer animation；官方說角色讓使用者更願意花時間在產品世界中。來源：https://blog.duolingo.com/building-character/ ，查證日期 2026-08-06。
- Duolingo 官方 brand guideline 指出 Duo 是 mascot，透過文字與 speech bubble 溝通；Duo 的聲音更情緒化、支持、持續，但不做突然快速動作、不發聲。來源：https://design.duolingo.com/writing/duo ，查證日期 2026-08-06。
- Apple Developer `The evolution of the Duolingo owl` 指出 Duo 從 2012 launch 開始存在，後來成為提醒使用者完成 lesson 的角色，也因哭泣 email 與 meme 被使用者記住。來源：https://developer.apple.com/news/?id=e2e1faj4 ，查證日期 2026-08-06。
- Tamagotchi 官方 FAQ 指出 Gen1/Gen2 有 6 種成人角色，若含 Baby/Child/hidden character 有 11 種；Gen3 有 5 種成人角色、總計 13 種。來源：https://tamagotchi-official.com/us/series/original/faq/ ，查證日期 2026-08-06。
- Finch App Store Editor's Choice 文案指出，Finch 的 companion 會幫助使用者完成 goals/guided journeys，且隨一致性揭露更多 pet personality。來源：https://apps.apple.com/us/app/finch-self-care-pet/id1528595748 ，查證日期 2026-08-06。
- Widgetable 商店頁將 pet 與 lock/home screen widget、besties/loved ones connection 綁在一起，並支援 co-parenting。來源：https://play.google.com/store/apps/details?id=com.widgetable.theme.android ，查證日期 2026-08-06。

##### 推論

可記住的角色通常有四件事：

- 輪廓明確：縮到小尺寸仍能認出。
- 表情語言穩定：不用大量文字也知道牠開心、等待、想念、興奮。
- 行為規則一致：角色何時說話、何時安靜，有清楚邊界。
- 與核心循環綁定：不是裝飾，而是每次聚會成果的見證者。

Phubbing Anchor 的寵物不應像 Duo 一樣用 guilt push 拉人回 app；但可學 Duo 的一致語氣與 bubble 表達。角色定位應是「聚會記憶保管員」，不是「需要你每天照顧的小孩」。

#### 3b.2 用現有資產提高辨識度，不重畫整套 art set

##### 查證到的事實

- 現有圖像資產只有 cat、dog、fox、rabbit 四個 PNG。來源：本機檔案 `frontend/views/pet-swap/assets/`，查證日期 2026-08-06。
- Widgetable App Store 版本紀錄 2026-05-18/23 顯示加入 Pet Skins，讓使用者用 skins 建立獨特風格。來源：https://apps.apple.com/ca/app/widgetable-besties-couples/id1641107226 ，查證日期 2026-08-06。
- Duolingo blog `Shape language` 指出其 art style 以 minimalism、playfulness、exaggeration 與 attention-guiding 為原則，並用視覺與動畫引導注意。來源：https://blog.duolingo.com/shape-language-duolingos-art-style/ ，查證日期 2026-08-06。

##### 推論

不重畫整套圖時，可以用「配件、輪廓、表情覆層、背景記憶物」提高 IP 感：

- 固定主角輪廓：四種 animal 是 skin，但底層 silhouette token 要一致，例如頭部比例、眼睛位置、身體底座大小一致。
- Emoji-based skin options 不直接當主角，而是當「徽章/貼紙」：例如群組風格徽章、季節徽章、活動徽章。
- 表情覆層：用 CSS/HTML 疊眼睛、眉毛、嘴角，不改 PNG 本體。至少做 5 個表情：平常、期待、驚喜、想念、慶祝。
- 記憶配件：不畫新角色，只給小物件，如合照相框、問答卡、Taboo 沙漏、聚會桌牌。
- 群組專屬命名：寵物本名由群組在首次聚會後命名，species/skin 是次要。

#### 3b.3 角色在 onboarding、recap、notification 的敘事角色

##### 查證到的事實

- Duolingo brand guideline 指出 Duo 透過文字與 speech bubble 在 app、push notification、email 中與使用者溝通。來源：https://design.duolingo.com/writing/duo ，查證日期 2026-08-06。
- Meetup notifications 以 event-related notifications 為主，包含新活動、時間/地點變更、RSVP、organizer messages 等。來源：https://help.meetup.com/hc/en-us/articles/40708711818637-What-notifications-Meetup-can-send ，查證日期 2026-08-06。

##### 推論

Phubbing Anchor 的寵物敘事規則：

- Onboarding：寵物是 guide，負責說清「共享使用是好的，疏離使用才是敵人」。
- 聚會中：寵物應幾乎安靜，只在定錨完成、活動切換、聚會結束等狀態變更出現。
- Recap：寵物是旁白與記憶保管員，把本次發生的共享活動轉成短日記，但不可虛構未發生事件。
- Notification：寵物不是討照顧，而是提醒真人事件。只能用於「聚會前提醒」與「有人揪下一次」，不做每日呼喚。

通知文案：

- 可以：「今晚 7:00，大家約好的聚會要開始了。」
- 可以：「小華開了一場週五晚餐，等你回覆。」
- 可以：「上次那張合照已經放進你們的回憶了。」
- 不可以：「我好想你，快回來看我。」
- 不可以：「今天還沒餵我。」

### 3b. 可執行建議

#### P0：定義角色人格文件

- 查證到的事實：Duolingo 有公開 Duo voice/tone guideline，明確定義 Duo 是什麼、不是什麼、何時說話。來源：https://design.duolingo.com/writing/duo ，查證日期 2026-08-06。
- 推論：Phubbing Anchor 也要有角色準則，避免未來文案漂移成 guilt pet。建議人格：溫暖、會記得大家、輕微笨拙、尊重聚會安靜、不討餵、不催每日登入。

#### P0：現有四種 PNG 當 species skin，IP 主體改靠固定表情語言

- 推論：短期不要重畫整套圖。先用 CSS 疊表情、徽章、配件，讓 cat/dog/fox/rabbit 都有同一套情緒語言。

#### P1：寵物在 recap 裡說「已發生的事」

- 查證到的事實：照片與共處分享可支撐共同記憶與敘事。來源：Patel et al. 2009、Van House 2009，查證日期 2026-08-06。
- 推論：recap 文案必須 grounding 到實際資料，例如 Q&A 題目、合照、Taboo 結果、focus minutes。不要生成泛泛的「大家很開心」。

#### P1：用命名與群組徽章提高 ownership

- 查證到的事實：Widgetable 與 Pokipet 都以 co-parent/group pet 做 shared ownership。來源：Widgetable、Pokipet 商店頁，查證日期 2026-08-06。
- 推論：首次有效聚會後，讓大家替寵物命名，比一開始選物種更有情感價值。因為名字來自共同經驗，而不是 onboarding 裡的個人偏好。

---

## 4. 查證缺口

- Focus Lab 2026-07-29 公開貼文：使用者提供了「novelty keeps me using a blocker」與多種 unlock methods 的線索，但本次 web search 沒找到可核驗原文。本文未把該貼文當作已查證事實，只把它當作產品線索；可核驗替代來源為 Lock、Bloka、Noff 等 NFC/object-scan blocker 產品頁。
- 社交 app 的完整 first-launch 實機畫面：Discord、Meetup、Strava、Bumble BFF 的官方 help center 可查到註冊/邀請/加入規則，但未能完整查證 2026-08-06 當天最新版 iOS/Android first-run 每一屏畫面。本文只引用可公開查證的官方流程文字。
- 對話式 onboarding 的 skip rate 與 typing animation 效果：本次找到的是 onboarding 長度、empty state、延後登入、Duolingo 角色策略等來源，未找到針對「chat bubble typing animation vs instant bubble」的可靠量化實驗。因此本文對 typing animation 的建議標為推論。
- 同步深呼吸對「親密感」的直接因果證據：可查到同步呼吸/生理同步研究與自律神經同步 meta-analysis，但未確認有高品質研究直接證明手機引導式同步呼吸可提升朋友群聚會 closeness。因此本文建議先以引導版做場測，不做強宣稱。
- 現有 `cat.png`、`dog.png`、`fox.png`、`rabbit.png` 的視覺細節：本次只查證檔名存在，未開圖做美術分析；IP 建議因此限定在「不重畫整套圖、用表情覆層/徽章/命名/敘事提高辨識度」。

