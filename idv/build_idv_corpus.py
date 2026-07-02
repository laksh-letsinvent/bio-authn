"""
IDV corpus builder. Run once before run_idv_eval.py.

Usage:
  python -m idv.build_idv_corpus                    # all three tasks
  python -m idv.build_idv_corpus --task extraction  # MIDV-2020 only
  python -m idv.build_idv_corpus --task authenticity # SIDTD only
  python -m idv.build_idv_corpus --task face_match  # DigiFace card pairs only

Data licensing — read before downloading:
  MIDV-2020  — Non-commercial research. Attribute: K. Bulatov et al., SmartEngines, 2020.
               http://smartengines.com/midv-2020/
  SIDTD      — CC BY-NC 4.0 non-commercial. Attribute: D. Jimenez-Morales et al., 2023.
               https://github.com/IMATIA-INNOVATION/SIDTD
  DigiFace   — Microsoft Research License (non-commercial). Already in corpus/data/.

The DigiFace card generation runs offline (no download). MIDV-2020 and SIDTD
require internet access and will prompt if licence has not been acknowledged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import shutil
import sys
import zipfile
from pathlib import Path

import io

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO_ROOT   = Path(__file__).parent.parent
IDV_DATA    = REPO_ROOT / "idv" / "data"
CORPUS_DATA = REPO_ROOT / "corpus" / "data"
MANIFEST    = REPO_ROOT / "idv" / "manifest.json"

SEED = 42


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Build IDV evaluation corpus")
    parser.add_argument(
        "--task",
        choices=["extraction", "authenticity", "face_match", "all"],
        default="all",
        help="Which sub-task corpus to build",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip licence acknowledgement prompts",
    )
    args = parser.parse_args()

    IDV_DATA.mkdir(parents=True, exist_ok=True)

    if args.task in ("extraction", "all"):
        build_extraction_corpus(skip_prompt=args.yes)

    if args.task in ("authenticity", "all"):
        build_authenticity_corpus(skip_prompt=args.yes)

    if args.task in ("face_match", "all"):
        build_face_match_corpus()

    _update_manifest()
    print("\nCorpus build complete. Run idv/run_idv_eval.py to generate results.")


# ---------------------------------------------------------------------------
# Task 1 — Extraction: MIDV-2020
# ---------------------------------------------------------------------------

MIDV_URL = "https://raw.githubusercontent.com/SmartEngines/midv2020/main/"
MIDV_DIR = IDV_DATA / "midv2020"

# Fallback: generate synthetic specimen documents so adapters can be tested
# without the real MIDV corpus. Set to True to use synthetic data.
USE_SYNTHETIC_EXTRACTION = True  # flip to False once MIDV-2020 is downloaded


def build_extraction_corpus(skip_prompt: bool = False) -> None:
    print("\n=== Extraction corpus (MIDV-2020) ===")

    if MIDV_DIR.exists() and any(MIDV_DIR.glob("**/*.json")):
        print(f"MIDV-2020 already present at {MIDV_DIR}. Skipping.")
        return

    if not skip_prompt:
        print(
            "\nMIDV-2020 licence: Non-commercial research only.\n"
            "Attribute as: K. Bulatov et al., MIDV-2020, SmartEngines, 2020.\n"
            "Source: http://smartengines.com/midv-2020/\n"
        )
        ans = input("Do you acknowledge the licence and wish to download? [y/N] ").strip().lower()
        if ans != "y":
            print("Skipping MIDV-2020. Generating synthetic extraction fixtures instead.")
            _generate_synthetic_extraction()
            return

    # MIDV-2020 is distributed by SmartEngines directly (not on GitHub).
    # Download from: http://smartengines.com/midv-2020/ (fill in the form to get the link)
    # Then place the extracted archive at idv/data/midv2020/ and re-run with --task extraction.
    # Until then, we generate synthetic fixtures for pipeline testing.
    try:
        _clone_midv2020()
    except Exception as e:
        print(f"[warn] MIDV-2020 download failed: {e}")
        print("Generating synthetic extraction fixtures instead.")
        _generate_synthetic_extraction()


def _clone_midv2020() -> None:
    """Clone the midv2020 GitHub repo which contains specimen images and ground truth."""
    import subprocess
    repo_url = "https://github.com/SmartEngines/midv2020.git"
    MIDV_DIR.parent.mkdir(parents=True, exist_ok=True)
    print(f"Cloning MIDV-2020 from {repo_url} ...")
    result = subprocess.run(
        ["git", "clone", "--depth", "1", repo_url, str(MIDV_DIR)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git clone failed:\n{result.stderr}")
    print(f"Cloned to {MIDV_DIR}")
    _build_midv_index()


def _build_midv_index() -> None:
    """Walk MIDV-2020 clone and build a stratified 150-doc subset with GT mapping."""
    rng = random.Random(SEED)
    doc_dirs = sorted([d for d in MIDV_DIR.glob("*/") if d.is_dir()])
    if not doc_dirs:
        raise RuntimeError(f"No document class dirs found in {MIDV_DIR}")

    index = []
    per_class = max(1, 150 // len(doc_dirs))
    for cls_dir in doc_dirs:
        images = sorted(cls_dir.glob("**/*.jpg")) + sorted(cls_dir.glob("**/*.png"))
        gt_files = sorted(cls_dir.glob("**/*.json"))
        gt_map = {g.stem: g for g in gt_files}
        sample = rng.sample(images, min(per_class, len(images)))
        for img in sample:
            gt = gt_map.get(img.stem)
            index.append({
                "image_path": str(img),
                "doc_class":  cls_dir.name,
                "gt_path":    str(gt) if gt else None,
            })

    out = MIDV_DIR / "subset_150.json"
    with open(out, "w") as f:
        json.dump({"n": len(index), "docs": index}, f, indent=2)
    print(f"Built extraction subset: {len(index)} docs → {out}")


def _generate_synthetic_extraction() -> None:
    """
    Generate minimal synthetic specimen documents for adapter smoke-testing.
    Each 'document' is a simple PNG with printed fields and a known ground truth.
    Not a substitute for MIDV-2020 — only for testing the pipeline.
    """
    out_dir = MIDV_DIR / "synthetic"
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    docs = []

    names = [
        ("SMITH", "JOHN JAMES"), ("JONES", "SARAH ANN"), ("BROWN", "MICHAEL LEE"),
        ("TAYLOR", "EMILY GRACE"), ("WILSON", "DAVID PAUL"), ("EVANS", "CLAIRE RUTH"),
        ("THOMAS", "ROBERT ALAN"), ("ROBERTS", "LUCY MAY"), ("WALKER", "JAMES PETER"),
        ("WHITE", "ANNA KATE"),
    ]
    years = list(range(1960, 2000))

    for i, (surname, given) in enumerate(names):
        dob_y = rng.choice(years)
        dob   = f"{rng.randint(1,28):02d}.{rng.randint(1,12):02d}.{dob_y}"
        doc_no = f"{''.join(rng.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=2))}{rng.randint(100000, 999999)}"
        expiry = f"{rng.randint(1,28):02d}.{rng.randint(1,12):02d}.{rng.randint(2025,2035)}"
        nat    = rng.choice(["GBR", "USA", "DEU", "FRA", "AUS"])

        gt = {
            "surname": surname, "given_names": given,
            "dob": dob, "doc_number": doc_no,
            "expiry": expiry, "nationality": nat,
        }

        img_path = out_dir / f"doc_{i:03d}.png"
        _render_specimen(gt, img_path)
        gt_path  = out_dir / f"doc_{i:03d}.json"
        with open(gt_path, "w") as f:
            json.dump(gt, f)

        docs.append({
            "image_path": str(img_path),
            "doc_class": "synthetic_id",
            "gt_path": str(gt_path),
        })

    index_path = MIDV_DIR / "subset_150.json"
    with open(index_path, "w") as f:
        json.dump({"n": len(docs), "docs": docs, "synthetic": True}, f, indent=2)
    print(f"Generated {len(docs)} synthetic extraction fixtures → {out_dir}")


def _render_specimen(fields: dict, out_path: Path) -> None:
    """Render a simple synthetic ID card image with printed fields."""
    W, H = 640, 400
    img  = Image.new("RGB", (W, H), color=(240, 235, 220))
    draw = ImageDraw.Draw(img)

    # Border
    draw.rectangle([10, 10, W - 10, H - 10], outline=(100, 80, 60), width=3)
    draw.rectangle([15, 15, W - 15, H - 15], outline=(160, 130, 100), width=1)

    # Title bar
    draw.rectangle([10, 10, W - 10, 50], fill=(60, 40, 100))
    draw.text((20, 18), "SPECIMEN IDENTITY DOCUMENT", fill=(255, 255, 255))

    # Photo placeholder
    draw.rectangle([20, 60, 140, 220], fill=(200, 195, 190), outline=(100, 80, 60), width=2)
    draw.text((50, 130), "PHOTO", fill=(120, 110, 100))

    # Fields
    y = 70
    for label, key in [
        ("Surname",     "surname"),
        ("Given Names", "given_names"),
        ("Date of Birth", "dob"),
        ("Doc. Number",  "doc_number"),
        ("Expiry",       "expiry"),
        ("Nationality",  "nationality"),
    ]:
        draw.text((160, y), f"{label}:", fill=(80, 60, 40))
        draw.text((300, y), fields.get(key, ""), fill=(20, 20, 20))
        y += 24

    # MRZ-style band
    draw.rectangle([10, H - 70, W - 10, H - 10], fill=(245, 240, 230), outline=(100, 80, 60))
    mrz1 = f"P<{fields.get('nationality','GBR')}{fields.get('surname','')[:20].upper():<20}{''.join(fields.get('given_names','').split()[:1])[:9].upper():<9}"
    draw.text((20, H - 60), mrz1[:44], fill=(20, 20, 20), font=None)

    img.save(out_path, "PNG")


# ---------------------------------------------------------------------------
# Task 2 — Authenticity: SIDTD
# ---------------------------------------------------------------------------

SIDTD_DIR = IDV_DATA / "sidtd"
SIDTD_REPO = "https://github.com/Oriolrt/SIDTD_Dataset.git"


def build_authenticity_corpus(skip_prompt: bool = False) -> None:
    print("\n=== Authenticity corpus (SIDTD) ===")

    if SIDTD_DIR.exists() and any(SIDTD_DIR.glob("**/*.png")) or any(SIDTD_DIR.glob("**/*.jpg")):
        print(f"SIDTD already present at {SIDTD_DIR}. Skipping.")
        return

    if not skip_prompt:
        print(
            "\nSIDTD licence: CC BY-SA 2.5 (Creative Commons Attribution-ShareAlike 2.5).\n"
            "Attribute as: C. Boned et al., Synthetic dataset of ID and Travel Documents, Scientific Data 2024.\n"
            "Source: https://github.com/Oriolrt/SIDTD_Dataset\n"
        )
        ans = input("Do you acknowledge the licence and wish to download? [y/N] ").strip().lower()
        if ans != "y":
            print("Skipping SIDTD. Generating synthetic authenticity fixtures instead.")
            _generate_synthetic_authenticity()
            return

    try:
        _clone_sidtd()
    except Exception as e:
        print(f"[warn] SIDTD download failed: {e}")
        print("Generating synthetic authenticity fixtures instead.")
        _generate_synthetic_authenticity()


def _clone_sidtd() -> None:
    """
    Clone the SIDTD repo (code only), install its package, then download
    the 'templates' dataset via their Python DataLoader.

    SIDTD images are NOT in the git repo — they are hosted separately and
    pulled via the SIDTD Python package's download_dataset() method.
    """
    import subprocess

    SIDTD_DIR.parent.mkdir(parents=True, exist_ok=True)
    print(f"Cloning SIDTD from {SIDTD_REPO} ...")
    result = subprocess.run(
        ["git", "clone", "--depth", "1", SIDTD_REPO, str(SIDTD_DIR)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git clone failed:\n{result.stderr}")
    print(f"Cloned to {SIDTD_DIR}")

    # Install the SIDTD Python package from the cloned repo
    print("Installing SIDTD package ...")
    install = subprocess.run(
        ["pip3", "install", "-e", str(SIDTD_DIR), "--quiet"],
        capture_output=True, text=True,
    )
    if install.returncode != 0:
        raise RuntimeError(f"pip install failed:\n{install.stderr[:400]}")
    print("SIDTD package installed.")

    # Download the templates dataset (genuine + forged document images)
    print("Downloading SIDTD templates dataset (this may take a few minutes) ...")
    try:
        import sys
        sys.path.insert(0, str(SIDTD_DIR))
        from SIDTD.data.DataLoader.Datasets import SIDTD as SIDTDDataset
        SIDTDDataset(
            download_original=False,
            custom_path_to_download=str(SIDTD_DIR / "downloaded"),
        ).download_dataset("templates")
        print("SIDTD templates downloaded.")
    except Exception as e:
        raise RuntimeError(f"SIDTD download_dataset() failed: {e}")

    _build_sidtd_index()


def _build_sidtd_index() -> None:
    """Build 100 genuine + 100 forged subset from SIDTD, stratified by forgery type."""
    rng = random.Random(SEED)

    # SIDTD places templates in a 'clip_and_crop' or 'templates' subfolder.
    # Search broadly for real/fake image directories.
    search_root = SIDTD_DIR

    genuine_imgs = (
        sorted(search_root.glob("**/reals/**/*.jpg")) +
        sorted(search_root.glob("**/reals/**/*.png")) +
        sorted(search_root.glob("**/genuine/**/*.jpg")) +
        sorted(search_root.glob("**/genuine/**/*.png"))
    )
    forged_imgs = (
        sorted(search_root.glob("**/fakes/**/*.jpg")) +
        sorted(search_root.glob("**/fakes/**/*.png")) +
        sorted(search_root.glob("**/forged/**/*.jpg")) +
        sorted(search_root.glob("**/forged/**/*.png")) +
        sorted(search_root.glob("**/tampered/**/*.jpg")) +
        sorted(search_root.glob("**/tampered/**/*.png"))
    )

    if not genuine_imgs or not forged_imgs:
        raise RuntimeError(
            f"No images found in {SIDTD_DIR} after download. "
            "Check the SIDTD package output above for errors."
        )

    genuine_sample = rng.sample(genuine_imgs, min(100, len(genuine_imgs)))
    forged_sample  = rng.sample(forged_imgs,  min(100, len(forged_imgs)))

    docs = []
    for img in genuine_sample:
        docs.append({"image_path": str(img), "label": "genuine", "forgery_type": None})
    for img in forged_sample:
        parts = img.parts
        ftype = "unknown"
        for p in parts:
            if p in ("crop_and_replace", "inpainting", "splicing", "copy_move", "fakes"):
                ftype = p if p != "fakes" else "unknown"
                break
        docs.append({"image_path": str(img), "label": "forged", "forgery_type": ftype})

    rng.shuffle(docs)
    index_path = SIDTD_DIR / "subset_200.json"
    with open(index_path, "w") as f:
        json.dump({"n": len(docs), "n_genuine": len(genuine_sample),
                   "n_forged": len(forged_sample), "docs": docs}, f, indent=2)
    print(f"Built authenticity subset: {len(docs)} docs → {index_path}")


def _generate_synthetic_authenticity() -> None:
    """
    Generate synthetic genuine/tampered document pairs for pipeline testing.
    Genuine: clean rendered specimen. Tampered: same doc with a region replaced.
    """
    out_dir = SIDTD_DIR / "synthetic"
    out_dir.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    docs = []

    names = [
        ("ALLEN", "MARK"), ("BAKER", "HELEN"), ("CLARK", "GEORGE"),
        ("DAVIS", "NINA"), ("EDWARDS", "TOM"), ("FOSTER", "EMMA"),
        ("GREEN", "JACK"), ("HALL", "ZARA"), ("IRWIN", "LEON"),
        ("JAMES", "MIRA"),
    ]

    for i, (surname, given) in enumerate(names):
        dob    = f"{rng.randint(1,28):02d}.{rng.randint(1,12):02d}.{rng.randint(1960,1999)}"
        doc_no = f"XY{rng.randint(100000, 999999)}"
        expiry = f"{rng.randint(1,28):02d}.{rng.randint(1,12):02d}.2030"
        fields = {"surname": surname, "given_names": given, "dob": dob,
                  "doc_number": doc_no, "expiry": expiry, "nationality": "GBR"}

        # Genuine
        gen_path = out_dir / f"genuine_{i:03d}.png"
        _render_specimen(fields, gen_path)
        docs.append({"image_path": str(gen_path), "label": "genuine", "forgery_type": None})

        # Tampered — overwrite the doc_number field with a different value
        tampered_fields = {**fields, "doc_number": f"ZZ{rng.randint(100000, 999999)}"}
        tam_path = out_dir / f"tampered_{i:03d}.png"
        _render_tampered(fields, tampered_fields, tam_path)
        docs.append({"image_path": str(tam_path), "label": "forged", "forgery_type": "field_replacement"})

    rng.shuffle(docs)
    n_genuine = sum(1 for d in docs if d["label"] == "genuine")
    n_forged  = sum(1 for d in docs if d["label"] == "forged")
    index_path = SIDTD_DIR / "subset_200.json"
    with open(index_path, "w") as f:
        json.dump({"n": len(docs), "n_genuine": n_genuine, "n_forged": n_forged,
                   "docs": docs, "synthetic": True}, f, indent=2)
    print(f"Generated {len(docs)} synthetic authenticity fixtures → {out_dir}")


def _render_tampered(original: dict, tampered: dict, out_path: Path) -> None:
    """Render a 'tampered' document — same as original but with a patch over the doc number."""
    # First render the original, then paint over with different doc_number
    W, H = 640, 400
    img = Image.new("RGB", (W, H), color=(240, 235, 220))
    _render_specimen(original, out_path)
    img = Image.open(out_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Paint over doc_number field area with slightly different background (simulates paste)
    draw.rectangle([295, 118, 500, 140], fill=(238, 233, 218))
    draw.text((300, 118), tampered.get("doc_number", ""), fill=(20, 20, 20))

    img.save(out_path, "PNG")


# ---------------------------------------------------------------------------
# Task 3 — Face-on-document match: DigiFace synthetic ID card pairs
# ---------------------------------------------------------------------------

FACE_DOC_DIR = IDV_DATA / "face_doc_pairs"

N_GENUINE  = 100
N_IMPOSTOR = 100


def build_face_match_corpus() -> None:
    """
    Generate synthetic ID card / selfie pairs from the existing DigiFace corpus.

    For each of N_GENUINE identities, take image[0] as the 'selfie' and
    embed it as the portrait on a generated ID card (the 'document').
    For impostors, pair the selfie of identity A with the card of identity B.
    """
    print("\n=== Face-on-document match corpus (DigiFace synthetic cards) ===")

    if FACE_DOC_DIR.exists() and any(FACE_DOC_DIR.glob("*.json")):
        print(f"Face-doc pairs already present at {FACE_DOC_DIR}. Skipping.")
        return

    FACE_DOC_DIR.mkdir(parents=True, exist_ok=True)

    # Load corpus manifest
    manifest_path = REPO_ROOT / "corpus" / "manifest.json"
    if not manifest_path.exists():
        print(f"[error] Corpus manifest not found at {manifest_path}. Run build_corpus.py first.")
        sys.exit(1)

    with open(manifest_path) as f:
        corpus = json.load(f)

    identities = corpus["identities"]
    if len(identities) < N_GENUINE + 1:
        print(f"[error] Need at least {N_GENUINE + 1} identities; corpus has {len(identities)}.")
        sys.exit(1)

    rng = random.Random(SEED)
    # N_GENUINE identities are enough: genuine pairs use images[0] (selfie) + images[1] (portrait).
    # Impostor pairs pair selfie of identity[i] with card of identity[(i+1) % N_GENUINE],
    # so every identity serves in both roles and we only need N_GENUINE total.
    selected = rng.sample(identities, N_GENUINE)

    pairs = []

    # Genuine pairs: selfie[0] + card carrying portrait[1] of the same identity
    print(f"Generating {N_GENUINE} genuine card pairs ...")
    for ident in selected:
        imgs  = ident["images"]
        selfie_path   = imgs[0]["path"]
        portrait_path = imgs[1]["path"] if len(imgs) > 1 else imgs[0]["path"]

        card_path = FACE_DOC_DIR / f"card_{ident['identity_id']}_genuine.png"
        _render_id_card_with_portrait(portrait_path, ident["identity_id"], card_path)

        pairs.append({
            "pair_id":      f"genuine_{ident['identity_id']}",
            "label":        "genuine",
            "selfie_path":  selfie_path,
            "card_path":    str(card_path),
            "portrait_identity": ident["identity_id"],
            "selfie_identity":   ident["identity_id"],
        })

    # Impostor pairs: selfie of identity[i] + card of identity[(i+1) % N_GENUINE]
    # Rotate so every identity appears as both selfie and card-portrait impostor.
    print(f"Generating {N_IMPOSTOR} impostor card pairs ...")
    imp_list = [(selected[i], selected[(i + 1) % len(selected)]) for i in range(N_IMPOSTOR)]
    for selfie_ident, card_ident in imp_list:
        selfie_path  = selfie_ident["images"][0]["path"]
        portrait_path = card_ident["images"][0]["path"]

        card_path = FACE_DOC_DIR / f"card_{card_ident['identity_id']}_impostor.png"
        _render_id_card_with_portrait(portrait_path, card_ident["identity_id"], card_path)

        pairs.append({
            "pair_id":      f"impostor_{selfie_ident['identity_id']}_vs_{card_ident['identity_id']}",
            "label":        "impostor",
            "selfie_path":  selfie_path,
            "card_path":    str(card_path),
            "portrait_identity": card_ident["identity_id"],
            "selfie_identity":   selfie_ident["identity_id"],
        })

    rng.shuffle(pairs)
    index_path = FACE_DOC_DIR / "pairs.json"
    with open(index_path, "w") as f:
        json.dump({
            "n_genuine":  N_GENUINE,
            "n_impostor": N_IMPOSTOR,
            "note": (
                "Portraits are DigiFace-1M synthetic faces embedded in a rendered ID card. "
                "Cross-domain: printed portrait (degraded, low-res) vs plain selfie. "
                "Expect a looser threshold than selfie-to-selfie matching."
            ),
            "pairs": pairs,
        }, f, indent=2)
    print(f"Generated {len(pairs)} face-doc pairs → {index_path}")


def _render_id_card_with_portrait(portrait_path: str, identity_id: str, out_path: Path) -> None:
    """
    Render a synthetic ID card with the given portrait embedded as the document photo.
    The portrait is resized and placed in the photo zone, simulating a printed document photo.
    """
    W, H = 640, 400
    card = Image.new("RGB", (W, H), color=(240, 235, 220))
    draw = ImageDraw.Draw(card)

    # Card border
    draw.rectangle([8, 8, W - 8, H - 8], outline=(80, 60, 100), width=3)

    # Header
    draw.rectangle([8, 8, W - 8, 48], fill=(60, 30, 80))
    draw.text((20, 14), "SPECIMEN NATIONAL IDENTITY CARD", fill=(220, 200, 255))

    # Embed portrait — simulate a printed ID-card photo:
    # resize to final display size with high-quality filter, apply mild JPEG
    # round-trip (q=85) and slight blur to mimic print/scan softness.
    portrait = Image.open(portrait_path).convert("RGB")
    portrait = portrait.resize((100, 125), Image.LANCZOS)
    buf = io.BytesIO()
    portrait.save(buf, "JPEG", quality=85)
    buf.seek(0)
    portrait = Image.open(buf).convert("RGB")
    portrait = portrait.filter(ImageFilter.GaussianBlur(radius=0.5))
    # Paste into card
    card.paste(portrait, (30, 60))
    # Photo border
    draw.rectangle([28, 58, 132, 187], outline=(80, 60, 100), width=2)

    # Fields (dummy — cross-domain matching test, not extraction)
    y = 70
    for label, value in [
        ("ID Number:", f"SYN{identity_id:>06}"),
        ("Class:",     "SYNTHETIC"),
        ("Note:",      "DigiFace-1M portrait"),
        ("Use:",       "Face-on-doc eval only"),
    ]:
        draw.text((150, y), label, fill=(80, 60, 40))
        draw.text((260, y), value, fill=(20, 20, 20))
        y += 28

    # MRZ band
    draw.rectangle([8, H - 65, W - 8, H - 8], fill=(245, 242, 235), outline=(80, 60, 100))
    mrz = f"IDGBRSYN{identity_id:0>7}<<<<<<<<<<<<<<<<<0101011GBR9912315M2912315<<<<<<<<<<<<<<<4"
    draw.text((20, H - 58), mrz[:44], fill=(20, 20, 20))
    draw.text((20, H - 38), mrz[44:88] if len(mrz) > 44 else "", fill=(20, 20, 20))

    card.save(out_path, "PNG")


# ---------------------------------------------------------------------------
# Update manifest status
# ---------------------------------------------------------------------------

def _update_manifest() -> None:
    with open(MANIFEST) as f:
        m = json.load(f)

    ext_ok  = (MIDV_DIR / "subset_150.json").exists()
    auth_ok = (SIDTD_DIR / "subset_200.json").exists()
    face_ok = (FACE_DOC_DIR / "pairs.json").exists()

    m["tasks"]["extraction"]["status"]      = "ready" if ext_ok  else "not_downloaded"
    m["tasks"]["authenticity"]["status"]    = "ready" if auth_ok else "not_downloaded"
    m["tasks"]["face_on_document"]["status"] = "ready" if face_ok else "not_generated"

    with open(MANIFEST, "w") as f:
        json.dump(m, f, indent=2)


if __name__ == "__main__":
    main()
