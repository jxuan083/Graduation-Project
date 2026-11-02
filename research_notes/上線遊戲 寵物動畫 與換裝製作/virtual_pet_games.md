# 已上線養寵遊戲的真實製作：Outfit7 個案

查核：2026-10-19。範圍限真正已推出的遊戲與原團隊分享，不把工具展示、教學作品或 Duolingo 當遊戲案例。主要個案為 My Talking Tom Friends 2 與 My Talking Hank: Islands；My Talking Angela 2 為玩家研究的補充。已閱讀先前 animation_craft.md，但本篇只保留遊戲生產證據。

## 角色從概念到遊戲裡，實際經過哪些工作？

### Takeaway

Outfit7 把角色、道具、美術工作檔、動畫與引擎交付視為有依賴關係的資產生產。概念、模型、rig 尚未成立時，不應把「掛上動畫播放器」當作角色品質完成。

### Cited Findings

- **來源 A：Samy Ben Rabah，Outfit7 Senior Software Engineer，2024-10-07，〈Outfit7’s Art Pipeline〉。** 該文以 My Talking Tom、My Talking Angela 的實際生產為背景：概念／模型／rigging 先於動畫；藝術家用 Maya、Photoshop、Houdini、Substance Painter 等製作。動畫師在 Maya 引用角色與道具 rig，做 IK、blend shapes 等，再由腳本烘焙骨骼、精簡 rig、依規則輸出 FBX 給 Unity 或自家 Starlite；ShotGrid 管理資產版本、依賴、任務與審核。原文以 Angela 圖示呈現 Maya 動作進入遊戲。— [Outfit7 自述](https://outfit7.com/blog/tech/outfit7s-art-pipeline)

### Inferences

- 可直接對本案說明的製作鏈：**角色概念與模型 → 可動畫 rig → 角色及道具動作作者工作 → 引擎可用的動畫／資產 → 遊戲行為整合與審核。** 這是該團隊的鏈，不是「所有手機遊戲唯一流程」。
- 我們先前 MVP 省略的工作，包含角色設計本身、可讀的姿勢、與每種道具相配的表演；選 Rive 或 Blender 不能補齊這些作者工作。
- 小專案不需要複製整套 ShotGrid 組織，但至少要留下來源工作檔、正式匯出物、rig 版本、動畫名稱與驗收預覽。這是本案提案。

### Gaps

- 該文是公司級管線，不逐款列明引擎與衣物 binding。不可據此認定每款 Tom／Angela 都使用完全相同引擎或骨架。
- 文中多專案遷移的資料規模，不等於任何一款遊戲的模型或動畫數；不拿來估算本案工期。

## My Talking Tom Friends 2 的動畫、互動與行為在 runtime 怎麼連起來？

### Takeaway

已確認這款 Unity 遊戲把作者製作的動畫、runtime IK／look-at、命中查詢、行為狀態與內容規則組合起來。玩具或食物不是僅在 UI 按鈕後觸發一段與位置無關的動畫。

### Cited Findings

- **來源 B：Adam Axler（Unity）訪問 Outfit7 的 Mihec Pezdirc（Fellow Software Engineer）、Črt Kristl（Principal Software Engineer），2025-11-25。** 他們描述 Unity 自訂 action state machine 追蹤活動；動畫管線做 retargeting、IK、look-at。點擊拖曳用 sphere／capsule casts，低階機在小遊戲以外關閉大部分物理；烹飪小遊戲才讓食物等以 Rigidbody 模擬。對話來自設計師的 Excel，依坐下／吃東西等活動決定可用內容，搭配不重複選取、距離和 cooldown。近 1,000 段動畫經自訂系統占 10–15 MB；另依資產選 LZMA／LZ4。— [具名工程訪談](https://unity.com/blog/bringing-my-talking-tom-friends-2-to-life)

### Inferences

- 保守可確認的 runtime 關係是「輸入／碰撞查詢、角色活動狀態、動畫處理、依活動選擇後續內容」共存；文章沒有公開完整呼叫序列，不能捏造某個 feed 事件函式或 AnimationEvent 名稱。
- **數字的正確讀法**：10–15 MB 指動畫在 app 中使用的空間，不能寫成整款遊戲大小、每段動畫大小或執行中 RAM。訪談沒有公開自訂壓縮格式，也不能說 LZMA／LZ4 就是近 1,000 段動畫變小的完整原因。
- 本案最值得借的是行為狀態與輸入分離，而非照搬 Unity：拖曳食物先查有效區；目前行為允許才進入餵食；道具接觸與消耗成功點要有明確契約；結束後再回待機。這段是我們提案，並非聲稱 Outfit7 正式餵食原始碼如此。

### Gaps

- **沒有公開**：逐格餵食分鏡、嘴與手的具體約束、每件玩具對應多少動畫、衣服 mesh／skeleton 共用方式。不能把這些推測成實證。
- 該訪談提到從預渲染畫面轉為 dynamic world，但沒有完整列出先前各代哪些畫面預渲染；不可泛稱「舊 Tom 全部都是序列圖」。
- 近 1,000 段是單款商業作品內容量，沒有證據支持畢專也需要同等數量。

## My Talking Hank: Islands 如何把「碰到哪裡、改變哪裡、保留結果」做成真的遊戲？

### Takeaway

這是比通用動畫原則更直接的案例：同一隻獅子，在主島使用 3D 骨架模型，在理髮活動使用為觸控特製的正面 2D 髮束；梳、剪、染與裝飾都有各自的命中和資料變化。活動成果回主島時仍需美術協作，並非同一資產到處直接播放。

### Cited Findings

- **來源 C：Marko Ravnjak，Outfit7 Senior Software Engineer，2025-06-18，〈The Tech Behind My Talking Hank’s Hair Salon〉。** Unity 中，主島獅子是 3D 骨架 mesh；理髮用正面 2D 髮束，由 spline 節點驅動 LineRenderer。梳子依範圍取節點並套手指位移；剪刀找滑動線與髮束線段交點，再刪除切口外節點；裝飾拖至槽位吸附。染色變成髮束貼圖；回主島只轉移顏色，合成單張貼圖後由 3D 團隊重配 UV，沒有轉移完整髮型。— [第一人稱完整技術文章](https://outfit7.com/blog/tech/the-tech-behind-my-talking-hanks-hair-salon)

### Inferences

- 本案可借的概念是「主角表示」與「互動專用表示」可以不同，不必讓每件事都由一個萬用模型完成。譬如近景清潔可以獨立定義可擦部位與髒污遮罩，主畫面只回寫清潔結果；這是我們提案，並非 Hank 已使用髒污遮罩的聲稱。
- 這個案例中真正的互動是**輸入 → 命中部位／節點 → 改變造型資料 → 重畫 → 必要時轉譯到另一套表示**。它和只在原地播放「開心」clip 的差異，在於玩家操作的位置會改變結果。
- 對抽衣服／玩具的提案：先確定每件物品在哪個視圖可裝、接在哪個槽、會改變哪些資料，以及離開互動畫面後怎麼保持一致。抽中只代表獲得物品，不能自動產生相容的外觀與互動。
- 對真人臉限制的提案：同樣可以只在正面視圖維持照片頭部，而讓身體與配件有獨立表演；但 Hank 的 2D 髮束是特殊玩法設計，不代表已有真人臉保真方案，更不支持只貼照片就一定自然。

### Gaps

- 作者明確說理髮與主島表示不同，完整髮型／造型沒有直接帶回。不可寫成「玩家所有髮型、飾品都能原樣持續套在主島 3D 模型」。
- 本案例的 accessories 槽位不等於全身衣服換裝，也不是抽獎後端。
- 沒有披露完整主角概念到 rig 的製作細節；只能將來源 A 當公司一般製作背景，不能宣稱兩篇合成了一份單遊戲完整設計文件。

## Angela 2 與 Tamagotchi 能提供哪些證據，哪些仍查不到？

### Takeaway

Angela 2 有具名團隊談真實已推出的理髮功能與玩家實體測試，但不足以確認它的衣服骨架／引擎細節。Tamagotchi 的公開受訪內容以世界與產品設計為主，沒有找到同等深入的 rig 與觸控管線，不以猜測補空白。

### Cited Findings

- **來源 D：Outfit7，2025-07-09，〈Tangled Up in Fun: Behind the Scenes of My Talking Angela 2’s Hair Salon〉。** 受訪 Product Manager Silina Senica Pintar 與 Product Marketing Manager Tjaša Derstvenšek。團隊說頭髮物理原本太不可預測，調整紋理、刷子、髮膠、顏色與飾品求取好玩與可控；還用假人頭、真實髮圈／夾子與玩家做 hands-on workshop。文章確認 Hair Salon 已可用，但不是技術規格。— [Outfit7 製作分享](https://outfit7.com/blog/news/tangled-up-in-fun-behind-the-scenes-of-my-talking-angela-2s-hair-salon)

### Inferences

- 本案應測「玩家是否理解怎麼餵／擦／放玩具、操作後有什麼變化」，不能只測動畫是否順。也應把道具接觸與規則用草圖或實體演示先走一遍，再決定 runtime 控制；這是由真實 workshop 引出的本案建議。

### Gaps

- My Talking Angela 2：沒有從以上來源查到 Fashion Editor 的全身服飾 attachment／skin 系統，不能把 Hank 髮飾槽直接當 Angela 衣服做法。
- Tamagotchi Adventure Kingdom：搜尋到 Bandai Namco 製作人訪談與遊戲名單，但沒有找到可同等核實的動畫道具約束／觸控互動技術 breakdown，本篇不把它當製作細節證據。
- 本篇不是 Rive／Spine 的選型證明。證據支持先完整設計角色、動作和互動資料，不能由這幾款使用 Unity 直接推論本案必須整個改成 Unity。

### 來源摘要預算與最終報告建議

四篇來源工具均標示每篇 **200 words** 的總轉述／引用上限，直接引文另受每篇 25 words 上限。此筆記不使用直接引文。上文來源 A／B 在前一篇研究也有轉述，最後報告請合併而非重複累加。

| 來源 | 最終文字建議 | 應保留的核心 | 可省略 |
|---|---|---|---|
| A | 用約 60–80 英文詞等值簡述 | concept／model／rig → Maya 動畫 → 烘焙 FBX → 引擎 | ShotGrid 遷移歷史、公司總資產量 |
| B | 用約 80–100 英文詞等值簡述 | action state machine、IK／look-at、碰撞查詢；若列大小，明寫只是動畫部分 | 行銷、shader、通用壓縮名詞 |
| C | 用約 100–130 英文詞等值簡述，至少另留約 60 words 餘量 | 3D 主島＋2D 互動表示；觸控局部改變；僅顏色轉回 | spline／物理 solver、工作執行緒的細節 |
| D | 用約 30–50 英文詞等值簡述 | 實體玩家 workshop、可控與逼真取捨 | 行銷式願景 |

此表是撰寫預算建議，非聲稱中英文詞數可精確換算；最後成文仍需控制每篇來源總衍生長度。
