"""
PAD corpus builder for bio-authN v2.

Generates:
  - pad_bonafide genuine images: real corpus images, labelled "bonafide"
  - ~50% print attacks + ~50% screen attacks: deterministic OpenCV/PIL degradations
  - Flags pad_vlm_subset samples (100 bonafide / 100 attack) to bound VLM cost

Augments corpus/manifest.json with a "pad_samples" key (additive — existing "pairs" untouched).
Outputs attack images to corpus/pad_attacks/.

Run: python corpus/attacks.py [--config config/eval.yaml]

NOTE: These are simulated PAIs for exercising PAD metric infrastructure —
not real-world attack samples. Not iBeta-grade evaluation.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np
import yaml
from tqdm import tqdm

ROOT          = Path(__file__).parent.parent
CORPUS_DIR    = Path(__file__).parent
MANIFEST_PATH = CORPUS_DIR / "manifest.json"
ATTACKS_DIR   = CORPUS_DIR / "pad_attacks"


# ---------------------------------------------------------------------------
# Attack transforms
# ---------------------------------------------------------------------------

def _ensure_bgr(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if img.shape[2] == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def apply_print_attack(image_path: str, out_path: Path, rng_state: int) -> None:
    """
    Simulate a printed photograph held to the camera.
    Transforms: Gaussian blur, desaturation, warm yellow cast, noise, re-quantisation,
    and a half-resolution round-trip to approximate halftone dot-matrix structure.
    """
    np.random.seed(rng_state)
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read: {image_path}")
    img = _ensure_bgr(img).astype(np.float32)

    # 1. Lens/scan softening
    img = cv2.GaussianBlur(img, (0, 0), sigmaX=1.0)

    # 2. Desaturate 30% toward grayscale
    gray_3 = np.stack([cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)] * 3, axis=2)
    img = 0.70 * img + 0.30 * gray_3

    # 3. Warm yellow cast: R up, B down (ink on paper)
    img[:, :, 2] = np.clip(img[:, :, 2] * 1.06, 0, 255)   # R channel
    img[:, :, 0] = np.clip(img[:, :, 0] * 0.90, 0, 255)   # B channel

    # 4. Paper texture noise
    noise = np.random.normal(0, 6, img.shape).astype(np.float32)
    img   = np.clip(img + noise, 0, 255)

    # 5. Re-quantise to 64 intensity levels (halftone approximation)
    img = (img / 4).astype(np.uint8).astype(np.float32) * 4

    # 6. Downscale + upscale to simulate halftone resolution loss
    h, w = img.shape[:2]
    small = cv2.resize(img, (max(1, w // 2), max(1, h // 2)), interpolation=cv2.INTER_AREA)
    img   = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img.astype(np.uint8))


def apply_screen_attack(image_path: str, out_path: Path, rng_state: int) -> None:
    """
    Simulate a phone/tablet screen replay captured by a second camera.
    Transforms: blue-cool LED tint, horizontal scan lines, screen-door grid,
    sinusoidal moiré, specular glare patch, bezel black border.
    """
    np.random.seed(rng_state)
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read: {image_path}")
    img = _ensure_bgr(img).astype(np.float32)
    h, w = img.shape[:2]

    # 1. Blue-cool tint (LED backlight temperature)
    img[:, :, 2] = np.clip(img[:, :, 2] * 1.10, 0, 255)   # B
    img[:, :, 1] = np.clip(img[:, :, 1] * 1.04, 0, 255)   # G

    # 2. Horizontal scan lines (every 4th row darkened)
    for y in range(0, h, 4):
        img[y, :, :] = np.clip(img[y, :, :] * 0.60, 0, 255)

    # 3. Screen-door effect (vertical bright columns every 3rd pixel)
    for x in range(0, w, 3):
        img[:, x, :] = np.clip(img[:, x, :] * 1.08, 0, 255)

    # 4. Moiré: sinusoidal luminance modulation across rows
    rows   = np.arange(h, dtype=np.float32)
    moire  = 1.0 + 0.04 * np.sin(2.0 * np.pi * rows / 6.0)
    img    = np.clip(img * moire[:, np.newaxis, np.newaxis], 0, 255)

    # 5. Specular glare patch (top-right corner)
    gy, gx = int(h * 0.12), int(w * 0.72)
    gh, gw = int(h * 0.12), int(w * 0.15)
    if gy + gh <= h and gx + gw <= w:
        img[gy:gy + gh, gx:gx + gw] = np.clip(
            img[gy:gy + gh, gx:gx + gw] * 1.6 + 50, 0, 255
        )

    # 6. Bezel crop: black border (simulates camera framing outside screen edge)
    border = max(2, int(min(h, w) * 0.04))
    img[:border, :, :]  = 0
    img[-border:, :, :] = 0
    img[:, :border, :]  = 0
    img[:, -border:, :] = 0

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img.astype(np.uint8))


# ---------------------------------------------------------------------------
# Corpus builder
# ---------------------------------------------------------------------------

def build_pad_corpus(cfg: dict, manifest: dict) -> list[dict]:
    rng = random.Random(cfg["seed"])

    n_bonafide = cfg["corpus"].get("pad_bonafide", 200)
    n_attacks  = cfg["corpus"].get("pad_attacks",  200)
    n_vlm_sub  = cfg["corpus"].get("pad_vlm_subset", 200)
    n_print    = n_attacks // 2
    n_screen   = n_attacks - n_print

    # Gather genuine images from identities
    all_images: list[tuple[str, str]] = []
    for identity in manifest["identities"]:
        for img in identity["images"]:
            all_images.append((identity["identity_id"], img["path"]))

    existing = [(iid, p) for iid, p in all_images if Path(p).exists()]
    if not existing:
        raise RuntimeError("No corpus images found. Run build_corpus.py first.")

    rng.shuffle(existing)

    bonafide_pool = existing[:n_bonafide]
    attack_pool   = existing[n_bonafide:n_bonafide + n_attacks]
    # Wrap-around if corpus is smaller than needed
    if len(attack_pool) < n_attacks:
        attack_pool = (attack_pool + existing)[:n_attacks]

    samples: list[dict] = []

    # --- Bona-fide ---
    for idx, (identity_id, img_path) in enumerate(bonafide_pool):
        samples.append({
            "sample_id":     f"pad_bf_{idx:04d}",
            "image_path":    img_path,
            "label":         "bonafide",
            "attack_type":   None,
            "identity_id":   identity_id,
            "pad_vlm_subset": False,
        })

    # --- Print attacks ---
    ATTACKS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[attacks] Generating {n_print} print attacks ...")
    for idx, (identity_id, img_path) in enumerate(tqdm(attack_pool[:n_print], desc="print")):
        out_path = ATTACKS_DIR / f"print_{idx:04d}.png"
        if not out_path.exists():
            apply_print_attack(img_path, out_path, rng_state=1000 + idx)
        samples.append({
            "sample_id":     f"pad_print_{idx:04d}",
            "image_path":    str(out_path),
            "label":         "attack",
            "attack_type":   "print",
            "identity_id":   identity_id,
            "pad_vlm_subset": False,
            "source_image":  img_path,
        })

    # --- Screen attacks ---
    print(f"[attacks] Generating {n_screen} screen attacks ...")
    screen_pool = attack_pool[n_print:n_print + n_screen]
    for idx, (identity_id, img_path) in enumerate(tqdm(screen_pool, desc="screen")):
        out_path = ATTACKS_DIR / f"screen_{idx:04d}.png"
        if not out_path.exists():
            apply_screen_attack(img_path, out_path, rng_state=2000 + idx)
        samples.append({
            "sample_id":     f"pad_screen_{idx:04d}",
            "image_path":    str(out_path),
            "label":         "attack",
            "attack_type":   "screen",
            "identity_id":   identity_id,
            "pad_vlm_subset": False,
            "source_image":  img_path,
        })

    # --- Flag VLM subset: 100 bonafide + 100 attack ---
    n_vlm_bf  = n_vlm_sub // 2
    n_vlm_atk = n_vlm_sub - n_vlm_bf

    bf_ids  = [s["sample_id"] for s in samples if s["label"] == "bonafide"]
    atk_ids = [s["sample_id"] for s in samples if s["label"] == "attack"]
    rng.shuffle(bf_ids)
    rng.shuffle(atk_ids)

    vlm_ids = set(bf_ids[:n_vlm_bf] + atk_ids[:n_vlm_atk])
    for s in samples:
        s["pad_vlm_subset"] = s["sample_id"] in vlm_ids

    return samples


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(config_path: str = "config/eval.yaml") -> None:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    if not MANIFEST_PATH.exists():
        print("[attacks] ERROR: corpus/manifest.json not found. Run build_corpus.py first.")
        raise SystemExit(1)

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    # Idempotent: skip if attack files already generated
    existing_pad = manifest.get("pad_samples", [])
    if existing_pad:
        attack_files_ok = all(
            Path(s["image_path"]).exists()
            for s in existing_pad
            if s.get("attack_type") is not None
        )
        if attack_files_ok:
            print(
                f"[attacks] {len(existing_pad)} PAD samples already in manifest "
                f"and attack files present — skipping."
            )
            return

    pad_samples = build_pad_corpus(cfg, manifest)

    n_bf  = sum(1 for s in pad_samples if s["label"] == "bonafide")
    n_pr  = sum(1 for s in pad_samples if s.get("attack_type") == "print")
    n_sc  = sum(1 for s in pad_samples if s.get("attack_type") == "screen")
    n_vlm = sum(1 for s in pad_samples if s["pad_vlm_subset"])

    manifest["pad_samples"]       = pad_samples
    manifest["n_pad_bonafide"]    = n_bf
    manifest["n_pad_attacks"]     = n_pr + n_sc
    manifest["n_pad_vlm_subset"]  = n_vlm
    manifest["pad_note"] = (
        "Simulated PAIs via deterministic OpenCV/PIL transforms (blur, colour shift, "
        "scan lines, quantisation, moiré). Not real-world attack samples. "
        "Exercises PAD metric infrastructure only; not iBeta-grade evaluation."
    )

    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, default=str)

    print(
        f"[attacks] manifest.json updated.\n"
        f"         {n_bf} bonafide | {n_pr} print + {n_sc} screen attacks | "
        f"{n_vlm} VLM-subset"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/eval.yaml")
    args = parser.parse_args()
    main(args.config)
