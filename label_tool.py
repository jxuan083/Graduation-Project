"""
動物臉標點工具 — 只需 matplotlib + Pillow，不需要 dlib / OpenCV
用法：
    python label_tool.py cat_template.jpg
存檔會產生同名 JSON：cat_template_landmarks.json
把 cat_template.jpg + cat_template_landmarks.json 傳回給 Brian 即可
"""

import sys
import json
import os
import numpy as np

# ── 跨平台 matplotlib backend ────────────────────────────────────────────────────
import matplotlib
try:
    if sys.platform == "darwin":
        matplotlib.use("MacOSX")
    else:
        matplotlib.use("TkAgg")
except Exception:
    pass
import matplotlib.pyplot as plt
from PIL import Image

DLIB_GROUPS = [
    ("下巴輪廓",   "0–16",  17, "從左耳下沿下巴到右耳，共 17 點，由左到右"),
    ("左眉毛",     "17–21",  5, "由眉頭（內側）→ 眉尾（外側），共 5 點"),
    ("右眉毛",     "22–26",  5, "由眉頭（內側）→ 眉尾（外側），共 5 點"),
    ("鼻樑",       "27–30",  4, "由鼻根往下到鼻尖上方，共 4 點"),
    ("鼻尖/鼻翼",  "31–35",  5, "左鼻翼→鼻尖→右鼻翼，共 5 點"),
    ("左眼",       "36–41",  6, "順時針從眼角開始，共 6 點"),
    ("右眼",       "42–47",  6, "順時針從眼角開始，共 6 點"),
    ("外嘴唇",     "48–59", 12, "順時針從左嘴角開始，共 12 點"),
    ("內嘴唇",     "60–67",  8, "順時針從上嘴唇中央開始，共 8 點"),
]


def main(animal_path: str):
    if not os.path.exists(animal_path):
        print(f"找不到圖片：{animal_path}")
        sys.exit(1)

    img = Image.open(animal_path).convert("RGB")
    img_arr = np.array(img)
    h, w = img_arr.shape[:2]
    SNAP = w * 0.03

    json_path = animal_path.rsplit(".", 1)[0] + "_landmarks.json"
    landmarks = []
    if os.path.exists(json_path):
        with open(json_path) as f:
            landmarks.extend(json.load(f))
        print(f"載入已有 {len(landmarks)} 個點，可繼續調整")

    selected = [None]
    plots = []

    fig, ax = plt.subplots(figsize=(12, 12))
    ax.imshow(img_arr)
    ax.set_xlim(0, w); ax.set_ylim(h, 0)
    info = ax.text(10, h * 0.03, "", color="yellow", fontsize=10,
                   bbox=dict(facecolor="black", alpha=0.7, pad=4))

    def _group_of(idx):
        c = 0
        for name, nums, n, desc in DLIB_GROUPS:
            if idx < c + n:
                return name, nums, desc
            c += n
        return "?", "?", ""

    def _redraw():
        for sc, tx in plots:
            sc.remove(); tx.remove()
        plots.clear()
        for i, (px, py) in enumerate(landmarks):
            col = "red" if i == selected[0] else "lime"
            ms  = 9    if i == selected[0] else 6
            sc = ax.plot(px, py, "o", color=col, markersize=ms,
                         markeredgewidth=0)[0]
            tx = ax.text(px + w * 0.004, py - h * 0.007, str(i),
                         color="cyan", fontsize=7, fontweight="bold")
            plots.append((sc, tx))
        _refresh_info()
        fig.canvas.draw_idle()

    def _refresh_info():
        n = len(landmarks)
        if n < 68:
            c = 0
            for name, nums, count, desc in DLIB_GROUPS:
                if n < c + count:
                    info.set_text(
                        f"點 {n}/68  ▶ {name}（{nums}）\n{desc}\n右鍵=撤回上一點")
                    ax.set_title(f"標記模式：左鍵依序點  目前在標「{name}」",
                                 fontsize=11)
                    return
                c += count
        elif selected[0] is not None:
            name, nums, desc = _group_of(selected[0])
            info.set_text(
                f"已選第 {selected[0]} 點（{name} {nums}，紅色）\n左鍵點新位置移過去  右鍵=取消選取")
            ax.set_title("移點模式", fontsize=11, color="orange")
        else:
            info.set_text("68 點完成！左鍵點綠點選取→再點新位置移動\n按 S 鍵存檔")
            ax.set_title("調整模式 — 按 S 存檔", fontsize=11, color="lime")

    def on_click(event):
        if event.inaxes != ax or event.xdata is None:
            return
        x, y = event.xdata, event.ydata

        if len(landmarks) < 68:
            if event.button == 1:
                landmarks.append([x, y])
            elif event.button == 3 and landmarks:
                landmarks.pop()
                selected[0] = None
            _redraw()
            return

        if event.button == 3:
            selected[0] = None
            _redraw()
            return
        if event.button != 1:
            return

        dists = [((lx - x) ** 2 + (ly - y) ** 2) ** 0.5
                 for lx, ly in landmarks]
        nearest = int(np.argmin(dists))
        if selected[0] is None:
            if dists[nearest] < SNAP:
                selected[0] = nearest
                _redraw()
        else:
            landmarks[selected[0]] = [x, y]
            selected[0] = None
            _redraw()

    def on_key(event):
        if event.key and event.key.lower() == "s":
            if len(landmarks) != 68:
                print(f"現在只有 {len(landmarks)} 點，需要 68 點才能存檔")
                return
            with open(json_path, "w") as f:
                json.dump([[float(p[0]), float(p[1])] for p in landmarks], f,
                          indent=2)
            print(f"✅ 存檔成功：{json_path}")
            ax.set_title("已存檔！把 JSON 和圖片傳給 Brian", fontsize=13,
                         color="lime")
            fig.canvas.draw_idle()

    fig.canvas.mpl_connect("button_press_event", on_click)
    fig.canvas.mpl_connect("key_press_event", on_key)

    _redraw()
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法：python label_tool.py <動物圖片路徑>")
        print("例如：python label_tool.py cat_template.jpg")
        sys.exit(1)
    main(sys.argv[1])
