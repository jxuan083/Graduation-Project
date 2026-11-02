# 手機寵物的模組換裝與資產製作流程

查證日期：2026-10-19。只研究製作流程與交付，不改 app、不開抽獎。以下所有 Inferences 是本案推論與建議，不能說成受訪者直接建議。本研究沒有成功操作瀏覽器預覽 Marketplace 動態成品；有作品頁、圖片與可下載工程，不等於已做視覺品質驗收。

## 1. 專業團隊如何組織角色、衣服與互動資產？

### Takeaway
專業案例的共同點是先做可維護的角色資產與控制規格，再交給工程連接；抽角色與抽衣服需要相容的模組結構，並非先拼角色、最後補換色。Rive 可以做到客製化角色，但它不會代替角色設計與 rig 製作。

### Cited Findings
- **具名從業訪談，2024-07-25，Rive 記者 Valerie Veteto 訪問 Duolingo 團隊**：Jeff Masters（creative technologist）、Alex Chopjian（associate creative director of animation）、Clint Fanelli（senior studio manager）。他們的實際交付流程為：動畫師製作 Rive 時間軸；creative technologist 同步建立狀態機與優化；撰寫 inputs 規格；將互動資產與文件交工程。文中強調模板化、可修改性及早處理設計限制。**wordlimit 200，請報告合併使用時總計不要超限。** — [Duolingo creates new role bridging designers and devs](https://framer.rive.app/blog/creative-technologists-duolingo-s-solution-to-the-designer-to-developer-handoff)
- **工作室第一手案例，2026，WeaveLines 製作 Moon Quest**：專案時間為 2025-12 至 2026-03。工作室說同一 Rive 檔案包含 10 表情，以資料綁定控制髮型、衣服、姿勢、配件與顏色；編輯器與月曆共用角色。該頁有四種 avatar 的圖片。這是工作室公開自述，未具名主動畫師，也沒有公布可檢查原始工程。**wordlimit 200。** — [Moon Quest case study](https://www.weavelines.com/work/moon-quest/)
- **Spine 官方可下載 Mix-and-match 製作解析**：每個物品是獨立 skin；衣服可有專用 bones/constraints；原始美術從 Photoshop 匯入，日後增加部件後再匯入。裙子拆前後袖、身體裙片；包包拆四張圖片與七根骨頭，並控制三角形繪製順序以避免錯誤遮擋。頁面末附製作影片與工程。**wordlimit 200；不要把整篇逐項抄寫到最終報告。** — [Mix-and-match example](https://esotericsoftware.com/spine-examples-mix-and-match)
- **比例適配的實作教學，2020-03-11**：Spine 官方以 skin constraints 改變臀部位置與四肢比例，變矮、變胖等各需自己的 constraints/skin；constraints 執行順序會影響腿部結果。官方 animator/rigger Erika 在 2020-03-23 論壇介紹此教學。**各頁 wordlimit 200。** — [Skin constraints for different proportions](https://esotericsoftware.com/blog/Skin-constraints-for-different-proportions)；[Erika 的教學介紹](https://en.esotericsoftware.com/forum/d/13676-skin-constraints-for-different-proportions)；[Erika Inzitari 身分與遊戲動畫經歷，2017](https://en.esotericsoftware.com/blog/Welcome-Erika)

### Inferences
- 本案先定義角色家族：例如同一站姿、相近身形的狗／貓可共用控制規格；四足動物與兩足布偶不應預設共用所有動作。骨架同名不代表穿衣與動作自然。
- 建議層級是後方配件／後肢／身體與衣服／照片頭／帽緣等前方遮罩／前肢／手持玩具。這是本案示意，實際前後關係須逐動作調整，不能只排一次固定 z-index。
- 衣服至少需要標註：適用 base/bodyFamily、佔用部位、與耳朵尾巴衝突處、前後片、骨架掛點、隱藏哪些底層皮膚。衣袖不能只是覆蓋身體的一整塊圖片。
- 玩具可拆成獨立 prop；但球、逗貓棒、可抱玩偶的接觸方式不同，不能因為都掛在 hand socket 就當完成。手碰得到、腳不穿地、衣服不穿臉才算通過。
- 真人照片保持為整張剛性 head attachment，允許平移、等比縮放與小幅平面旋轉。不要直接沿用示範可扭曲五官的 2.5D face mesh；那和保真優先的要求不同。

### Gaps
- 找不到可靠資料證明 Rive 對任意動物體型具有自動服裝適配；不能承諾一件衣服全物種可穿。
- Moon Quest 不是養寵物遊戲，證實的是模組化 avatar 可行，不能借此推論玩具物理或餵食品質。

## 2. Rive、Spine、預渲染及即時 3D，對大量角色與衣服有什麼產能差異？

### Takeaway
以本案已有網頁式手機 app、使用者偏好 Rive、照片保真及未來換裝需求，先做一套模組化 Rive 資產合理。是否轉 Spine 應依插畫師／動畫師擅長工具與資產結構決定，不要再以同一個粗糙造型做兩套技術比賽。

### Cited Findings
- Rive 官方 JcToon 的 Avatar Creator 示範提供原檔與完整教學，涵蓋 design、rig、動畫、state machine 到 runtime 整合；Marketplace 頁標 CC BY，發布日 2023-10-07。這是可拆解的教學工程，不是寵物完整美術包。**兩頁各 wordlimit 200。** — [Avatar Creator 原檔](https://rive.app/marketplace/6236-12120-avatar-creator/)；[製作教學](https://rive.app/use-cases/avatar-creator-tutorial)
- Blender 官方 Cryptomatte 文檔說明可以對特定物件／材質建立合成遮罩，並支援透明、動態模糊。此處成功讀取的是 3.1 手冊；較新手冊只取得搜尋摘要，不能宣稱已全文驗證 Blender 5.2 細節。**wordlimit 200。** — [Cryptomatte Node](https://docs.blender.org/manual/en/3.1/compositing/types/matte/cryptomatte.html)
- Synty 官方 FAQ 說明大部分美術包不包含動畫，角色使用自己的骨架、轉 Unreal 等需要 retarget；source files 是否包含須看個別商品。可編修不等於可轉售資產。這只是成熟 3D 商用資產的限制例子，不推薦用其低多邊形人類美術作本案寵物。**wordlimit 200。** — [Synty FAQ](https://syntystore.com/en-gb/community/faq)

### Inferences
| 方案 | 模組化產能 | 本案風險／成立條件 |
|---|---|---|
| Rive 分層 2D | 同 base 的動作可覆用；衣服須製作形狀、綁定與前後片；資料控制外觀與互動 | 本案優先。仍需原創造型、rig 與事件規格；別先承諾所有新衣服無需調動畫。 |
| Spine 分層 2D | skins、attachments、服裝專用 bones 等已有完整示範；可保留手繪貼圖質感 | 若合作美術擅長 Spine，可能比硬換 Rive 省工；需確認軟體/runtime/美術各自授權與版本。 |
| Blender 預渲染 | 可在製作時分層並輸出遮罩；固定鏡頭、同步影格的配件有機會獨立組合 | 不能說每件衣服必須連全身重渲染，也不能說分層便可自由換裝。跨層遮擋、陰影、反射、衣物體積會產生相依；基於舊衣服計算的遮罩並不會補出新衣服遮住的背後。若多體型、多衣服、多互動都要正確，例外會增多。 |
| 即時 3D | 一個 mesh 可隨骨架動；衣服可獨立蒙皮，動作能 retarget | 每套仍需模型、拓樸、材質、蒙皮與穿插檢查；真人平面頭轉側面尤其不自然。這輪不建議為它換全 app 引擎。 |

### Gaps
- 沒有足夠第一手數據比較同一美術品質、同一衣服數量的 Rive/Spine 工時，因此不報任意倍數、工期或省成本百分比。
- 沒找到與本案完全相同「真人照片頭＋動物換裝」的完整成熟開源製作包；以上可行性與風格成功是不同層次。

## 3. 可取得什麼資源、委託要交付什麼，以及下一步最小驗證範圍？

### Takeaway
現成工程適合驗證工作流；真正可長期抽角色與換裝的產品，需要角色設計師與互動動畫師能持續擴充的原始資產。最小下一步是一隻有品質的角色、一件真正衣服、一段完整互動，以及明確交接檔案。

### Cited Findings
- alisketch 的原創 **Cat**（2026-03-22）有 Download/Remix 與 CC BY 標示，作者為 For Hire。作者明說只有點擊頭部與基本臉部控制，因此只能作風格／rig 候選，不能說已具完整餵養動畫或服裝系統。**wordlimit 200。** — [Cat by alisketch](https://rive.app/marketplace/26950-50655-cat/)
- 同作者 **Mascot / Avatar Customization**（2026-04-29）沿用自己既有 rig 與動畫，加上顏色控制及動作測試 UI，頁面標 CC BY。它能用來看作者資產覆用做法，但作者只宣稱換色，不能把它說成真正衣服換裝。**wordlimit 200。** — [Mascot / Avatar Customization](https://www.rive.app/marketplace/27479-51911-mascot-avatar-customization/)
- Rive 官方提供 Experts 入口，收錄 freelancer、studio、agency。可用來找提供原創角色與 Rive rig 作品的人；此頁未直接提供可比的報價，不能編造委託價格。**wordlimit 200。** — [Rive Experts](https://rive.app/experts)
- Spine 團隊 Erika 在 2019-07-31 官方論壇說隨附示範工程可做作品集等衍生、不可作商業用途。這是歷史官方回覆；正式上架前仍須檢查當前個別資產授權，**不能把可下載 mix-and-match 原檔當作可商用角色**。**wordlimit 200。** — [Building portfolio](https://en.esotericsoftware.com/forum/d/12364-building-portfolio)
- 截至查證，Rive 價格頁將 .riv export 列於 Cadet 等付費方案；免費編輯不代表免費匯出。價格呈現包含月／年切換，本研究不引用金額以免搞混帳期。**wordlimit 200。** — [Rive Pricing](https://www.rive.app/pricing)

### Inferences
**選資源或找人時的順序**：先看符合實際手機尺寸的作品與照片頭合成，通過才看可否取得原始 rig；「能操作 Rive」不足以替代「會設計可愛動物」。有合適原創資產可先取得授權後改造；找不到吻合照片頭開口、身形與衣服規格的成熟資產，就委託一個 base，而非拿不適合的模板硬改。

**本案建議最小製作範圍（非業界固定標準）**：
1. 一個確定物種、姿勢與比例的 base，先給三張不同真人照片的靜態合成；不要再同時做兩套整頁 MVP。
2. 一件輪廓明顯不同的衣服，例如可看到前片與袖子的外套；換色不算第二套衣服。預留一個玩具掛點，可先不做完整玩具互動。
3. Idle 與一個完整餵食流程；有待機到餵食的銜接、食物接觸事件、完成回待機，也確認中途重點或換裝時的行為。
4. 在目標手機畫面尺寸播放，展示裸裝／穿衣、三張照片與完整餵食；用這個結果決定是否擴角色庫。

**可檢查交付物（給委託方的本案規格建議）**：
- 原創角色設定：正面、必要側面、比例／色票、照片頭開口、手機尺寸預覽；一張有說服力的定稿圖。
- 可編輯分層美術（PSD/SVG 或工具原始 vector）及未裁切關節補畫；人體照片原檔不得被烘焙進公用角色包。
- 可編輯 Rive 原工程／備份與 .riv，清楚命名的 body、衣服前後片、耳朵尾巴、照片掛點、prop 掛點、遮罩。
- 角色與服裝支援表：bodyFamily、slot、需要隱藏的部位、禁止組合、適配偏移。這是未來內容目錄，不等於現在實作抽獎。
- State machine、資料欄位、inputs、事件時點及中斷規則文件；例：食物真正接觸才送 consume，而非按下按鈕即完成。
- 桌面及實際手機尺寸的試播，檢查照片是否變形、衣袖／臉／耳朵穿插、腳是否滑動、動畫前後是否跳位。
- 清楚列明商用、修改、後續增衣、可交接給別人維護的授權範圍；素材授權和 Rive 軟體方案分開列。

MCP／CLI 可以代替部分重複建檔、命名、匯出與接線；本輪來源沒有證明它可取代專業造型、綁定權重、接觸動作與視覺驗收。這是能力邊界判斷，不能宣稱來源做過 MCP 效能實驗。

### Gaps
- Marketplace CC BY 標記不保證投稿者擁有所有第三方權利；正式採用仍需釐清來源，尤其品牌仿作。上述 Cat 作者明列自己創作但本研究未完成逐層素材權利查核。
- 沒有取得委託報價，也沒有聯絡任何創作者；尚未購買或下載資產到專案。
- 沒有宣稱這些候選資產已解決照片人臉與身體的美術整合；那正是下次要先驗證的內容。
