#!/usr/bin/env python3
"""Generate all static data files for the bio-authN portal (v2)."""

import csv
import json
import math
import os
import pickle
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from sklearn.decomposition import PCA

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CORPUS_DIR   = PROJECT_ROOT / "corpus"
RESULTS_DIR  = PROJECT_ROOT / "results"
PORTAL_DIR   = PROJECT_ROOT / "portal"
DATA_DIR     = PORTAL_DIR / "data"
ASSETS_DIR   = PORTAL_DIR / "assets" / "faces"
PAD_DIR      = DATA_DIR / "pad_examples"

THRESHOLD = 0.298
MARGIN    = 0.07
BAND_LO   = THRESHOLD - MARGIN
BAND_HI   = THRESHOLD + MARGIN

random.seed(42)
np.random.seed(42)


def load_data():
    manifest   = json.loads((CORPUS_DIR / "manifest.json").read_text())
    embeddings = pickle.loads((CORPUS_DIR / "embeddings_arcface.pkl").read_bytes())
    with open(RESULTS_DIR / "pairs_raw.csv") as f:
        rows = list(csv.DictReader(f))
    arcface_rows = [r for r in rows if r["matcher_id"] == "arcface"]
    insightface_rows = [r for r in rows if r["matcher_id"] == "insightface"]
    return manifest, embeddings, arcface_rows, insightface_rows


def copy_face(abs_path: str) -> str:
    p = Path(abs_path)
    identity_id = p.parent.name
    dest_dir = ASSETS_DIR / identity_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / p.name
    if not dest.exists():
        shutil.copy2(p, dest)
    return f"assets/faces/{identity_id}/{p.name}"


def mean_pool(vec: list, n: int = 64) -> list:
    arr   = np.array(vec, dtype=np.float32)
    chunk = len(arr) // n
    return [float(arr[i * chunk:(i + 1) * chunk].mean()) for i in range(n)]


# ---------------------------------------------------------------------------
# Matching examples
# ---------------------------------------------------------------------------

def export_matching_examples(manifest, embeddings, arcface_rows):
    by_id = {r["pair_id"]: r for r in arcface_rows}

    genuine  = [r for r in arcface_rows if r["label"] == "genuine"]
    impostor = [r for r in arcface_rows if r["label"] == "impostor"]
    genuine.sort(key=lambda r: float(r["score"]), reverse=True)
    impostor.sort(key=lambda r: float(r["score"]), reverse=True)

    high_g = [r for r in genuine if float(r["score"]) > 0.75]
    mid_g  = [r for r in genuine if 0.55 <= float(r["score"]) <= 0.65]
    near_g = [r for r in genuine if 0.30 <= float(r["score"]) <= 0.40]
    clear_i = [r for r in impostor if float(r["score"]) < 0.10]
    mid_i   = [r for r in impostor if 0.15 <= float(r["score"]) <= 0.22]
    near_i  = [r for r in impostor if 0.22 < float(r["score"]) <= 0.28]

    selected_genuine  = [
        random.choice(high_g),
        random.choice(mid_g  if mid_g  else genuine[-50:]),
        random.choice(near_g if near_g else genuine[-50:]),
    ]
    selected_impostor = [
        random.choice(clear_i if clear_i else impostor[-100:]),
        random.choice(mid_i   if mid_i   else impostor[-100:]),
        random.choice(near_i  if near_i  else impostor[:50]),
    ]

    img_lookup  = {}
    for identity in manifest["identities"]:
        for img in identity["images"]:
            img_lookup[img["path"]] = img
    pair_lookup = {p["pair_id"]: p for p in manifest["pairs"]}

    examples = []
    for label, rows in [("genuine", selected_genuine), ("impostor", selected_impostor)]:
        for r in rows:
            pair = pair_lookup.get(r["pair_id"])
            if not pair:
                continue
            ref_emb   = embeddings.get(pair["ref_path"])
            probe_emb = embeddings.get(pair["probe_path"])
            if ref_emb is None or probe_emb is None:
                continue
            ref_rel   = copy_face(pair["ref_path"])
            probe_rel = copy_face(pair["probe_path"])
            examples.append({
                "pair_id":             r["pair_id"],
                "label":               label,
                "score":               round(float(r["score"]), 4),
                "ref_image":           ref_rel,
                "probe_image":         probe_rel,
                "ref_embedding_512":   ref_emb   if isinstance(ref_emb,   list) else ref_emb.tolist(),
                "probe_embedding_512": probe_emb if isinstance(probe_emb, list) else probe_emb.tolist(),
                "ref_embedding_64":    mean_pool(ref_emb),
                "probe_embedding_64":  mean_pool(probe_emb),
                "threshold":           THRESHOLD,
                "band_lo":             round(BAND_LO, 4),
                "band_hi":             round(BAND_HI, 4),
            })

    out_path = DATA_DIR / "matching_examples.json"
    out_path.write_text(json.dumps(examples, indent=2))
    print(f"  matching_examples.json — {len(examples)} pairs")


