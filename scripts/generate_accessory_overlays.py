#!/usr/bin/env python3
"""
Generate accessory overlay PNGs for the gacha pet system.

Costume approach (generate endpoint — dog + item drawn together):
  1. Use images.generate with a LOCKED dog description + accessory description
     so the AI draws both together (natural "wearing" effect, not sticker)
  2. The generated image has transparent background
  3. Diff vs original PUPPY_POSTER to extract ONLY the new accessory pixels
     (threshold 22 — colored accessories diff clearly from golden fur)
  4. Overlay = extracted accessory pixels on transparent canvas
  5. Dressed  = original PUPPY_POSTER (pixel-perfect) + overlay composited
  Dog never changes — always the original PUPPY_POSTER in the final output.

Effect approach (edit API with dog-silhouette mask — unchanged, works well).

Combo pre-render: 8 head × 3 neck × 3 body × 6 effect = 432 PNG files.

Usage:
    OPENAI_API_KEY=sk-... python scripts/generate_accessory_overlays.py
    OPENAI_API_KEY=sk-... python scripts/generate_accessory_overlays.py crown scarf
    OPENAI_API_KEY=sk-... python scripts/generate_accessory_overlays.py --effects-only
    OPENAI_API_KEY=sk-... python scripts/generate_accessory_overlays.py --costumes-only
    OPENAI_API_KEY=sk-... python scripts/generate_accessory_overlays.py --combos-only
"""

import sys, time, base64
from pathlib import Path
from io import BytesIO

import numpy as np
from PIL import Image, ImageDraw
from openai import OpenAI

ROOT         = Path(__file__).resolve().parents[1]
PUPPY_POSTER = ROOT / "frontend/assets/pets/illustrated/puppy-poster-v1.png"
OVERLAY_DIR  = ROOT / "frontend/assets/pets/gacha_overlay"
DRESSED_DIR  = ROOT / "frontend/assets/pets/gacha_dressed"
COMBO_DIR    = ROOT / "frontend/assets/pets/gacha_combos"
CANVAS       = 400
EDIT_SIZE    = 1024
client       = OpenAI()

# ── Strict, locked dog description used in EVERY costume prompt ───────────────
# This is the single variable that keeps the dog consistent across all 14 items.
CANONICAL_DOG = (
    "a cute chubby fluffy golden retriever puppy, sitting upright facing forward, "
    "both front paws slightly raised at chest height, "
    "big round warm dark-brown eyes with tiny catchlights, "
    "long floppy golden-brown ears hanging on the sides, "
    "cream-white patch on chest, "
    "soft warm golden-brown fur covering the body, "
    "small rounded brown nose, content gentle expression, "
    "centered in frame, occupying about 75% of the frame height, "
    "transparent background (no scene, no ground, no shadow on background)"
)

SHARED_STYLE = (
    "soft painterly children's book illustration style, "
    "warm muted golden-brown palette, gentle rounded forms, "
    "subtle soft shadows, no heavy black outlines, "
    "watercolor-meets-digital-painting technique"
)

# ── Item tables ──────────────────────────────────────────────────────────────

# Description = what the puppy HAS / IS WEARING (used in "The puppy has …")
COSTUMES = [
    ("party_hat",       "a colorful striped cone party hat with a fluffy yellow pompom on top, sitting on its head"),
    ("bow_tie_hat",     "a large fluffy pink satin ribbon bow perched on top of its head"),
    ("crown",           "a small ornate golden crown with ruby and sapphire gems resting on its head"),
    ("witch_hat",       "a pointed purple witch hat with a golden star buckle, slightly tilted on its head"),
    ("star_crown",      "a golden star-shaped tiara on its head, sparkling with tiny diamonds"),
    ("rainbow_crown",   "a pastel rainbow tiara with colorful gem flowers on its head"),
    ("cat_ears",        "a pair of fluffy pink cat ears perched on its head like a hair clip"),
    ("star_glasses",    "cute yellow star-shaped sunglasses over its eyes"),
    ("scarf",           "a cozy red and blue plaid tartan scarf loosely wrapped around its neck"),
    ("medal",           "a shiny gold award medal on a red ribbon hanging around its neck"),
    ("crystal_pendant", "a faceted blue crystal teardrop pendant on a silver chain at its neck"),
    ("vest",            "a small red fabric vest with a yellow star button on its body"),
    ("cape",            "a red superhero cape with a gold star emblem and yellow trim on its back"),
    ("tuxedo",          "a miniature black tuxedo jacket with white shirt and black bow tie on its body"),
]

