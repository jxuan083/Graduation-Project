# 寵物造型與播放器

第一版提供一隻原創短絨毛狗狗，含獨立頭部、耳朵、尾巴與前腳 pivot。
模型由 Blender Python 建立，無付費生成 API、無第三方角色素材。

```sh
blender --background --python scripts/pets/build_dog.py
python3 -m http.server 5178 --bind 127.0.0.1 --directory frontend
```

開啟 `http://127.0.0.1:5178/pet-preview.html`。預覽互動不寫入養成數值；
選取的照片由瀏覽器內的 MediaPipe 裁臉，不會上傳。辨識模型首次需連網下載。

`puppy.blend` 為可編輯原檔，`frontend/assets/pets/puppy.glb` 為網頁資產。
修改模型時須保留 `tests/pet-model.test.js` 驗證的 pivot 名稱。
Three.js 0.180.0 與 GLTFLoader 存放於 `frontend/vendor/three`，授權附於該目錄。

正式養成畫面只為「狗狗＋有獨立 pet_portrait_url」啟用 3D；其他物種、舊版
合成圖、載入失敗與 WebGL 不可用時保留原本圖片顯示。舊版圖片沒有可逆的臉部
資訊，須在群組重新選取照片；不從合成圖猜造人臉。前後端需一起部署才能保存新欄位。
人臉維持原比例，使用不受場景打光與色調映射影響的照片材質。

餵食、清潔、玩耍的動作於照顧 API 成功後播放；數值、冷卻與救援規則沿用原後端。
減少動態偏好會移除身體動作；離開畫面釋放 GPU 資源，背景分頁停止繪製。
目前為分部件程序動畫，尚無拖曳餵食、刷洗手勢、追球路徑或骨架蒙皮。

本機已安裝 Blender 5.2.2 及 mcp-for-blender addon。這輪模型建置與渲染使用
Blender Python CLI；官方 MCP addon 拒絕 background 模式，尚未完成 GUI 連線驗證。
網頁播放器獨立於 MCP，使用者執行 app 不需要安裝 Blender。

驗證：`npm test`、`.venv/bin/python -m unittest discover -s backend/tests`。
已以 Blender 渲染檢查造型；瀏覽器自動控制連線中斷，WebGL 實際顯示、真人照片貼合
及手機效能仍需目視驗收，不應以靜態渲染代替網頁驗證。