# ---------------------------------------------------------------------------
# Embedding map (PCA 2D)
# ---------------------------------------------------------------------------

def export_embedding_map(manifest, embeddings):
    identity_ids = []
    points       = []
    groups       = []

    for identity in manifest["identities"]:
        embs          = []
        gender_counts = {"Male": 0, "Female": 0}
        age_counts    = {}
        skin_counts   = {}
        for img in identity["images"]:
            e = embeddings.get(img["path"])
            if e is not None:
                embs.append(e if isinstance(e, list) else e.tolist())
            g  = img["labels"].get("gender",    "Unknown")
            ag = img["labels"].get("age_group", "Unknown")
            sk = img["labels"].get("skin_tone", "Unknown")
            gender_counts[g]  = gender_counts.get(g,  0) + 1
            age_counts[ag]    = age_counts.get(ag,    0) + 1
            skin_counts[sk]   = skin_counts.get(sk,   0) + 1
        if not embs:
            continue
        mean_emb = np.mean(embs, axis=0)
        identity_ids.append(identity["identity_id"])
        points.append(mean_emb.tolist())
        groups.append({
            "identity": identity["identity_id"],
            "gender":   max(gender_counts, key=gender_counts.get),
            "age":      max(age_counts,    key=age_counts.get),
            "skin":     max(skin_counts,   key=skin_counts.get),
        })

    arr = np.array(points, dtype=np.float32)
    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(arr)
    explained = pca.explained_variance_ratio_.tolist()

    out = {
        "explained_variance": [round(v, 4) for v in explained],
        "points": [
            {
                "x":        round(float(coords[i, 0]), 4),
                "y":        round(float(coords[i, 1]), 4),
                "identity": groups[i]["identity"],
                "gender":   groups[i]["gender"],
                "age":      groups[i]["age"],
                "skin":     groups[i]["skin"],
            }
            for i in range(len(identity_ids))
        ],
    }
    (DATA_DIR / "embedding_map.json").write_text(json.dumps(out, indent=2))
    print(
        f"  embedding_map.json — {len(out['points'])} identity points, "
        f"PCA {explained[0]:.1%}+{explained[1]:.1%}"
    )


# ---------------------------------------------------------------------------
# Pair scores (ArcFace + InsightFace)
# ---------------------------------------------------------------------------

def export_pair_scores(arcface_rows, insightface_rows):
    arcface_scores = [
        {"pair_id": r["pair_id"], "score": round(float(r["score"]), 4), "label": r["label"]}
        for r in arcface_rows
    ]
    (DATA_DIR / "pair_scores.json").write_text(json.dumps(arcface_scores))

    if insightface_rows:
        if_scores = [
            {"pair_id": r["pair_id"], "score": round(float(r["score"]), 4), "label": r["label"]}
            for r in insightface_rows
        ]
        (DATA_DIR / "insightface_scores.json").write_text(json.dumps(if_scores))
        print(f"  insightface_scores.json — {len(if_scores)} rows")

    gen_n  = sum(1 for s in arcface_scores if s["label"] == "genuine")
    imp_n  = sum(1 for s in arcface_scores if s["label"] == "impostor")
    print(f"  pair_scores.json — {gen_n} genuine, {imp_n} impostor")


# ---------------------------------------------------------------------------
# PAD example images
# ---------------------------------------------------------------------------

