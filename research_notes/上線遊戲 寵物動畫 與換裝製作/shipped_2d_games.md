# 已上線 2D 遊戲的角色美術與動畫實際流程

## 《Spiritfarer》：陪伴感來自手繪、動作個性與狀態轉場

### Takeaway

這是最貼近「照顧動物角色、餵食、擁抱」情緒的實際案例，而且有開發團隊清楚講出整條製作路徑：Photoshop 角色參考稿→粗動畫進引擎試感覺→清稿／Harmony 混合逐格與 cut-out→圖集→Unity。不是一定要即時 3D，也不是靠角色整張圖縮放就完成演出。

### Cited Findings

- **遊戲與上線證據：** Thunder Lotus 開發發行，Steam 列發售日為 2020-08-18；商店有實際遊戲截圖與影片可看。— [官方 Steam 成品頁](https://store.steampowered.com/app/972660/Spiritfarer_Farewell_Edition/)（此頁 wordlimit 200；本筆記只取遊戲身分、日期及成品入口）
- **原團隊完整流程：** 2020-06-18 Verified AMA，發文者為 Thunder Lotus 團隊，內文確認 u/Wabak 是 CTO／共同創辦人 Alex。他回答美術總監先用 Photoshop 畫角色 reference；動畫師做粗版在引擎測試動作感；確認後製作 clean version；全在 Harmony 做，輸出 spritesheets。還要做許多轉場避免切換狀態突然跳姿勢，但轉場應只影響畫面、不阻止玩家行動。— [原團隊 AMA，pipeline 回答](https://www.reddit.com/r/Games/comments/hbh022/were_thunder_lotus_creators_of_spiritfarer_a_cozy/)（wordlimit 200；頁內搜尋 `Or pipeline has been pretty straightforward`。注意 Alex CTO 與動畫總監 Alex Boyer 為不同人，不要混稱）
- **動畫工具原訪談：** Toon Boom 官方 Edward Hartley，2021-09-23 訪動畫師 Simon Nakauchi Pelletier、Alexandre Boyer。作者明講使用 Harmony，混合 frame-by-frame 和 cut-out；遊戲使用 Unity。他們前三作經 TK2D 把畫格打包成 Unity 可讀圖集；採訪同時提到其後的新專案自製類似匯出器，不能把那段新專案功能全算到 Spiritfarer 上。— [工具官方對製作團隊的原訪談](https://www.toonboom.com/thunder-lotus-games-on-animating-the-afterlife-in-spiritfarer)（wordlimit 200；本段與下一段衍生內容合計須控制）
- **同一原訪談的重要實作：** 各 spirit 多有走路、吃飯、睡覺、擁抱等相同基本動作清單，但動作需帶出每個人物的個性。Stella 約 100 種動作，其中約 25 為含轉場的基礎平台動作。團隊會在已傳達意思之後允許玩家取消演出；sprite 動畫缺乏 3D 式程序混合，重要切換需另外製作轉場。文內直接有 rough animation、platforming test、官方上市影片。— [同一訪談的可見製作示例](https://www.toonboom.com/thunder-lotus-games-on-animating-the-afterlife-in-spiritfarer)

### Inferences

- **為什麼不是幾何拼裝（依來源作的判斷）：** 它先由美術確立角色，再由受訓動畫師設計姿勢和手繪形變；遊戲測試、清稿與轉場都是真實製作階段。「餵食」對不同性格不是完全相同的左右晃，而是有各自的吃飯演出。
- **對本案可借鏡：** 先讓一隻角色的待機→注意到食物→伸手接／靠近→吃→滿足收尾成立；食物與身體有實際接觸點。關鍵姿勢先畫成能看的草動畫，放進手機尺寸看過再清稿。
- **不能直接照搬：** 每套衣服若直接烘進逐格影格，新增衣服可能要重畫多個動作；若要原照片頭另疊，則每格需有頭部的位置／方向資料、遮擋分層或人工對位，不能僅換一張完整 sprite。這是我們對需求的工程推論，並非 Spiritfarer 團隊宣稱的照片換頭方案。
- Harmony 本身可有 rig 與 cut-out，這個案例的 runtime 卻以圖像影格為核心；不要把「製作軟體能綁骨架」誤寫成「Spiritfarer 在 Unity 即時跑 Harmony 骨架」。

### Gaps

- 本輪讀了流程文及開發者回覆，未逐格播放完文章內影片；可提供原文嵌入的粗動畫給使用者看，不能宣稱自己完整看完每段。
- 找到的原始資料沒有公開每隻角色的所有分層、影格尺寸、圖集數量或 rig 結構；不能從 100 moves 反推美術人日。

## 《Cult of the Lamb》：已確認 Spine，但遊戲與宣傳動畫必須分清

### Takeaway

《Cult of the Lamb》可作可愛動物群與養成場景的視覺參考，且美術總監具名確認用 Spine；它也示範研究時最大的陷阱：宣傳短片用 Harmony，不等於遊戲內角色用 Harmony，更不能把網路推測的 Photoshop→Spine→Unity 當原團隊公開流程。

### Cited Findings

- **遊戲身分：** Massive Monster 開發、Devolver Digital 發行，Steam 列 2022-08-11 發售，已上市產品；商店可直接看村莊角色、玩法及官方影片。— [官方 Steam 成品頁](https://store.steampowered.com/app/1313140/Cult_of_the_Lamb/)（wordlimit 200）
- **動畫工具的第一人稱證據：** Esoteric 官方 showcase 列出 James Pearmain，Art Director，具名說 Spine 用於本作富有表現力的角色動畫。這證明實際遊戲採用，**沒有公布每一步資產製作細節**。— [Spine 官方具名客戶證言與成品示例](https://esotericsoftware.com/spine-showcase-all)（整頁 wordlimit 200；不同遊戲的證言加起來仍是同一頁額度）
- **宣傳動畫的原製作人拆解：** Toon Boom 訪 Half Giant 導演／2D 負責人 Bill Northcott，2023-01-14。訪談明確是在談 Devolver 委託的《Cult of the Lamb》宣傳片，用 Harmony、手繪混合 rig／pegged 技術，目標讓接點不顯眼。團隊另有角色 layout、動畫、清稿、背景、特效與合成職務。— [原製作人完整訪談](https://www.toonboom.com/half-giants-bill-northcott-on-channeling-enthusiasm-for-cult-of-the-lamb)（wordlimit 200；本段與下段合計）
- **同一訪談的限制與實際造型調整：** 宣傳團隊把小尺寸遊戲角色調整得較高、添加近景可見的手等細節；Bill 也直說他們索取 turnaround／model sheet 時原遊戲團隊沒有，不可說所有成功遊戲都有完整影視式前期。— [同一原訪談，`How did you go about adapting` 與 `What did the creative brief` 段落](https://www.toonboom.com/half-giants-bill-northcott-on-channeling-enthusiasm-for-cult-of-the-lamb)

### Inferences

- **可借鏡：** 先依真正手機顯示尺寸決定細節，角色清單需保持風格一致；別把宣傳圖的近景細節密度全部塞進小角色。同一物種能不能用輪廓、耳尾、衣服的輪廓差異產生想收集的變體，需用實際並排稿檢查。
- **對 Rive 的結論：** 以上真遊戲證據支持的是「先有角色美術、再做分件／逐格／rig及互動」，並不能證明本案使用 Rive 就有相同品質。Rive 可否承接我們的分層與換裝須另做技術驗證，不能用相似觀感宣稱《Cult of the Lamb》用 Rive。
- **對照片臉的結論：** 兩個案例都沒有公開提供真人照片頭玩法；把原照片頭納入這套美術是我們新增的設計問題。應先合成看照片邊界、遮擋及臉身比例，保真臉不能沿用卡通臉 mesh 的自由 squash／stretch。

### Gaps

- 未從可靠原團隊資料查到本作完整 Photoshop 分件匯出方式、所有 rigs／skins 結構或衣服新增流程；不採用 Tebesir、Foro3D 或外包公司「almost certainly」的推測文章補空白。
- 未拿到遊戲原始素材，也沒下載／抽取商業遊戲圖集。本輪只研究公開作者說明，沒有假稱實作、播放或測過這些遊戲。
- **引用與後續報告注意：** 全部網頁的工具額度均為各頁 200 words（同來源跨段合併計）；最終報告應再濃縮。本筆記中的「Inferences」是根據來源與本專案條件提出的建議，不能改寫為遊戲作者聲稱。相近陪伴氣質的主案例是 Spiritfarer；Cult 只對已證實部分下結論。
