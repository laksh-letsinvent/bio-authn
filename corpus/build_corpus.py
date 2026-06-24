"""
Corpus builder for bio-authN Phase 1.

Produces corpus/manifest.json with:
  - 150 identities × 6 images = 900 images from DigiFace-1M (10K×72 partition)
  - Per-image DeepFace demographic labels (race, gender, age)
  - Pair lists: 2,250 genuine + 7,500 impostor + 240 VLM-subset

Run: python corpus/build_corpus.py [--config config/eval.yaml]

CAVEAT: Demographic labels use DeepFace's built-in analyzer (trained on real faces).
Labels on synthetic DigiFace-1M images are approximate. The bias panel
demonstrates method, not a publishable audit.
"""

from __future__ import annotations

# Must be set before ANY tensorflow/keras import — disables Metal GPU plugin on
# Apple Silicon which causes a mutex deadlock during TF initialisation on macOS.
import os
os.environ.setdefault("TF_ENABLE_METAL", "0")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

import argparse
import hashlib
import json
import random
import struct
import sys
import zlib
from itertools import combinations
from pathlib import Path
from typing import Optional

import numpy as np
import requests
import yaml
from tqdm import tqdm

ROOT = Path(__file__).parent.parent
DATA_DIR = Path(__file__).parent / "data"
MANIFEST_PATH = Path(__file__).parent / "manifest.json"

DIGIFACE_SOURCE    = "DigiFace-1M"
DIGIFACE_PARTITION = "10K×72"
DIGIFACE_LICENSE   = "Microsoft Research License Agreement (non-commercial research)"

# First archive covers identities 0–1999 (2000 identities × 72 images).
# We only need 150 identities × 6 images, so we stream-extract and stop early.
DIGIFACE_URLS = [
    "https://facesyntheticspubwedata.z6.web.core.windows.net/wacv-2023/subjects_0-1999_72_imgs.zip",
    "https://facesyntheticspubwedata.z6.web.core.windows.net/wacv-2023/subjects_2000-3999_72_imgs.zip",
]


# ---------------------------------------------------------------------------
# Already-have check
# ---------------------------------------------------------------------------

def _already_have_data(n_identities: int, images_per_identity: int) -> bool:
    if not DATA_DIR.exists():
        return False
    dirs = [d for d in DATA_DIR.iterdir() if d.is_dir()]
    qualified = [
        d for d in dirs
        if len(list(d.glob("*.png")) + list(d.glob("*.jpg")) + list(d.glob("*.jpeg"))) >= images_per_identity
    ]
    return len(qualified) >= n_identities


# ---------------------------------------------------------------------------
# Streaming zip extractor
# ---------------------------------------------------------------------------
# Parses zip local-file-header records from an HTTP stream and writes only the
# files we want, then closes the connection. Avoids downloading the full archive.

_DEFLATE = 8
_STORED  = 0


def _stream_extract_zip(
    url: str,
    output_dir: Path,
    n_identities: int,
    images_per_identity: int,
    collected: dict[str, list[Path]],
) -> bool:
    """
    Stream-parse a zip from url, extracting face images into output_dir.
    Stops and closes the HTTP connection once n_identities are satisfied.
    Returns True if target reached.
    """
    try:
        r = requests.get(url, stream=True, timeout=60)
        r.raise_for_status()
    except Exception as exc:
        print(f"[corpus] HTTP error for {url}: {exc}")
        return False

    total = int(r.headers.get("content-length", 0)) or None
    desc  = f"DigiFace-1M ({url.split('/')[-1]})"
    pbar  = tqdm(total=total, unit="B", unit_scale=True, desc=desc)

    buf  = b""
    done = False

    try:
        for chunk in r.iter_content(chunk_size=131072):
            buf += chunk
            pbar.update(len(chunk))

            # Process as many complete local-file-header entries as possible
            while True:
                result = _parse_next_entry(buf)
                if result is None:
                    break                    # need more bytes
                if result == "skip":
                    # Corrupt or unsupported entry — advance past magic
                    buf = buf[4:]
                    continue
                fname, data, consumed = result

                # Write if it looks like a face image
                parts = Path(fname.replace("\\", "/")).parts
                if (
                    len(parts) == 2
                    and parts[1].lower().endswith((".png", ".jpg", ".jpeg"))
                ):
                    identity_id = parts[0]
                    imgs = collected.get(identity_id, [])
                    if len(imgs) < images_per_identity:
                        id_dir = output_dir / identity_id
                        id_dir.mkdir(parents=True, exist_ok=True)
                        out_path = id_dir / f"{len(imgs):04d}.png"
                        out_path.write_bytes(data)
                        imgs.append(out_path)
                        collected[identity_id] = imgs

                buf = buf[consumed:]

                qualified = {k: v for k, v in collected.items() if len(v) >= images_per_identity}
                if len(qualified) >= n_identities:
                    done = True
                    break

            if done:
                break

    finally:
        r.close()
        pbar.close()

    qualified = {k: v for k, v in collected.items() if len(v) >= images_per_identity}
    print(f"[corpus] {len(qualified)} identities collected so far.")
    return len(qualified) >= n_identities


