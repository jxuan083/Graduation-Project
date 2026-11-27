"""報紙插圖：挑聚會照片、找人臉、把群組寵物放在不擋到人的位置。

只做「人臉偵測」（找出照片裡哪裡有臉），不做人臉辨識（不知道是誰）。
模型是 OpenCV 的 YuNet（backend/models/，MIT 授權），在自己的伺服器上跑，照片不會送到別的服務。

座標一律用 0～1 的比例：x、寬度以照片寬為 1，y、高度以照片高為 1（照片已依 EXIF 轉正，
跟瀏覽器顯示的方向一致），前端照這個比例把寵物疊到照片上。
"""
from __future__ import annotations

import io
import os
from typing import Optional

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "face_detection_yunet_2023mar.onnx")
MAX_SIDE = 1280            # 偵測前先縮到長邊 1280，夠準也夠快
SCORE_THRESHOLD = 0.75
MAX_PHOTOS_TO_SCAN = 12    # 照片很多時只看前 12 張，避免產生報紙太久

# 寵物大小（佔照片寬度）：先試大的，放不下再縮小
PET_SIZES = (0.30, 0.24, 0.18, 0.14)
MARGIN = 0.03


class FaceDetectionUnavailable(RuntimeError):
    """伺服器沒有 OpenCV 或模型檔：無法確定人臉位置。"""


def detect_faces(image_bytes: bytes) -> dict:
    """回傳 {"width", "height", "faces": [{"x","y","w","h","score"}]}（比例座標）。"""
    try:
        import cv2
        import numpy as np
    except ImportError as e:  # pragma: no cover - 正式環境與 CI 都有裝
        raise FaceDetectionUnavailable(str(e)) from e
    if not os.path.exists(MODEL_PATH):
        raise FaceDetectionUnavailable(f"missing model {MODEL_PATH}")
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    width, height = img.size
    scale = min(1.0, MAX_SIDE / max(width, height))
    if scale < 1.0:
        img = img.resize((max(1, round(width * scale)), max(1, round(height * scale))))
    w, h = img.size
    bgr = np.ascontiguousarray(np.asarray(img)[:, :, ::-1])
    detector = cv2.FaceDetectorYN.create(MODEL_PATH, "", (w, h), SCORE_THRESHOLD, 0.3, 5000)
    _, found = detector.detect(bgr)
    faces = []
    for row in (found if found is not None else []):
        fx, fy, fw, fh = (float(v) for v in row[:4])
        faces.append({
            "x": max(0.0, fx / w), "y": max(0.0, fy / h),
            "w": min(fw / w, 1.0), "h": min(fh / h, 1.0),
            "score": round(float(row[14]), 3),
        })
    return {"width": width, "height": height, "faces": faces}


def person_regions(faces: list) -> list:
    """由臉往外推估整個人佔的範圍：左右各多約一張臉寬（肩膀），往下約 4 張臉高（身體）。"""
    regions = []
    for f in faces:
        regions.append((
            max(0.0, f["x"] - 0.9 * f["w"]),
            max(0.0, f["y"] - 0.35 * f["h"]),
            min(1.0, f["x"] + 1.9 * f["w"]),
            min(1.0, f["y"] + 5.0 * f["h"]),
        ))
    return regions


def _overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def place_pet(faces: list, aspect: float) -> Optional[dict]:
    """在照片上找一個完全不擋到人的位置給寵物（正方形）。

    aspect = 照片寬 / 高。回傳 {"x","y","w"}（左上角與寬度，比例座標），找不到就回傳 None
    （前端改成把寵物放在照片下方的圖說旁邊，保證不擋到人）。
    """
    regions = person_regions(faces)
    for size in PET_SIZES:
        box_h = size * aspect                 # 正方形：高度換算成「照片高」的比例
        if box_h > 1 - 2 * MARGIN:
            continue
        bottom, top = 1 - MARGIN - box_h, MARGIN
        left, right = MARGIN, 1 - MARGIN - size
        xs = [right, left] + [right - i * (right - left) / 16 for i in range(1, 16)]   # 先兩個角落，再右→左
        ys = [bottom - i * (bottom - top) / 8 for i in range(9)]                       # 由下往上，寵物盡量坐在下面
        candidates = [(x, y) for y in ys for x in xs]
        for x, y in candidates:
            box = (x, y, x + size, y + box_h)
            if not any(_overlaps(box, r) for r in regions):
                return {"x": round(x, 4), "y": round(y, 4), "w": size}
    return None


def choose_hero_photo(photos: list, scans: dict, host_cover_id: Optional[str]) -> Optional[dict]:
    """挑報紙主圖：主持人手動選的封面優先；否則人臉最多的；一樣多時封面優先，再來是最早拍的。

    photos 已依「封面優先、上傳時間」排序；scans 是 {photo_id: detect_faces 的結果}（偵測失敗的不在裡面）。
    """
    if not photos:
        return None
    if host_cover_id:
        chosen = next((p for p in photos if p.get("id") == host_cover_id), None)
        if chosen:
            return chosen
    order = {p.get("id"): i for i, p in enumerate(photos)}
    return max(photos, key=lambda p: (len((scans.get(p.get("id")) or {}).get("faces") or []),
                                      bool(p.get("is_cover")), -order[p.get("id")]))


def build_photo_hero(photos: list, read_bytes, host_cover_id: Optional[str], with_pet: bool) -> Optional[dict]:
    """有照片時的報紙主圖資料；read_bytes(photo) 回傳照片原始檔。沒有照片回傳 None。"""
    if not photos:
        return None
    scans: dict = {}
    detection_ok = True
    for photo in photos[:MAX_PHOTOS_TO_SCAN]:
        try:
            scans[photo["id"]] = detect_faces(read_bytes(photo))
        except FaceDetectionUnavailable as e:
            print(f"[newspaper] 人臉偵測無法使用：{e}")
            detection_ok = False
            break
        except Exception as e:  # noqa: BLE001 - 單張壞掉不影響其他張
            print(f"[newspaper] 照片 {photo.get('id')} 偵測失敗：{e}")
    chosen = choose_hero_photo(photos, scans, host_cover_id)
    scan = scans.get(chosen.get("id"))
    hero = {
        "kind": "photo",
        "photo_id": chosen.get("id"),
        "content_path": chosen.get("content_path"),
        "face_count": len(scan["faces"]) if scan else None,
        "pet": None,
    }
    if with_pet:
        # 偵測不到臉的位置（模型無法使用或這張讀取失敗）時不疊在照片上，改放圖說旁，保證不擋到人
        spot = place_pet(scan["faces"], scan["width"] / scan["height"]) if (detection_ok and scan) else None
        hero["pet"] = {"mode": "overlay", **spot} if spot else {"mode": "caption"}
    return hero
