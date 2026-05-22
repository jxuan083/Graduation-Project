"""
Pet Face Swap — 把人臉特徵合成到動物臉模板上
使用方式：
    python face_swap.py --human your_photo.jpg --animal dog_template.jpg --output result.jpg

依賴：
    pip install opencv-python dlib numpy
    需要 dlib 的 shape_predictor_68_face_landmarks.dat
    下載：http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2
"""

import cv2
import dlib
import numpy as np
import argparse
import json
import os

# ── 1. 初始化 dlib 偵測器 ──────────────────────────────────────────────────────
detector = dlib.get_frontal_face_detector()

PREDICTOR_PATH = os.path.join(os.path.dirname(__file__), "shape_predictor_68_face_landmarks.dat")
predictor = dlib.shape_predictor(PREDICTOR_PATH)


def get_landmarks(img: np.ndarray) -> np.ndarray | None:
    """偵測圖片中最大的人臉，回傳 68×2 的 landmark 陣列，找不到回傳 None"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = detector(gray, 1)
    if not faces:
        return None
    # 取最大的臉
    face = max(faces, key=lambda r: r.width() * r.height())
    shape = predictor(gray, face)
    return np.array([[shape.part(i).x, shape.part(i).y] for i in range(68)], dtype=np.float32)


def load_animal_landmarks(path: str) -> np.ndarray | None:
    """
    從 JSON 檔讀取預先標好的動物特徵點。
    JSON 格式：[[x0,y0], [x1,y1], ...]，共 68 點（與 dlib 順序對應）
    如果 JSON 不存在，就嘗試對動物圖片直接跑 dlib（適用於真實動物臉）
    """
    json_path = path.rsplit(".", 1)[0] + "_landmarks.json"
    if os.path.exists(json_path):
        with open(json_path) as f:
            pts = json.load(f)
        return np.array(pts, dtype=np.float32)
    # fallback：直接跑 dlib（只對真實人/狗臉有效）
    img = cv2.imread(path)
    if img is None:
        return None
    return get_landmarks(img)


# ── 2. Delaunay 三角剖分 ────────────────────────────────────────────────────────
def get_triangles(pts: np.ndarray, img_shape: tuple) -> list[tuple]:
    """對特徵點做 Delaunay 三角剖分，回傳每個三角形的三個點索引"""
    h, w = img_shape[:2]
    rect = (0, 0, w, h)
    subdiv = cv2.Subdiv2D(rect)

    idx_map = {}
    for i, (x, y) in enumerate(pts):
        key = (float(x), float(y))
        subdiv.insert(key)
        idx_map[key] = i

    triangles = []
    for tri in subdiv.getTriangleList():
        pts_tri = [(tri[0], tri[1]), (tri[2], tri[3]), (tri[4], tri[5])]
        idxs = []
        valid = True
        for p in pts_tri:
            # 找最近的點索引
            dists = np.linalg.norm(pts - np.array(p), axis=1)
            i = int(np.argmin(dists))
            if dists[i] > 2:        # 超過 2px 視為 subdiv 補的邊界點，跳過
                valid = False
                break
            idxs.append(i)
        if valid and len(set(idxs)) == 3:
            triangles.append(tuple(idxs))
    return triangles


# ── 3. 單三角形 Affine Warp ─────────────────────────────────────────────────────
def warp_triangle(src: np.ndarray, dst: np.ndarray,
                  tri_src: np.ndarray, tri_dst: np.ndarray) -> None:
    """把 src 裡的一個三角形 affine warp 到 dst 的對應三角形區域"""
    r_src = cv2.boundingRect(tri_src.astype(np.float32))
    r_dst = cv2.boundingRect(tri_dst.astype(np.float32))

    tri_src_crop = tri_src - r_src[:2]
    tri_dst_crop = tri_dst - r_dst[:2]

    mask = np.zeros((r_dst[3], r_dst[2]), dtype=np.uint8)
    cv2.fillConvexPoly(mask, tri_dst_crop.astype(np.int32), 255)

    src_crop = src[r_src[1]:r_src[1]+r_src[3], r_src[0]:r_src[0]+r_src[2]]
    if src_crop.size == 0:
        return

    M = cv2.getAffineTransform(tri_src_crop.astype(np.float32),
                                tri_dst_crop.astype(np.float32))
    warped = cv2.warpAffine(src_crop, M, (r_dst[2], r_dst[3]),
                             flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_REFLECT_101)

    # 貼到 dst 的對應位置
    x, y, w, h = r_dst
    roi = dst[y:y+h, x:x+w]
    roi_masked = cv2.bitwise_and(roi, roi, mask=cv2.bitwise_not(mask))
    warped_masked = cv2.bitwise_and(warped, warped, mask=mask)
    dst[y:y+h, x:x+w] = cv2.add(roi_masked, warped_masked)


# ── 4. 主流程 ───────────────────────────────────────────────────────────────────
def face_swap(human_path: str, animal_path: str, output_path: str,
              feather: int = 60) -> bool:
    """
    feather: 邊界羽化程度（像素），越大越模糊
    """
    human_img = cv2.imread(human_path)
    animal_img = cv2.imread(animal_path)
    if human_img is None or animal_img is None:
        print("讀取圖片失敗，請確認路徑")
        return False

    human_pts = get_landmarks(human_img)
    if human_pts is None:
        print("找不到人臉，請換一張正臉照片")
        return False

    animal_pts = load_animal_landmarks(animal_path)
    if animal_pts is None:
        print("找不到動物特徵點")
        return False

    # Step 1：Delaunay 三角 warp（68 點）
    result = animal_img.copy()
    triangles = get_triangles(human_pts, human_img.shape)
    for tri_idx in triangles:
        tri_h = human_pts[list(tri_idx)]
        tri_a = animal_pts[list(tri_idx)]
        warp_triangle(human_img, result, tri_h, tri_a)

    # Step 2：convex hull mask + Gaussian 羽化
    hull_a = cv2.convexHull(animal_pts.astype(np.int32))
    mask_hard = np.zeros(animal_img.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask_hard, hull_a, 255)

    # 先稍微侵蝕去掉三角 warp 產生的邊緣鋸齒，再 Gaussian blur 做羽化
    k = feather | 1          # 確保是奇數
    erode_k = np.ones((k // 4 | 1, k // 4 | 1), np.uint8)
    mask_eroded = cv2.erode(mask_hard, erode_k, iterations=1)
    mask_blur = cv2.GaussianBlur(mask_eroded, (k, k), 0)

    # alpha blend：warped * alpha + animal * (1-alpha)
    alpha = mask_blur.astype(np.float32) / 255.0
    alpha3 = np.stack([alpha, alpha, alpha], axis=2)

    blended = (result.astype(np.float32) * alpha3
               + animal_img.astype(np.float32) * (1.0 - alpha3))
    output = np.clip(blended, 0, 255).astype(np.uint8)

    cv2.imwrite(output_path, output)
    print(f"輸出：{output_path}")
    return True


# ── 5. 標記工具：幫動物圖標 landmarks（matplotlib 互動式）────────────────────────
def label_animal_landmarks(animal_path: str):
    """
    左鍵點擊 = 新增點（照順序），右鍵 = 撤回最後一點。
    標完 68 點後進入「移點模式」：
      - 左鍵點擊任意綠點 → 選中（變紅）
      - 再左鍵點擊任意空白處 → 把選中的點移過去
      - 右鍵 = 取消選取
      - 按 S 鍵存檔
    """
    import matplotlib
    matplotlib.use("MacOSX")
    import matplotlib.pyplot as plt

    img_bgr = cv2.imread(animal_path)
    if img_bgr is None:
        print("找不到圖片")
        return
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w = img_rgb.shape[:2]
    SNAP = w * 0.025   # 點擊選取半徑

    DLIB_GROUPS = [
        ("下巴輪廓 0-16", 17), ("左眉毛 17-21", 5), ("右眉毛 22-26", 5),
        ("鼻樑 27-30", 4), ("鼻尖 31-35", 5),
        ("左眼 36-41", 6), ("右眼 42-47", 6),
        ("外嘴唇 48-59", 12), ("內嘴唇 60-67", 8),
    ]

    landmarks = []
    plots = []
    selected = [None]  # 目前選中的點編號（用 list 讓 closure 可修改）

    json_path = animal_path.rsplit(".", 1)[0] + "_landmarks.json"
    if os.path.exists(json_path):
        with open(json_path) as f:
            loaded = json.load(f)
        landmarks.extend(loaded)
        print(f"載入已有 {len(landmarks)} 個點，可繼續調整")

    fig, ax = plt.subplots(figsize=(11, 11))
    ax.imshow(img_rgb)
    info = ax.text(10, h * 0.03, "", color="yellow", fontsize=10,
                   bbox=dict(facecolor="black", alpha=0.6))

    def _redraw():
        for sc, tx in plots:
            sc.remove(); tx.remove()
        plots.clear()
        for i, (px, py) in enumerate(landmarks):
            if i == selected[0]:
                col, ms = "red", 9
            else:
                col, ms = "lime", 6
            sc = ax.plot(px, py, "o", color=col, markersize=ms, markeredgewidth=0)[0]
            tx = ax.text(px + w * 0.003, py - h * 0.006, str(i),
                         color="cyan", fontsize=7, fontweight="bold")
            plots.append((sc, tx))
        _refresh_info()
        fig.canvas.draw_idle()

    def _refresh_info():
        total = len(landmarks)
        if total < 68:
            count, g = 0, 0
            for i, (_, n) in enumerate(DLIB_GROUPS):
                if count + n > total: g = i; break
                count += n
            info.set_text(f"點 {total}/68  目前：{DLIB_GROUPS[g][0]}  右鍵=撤回")
            ax.set_title("左鍵依序點擊標記 68 個特徵點", fontsize=12)
        elif selected[0] is not None:
            info.set_text(f"已選第 {selected[0]} 點（紅色）→ 左鍵點新位置移過去  右鍵=取消")
            ax.set_title("移點模式", fontsize=12, color="orange")
        else:
            info.set_text("左鍵點綠點選取 → 再點新位置移動  S=存檔")
            ax.set_title("調整模式：左鍵選點再點新位置，S 鍵存檔", fontsize=12, color="lime")

    def on_click(event):
        if event.inaxes != ax or event.xdata is None:
            return
        x, y = event.xdata, event.ydata

        if len(landmarks) < 68:
            # 標記模式
            if event.button == 1:
                landmarks.append([x, y])
                _redraw()
            elif event.button == 3 and landmarks:
                landmarks.pop()
                selected[0] = None
                _redraw()
            return

        # 調整模式
        if event.button == 3:
            selected[0] = None
            _redraw()
            return

        if event.button != 1:
            return

        dists = [((lx - x) ** 2 + (ly - y) ** 2) ** 0.5 for lx, ly in landmarks]
        nearest = int(np.argmin(dists))

        if selected[0] is None:
            # 第一次點擊：選取最近的點
            if dists[nearest] < SNAP:
                selected[0] = nearest
                _redraw()
        else:
            # 第二次點擊：移動到新位置
            landmarks[selected[0]] = [x, y]
            selected[0] = None
            _redraw()

    def on_key(event):
        if event.key and event.key.lower() == 's' and len(landmarks) == 68:
            with open(json_path, "w") as f:
                json.dump([[float(p[0]), float(p[1])] for p in landmarks], f)
            print(f"✅ 儲存到 {json_path}")
            ax.set_title("已存檔！關閉視窗即可", fontsize=13, color="lime")
            fig.canvas.draw_idle()

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)

    def on_key(event):
        if event.key.lower() == 's' and len(landmarks) == 68:
            with open(json_path, "w") as f:
                json.dump([[float(p[0]), float(p[1])] for p in landmarks], f)
            print(f"✅ 儲存到 {json_path}")
            ax.set_title("已存檔！關閉視窗即可", fontsize=13, color="lime")
            fig.canvas.draw_idle()

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)

    _redraw()
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["swap", "label"], default="swap")
    parser.add_argument("--human", help="人臉照片路徑")
    parser.add_argument("--animal", help="動物模板圖片路徑")
    parser.add_argument("--output", default="output.jpg", help="輸出路徑")
    args = parser.parse_args()

    if args.mode == "label":
        label_animal_landmarks(args.animal)
    else:
        if not args.human or not args.animal:
            parser.print_help()
        else:
            face_swap(args.human, args.animal, args.output)
