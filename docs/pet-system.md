# 群組寵物系統

更新：2026-10-20。這輪整合已在本機驗證，尚未部署正式環境。

## 玩家流程

1. 在群組頁領養狗狗，取名字，不需要設定人臉或指定寵物人。
2. 群組成員在養成頁餵食、清潔、玩球；點頭部可摸摸牠，摸頭只作陪伴反應。
3. 後端確認有效操作後才播放對應動畫並顯示養成數值。滿飽、很乾淨、太餓不能玩、冷卻或等待聚會救援，都有原因提示。
4. 群組聚會維持既有 XP、成長、共同回憶和救援規則。沒有增加養成動作的 XP 農場。
5. 建立者可改名、刪除，或把既有照片角色換成狗狗。換角色不重設等級、數值、衰減時間、聚會紀錄和冷卻；刪除仍須明確確認。

## 資料與相容性

- `pet_character_id = "puppy-v1"` 表示原生插畫角色；舊照片角色為空值。
- `pet_face_url` 保留既有「寵物頭像」欄位名稱，插畫角色儲存隨前端發佈的透明縮圖路徑；群組列表、首頁與聚會無須下載整個 Rive。
- 上傳新的舊式照片角色時會清除 `pet_character_id`，避免新舊顯示方式互相覆蓋。
- `/api/group-pets` 現在也會列出尚無寵物的群組，`pet` 為空物件，讓建立者能找到領養入口。
- 群組卡片和養成頁都由同一套純計算規則推導當前數值與等級，GET 不重設衰減 anchor。

## API

### 領養

`POST /api/groups/{group_id}/pet/adopt`

```json
{"character_id":"puppy-v1","name":"奶糖"}
```

需要有效登入、群組成員資格及建立者身分。角色 ID 由後端白名單決定。Firestore transaction 初始化缺少的欄位；已有角色只替換外觀和名字。

### 照顧

`POST /api/groups/{group_id}/pet/action`

```json
{"action":"feed","request_id":"9d825d1d-75d7-47ac-8ae9-bad282941366"}
```

`action` 是 `feed`、`wipe`、`play`。`request_id` 可選以相容舊版，新版前端每次操作產生一個 ID；連線結果不明時重試相同 ID，其他照顧操作暫停。後端在同一個 transaction 更新數值、冷卻及回執；同一 ID 用於不同動作會拒絕。

每位使用者保留最近八筆回執，重試回傳 `replayed: true` 並帶當前群組狀態，不再次加數值。這是短期重試機制，不是永久帳務紀錄。內部回執、冷卻原始紀錄和 Storage 路徑不會包含在公開群組資料中。

## 前端可靠度

- API 成功後才播放動畫；沒有假成功或本機先改數值。
- 請求與動畫期間阻擋連按；動畫等原生完成事件，有取消及超時處理。
- 12 秒請求超時，失敗原因可見；讀取失敗可重試。動畫載入失敗改顯示靜態狗狗，照顧 API 仍可用。
- 離開頁面會取消請求、卸載 Rive、停止輪詢／動畫／提示計時器，過時的群組回應不會覆寫新頁面。
- 前腳與身體不會旋轉、平移、換圖或縮放；外層 CSS 同樣不對狗狗套用彈跳。
- 使用原生 dialog 處理領養、改名與刪除的焦點和 Escape。數值條有螢幕閱讀器資訊，保留中英語系。
- 手機優先把照顧按鈕放在寵物下方，背景仍可分群組保存在裝置上。

## 驗證

```sh
npm test
.venv/bin/python -m unittest discover -s backend/tests -v
```

本輪另以 Playwright 載入真正的正式頁面與 Rive，測領養、三種照顧的原生完成事件、快速連按、HTTP 拒絕、回應遺失後沿用 ID、無權領養、數值上限、手機／桌面及卸載。也用完整 App + FastAPI + Firebase Auth / Firestore Emulator 跑過建立群組、領養、餵食、玩球、清潔、冪等回放、改名和取消刪除；不使用正式資料。

## 上線與後續

