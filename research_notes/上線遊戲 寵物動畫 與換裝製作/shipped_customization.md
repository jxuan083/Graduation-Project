# 已發售遊戲的角色與換裝製作：Fall Guys 與 The Sims 4

查證：2026-10-19。本次只採實際遊戲與開發者原始製作資料，不把 Rive demo、Moon Quest avatar 或尚未發售原型當遊戲證據。來源列出的數字頁碼為 PDF 頁腳；p60 指頁腳60、零起算PDF page60，實際閱讀器第61頁。

## 1. Fall Guys 的服裝到底怎麼做？

### Takeaway
《Fall Guys》給本案最直接的啟示是：先固定一個識別鮮明、可容納很多服裝的身體，再把每套服裝作為真正的設計與3D製作工作。公開資料證實上／下裝分件及反覆2D→3D修正；沒有公開的骨架或程式細節不應補猜。

### Cited Findings
- **真實遊戲身分**：《Fall Guys: Ultimate Knockout》由 Mediatonic 製作、Devolver Digital 發行，2020-08-04 已於 PS4/PC 推出；發售當日公關新聞稿可作日期證據。本文研究的是即時3D遊戲服裝，不是預渲染宣傳影片。**wordlimit 200。** — [發售公告，合作公關公司原稿](https://www.cosmocover.com/newsroom/fall-guys-launch-themselves-onto-playstation-4-steam-today/)
- **具名製作者分享，2020-05，Ash Kerins／Mediatonic Principal Artist**：官方文章展示 Alberto Hernandez 的早期3D比例稿。團隊建議先畫多個方案；在遊戲小尺寸下簡化、縮小檢查；遮住上半身仍應可從下半身辨認服裝主題。這明確指出設計是依實際遊戲尺寸驗證。**wordlimit 200；本報告可摘約60–90英文詞等量，不需要照抄全部五項。** — [Creating the Character Designs of Fall Guys](https://blog.playstation.com/?p=224711)
- **實際量產服裝，2022-03，Mediatonic 官方製作介紹，署名 Bee Sarafian／Community Manager**：Astro/T-Rex 先做草圖、比較形狀色彩與保留原角色特徵；進3D後會再改，因2D成立的設計在3D可能不成立，最後製作3D shell 與貼圖。文中把服裝描述成穿在原本圓潤bean身上的衣服，並列明 Upper/Lower 分別解鎖。作者是社群經理轉述美術團隊，不應錯標她為實際模型師。附概念圖、早期render與最終成品。**wordlimit 200；這一段盡量控制120英文詞等量內，留給圖說餘量。** — [Astro Bot lands in Fall Guys March 8](https://blog.playstation.com/?p=362014)
- 官方遊戲支援頁證實玩家可改顏色、圖樣、faceplate、上裝、下裝等外觀，這些是不同選項；不能把 color pattern 的替換混稱成換一件完整衣服。**wordlimit 200。** — [How to customize your character](https://www.epicgames.com/help/c-32551467/c-37975153/a23088307?lang=en-US)

### Inferences
- 可學的是「相容身體＋真的有輪廓變化的服裝」。我們未來的抽角色若一開始全是不同四足/兩足比例，衣服覆用的成本會高；可以先選定同一站姿、同一胸肩位置的一個 body family。
- 真人照片的設計可以借鏡「服裝內仍看得出原角色」：先定照片開口與帽緣，而不是把真人五官塞到動物眼睛鼻吻上。這是本案提出的轉用，不是 Fall Guys 使用照片臉。
- 上下裝分開後，單看每一件能否辨識其主題，是值得採用的選物價值檢查；不是把普通身體換粉紅色當稀有衣服。

### Gaps
- 以上來源**沒有**公開共享骨架名稱、蒙皮權重、服裝內部mesh裁切方式、遮擋演算法、角色狀態機或 item IDs 的權威端；不能宣稱已知道其完整runtime實作。
- 無證據顯示全部服裝自動適配不同體型；也沒有證據足以說服裝不需逐動作穿插測試。
- 本研究未取得可供本案商用的 Fall Guys 美術或 rig；官方圖只能作研究參考。

## 2. The Sims 4 如何真正解決衣服互相穿插與身形變化？

### Takeaway
《The Sims 4》的開發者演講提供更深的換裝實作證據：衣服不是只接到骨頭，還有空間區域、層級、資產配對與體型變形資料。這些技術展示了大量自由換裝背後的內容規範成本。

### Cited Findings
- **遊戲及年分**：EA 發售公告列《The Sims 4》北美PC日期為2014-09-02；EA目前官方FAQ也列PC、Mac與主機可玩，確實是已發售遊戲。**各頁wordlimit 200。** — [EA發售公告](https://news.ea.com/press-releases/press-releases-details/2014/The-Sims-4-Available-September-2-2014/default.aspx)；[官方FAQ](https://www.ea.com/ea-originals/news/behind-the-sims-summit-f-a-q)
- **主要技術來源，2015 GDC，Sri Nair／Technical Lead, Maxis/Electronic Arts，89頁原始簡報**：p53–65 以褲子/靴子及頭髮/帽子示範 Asset Pairing；p60 將角色空間分成 regions/layers，每個region由最高layer的subpart勝出，目的是避免clipping。p77–85說明為避免每個部件各做blendshapes導致資產/記憶體爆量，採 deformation maps；但寬袍和緊身衣拓樸差異太大仍需要兩個變形map。**整份PDF僅wordlimit 200；不要因89頁而誤認可衍生大量原文，最終請把本段控制約100英文詞等量。** — [Innovations in The Sims 4 Character Creator，原始GDC slides](https://media.gdcvault.com/gdc2015/presentations/Nair_Sri_InnovationsInSims4CharacterCreator_GDC15.pdf)

### Inferences
- 套在2D的可學部分：為衣服先標註身體部位、前後層與要隱藏的底層；帽子和耳朵衝突、衣袖遮到手、外套覆蓋上衣都要有規則。不能把3D regions/layers系統直接稱作Rive現成功能。
- 套在原生web＋Capacitor：未來資料可用 characterId、bodyFamily、topId、hatId、toyId 形成配裝描述，檢查相容後由 renderer 裝上資產；FastAPI/資料庫保存擁有權與配裝，Rive只負責顯示和互動事件。這是本案建議架構，**不是從 Sims4 資料反推出其網路權威端**。
- 不必複製Sims4的CPU變形map技術。先統一一個2D body family，衣服跟著少量固定骨架動；若新角色身形改太多，就增加衣服適配版本或另一個 family，不承諾一次通用。

### Gaps
- 此簡報不證實本案需要的照片頭保真，也未公布完整服裝catalog或runtime物品ID程式。
- PDF圖表中部件劃分只代表Sims4該套實作，不足以支持所有換裝遊戲都用相同方法。
- 本研究只抽取上述兩項機制，未觀看整場有聲演講，不能補述speaker未在slides寫出的細節。

## 3. 對本案的具體技術選擇與下一步

### Takeaway
真遊戲案例支持的是先建立相容的角色／衣服製作規範、逐步驗證成品。它們並沒有證明換一套動畫工具就會變好看，也沒有證明Rive是這些遊戲的引擎。

### Cited Findings
- Fall Guys的草圖到3D反覆修正是開發商親自公開的流程，並非快速模板套用。— [Mediatonic服裝製作](https://blog.playstation.com/?p=362014)
- Sims4的穿插處理與變形適配已有實際技術演講證據，並非只說「共骨架即可」。— [Sri Nair的GDC原稿](https://media.gdcvault.com/gdc2015/presentations/Nair_Sri_InnovationsInSims4CharacterCreator_GDC15.pdf)

### Inferences
本案可維持原生ES modules/HTML/CSS＋Capacitor，用Rive或Spine承載分層2D身體與互動。**選擇這條路是根據現有架構、使用者指定Rive、真人原照片與固定鏡頭需求的工程判斷；不是因為Fall Guys/Sims4使用Rive——它們在本研究都是3D例子。**

下一個製作證據應包含：
1. 一個body family、一隻定稿角色；三張不同真人原照片在手機尺寸的合成示例。
2. 裸裝與一件有前片／袖子／不同輪廓的衣服；可清楚指出哪些底層被隱藏、帽緣在臉前或後。
3. 同一套骨架播放Idle與完整餵食；一份穿插檢查表，檢查衣袖、耳朵、照片邊緣與手部接觸。
4. 純資料的配裝manifest與相容條件說明，用來證明將來可以增加內容；這輪不用實作抽獎、商城或背包。

需要給使用者看的不是再一個比較頁，而是同一角色「未穿／穿上衣服／動起來」都成立的美術結果。

### Gaps
- 尚未發現符合本案「可愛動物＋真人原照片臉＋可抽衣服玩具」並公開完整pipeline的已發售遊戲；需把借鏡與未驗證部分分開講。
- 此研究沒有改動產品、購買資源、聯絡開發者或宣稱視覺驗收已通過。
