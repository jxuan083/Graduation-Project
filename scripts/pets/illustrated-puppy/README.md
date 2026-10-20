# 手繪狗狗與正式養成整合

正式入口是群組的「領養群組寵物」與「去養成」。`frontend/pet-preview.html` 保留為純美術互動試玩，不會呼叫養成 API。

## 目前角色

- `puppy-v1`：使用者選定的手繪狗狗。前腳與身體在所有狀態都固定，僅頭部、表情、耳朵、尾巴和道具會動。
- 使用者於 2026-10-20 明確要求「讓他的手不動」；不可重新加入抬手、手部替換、身體呼吸縮放或外層角色彈跳。
- 背心畫在身體上。抽角色、獨立衣服與玩具背包尚未實作，不能把目前的成長收藏徽章當成可穿戴衣服。
- 人臉合成暫緩。既有照片角色仍以保存的圖片顯示；建立者可換成插畫狗狗，保留成長與冷卻。

## 資產

`frontend/assets/pets/illustrated/` 中目前生效的是：

- `puppy-parts-v1.png`：原始透明分層圖集。
- `puppy-poster-v1.png`：由實際 Rive 畫布輸出的透明縮圖，供群組卡片、聚會和載入失敗時使用。
- `puppy-v1.riv`：無腳本原生 Rive，約 1.76 MB。只嵌入原始分層圖集一次。

先前手部姿勢圖留作來源紀錄，已從執行中的 Rive 移除。內建 image_gen 的完整提示詞與美術來源保存在 `source.json`，不依賴機器上的生成快取路徑。

## 動畫與介面

Artboard `Puppy`，State Machine `Care`，View Model `PuppyCare`。

- 觸發器：`feed`、`pet`、`wipe`、`play`。
- 輔助輸入：`nearFood` boolean、`attention` number。
- 八個狀態：Idle、Notice、Receive、Chew、Satisfied、Pet、Wipe、Play。
- 餵食在嘴邊顯示餅乾與咀嚼；清潔閉眼並出現泡泡；玩耍看著球滾動；摸頭有獨立表情。
- 事件：`feedStart`、`foodTaken`、`chewing`、`feedComplete`，以及 `pet` / `wipe` / `play` 的 `Start` 與 `Complete`。
- `IllustratedPetViewer.playAndWait(action)` 等實際原生完成事件，取消／卸載會結束等待；有超時恢復。減少動態模式改為靜止圖與文字回饋。

## 重建

需要 Rive CLI 1.6.0，將 `rive` 加入 PATH 後在專案根目錄執行：

```sh
python3 scripts/pets/build_illustrated_puppy.py
rive scripts/pets/illustrated-puppy --verify
rive inspect scripts/pets/illustrated-puppy --summary
rive scripts/pets/illustrated-puppy --once
cp scripts/pets/illustrated-puppy/build/illustrated-puppy.riv frontend/assets/pets/illustrated/puppy-v1.riv
```

`scene.rml` 是生成檔。CLI 的 `--advance=N` 用 60 fps 幀數計算，截圖建議用 `--advance=2s` 指定秒數。

正式系統、API、驗證與部署說明見 [pet-system.md](../../../docs/pet-system.md)。