前端與後端要一起發佈，因為舊後端沒有領養 API；保留專案既有的手動部署流程。此次沒有執行部署，也沒有同步或覆寫原生 app 的產物。

目前只有狗狗 A。抽角色與獨立換裝仍需角色資產／穿戴圖層；食物與玩具背包已於 2026-10-22 接入群組養成；這輪沒有假裝把成長收藏徽章做成可穿衣服。

2026-10-20 最終檢查：前端 42/42、後端 109/109 通過；全部 JavaScript／Python 語法檢查通過，原生 Rive verify 無錯誤或警告。瀏覽器另驗證動畫檔失敗後靜態回退、重新載入恢復、減少動態，以及三種照顧的原生完成事件。


## 2026-10-22：AWS、兩層寵物與聚會補給

已合併 GitHub `origin/main` 的 v16 AWS 遷移（`d36b903` 與 `366c435`）。正式服務改用 Cognito、DynamoDB、S3、Amplify、單一 EC2；本輪測試使用記憶體資料庫或 moto，不存取正式 AWS 資料。

### 小陪伴與大養成

- 首頁群組縮圖與群組頁使用小寵物；`pet_mini_profile` 僅包含群組指定成員的 uid、暱稱與公開 Profile 頭像。沒有指定時顯示角色縮圖。
- 建立者在群組頁的「小寵物頭像」選擇成員，沿用 `PATCH /api/groups/{group_id}/pet` 的 `pet_target_uid`；空字串清除指定，非成員會拒絕。離開群組的成員不再被解析為小寵物。
- 小寵物的「摸摸」僅顯示陪伴反應，不呼叫照顧 API 或增加數值。點「進入小屋」才載入完整原生 Rive；頭像設定不更換大角色或重設進度。
- 右下角主導覽是「寵物」；「更多與設定」在右上角帳號選單及個人資料頁。

### 群組共用金幣、抽取與背包

| 內容 | 規則 |
| --- | --- |
| 聚會金幣 | 至少 2 位群組成員有計分紀錄，聚會滿 10 分鐘；`20 + floor(min(120,分鐘)/5)*5 + round(專注分數*0.2)`，每場最高 160 |
| 食物小包 | 30 金幣，隨機 1 種食物，共 3 份；餵食扣 1 份 |
| 玩具禮盒 | 60 金幣，隨機 1 款永久玩具；重複款返還 20 金幣 |
| 等級 | 普通 70%、稀有 25%、珍藏 5%；先抽等級，再於該等級內等機率抽款式 |
| 基本款 | 燕麥小餅與拼布小球免費可用，不在付費抽取池 |
| 物品總數 | 食物 9 種（含基本款）、玩具 7 種（含基本款） |

金幣、食物份數與玩具擁有權由群組共用。沒有真實金錢購買。不同物品有不同數值效果、食物插畫和玩具動作。照顧冷卻、滿飽／快樂上限與救援條件繼續由伺服器檢查，照顧不增加 XP。

`GET /api/groups/{group_id}/pet` 額外回傳 `care_catalog`；寵物欄位含 `pet_coins`、`pet_food_inventory`、`pet_owned_toys`、`pet_discovered_items`、`pet_last_care`、`pet_last_toy`。

```json
POST /api/groups/{group_id}/pet/draw
{"kind":"food","request_id":"unique-request-id"}

POST /api/groups/{group_id}/pet/action
{"action":"feed","item_id":"heart_biscuit","request_id":"unique-care-id"}
```

未提供 `item_id` 時，餵食／玩耍使用免費基本款，以相容原有入口。非擁有物品或種類不符的請求會拒絕，不扣份數或啟動冷卻。

### 原子性與重試

- `backend/docstore.py` 的 transaction 現在將讀取快照轉成 DynamoDB 條件式 `TransactWriteItems`，同時提交金幣、背包和抽取回執；條件衝突最多重讀重試 5 次。一般 `update` 與 `set(merge=True)` 同樣使用條件寫入，避免覆寫已提交的錢包。
- 每筆抽取回執永久保存在群組子集合 `pet_draw_receipts`；同 ID 回傳原物品與目前餘額，不重新抽取或扣款。前端將待確認 ID 存在 sessionStorage，重新整理後仍可重試。
- 每場聚會的獎勵回執保存在 `pet_reward_ledger`，不受舊 50 場列表截斷影響。結算畫面的金幣只顯示實際成功提交的結果。
- 照顧回執仍為每人最近 8 筆的短期重試；食物扣份數與數值、冷卻同時提交。
- 一般 WriteBatch 仍沿用上游依序提交；金幣相關流程全部使用已補強的 transaction。