EFFECTS = [
    ("sparkle",   "tiny golden sparkles and glitter floating all around the puppy"),
    ("music",     "colorful musical notes and small hearts floating around the puppy"),
    ("hearts",    "soft pink and red hearts raining down gently around the puppy"),
    ("rainbow",   "a soft pastel rainbow arc shining above and behind the puppy"),
    ("fireworks", "colorful celebration firework bursts sparkling in the air around the puppy"),
    ("galaxy",    "swirling galaxy stardust and tiny stars surrounding the puppy in a soft glow"),
]

SLOT_HEAD = ["party_hat","bow_tie_hat","crown","witch_hat","star_crown","rainbow_crown","cat_ears","star_glasses"]
SLOT_NECK = ["scarf","medal","crystal_pendant"]
SLOT_BODY = ["vest","cape","tuxedo"]
SLOT_EFF  = ["sparkle","music","hearts","rainbow","fireworks","galaxy"]

# Slot bounding boxes (x, y, w, h) in 400×400 canvas
COSTUME_POSITIONS = {
    "party_hat":       (104, -42, 192, 192),
    "bow_tie_hat":     (123, -25, 155, 155),
    "crown":           (121, -36, 158, 158),
    "witch_hat":       (107, -45, 187, 187),
    "star_crown":      (121, -30, 159, 159),
    "rainbow_crown":   (111, -46, 179, 179),
    "cat_ears":        (119, -27, 163, 163),
    "star_glasses":    (101,  26, 198, 198),
    "scarf":           (125, 141, 165, 165),
    "medal":           (152, 169,  97,  97),
    "crystal_pendant": (145, 171, 109, 109),
    "vest":            (127, 190, 147, 147),
    "cape":            ( 85, 156, 231, 231),
    "tuxedo":          (121, 181, 159, 159),
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_dog_base() -> Image.Image:
    img = Image.open(PUPPY_POSTER).convert("RGBA")
    bg  = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=img)
    return bg.resize((EDIT_SIZE, EDIT_SIZE), Image.LANCZOS)


def make_effect_mask() -> Image.Image:
    from scipy.ndimage import binary_dilation
    orig   = Image.open(PUPPY_POSTER).convert("RGBA").resize((EDIT_SIZE, EDIT_SIZE), Image.LANCZOS)
    arr    = np.array(orig)
    is_dog = binary_dilation(arr[:, :, 3] > 20, iterations=10)
    mask   = np.zeros((EDIT_SIZE, EDIT_SIZE, 4), dtype=np.uint8)
    mask[is_dog, 3] = 255
    return Image.fromarray(mask, "RGBA")


def call_edit_api(image: Image.Image, mask: Image.Image, prompt: str) -> Image.Image | None:
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        image.convert("RGBA").save(f, "PNG"); img_path = f.name
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        mask.save(f, "PNG"); mask_path = f.name
    try:
        for model in ["gpt-image-2.6-sunburst", "gpt-image-1", "dall-e-2"]:
            try:
                with open(img_path, "rb") as img_f, open(mask_path, "rb") as mask_f:
                    resp = client.images.edit(
                        model=model, image=img_f, mask=mask_f,
                        prompt=prompt, n=1, size="1024x1024",
                    )
                data = (base64.b64decode(resp.data[0].b64_json) if resp.data[0].b64_json
                        else __import__("urllib.request").request.urlopen(resp.data[0].url).read())
                print(f"    (edit model: {model})")
                return Image.open(BytesIO(data)).convert("RGBA")
            except Exception as e:
                err = str(e)
                if any(k in err for k in ["not exist","not support","not available","does not"]):
                    print(f"    model {model} unavailable …"); continue
                raise
        return None
    finally:
        os.unlink(img_path); os.unlink(mask_path)


def call_generate(prompt: str) -> Image.Image:
    resp = client.images.generate(
        model="gpt-image-2.6-sunburst", prompt=prompt,
        size="1024x1024", quality="high", background="transparent",
        n=1, output_format="png",
    )
    return Image.open(BytesIO(base64.b64decode(resp.data[0].b64_json))).convert("RGBA")


# ── Core generation ───────────────────────────────────────────────────────────