def _parse_next_entry(buf: bytes) -> Optional[tuple | str]:
    """
    Find and parse the next zip local-file-header entry in buf.

    Returns:
      (filename, data_bytes, total_bytes_consumed)  on success
      None    if more bytes are needed
      "skip"  if the current position is not a valid local header
    """
    pos = buf.find(b"PK\x03\x04")
    if pos == -1:
        return None   # No header yet — need more data

    # If the header isn't at the start, discard leading junk by returning "skip"
    if pos > 0:
        # Return skip so the caller advances; we re-try from the found position
        # Actually, we want to jump to pos. Easiest: slice and retry next call.
        # Caller does buf = buf[consumed:] after "skip"; consume only up to pos.
        return ("__skip__", b"", pos)   # advance buf by pos bytes

    # Need at least 30 bytes for the fixed local file header
    if len(buf) < 30:
        return None

    # Unpack local file header (offsets relative to buf[0] = 'P')
    # Offset  6: flags (uint16)
    # Offset  8: compression method (uint16)
    # Offset 10: mod_time (uint16)
    # Offset 12: mod_date (uint16)
    # Offset 14: crc32 (uint32)
    # Offset 18: compressed size (uint32)
    # Offset 22: uncompressed size (uint32)
    # Offset 26: filename length (uint16)
    # Offset 28: extra field length (uint16)
    (flags, method, _, _, crc32, comp_size, uncomp_size,
     fname_len, extra_len) = struct.unpack_from("<HHHHIIIHH", buf, 6)

    has_data_descriptor = bool(flags & 0x08)

    # Wait for header + filename + extra
    header_end = 30 + fname_len + extra_len
    if len(buf) < header_end:
        return None

    fname = buf[30:30 + fname_len].decode("utf-8", errors="replace")

    if method not in (_STORED, _DEFLATE):
        # Unsupported compression — skip this entry's header and keep going
        return ("__skip__", b"", 4)

    # If we know comp_size, wait until we have all the data
    if comp_size > 0 or not has_data_descriptor:
        entry_end = header_end + comp_size
        if len(buf) < entry_end:
            return None

        raw = buf[header_end:entry_end]
        try:
            data = raw if method == _STORED else zlib.decompress(raw, -15)
        except zlib.error:
            return ("__skip__", b"", 4)

        return fname, data, entry_end

    # comp_size == 0 and has_data_descriptor: scan for the data descriptor or next header
    search_start = header_end
    next_pk = buf.find(b"PK", search_start)
    while next_pk != -1:
        marker = buf[next_pk:next_pk + 4]
        if marker in (b"PK\x03\x04", b"PK\x01\x02", b"PK\x05\x06"):
            # Check for 16-byte data descriptor (with PK\x07\x08 signature) immediately before
            desc_pos = next_pk - 16
            if desc_pos >= search_start and buf[desc_pos:desc_pos + 4] == b"PK\x07\x08":
                actual_comp = next_pk - 16 - header_end
                entry_end   = next_pk        # after data descriptor
            else:
                actual_comp = next_pk - header_end
                entry_end   = next_pk
            raw = buf[header_end:header_end + actual_comp]
            try:
                data = raw if method == _STORED else zlib.decompress(raw, -15)
            except zlib.error:
                return ("__skip__", b"", 4)
            return fname, data, entry_end
        next_pk = buf.find(b"PK", next_pk + 1)

    return None  # need more data


# ---------------------------------------------------------------------------
# Acquire corpus
# ---------------------------------------------------------------------------

