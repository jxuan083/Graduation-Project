# 手繪狗狗互動預覽

本輪先完成使用者喜歡的手繪角色 A，供實際互動評估。人臉合成暫緩；尚未接入正式養成 API、背包、抽角色或換裝。綠色背心目前畫在身體素材上，不能獨立更換。

## 本機試玩

在專案根目錄執行：

```sh
python3 -m http.server 5178 --directory frontend
```

開啟 <http://127.0.0.1:5178/pet-preview.html>。可按按鈕餵食、拖餅乾到手邊，或點頭部摸摸牠。餵食完成事件才累計試玩次數，重新整理即歸零。

## 素材與動畫

- 核准的美術方向：`docs/pet-concepts/character-directions-v1.png`。
- 圖片由內建 image_gen 產生；完整提示詞、來源和限制記在 `frontend/assets/pets/illustrated/source.json`。
- `puppy-parts-v1.png` 包含身體、頭部表情、耳朵、尾巴等分層；`puppy-paw-poses-v1.png` 是手部姿勢替換圖。
- 原生、無腳本 Rive 使用 UV 裁取與分層變換，搭配表情及手部替換圖。保留毛髮輪廓，避免過度拉伸手臂圖片。
- 六個狀態：Idle、Notice、Receive、Chew、Satisfied、Pet。待機有呼吸、眨眼、耳尾輕動；手邊食物離開後可取消期待。
- View Model `PuppyCare`：`feed` / `pet` trigger、`nearFood` boolean、`attention` number。
- 原生事件：`feedStart`、`foodTaken`、`chewing`、`feedComplete`、`petStart`、`petComplete`。瀏覽器以完成事件解鎖操作，避免連按重複計數。
- 本機 vendored Rive runtime 和 WASM，不需要外部 CDN。減少動態偏好使用靜止角色與文字回饋。

## 重建

需要 Rive CLI 1.6.0；將 `rive` 加入 PATH 後，在專案根目錄執行：

```sh
python3 scripts/pets/build_illustrated_puppy.py
rive scripts/pets/illustrated-puppy --verify
rive inspect scripts/pets/illustrated-puppy --summary
rive scripts/pets/illustrated-puppy --once
cp scripts/pets/illustrated-puppy/build/illustrated-puppy.riv frontend/assets/pets/illustrated/puppy-v1.riv
```

`scene.rml` 由 Python 產生，修改生成器後應重新生成。CLI 的 `--advance=N` 以 60 fps 的幀數計算；截取特定階段建議使用 `--advance=2s` 這類秒數。

## 本輪驗證

2026-10-20：原生 Rive verify/inspect 無錯誤或警告；既有前端測試 40/40 通過。另用 Playwright 實際載入 Rive，檢查桌面、390px 手機、DPR 2、拖放成功／失敗／取消、快速重複操作、連續餵食、摸頭、減少動態切換、重新整理及載入失敗後重試。目視檢查待機、接食、咀嚼和靜止畫面。這些確認功能與顯示正常，不代表使用者已驗收動畫品質。