def generate_costume(file_id: str, description: str,
                     x: int = 0, y: int = 0, w: int = CANVAS, h: int = CANVAS) -> bool:
    """
    Generate dog + accessory TOGETHER using the generate endpoint so the AI draws
    the item naturally on the dog (not a sticker). Dog description is locked via
    CANONICAL_DOG to keep appearance consistent across all 14 items.

    Overlay extraction:
    - Reference = original PUPPY_POSTER (dog RGB where opaque, white where transparent)
    - diff > THRESHOLD in the slot bounding box + NOT transparent background = accessory pixels
    - Threshold 22: colored accessories (red, blue, purple, gold gems) diff clearly vs gold fur
    - Dilation(2) to close small gaps; re-clipped to slot + not-bg

    Dressed = original PUPPY_POSTER (pixel-perfect, unchanged) + overlay composited.
    """
    from scipy.ndimage import binary_dilation

    DIFF_THRESHOLD = 22

    # Strict prompt: locked dog + accessory + style
    prompt = (
        f"Children's book illustration: {CANONICAL_DOG}. "
        f"The puppy has {description}. "
        f"{SHARED_STYLE}. "
        f"The puppy must be in exactly the same sitting pose, centered, same size in frame. "
        f"Draw the accessory naturally as if the puppy is actually wearing it — "
        f"correct size, angle, and fitting to the puppy's body."
    )

    result = call_generate(prompt)   # 1024×1024, transparent bg

    # ── Work in CANVAS (400×400) space ────────────────────────────────────────
    r_small = np.array(result.resize((CANVAS, CANVAS), Image.LANCZOS))

    # Reference image: original dog pixels where dog exists, white where transparent
    orig_rgba = np.array(Image.open(PUPPY_POSTER).convert("RGBA")
                         .resize((CANVAS, CANVAS), Image.LANCZOS))
    reference = np.full((CANVAS, CANVAS, 3), 255, dtype=np.uint8)   # white bg
    is_dog_px = orig_rgba[:, :, 3] > 20
    reference[is_dog_px] = orig_rgba[is_dog_px, :3]   # original dog colors

    # diff vs original: captures pixels the AI added (the accessory)
    diff = np.abs(r_small[:, :, :3].astype(int) - reference.astype(int)).max(axis=2)

    # Slot bounding box (tight)
    sx0 = max(0, x); sy0 = max(0, y)
    sx1 = min(CANVAS, x + w); sy1 = min(CANVAS, y + h)
    in_slot = np.zeros((CANVAS, CANVAS), dtype=bool)
    in_slot[sy0:sy1, sx0:sx1] = True

    # Background = transparent in generated image (alpha < 20)
    is_bg = r_small[:, :, 3] < 20

    # Accessory pixels: in slot + strong diff + not transparent background
    is_acc = in_slot & (diff > DIFF_THRESHOLD) & ~is_bg
    is_acc = binary_dilation(is_acc, iterations=2)      # fill small gaps
    is_acc = is_acc & in_slot & ~is_bg                  # re-clip strictly

    # ── Overlay: transparent everywhere except accessory ──────────────────────
    overlay_arr           = np.zeros((CANVAS, CANVAS, 4), dtype=np.uint8)
    overlay_arr[:, :, :3] = r_small[:, :, :3]
    overlay_arr[:, :, 3]  = np.where(is_acc, 255, 0).astype(np.uint8)
    overlay = Image.fromarray(overlay_arr, "RGBA")
    overlay.save(OVERLAY_DIR / f"{file_id}.png", "PNG")

    # ── Dressed: save full AI-generated image directly (natural worn effect) ──
    # The AI drew dog + accessory together, so the item looks naturally fitted.
    # We do NOT composite diff overlay onto original dog here — that created a
    # double-dog-head artifact. The dressed preview uses the raw generation result.
    result.resize((CANVAS, CANVAS), Image.LANCZOS).save(DRESSED_DIR / f"{file_id}.png", "PNG")
    return True


def dog_silhouette_alpha() -> np.ndarray:
    from scipy.ndimage import binary_dilation
    orig   = Image.open(PUPPY_POSTER).convert("RGBA").resize((EDIT_SIZE, EDIT_SIZE), Image.LANCZOS)
    is_dog = np.array(orig)[:, :, 3] > 20
    return binary_dilation(is_dog, iterations=6)