def apply_print_attack(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)
    arr = arr + np.random.normal(0, 8, arr.shape).astype(np.float32)
    arr[:, :, 0] = np.clip(arr[:, :, 0] * 1.06, 0, 255)   # R up
    arr[:, :, 2] = np.clip(arr[:, :, 2] * 0.88, 0, 255)   # B down
    result = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    result = result.filter(ImageFilter.GaussianBlur(radius=1.2))
    w, h   = result.size
    small  = result.resize((w // 3, h // 3), Image.BILINEAR)
    return small.resize((w, h), Image.BILINEAR)


def apply_screen_replay(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)
    arr[:, :, 2] = np.clip(arr[:, :, 2] * 1.10, 0, 255)
    arr[:, :, 1] = np.clip(arr[:, :, 1] * 1.04, 0, 255)
    for y in range(0, arr.shape[0], 4):
        arr[y, :, :] = np.clip(arr[y, :, :] * 0.65, 0, 255)
    h, w   = arr.shape[:2]
    gy, gx = int(h * 0.15), int(w * 0.75)
    gh, gw = int(h * 0.10), int(w * 0.12)
    arr[gy:gy+gh, gx:gx+gw] = np.clip(arr[gy:gy+gh, gx:gx+gw] * 1.5 + 60, 0, 255)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))


def export_pad_examples(manifest):
    PAD_DIR.mkdir(parents=True, exist_ok=True)
    chosen = []
    for identity in manifest["identities"][:5]:
        if identity["images"]:
            p = identity["images"][0]["path"]
            if Path(p).exists():
                chosen.append(p)
        if len(chosen) >= 3:
            break

    for i, abs_path in enumerate(chosen):
        base = f"subject_{i+1}"
        img  = Image.open(abs_path).convert("RGB").resize((224, 224), Image.LANCZOS)
        img.save(PAD_DIR / f"{base}_genuine.jpg",      "JPEG", quality=92)
        apply_print_attack(img.copy()).save(PAD_DIR / f"{base}_print.jpg",  "JPEG", quality=88)
        apply_screen_replay(img.copy()).save(PAD_DIR / f"{base}_screen.jpg", "JPEG", quality=88)
        copy_face(abs_path)

    meta = [
        {
            "subject":      f"subject_{i+1}",
            "genuine":      f"data/pad_examples/subject_{i+1}_genuine.jpg",
            "print_attack": f"data/pad_examples/subject_{i+1}_print.jpg",
            "screen_attack":f"data/pad_examples/subject_{i+1}_screen.jpg",
        }
        for i in range(len(chosen))
    ]
    (DATA_DIR / "pad_examples.json").write_text(json.dumps(meta, indent=2))
    print(f"  pad_examples — {len(chosen)} subjects × 3 variants")


# ---------------------------------------------------------------------------
# eval_run.json → portal/data/ (findings + PAD section use this directly)
# ---------------------------------------------------------------------------

def export_eval_run():
    src = RESULTS_DIR / "eval_run.json"
    if not src.exists():
        print("  eval_run.json — not found, skipping")
        return
    dst = DATA_DIR / "eval_run.json"
    shutil.copy2(src, dst)
    data = json.loads(src.read_text())
    pad_matchers = [m for m in data.get("matchers", []) if m.get("task_type") == "pad"]
    match_matchers = [m for m in data.get("matchers", []) if m.get("task_type") == "match"]
    print(
        f"  eval_run.json copied — "
        f"{len(match_matchers)} match matcher(s), {len(pad_matchers)} PAD matcher(s)"
    )
    for m in pad_matchers:
        pad = m.get("pad") or {}
        print(
            f"    {m['matcher_id']}: "
            f"APCER={pad.get('apcer', '?'):.3f}  "
            f"BPCER={pad.get('bpcer', '?'):.3f}  "
            f"ACER={pad.get('acer', '?'):.3f}"
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("Loading data...")
    manifest, embeddings, arcface_rows, insightface_rows = load_data()
    print(
        f"  {len(manifest['identities'])} identities, "
        f"{len(arcface_rows)} arcface rows, "
        f"{len(insightface_rows)} insightface rows, "
        f"{len(embeddings)} embeddings"
    )

    print("Exporting matching_examples.json...")
    export_matching_examples(manifest, embeddings, arcface_rows)

    print("Exporting embedding_map.json...")
    export_embedding_map(manifest, embeddings)

    print("Exporting pair_scores.json...")
    export_pair_scores(arcface_rows, insightface_rows)

    print("Generating PAD examples...")
    export_pad_examples(manifest)

    print("Copying eval_run.json...")
    export_eval_run()

    print("Done.")


if __name__ == "__main__":
    main()