### CI/CD 與驗證

```sh
python -m pip install -r backend/requirements-test.txt
python scripts/test_backend.py
npm ci
npm test
npx playwright install chromium
PYTHON=python npx playwright test
```

後端 CI 不能略過測試；缺依賴會失敗。瀏覽器測試使用專用的 `scripts/browser_review_server.py`，只在 localhost 與記憶體資料庫跑，Cognito 身分使用測試替身；正式啟動仍為 `backend/main.py`，不包含測試伺服器入口。

2026-11-02 起 push 到 main 通過 CI 後自動部署，也可手動觸發。完整部署會先更新 EC2 後端、檢查 `/api/health` 的 commit，再上傳前端到 Amplify；兩者使用同一個已驗證的 GitHub SHA，不以部署當下移動中的分支 HEAD 取代。手動部署不取消正在執行的部署。尚未執行本輪正式部署。

設計參考： [PicPet 官方介紹](https://play.google.com/store/apps/details?id=com.o3o.android.picpet&hl=en_US) 的共同飼養與日常分享，以及 [My Talking Tom 2 官方頁](https://talkingtomandfriends.com/apps/my-talking-tom-2) 的餵食、清潔與遊玩。小／大兩層是本專案依使用者要求採用的安排，不是宣稱兩款產品有相同架構。

2026-10-22 本輪驗證：後端 134/134（零略過）、前端 43/43、完整瀏覽器 4/4。瀏覽器包含指定頭像與完整角色分離、斷線後重新整理重試、食物扣份數、永久玩具，以及全部 7 款玩具的原生完成事件與前腳固定檢查。8-bit 畫素比較容許 4/255 的渲染捨入差異。Workflow YAML 與每個 shell 區塊均完成語法檢查；未觸發遠端 GitHub Actions 或正式部署。

2026-10-22 選擇流程：主畫面的餵食與玩耍先開啟對應的物品選擇器，已擁有者排前；按「餵一份／陪牠玩」才送出含 item_id 的照顧操作。取消不產生 API 或消耗。只有結果待確認的重試會直接沿用原操作，避免重選與重複消耗。

### 抽取揭曉動畫（2026-10-22）

研究參考：[Pokémon 官方設計訪談](https://corporate.pokemon.co.jp/en/topics/detail/t-28/)以滑開包裝、聲音與震動重現拆包的手感；[Apple Motion 指南](https://developer.apple.com/design/human-interface-guidelines/motion)要求動態簡短、有目的、可取消並配合減少動態。本專案採用包裝開啟的視覺節奏，沒有加入聲音或手勢升級機率。

- 食物用暖色紙袋、玩具用綠色禮盒，SVG 封口與盒蓋可獨立移動，與現有插畫及配色一致。
- 等待 API 時只顯示中性包裝與確認中文字。伺服器確認後才呈現等級色、輕晃 240ms、開封 240ms、包裝退場 180ms，接結果卡 240ms；動畫只使用 transform／opacity 與既有 ease-out。
- 稀有款有冷色背景，珍稀款有暖金背景與結果卡、較明確的裝置觸覺回饋（裝置支援時）。沒有改動 70/25/5 機率或後端抽取規則。
- 「直接看結果」可取消等待中的動態，但仍要等 API 確認；減少動態模式直接顯示確認後的結果。關閉視窗只結束展示，已確認物品仍留在背包。原 request_id 重試規則不變。
- 本輪前端 43/43、相關瀏覽器 4/4 通過：等待時跳過不可提前揭曉、關閉後不遺失物品或重抽、減少動態零執行中動畫、回應遺失重試與背包使用回歸。已查看紙袋與結果卡實際截圖；未部署。