def generate_effect(file_id: str, description: str) -> bool:
    dog    = load_dog_base()
    mask   = make_effect_mask()
    prompt = (
        f"Keep the puppy illustration exactly as-is. "
        f"Fill only the white background around the puppy with {description}. "
        f"The puppy's body, face, pose, and colours must remain perfectly unchanged. "
        f"Add decorative elements only in the surrounding space. {SHARED_STYLE}."
    )
    result = call_edit_api(dog, mask, prompt)
    if result is None:
        result = call_generate(
            f"{description}, decorative effect only, no dog, spread across canvas, {SHARED_STYLE}."
        )
    dressed = result.resize((CANVAS, CANVAS), Image.LANCZOS)
    dressed.save(DRESSED_DIR / f"{file_id}.png", "PNG")
    ovr_arr = np.array(result.convert("RGBA"))
    ovr_arr[dog_silhouette_alpha(), 3] = 0
    overlay = Image.fromarray(ovr_arr, "RGBA").resize((CANVAS, CANVAS), Image.LANCZOS)
    overlay.save(OVERLAY_DIR / f"{file_id}.png", "PNG")
    return True


# ── Combo pre-rendering ───────────────────────────────────────────────────────

def generate_all_combos():
    """Pre-render all 8×3×3×6 = 432 combination PNG files."""
    COMBO_DIR.mkdir(parents=True, exist_ok=True)
    base = Image.open(PUPPY_POSTER).convert("RGBA").resize((CANVAS, CANVAS), Image.LANCZOS)

    overlays = {}
    missing  = []
    for slot_id in SLOT_HEAD + SLOT_NECK + SLOT_BODY + SLOT_EFF:
        p = OVERLAY_DIR / f"{slot_id}.png"
        if p.exists():
            overlays[slot_id] = Image.open(p).convert("RGBA")
        else:
            missing.append(slot_id)
    if missing:
        print(f"  WARNING: missing overlays: {missing}", file=sys.stderr)

    total = len(SLOT_HEAD) * len(SLOT_NECK) * len(SLOT_BODY) * len(SLOT_EFF)
    idx   = 0
    for h in SLOT_HEAD:
        for n in SLOT_NECK:
            for b in SLOT_BODY:
                for e in SLOT_EFF:
                    idx += 1
                    img = base.copy()
                    for slot_id in [e, b, n, h]:   # effect → body → neck → head
                        if slot_id in overlays:
                            img = Image.alpha_composite(img, overlays[slot_id])
                    img.save(COMBO_DIR / f"{h}__{n}__{b}__{e}.png", "PNG", optimize=True)
                    if idx % 72 == 0:
                        print(f"  {idx}/{total} combos …")
    print(f"✅ {idx} combo files → {COMBO_DIR}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    args          = sys.argv[1:]
    effects_only  = "--effects-only"  in args
    costumes_only = "--costumes-only" in args
    combos_only   = "--combos-only"   in args
    args          = [a for a in args if not a.startswith("--")]

    DRESSED_DIR.mkdir(parents=True, exist_ok=True)
    OVERLAY_DIR.mkdir(parents=True, exist_ok=True)

    if combos_only:
        generate_all_combos()
        return

    if effects_only:
        targets_c, targets_e = [], list(EFFECTS)
    elif costumes_only:
        targets_c, targets_e = list(COSTUMES), []
    elif args:
        only      = set(args)
        targets_c = [(fid, d) for fid, d in COSTUMES if fid in only]
        targets_e = [(fid, d) for fid, d in EFFECTS  if fid in only]
    else:
        targets_c = list(COSTUMES)
        targets_e = list(EFFECTS)

    total = len(targets_c) + len(targets_e)
    idx   = 0

    for file_id, desc in targets_c:
        idx += 1
        print(f"\n[{idx}/{total}] costume: {file_id}")
        pos = COSTUME_POSITIONS.get(file_id, (0, 0, CANVAS, CANVAS))
        try:
            generate_costume(file_id, desc, *pos)
            print(f"  ✓ dressed {(DRESSED_DIR/f'{file_id}.png').stat().st_size//1024} KB  "
                  f"overlay {(OVERLAY_DIR/f'{file_id}.png').stat().st_size//1024} KB")
        except Exception as e:
            print(f"  ✗ FAILED: {e}", file=sys.stderr)
        if idx < total:
            time.sleep(6)

    for file_id, desc in targets_e:
        idx += 1
        print(f"\n[{idx}/{total}] effect: {file_id}")
        try:
            generate_effect(file_id, desc)
            print(f"  ✓ {(DRESSED_DIR/f'{file_id}.png').stat().st_size//1024} KB")
        except Exception as e:
            print(f"  ✗ FAILED: {e}", file=sys.stderr)
        if idx < total:
            time.sleep(6)

    if not effects_only and not args:
        print("\n── Pre-rendering 432 combination files …")
        generate_all_combos()

    print(f"\n✅ Done")


if __name__ == "__main__":
    main()
