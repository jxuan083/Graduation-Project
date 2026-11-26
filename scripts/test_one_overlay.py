#!/usr/bin/env python3
"""
Quick one-shot test: generate the 'crown' accessory with the new style
and composite it on the puppy image for visual review BEFORE running
the full batch.

Usage:
    OPENAI_API_KEY=sk-... python scripts/test_one_overlay.py
"""
import base64, sys
from pathlib import Path
from io import BytesIO

from PIL import Image
from openai import OpenAI

ROOT   = Path(__file__).resolve().parents[1]
PUPPY  = ROOT / "frontend/assets/pets/illustrated/puppy-poster-v1.png"
OUT    = ROOT / "frontend/assets/pets/gacha_overlay/_test_crown_preview.png"
RAW    = ROOT / "frontend/assets/pets/gacha_overlay/_test_crown_raw.png"

CANVAS = 400
client = OpenAI()

SHARED_STYLE = (
    "soft painterly children's book illustration, warm muted colors, "
    "gentle rounded forms with subtle soft shadows, "
    "NO heavy black outlines — use color-shading only, "
    "watercolor-meets-digital-painting technique, "
    "fully transparent background, centered in frame, "
    "isolated single object, no other items, no text, no labels"
)

desc = (
    "small ornate golden crown with ruby and sapphire cabochon gems, "
    "royal and sparkling, seen from slightly below front view"
)

print("Generating crown with new painterly style …")
resp = client.images.generate(
    model="gpt-image-2.6-sunburst",
    prompt=f"{desc}, {SHARED_STYLE}",
    size="1024x1024",
    quality="medium",
    background="transparent",
    n=1,
    output_format="png",
)
raw = Image.open(BytesIO(base64.b64decode(resp.data[0].b64_json))).convert("RGBA")
raw.save(RAW)
print(f"Raw saved → {RAW}")

# Composite onto puppy at crown's canvas position
x, y, w, h = 121, -36, 158, 158
resized = raw.resize((w, h), Image.LANCZOS)
canvas  = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
canvas.paste(resized, (x, y), resized)

puppy = Image.open(PUPPY).convert("RGBA").resize((CANVAS, CANVAS), Image.LANCZOS)
merged = puppy.copy()
merged.paste(canvas, (0, 0), canvas)

# Side-by-side: old vs new
old_path = ROOT / "frontend/assets/pets/gacha_overlay/crown.png"
old = Image.open(old_path).convert("RGBA") if old_path.exists() else None
old_composite = puppy.copy()
if old:
    old_composite.paste(old, (0, 0), old)

compare = Image.new("RGBA", (CANVAS * 2 + 20, CANVAS + 60), (200, 200, 200, 255))
from PIL import ImageDraw
d = ImageDraw.Draw(compare)
d.text((10, 5),  "OLD (cartoon)", fill=(80,80,80))
d.text((CANVAS + 30, 5), "NEW (painterly)", fill=(80,80,80))
compare.paste(old_composite, (0, 25))
compare.paste(merged, (CANVAS + 20, 25))
compare.save(OUT)
print(f"Side-by-side preview saved → {OUT}")
print("Open the file in Finder to compare OLD vs NEW crown style.")