def acquire_corpus(n_identities: int, images_per_identity: int) -> str:
    if _already_have_data(n_identities, images_per_identity):
        print("[corpus] Found existing corpus data — skipping download.")
        if MANIFEST_PATH.exists():
            with open(MANIFEST_PATH) as f:
                return json.load(f).get("source_dataset", DIGIFACE_SOURCE)
        return DIGIFACE_SOURCE

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    collected: dict[str, list[Path]] = {}

    for url in DIGIFACE_URLS:
        print(f"[corpus] Streaming from {url.split('/')[-1]} ...")
        success = _stream_extract_zip(url, DATA_DIR, n_identities, images_per_identity, collected)
        if success:
            print(f"[corpus] DigiFace-1M: {n_identities} identities × {images_per_identity} images acquired.")
            return DIGIFACE_SOURCE

    # Manual fallback
    if _already_have_data(n_identities, images_per_identity):
        return "manual"

    print(
        "\n[corpus] ERROR: Could not acquire corpus.\n"
        "Options:\n"
        "  1. DigiFace-1M (Microsoft): https://github.com/microsoft/DigiFace1M\n"
        "     Extract to corpus/data/<identity_id>/<image>.png\n"
        "  2. DCFace: https://github.com/mk-minchul/dcface\n"
        "  3. SynFace (ETH): https://github.com/haibo-qiu/SynFace\n"
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# Identity selection
# ---------------------------------------------------------------------------

def _list_all_qualified(images_per_identity: int) -> list[tuple[str, list[Path]]]:
    """Return all identity dirs that have enough images."""
    if not DATA_DIR.exists():
        return []
    result = []
    for id_dir in sorted(DATA_DIR.iterdir()):
        if not id_dir.is_dir():
            continue
        imgs = sorted(
            list(id_dir.glob("*.png"))
            + list(id_dir.glob("*.jpg"))
            + list(id_dir.glob("*.jpeg"))
        )
        if len(imgs) >= images_per_identity:
            result.append((id_dir.name, imgs))
    return result


def _quick_label_for_stratification(
    all_qualified: list[tuple[str, list[Path]]],
) -> dict[str, dict]:
    """Label one image per identity (fast) to drive stratified selection."""
    labels: dict[str, dict] = {}
    print(f"[corpus] Quick-labeling {len(all_qualified)} identities for stratification ...")
    for identity_id, imgs in tqdm(all_qualified, desc="QuickLabel"):
        labels[identity_id] = label_demographics(imgs[0])
    return labels


def select_identities(
    n_identities: int,
    images_per_identity: int,
    seed: int,
    quick_labels: dict[str, dict] = None,
) -> dict[str, list[Path]]:
    """
    Select n_identities from the corpus.

    With quick_labels (v2): stratified by sex (~50/50) and age×skin buckets to
    maximise demographic coverage. Without (v1 fallback): random sampling.
    """
    rng = random.Random(seed)
    all_qualified = _list_all_qualified(images_per_identity)

    if len(all_qualified) < n_identities:
        raise ValueError(f"Only {len(all_qualified)} qualified identities, need {n_identities}")

    if not quick_labels:
        # v1 fallback: random
        selected = rng.sample(all_qualified, n_identities)
        result: dict[str, list[Path]] = {}
        for identity_id, imgs in selected:
            result[identity_id] = sorted(rng.sample(imgs, images_per_identity))
        return result

    # v2: stratified by sex, then by age×skin within each sex pool
    male_pool   = [(iid, imgs) for iid, imgs in all_qualified
                   if quick_labels.get(iid, {}).get("gender", "") == "Male"]
    female_pool = [(iid, imgs) for iid, imgs in all_qualified
                   if quick_labels.get(iid, {}).get("gender", "") == "Female"]
    other_pool  = [(iid, imgs) for iid, imgs in all_qualified
                   if quick_labels.get(iid, {}).get("gender", "") not in ("Male", "Female")]

    # Absorb unknowns into male pool for DigiFace-1M which is predominantly Male/Female
    all_male = male_pool + other_pool
    rng.shuffle(all_male)
    rng.shuffle(female_pool)

    n_female_want = n_identities // 2
    n_male_want   = n_identities - n_female_want
    n_female      = min(n_female_want, len(female_pool))
    n_male        = min(n_male_want + (n_female_want - n_female), len(all_male))

    def stratified_select(pool, n_want, pool_labels):
        if len(pool) <= n_want:
            return pool[:]
        # Round-robin across age×skin buckets (shuffled within each)
        buckets: dict[str, list] = {}
        for iid, imgs in pool:
            labs = pool_labels.get(iid, {})
            key  = f"{labs.get('age_group','unk')}_{labs.get('skin_tone','unk')}"
            buckets.setdefault(key, []).append((iid, imgs))
        for k in buckets:
            rng.shuffle(buckets[k])
        selected = []
        keys     = sorted(buckets.keys())
        while len(selected) < n_want:
            progress = False
            for key in keys:
                if buckets[key] and len(selected) < n_want:
                    selected.append(buckets[key].pop(0))
                    progress = True
            if not progress:
                break
        return selected[:n_want]

    female_labels = {iid: quick_labels[iid] for iid, _ in female_pool if iid in quick_labels}
    male_labels   = {iid: quick_labels[iid] for iid, _ in all_male   if iid in quick_labels}

    sel_female = stratified_select(female_pool, n_female, female_labels)
    sel_male   = stratified_select(all_male,    n_male,   male_labels)

    combined = sel_female + sel_male
    rng.shuffle(combined)

    result: dict[str, list[Path]] = {}
    for identity_id, imgs in combined[:n_identities]:
        result[identity_id] = sorted(rng.sample(imgs, images_per_identity))
    return result


# ---------------------------------------------------------------------------
# Demographic labeling — InsightFace genderage.onnx (already in buffalo_l pack)
#
# genderage.onnx: input (1,3,96,96) BGR float32, no normalization (mean=0, std=1)
# Output [0]: [female_logit, male_logit, age/100]
#
# DigiFace-1M images are pre-cropped 112×112 faces, so we resize to 96×96 and
# run the model directly without face detection.
# ---------------------------------------------------------------------------

_GENDERAGE_ONNX = ROOT / "models" / "insightface" / "models" / "buffalo_l" / "genderage.onnx"
_genderage_session = None


def _get_genderage_session():
    global _genderage_session
    if _genderage_session is None:
        import onnxruntime as ort
        _genderage_session = ort.InferenceSession(
            str(_GENDERAGE_ONNX), providers=["CPUExecutionProvider"]
        )
    return _genderage_session


def _load_bgr(image_path: str):
    """Load image as 3-channel BGR, converting RGBA if needed."""
    import cv2
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def label_demographics(image_path: Path) -> dict[str, str]:
    """
    Run InsightFace genderage.onnx + ITA skin tone on a pre-cropped face image.
    Returns {gender, age_group, skin_tone}. No external download required.
    """
    try:
        import cv2
        import numpy as np

        img_bgr = _load_bgr(str(image_path))
        img_96  = cv2.resize(img_bgr, (96, 96)).astype(np.float32)
        inp     = img_96.transpose(2, 0, 1)[np.newaxis, :]

        sess   = _get_genderage_session()
        pred   = sess.run(None, {sess.get_inputs()[0].name: inp})[0][0]

        gender  = "Male" if int(np.argmax(pred[:2])) == 1 else "Female"
        age_raw = int(round(float(pred[2]) * 100))
        if age_raw < 25:
            age_group = "under_25"
        elif age_raw < 45:
            age_group = "25_to_44"
        else:
            age_group = "45_plus"

        skin_tone = _label_skin_tone_ita(img_bgr)

        return {"gender": gender, "age_group": age_group, "skin_tone": skin_tone}
    except Exception as exc:
        print(f"[genderage] Warning: labeling failed for {image_path.name}: {exc}")
        return {"gender": "unknown", "age_group": "unknown", "skin_tone": "unknown"}


def _label_skin_tone_ita(img_bgr) -> str:
    """
    ITA-based skin tone from face center region (L*a*b* colour space).
    ITA = arctan((L* - 50) / b*) in degrees.
    Buckets: light (ITA > 41°), medium (10° < ITA ≤ 41°), dark (ITA ≤ 10°).
    """
    import cv2
    import numpy as np

    try:
        img_lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2Lab).astype(np.float32)
        h, w    = img_lab.shape[:2]
        cy, cx  = h // 2, w // 2
        r       = max(4, min(h, w) // 5)
        region  = img_lab[cy - r:cy + r, cx - r:cx + r]
        if region.size == 0:
            return "medium"
        # OpenCV Lab: L ∈ [0,255] → L* = L*100/255; b ∈ [0,255], centre 128 → b* = b-128
        L_star = float(region[:, :, 0].mean()) * 100.0 / 255.0
        b_star = float(region[:, :, 2].mean()) - 128.0
        ita = float(np.degrees(np.arctan((L_star - 50.0) / b_star))) if abs(b_star) > 0.5 \
              else (90.0 if L_star > 50 else -90.0)
        if ita > 41:
            return "light"
        elif ita > 10:
            return "medium"
        return "dark"
    except Exception:
        return "medium"


def label_all_images(identities: dict[str, list[Path]]) -> dict[str, dict]:
    all_images = [img for imgs in identities.values() for img in imgs]
    labels: dict[str, dict] = {}
    print(f"[corpus] Labeling {len(all_images)} images (genderage.onnx + ITA skin tone) ...")
    for img in tqdm(all_images, desc="Demographics"):
        labels[str(img)] = label_demographics(img)
    return labels


# ---------------------------------------------------------------------------
# Per-identity demographic profile (majority vote across images)
# ---------------------------------------------------------------------------

def _identity_demographics(imgs: list[Path], img_labels: dict[str, dict]) -> dict:
    """Return majority-vote {sex, age, skin} across all images of one identity."""
    genders = [img_labels.get(str(img), {}).get("gender",    "unknown") for img in imgs]
    ages    = [img_labels.get(str(img), {}).get("age_group", "unknown") for img in imgs]
    skins   = [img_labels.get(str(img), {}).get("skin_tone", "unknown") for img in imgs]
    return {
        "sex":  max(set(genders), key=genders.count),
        "age":  max(set(ages),    key=ages.count),
        "skin": max(set(skins),   key=skins.count),
    }


def _identity_group(imgs: list[Path], img_labels: dict[str, dict]) -> str:
    """Backward-compat: return sex as the group string."""
    return _identity_demographics(imgs, img_labels)["sex"]


# ---------------------------------------------------------------------------
# Pair building
# ---------------------------------------------------------------------------

def build_pairs(
    identities: dict[str, list[Path]],
    img_labels: dict[str, dict],
    n_impostor: int,
    n_vlm_subset: int,
    seed: int,
) -> list[dict]:
    rng      = random.Random(seed)
    id_list  = sorted(identities.keys())

    # Per-identity demographics for multi-axis by_group (v2)
    id_demos = {iid: _identity_demographics(imgs, img_labels) for iid, imgs in identities.items()}
    id_group = {iid: demos["sex"] for iid, demos in id_demos.items()}  # backward compat

    pairs: list[dict] = []

    # Genuine: C(6,2) = 15 per identity = 2,250 total
    for iid in id_list:
        for ref_img, probe_img in combinations(identities[iid], 2):
            pairs.append({
                "pair_id":    f"g_{iid}_{ref_img.stem}_{probe_img.stem}",
                "ref_id":     iid,
                "probe_id":   iid,
                "ref_path":   str(ref_img),
                "probe_path": str(probe_img),
                "group":      id_group[iid],    # backward compat (sex)
                "groups":     id_demos[iid],    # v2: {sex, age, skin}
                "label":      "genuine",
                "vlm_subset": False,
            })

    # Impostor: n_impostor random cross-identity pairs
    cross_pairs = [(a, b) for a in id_list for b in id_list if a < b]
    for ref_id, probe_id in rng.choices(cross_pairs, k=n_impostor):
        ref_img   = rng.choice(identities[ref_id])
        probe_img = rng.choice(identities[probe_id])
        pairs.append({
            "pair_id":    f"i_{ref_id}_{probe_id}_{ref_img.stem}_{probe_img.stem}",
            "ref_id":     ref_id,
            "probe_id":   probe_id,
            "ref_path":   str(ref_img),
            "probe_path": str(probe_img),
            "group":      id_group[ref_id],     # backward compat (sex)
            "groups":     id_demos[ref_id],     # v2: {sex, age, skin}
            "label":      "impostor",
            "vlm_subset": False,
        })

    pairs = _flag_vlm_subset(pairs, n_vlm_subset, rng)
    return pairs


def _flag_vlm_subset(pairs: list[dict], n_vlm_subset: int, rng: random.Random) -> list[dict]:
    n_half = n_vlm_subset // 2
    genuine_pairs  = [p for p in pairs if p["label"] == "genuine"]
    impostor_pairs = [p for p in pairs if p["label"] == "impostor"]

    def stratified(pool: list[dict], n: int) -> list[dict]:
        by_group: dict[str, list[dict]] = {}
        for p in pool:
            by_group.setdefault(p["group"], []).append(p)
        per_group = max(1, n // len(by_group))
        selected: list[dict] = []
        for grp in sorted(by_group):
            bucket = by_group[grp][:]
            rng.shuffle(bucket)
            selected.extend(bucket[:per_group])
        remaining = [p for p in pool if p not in selected]
        rng.shuffle(remaining)
        selected.extend(remaining[: max(0, n - len(selected))])
        return selected[:n]

    vlm_ids = {p["pair_id"] for p in stratified(genuine_pairs, n_half) + stratified(impostor_pairs, n_half)}
    for p in pairs:
        if p["pair_id"] in vlm_ids:
            p["vlm_subset"] = True
    return pairs


# ---------------------------------------------------------------------------
# Manifest assembly
# ---------------------------------------------------------------------------

def _corpus_version(id_list: list[str], seed: int) -> str:
    h = hashlib.sha256()
    h.update(str(seed).encode())
    for iid in sorted(id_list):
        h.update(iid.encode())
    return h.hexdigest()[:16]


def build_manifest(
    source: str,
    identities: dict[str, list[Path]],
    img_labels: dict[str, dict],
    pairs: list[dict],
    seed: int,
) -> dict:
    id_list = sorted(identities.keys())
    return {
        "corpus_version": _corpus_version(id_list, seed),
        "seed":           seed,
        "source_dataset": source,
        "partition":      DIGIFACE_PARTITION if source == DIGIFACE_SOURCE else "n/a",
        "license":        DIGIFACE_LICENSE   if source == DIGIFACE_SOURCE else "see source dataset",
        "n_identities":   len(id_list),
        "images_per_identity": len(next(iter(identities.values()))),
        "demographic_labeling": (
            "Gender + age via InsightFace genderage.onnx (buffalo_l pack, ONNX/CPU). "
            "Skin tone via ITA (Individual Typology Angle) from L*a*b* face-centre region — "
            "light (ITA>41°), medium (10°<ITA≤41°), dark (ITA≤10°). "
            "DigiFace-1M images are synthetic; demographic predictions are approximate. "
            "Identity selection is stratified to ~50% male/female and populates age×skin buckets. "
            "Fairness panel demonstrates disparity measurement method — not a publishable audit."
        ),
        "identities": [
            {
                "identity_id": iid,
                "images": [
                    {"path": str(img), "labels": img_labels[str(img)]}
                    for img in identities[iid]
                ],
            }
            for iid in id_list
        ],
        "pairs":        pairs,
        "n_genuine":    sum(1 for p in pairs if p["label"] == "genuine"),
        "n_impostor":   sum(1 for p in pairs if p["label"] == "impostor"),
        "n_vlm_subset": sum(1 for p in pairs if p["vlm_subset"]),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(config_path: str = "config/eval.yaml") -> None:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    seed          = cfg["seed"]
    n_identities  = cfg["corpus"]["n_identities"]
    images_per_id = cfg["corpus"]["images_per_identity"]
    n_impostor    = cfg["corpus"]["impostor_pairs"]
    n_vlm_subset  = cfg["corpus"]["vlm_subset_pairs"]

    source = acquire_corpus(n_identities, images_per_id)

    # Quick-label all qualified identities for stratified selection (v2 Fix 2)
    all_qualified = _list_all_qualified(images_per_id)
    quick_labels  = _quick_label_for_stratification(all_qualified) if all_qualified else {}

    identities  = select_identities(n_identities, images_per_id, seed, quick_labels)
    img_labels  = label_all_images(identities)
    pairs       = build_pairs(identities, img_labels, n_impostor, n_vlm_subset, seed)
    manifest    = build_manifest(source, identities, img_labels, pairs, seed)

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2, default=str)

    print(
        f"[corpus] manifest.json written.\n"
        f"         {manifest['n_identities']} identities | "
        f"{manifest['n_genuine']} genuine | "
        f"{manifest['n_impostor']} impostor | "
        f"{manifest['n_vlm_subset']} VLM-subset"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config/eval.yaml")
    args = parser.parse_args()
    main(args.config)
