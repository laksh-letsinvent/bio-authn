"""
Patch corpus/manifest.json in-place to:
  1. Add skin_tone (ITA) to each image label
  2. Add groups: {sex, age, skin} to each pair (majority-vote from ref_id identity)
  3. Flag 30–50 additional in-band pairs as vlm_subset=True (drawn from ArcFace
     scores already in results/pairs_raw.csv that are not yet VLM-judged)

Run once after the corpus is built but before re-running eval --resume.
Does NOT download or recompute embeddings.
"""

from __future__ import annotations

import csv
import json
import os
import random
from pathlib import Path

import cv2
import numpy as np

ROOT          = Path(__file__).parent.parent
MANIFEST_PATH = ROOT / "corpus" / "manifest.json"
PAIRS_CSV     = ROOT / "results" / "pairs_raw.csv"

BAND_MARGIN        = 0.07   # must match config
NEW_VLM_GENUINE    = 25
NEW_VLM_IMPOSTOR   = 20
SEED               = 42


# ---------------------------------------------------------------------------
# ITA skin-tone (copy of build_corpus._label_skin_tone_ita — kept local so
# this script runs standalone)
# ---------------------------------------------------------------------------

def _ita_skin_tone(img_bgr) -> str:
    try:
        img_lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2Lab).astype(np.float32)
        h, w    = img_lab.shape[:2]
        cy, cx  = h // 2, w // 2
        r       = max(4, min(h, w) // 5)
        region  = img_lab[cy - r:cy + r, cx - r:cx + r]
        if region.size == 0:
            return "medium"
        L_star = float(region[:, :, 0].mean()) * 100.0 / 255.0
        b_star = float(region[:, :, 2].mean()) - 128.0
        ita    = (float(np.degrees(np.arctan((L_star - 50.0) / b_star)))
                  if abs(b_star) > 0.5
                  else (90.0 if L_star > 50 else -90.0))
        if ita > 41:
            return "light"
        elif ita > 10:
            return "medium"
        return "dark"
    except Exception:
        return "medium"


def _load_bgr(path: str):
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read: {path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("[patch] Loading manifest …")
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    identities = manifest["identities"]
    pairs      = manifest["pairs"]

    # ── Step 1: add skin_tone to every image label ──────────────────────────
    print(f"[patch] Computing ITA skin-tone for {sum(len(i['images']) for i in identities)} images …")
    for ident in identities:
        for img_rec in ident["images"]:
            if "skin_tone" in img_rec["labels"]:
                continue   # already done
            try:
                bgr  = _load_bgr(img_rec["path"])
                tone = _ita_skin_tone(bgr)
            except Exception as exc:
                print(f"  WARNING: {img_rec['path']}: {exc}")
                tone = "medium"
            img_rec["labels"]["skin_tone"] = tone

    tone_counts: dict[str, int] = {}
    for ident in identities:
        for img_rec in ident["images"]:
            t = img_rec["labels"].get("skin_tone", "unknown")
            tone_counts[t] = tone_counts.get(t, 0) + 1
    print(f"[patch] Skin-tone distribution: {tone_counts}")

    # ── Step 2: per-identity majority-vote demographics ──────────────────────
    def majority(vals: list[str]) -> str:
        return max(set(vals), key=vals.count)

    id_demos: dict[str, dict] = {}
    for ident in identities:
        iid  = ident["identity_id"]
        imgs = ident["images"]
        genders = [img["labels"].get("gender",    "unknown") for img in imgs]
        ages    = [img["labels"].get("age_group", "unknown") for img in imgs]
        skins   = [img["labels"].get("skin_tone", "unknown") for img in imgs]
        id_demos[iid] = {
            "sex":  majority(genders),
            "age":  majority(ages),
            "skin": majority(skins),
        }

    sex_counts: dict[str, int] = {}
    for d in id_demos.values():
        sex_counts[d["sex"]] = sex_counts.get(d["sex"], 0) + 1
    print(f"[patch] Identity sex distribution: {sex_counts}")

    # ── Step 3: add groups to each pair ─────────────────────────────────────
    missing = 0
    for pair in pairs:
        if "groups" in pair:
            continue
        ref_id = str(pair["ref_id"])
        if ref_id in id_demos:
            pair["groups"] = id_demos[ref_id]
        else:
            pair["groups"] = {"sex": "unknown", "age": "unknown", "skin": "unknown"}
            missing += 1
    if missing:
        print(f"[patch] WARNING: {missing} pairs had no identity demographics")

    # ── Step 4: load ArcFace scores from pairs_raw.csv ──────────────────────
    if not PAIRS_CSV.exists():
        print("[patch] No pairs_raw.csv found — skipping new VLM pair flagging.")
        _save_manifest(manifest)
        return

    arc_scores: dict[str, float] = {}
    vlm_judged: set[str]         = set()

    with open(PAIRS_CSV, newline="") as f:
        for row in csv.DictReader(f):
            if row["matcher_id"] == "arcface":
                arc_scores[row["pair_id"]] = float(row["score"])
            elif row["matcher_id"] == "vlm_claude":
                vlm_judged.add(row["pair_id"])

    print(f"[patch] ArcFace scores loaded: {len(arc_scores)}; VLM already judged: {len(vlm_judged)}")

    # Operating threshold: use weighted average from existing eval_run if available,
    # else compute naively from the scores we have.
    eval_json = ROOT / "results" / "eval_run.json"
    op_thr = None
    if eval_json.exists():
        with open(eval_json) as f:
            ev = json.load(f)
        for mr in ev.get("matchers", []):
            if mr.get("matcher_id") == "arcface":
                op_thr = float(mr["operating_threshold"])
                break
    if op_thr is None:
        # Fallback: find threshold where FAR ≈ FRR via sweep
        op_thr = 0.298   # known from last run
    band_lo = op_thr - BAND_MARGIN
    band_hi = op_thr + BAND_MARGIN
    print(f"[patch] Operating threshold: {op_thr:.4f}  Band: [{band_lo:.3f}, {band_hi:.3f}]")

    # ── Step 5: select new in-band pairs for VLM ────────────────────────────
    pair_by_id = {p["pair_id"]: p for p in pairs}
    in_band_genuine  = []
    in_band_impostor = []
    for pid, score in arc_scores.items():
        if pid in vlm_judged:
            continue
        if not (band_lo <= score <= band_hi):
            continue
        p = pair_by_id.get(pid)
        if p is None:
            continue
        if p["label"] == "genuine":
            in_band_genuine.append((pid, score))
        else:
            in_band_impostor.append((pid, score))

    rng = random.Random(SEED)
    rng.shuffle(in_band_genuine)
    rng.shuffle(in_band_impostor)

    new_genuine  = in_band_genuine[:NEW_VLM_GENUINE]
    new_impostor = in_band_impostor[:NEW_VLM_IMPOSTOR]
    new_vlm_ids  = {pid for pid, _ in new_genuine + new_impostor}

    print(
        f"[patch] In-band available (not VLM-judged): "
        f"{len(in_band_genuine)} genuine, {len(in_band_impostor)} impostor"
    )
    print(
        f"[patch] Flagging {len(new_genuine)} genuine + {len(new_impostor)} impostor "
        f"= {len(new_vlm_ids)} new vlm_subset pairs"
    )

    for pair in pairs:
        if pair["pair_id"] in new_vlm_ids:
            pair["vlm_subset"] = True

    manifest["n_vlm_subset"] = sum(1 for p in pairs if p["vlm_subset"])
    manifest["demographic_labeling"] = (
        "Gender + age via InsightFace genderage.onnx (buffalo_l pack, ONNX/CPU). "
        "Skin tone via ITA (Individual Typology Angle) from L*a*b* face-centre region — "
        "light (ITA>41°), medium (10°<ITA≤41°), dark (ITA≤10°). "
        "DigiFace-1M images are synthetic; demographic predictions are approximate. "
        "Corpus is ~87% male — balance caveat shown on bias panel. "
        "Fairness panel demonstrates disparity measurement method — not a publishable audit."
    )

    _save_manifest(manifest)
    print(f"[patch] Done. New vlm_subset total: {manifest['n_vlm_subset']}")


def _save_manifest(manifest: dict) -> None:
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"[patch] manifest.json saved ({MANIFEST_PATH})")


if __name__ == "__main__":
    main()
