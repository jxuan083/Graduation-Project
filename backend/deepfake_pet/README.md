# Pet Face Swap — 使用說明

## 安裝依賴

```bash
pip install opencv-python dlib numpy
```

### 下載 dlib 人臉特徵點模型
```bash
# 下載後解壓縮到這個資料夾
curl -L http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2 -o shape_predictor_68_face_landmarks.dat.bz2
bunzip2 shape_predictor_68_face_landmarks.dat.bz2
```

---

## 第一步：準備狗臉模板

1. 找一張**正面、臉部清晰**的狗照片，放到這個資料夾，命名為 `dog_template.jpg`
2. 執行標記工具，手動點 68 個特徵點：
```bash
python face_swap.py --mode label --animal dog_template.jpg
```
3. 依照視窗左上角的提示，按順序點 68 個點（對應 dlib 68 點位置）
4. 標完按 `s` 儲存，會產生 `dog_template_landmarks.json`

### dlib 68 點標記順序
```
0-16:   下巴輪廓（左到右）
17-21:  左眉毛
22-26:  右眉毛
27-30:  鼻樑
31-35:  鼻尖
36-41:  左眼（順時針）
42-47:  右眼（順時針）
48-59:  外嘴唇
60-67:  內嘴唇
```

---

## 第二步：執行 Face Swap

```bash
python face_swap.py --mode swap --human 同學照片.jpg --animal dog_template.jpg --output result.jpg
```

---

## 動畫計畫（第二階段）

準備 5~10 張狗的動作幀（眨眼 / 搖頭 / 開口），每張都標好 landmarks，
然後對每一幀跑 face_swap，最後用 Pillow 合成 GIF：

```python
from PIL import Image
frames = [Image.open(f"frame_{i}.jpg") for i in range(10)]
frames[0].save("pet_animation.gif", save_all=True, append_images=frames[1:],
               loop=0, duration=100)
```
