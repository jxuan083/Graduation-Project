# 寵物造型與播放器

2026-10-19，使用者確認目標：升級養成畫面中的身體質感與動作；真人臉直接使用原照片，優先保真。
目前預設為 Blender Studio 的 Autumn 衍生版本。第一版幾何狗狗已保留為對照素材。

## 預覽

```sh
python3 -m http.server 5178 --bind 127.0.0.1 --directory frontend
```

開啟 `http://127.0.0.1:5178/pet-preview.html?v=2`。預覽互動不寫入養成數值。
選取照片由瀏覽器內 MediaPipe 裁臉，不會上傳；辨識模型首次需連網下載。

## 重建素材

從 https://studio.blender.org/characters/autumn/v1/ 下載並解壓官方角色檔案，再執行：

```sh
blender --background --disable-autoexec --python scripts/pets/prepare_autumn.py -- /path/to/autumn/autumn.blend
```

產物是 `frontend/assets/pets/autumn.glb` 與可編輯的 `autumn-web.blend`。不需要付費生成 API。
保留來源輪廓、UV 和色彩貼圖；電影控制骨架改為 22 根蒙皮骨骼，粒子毛改成沿表面毛流排列、帶透明貼圖的毛片。
Idle、Feed、Wipe、Play、Tap 五組動畫是本專案新增，包含起手、耳尾延遲跟隨與收尾。
來源與改作說明見 `frontend/assets/pets/AUTUMN-LICENSE.md`，預覽及正式養成畫面顯示署名。
原照片使用獨立平面與不受燈光、色調映射影響的材質，不進行五官重畫或幾何拉伸。

原創第一版可用 `blender --background --python scripts/pets/build_dog.py` 重建。
Three.js 0.180.0、GLTFLoader 與 MIT 授權保存在 `frontend/vendor/three`。

## 整合與限制

正式養成畫面只為「狗狗＋獨立 pet_portrait_url」啟用 3D；其他物種、舊合成圖、載入失敗
及 WebGL 不可用時保留原圖片。舊合成圖沒有可逆的原照片資訊，需重新選取照片，不從成品猜造人臉。
前後端需一起部署才能保存新欄位。餵食、清潔、玩耍的動畫只在 API 確認成功後播放，數值、冷卻與救援規則沿用原後端。
操作仍為三個按鈕，尚無拖食物到嘴邊、刷洗手勢或追球路徑。
減少動態偏好停用身體動作；背景分頁停止繪製，離開畫面釋放材質、貼圖、骨架與 GPU 資源。
繪製限制為 30 FPS、DPR 上限 2、1024 陰影貼圖；尚未完成手機效能實測。

本機已裝 Blender 5.2.2 與 mcp-for-blender addon。本輪使用 Blender Python CLI 建置及渲染；
官方 MCP addon 拒絕 background 模式，GUI 連線尚未驗證。使用 app 不需要 Blender 或 MCP。

## 查證後採用的技巧與資源

- [Autumn 角色](https://studio.blender.org/characters/autumn/v1/)：採用實際作者製作的模型輪廓與貼圖，避免用基本幾何拼角色。
- [Blender Hair Nodes](https://docs.blender.org/manual/en/4.4/modeling/geometry_nodes/hair/index.html)：毛髮需要毛流、成束、長短與微小不規則變化，不能只平均撒短刺。
- [Frizz Hair Curves](https://docs.blender.org/manual/en/5.0/modeling/geometry_nodes/hair/deformation/frizz_hair_curves.html)：自然變化應沿毛髮連續變化，控制強度，避免均勻噪聲。
- [Blender glTF 匯出](https://docs.blender.org/manual/en/5.0/addons/import_export/scene_gltf2.html)：曲線與非網格資料不能直接保留；材質須整理成支援的 PBR/貼圖，動作匯出骨骼或物件變換。
- [Three.js AnimationAction](https://threejs.org/docs/pages/AnimationAction.html)：用 AnimationMixer 與 crossFadeTo 混合動作，避免直接重設姿勢。
- [Quaternius 動物包](https://quaternius.com/packs/ultimateanimatedanimals.html)：另有 CC0、12 種動物、每隻超過 12 組動畫的遊戲素材；本輪未匯入。
- [Blendkit 授權 FAQ](https://www.blendkit.com/docs/licenses/licensing-faq/)：Royalty Free 對容易抽取的遊戲素材有限制，本專案公開 GLB 不直接採用這類素材；CC0 與已履行署名的 CC BY 較適合。

## 驗證

`npm test`、`.venv/bin/python -m unittest discover -s backend/tests`。
素材檢查實際解析 GLB、確認骨架權重歸一、五組動畫、人臉掛點隨頭部移動、接地與檔案預算。
Blender 已渲染多個動作中途姿勢；衍生檔確認不依賴外部 library、僅兩張內嵌貼圖且不含原始腳本。
瀏覽器控制連線中斷，WebGL 實際顯示、真人照片貼合與手機流暢度仍待目視驗收。
