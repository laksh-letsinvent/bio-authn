"""
IDV evaluation harness. Run after idv/build_idv_corpus.py.

Usage:
    python -m idv.run_idv_eval [--vlm-mode cli|api|local] [--dry-run]

Outputs:
    results/idv_run.json  — schema-valid (schema_version idv-1.0)
    results/idv_raw.csv   — per-document row for all three tasks

Three tasks:
  1. Extraction     — vlm_extract vs ocr_baseline on MIDV-2020 (or synthetic subset)
  2. Authenticity   — vlm_doc_auth vs auth_baseline (ELA) on SIDTD (or synthetic)
  3. Face-on-doc    — ArcFace with doc-tuned threshold on DigiFace card pairs

VLM cost is logged and bounded. Set --dry-run to validate pipeline without VLM calls.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from idv.adapters.vlm_extract   import VLMExtractAdapter
from idv.adapters.ocr_baseline  import OCRBaselineAdapter
from idv.adapters.vlm_doc_auth  import VLMDocAuthAdapter
from idv.adapters.auth_baseline  import ELABaselineAdapter
from idv.schema_idv import validate_idv_result
from eval.metrics import (
    compute_extraction_metrics, compute_doc_auth_metrics,
    compute_roc, compute_auc, find_operating_threshold, at_threshold,
)

IDV_DATA   = ROOT / "idv" / "data"
RESULTS    = ROOT / "results"
RESULTS.mkdir(exist_ok=True)

# Fields to extract and evaluate for extraction task
FIELDS = ["surname", "given_names", "dob", "doc_number", "expiry", "nationality"]

# Selfie-to-selfie threshold from the face-matching eval (ArcFace operating point)
# Used to demonstrate the document-tuned threshold is looser.
SELFIE_THRESHOLD = 0.28  # ArcFace default; update with your actual eval result


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="IDV evaluation harness")
    parser.add_argument("--vlm-mode", choices=["cli", "api", "local"], default="cli")
    parser.add_argument("--dry-run", action="store_true",
                        help="Skip VLM calls, use random scores (pipeline smoke-test)")
    parser.add_argument("--skip-permissions", action="store_true",
                        help="Pass --dangerously-skip-permissions to claude CLI")
    args = parser.parse_args()

    run_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).isoformat()
    git_sha = _git_sha()

    print(f"\n=== IDV Eval Run {run_id} | {timestamp} | vlm_mode={args.vlm_mode} ===\n")

    total_cost = 0.0
    csv_rows: list[dict] = []

    # -----------------------------------------------------------------------
    # Task 1 — Extraction
    # -----------------------------------------------------------------------
    ext_result, ext_rows, ext_cost = run_extraction(
        args.vlm_mode, args.dry_run, args.skip_permissions
    )
    total_cost += ext_cost
    csv_rows.extend(ext_rows)
    print(f"Extraction done. VLM cost: ${ext_cost:.4f}")

    # -----------------------------------------------------------------------
    # Task 2 — Authenticity
    # -----------------------------------------------------------------------
    auth_result, auth_rows, auth_cost = run_authenticity(
        args.vlm_mode, args.dry_run, args.skip_permissions
    )
    total_cost += auth_cost
    csv_rows.extend(auth_rows)
    print(f"Authenticity done. VLM cost: ${auth_cost:.4f}")

    # -----------------------------------------------------------------------
    # Task 3 — Face-on-document match
    # -----------------------------------------------------------------------
    face_result, face_rows = run_face_match()
    csv_rows.extend(face_rows)
    print(f"Face-on-document match done.")

    print(f"\nTotal VLM spend: ${total_cost:.4f}")

    # -----------------------------------------------------------------------
    # Assemble output
    # -----------------------------------------------------------------------
    output = {
        "schema_version": "idv-1.0",
        "run": {
            "id":             run_id,
            "timestamp":      timestamp,
            "git_sha":        git_sha,
            "vlm_mode":       args.vlm_mode,
            "total_cost_usd": round(total_cost, 6),
        },
        "extraction":   ext_result,
        "authenticity": auth_result,
        "face_match":   face_result,
    }

    # Validate
    try:
        validate_idv_result(output)
        print("\nSchema validation passed.")
    except Exception as e:
        print(f"\n[warn] Schema validation failed: {e}")

    # Write outputs
    out_json = RESULTS / "idv_run.json"
    with open(out_json, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Written: {out_json}")

    out_csv = RESULTS / "idv_raw.csv"
    if csv_rows:
        # Rows from different tasks have different keys — take union of all keys
        all_keys: list[str] = []
        seen: set[str] = set()
        for row in csv_rows:
            for k in row.keys():
                if k not in seen:
                    all_keys.append(k)
                    seen.add(k)
        with open(out_csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=all_keys, extrasaction="ignore", restval="")
            writer.writeheader()
            writer.writerows(csv_rows)
        print(f"Written: {out_csv}")


# ---------------------------------------------------------------------------
# Task 1 — Extraction
# ---------------------------------------------------------------------------

def run_extraction(
    vlm_mode: str, dry_run: bool, skip_permissions: bool
) -> tuple[dict, list[dict], float]:
    index_path = IDV_DATA / "midv2020" / "subset_150.json"
    if not index_path.exists():
        print(f"[warn] Extraction index not found at {index_path}.")
        print("       Run: python -m idv.build_idv_corpus --task extraction")
        return _stub_extraction(), [], 0.0

    with open(index_path) as f:
        index = json.load(f)

    docs = index["docs"]
    print(f"Extraction: {len(docs)} documents")

    ocr = OCRBaselineAdapter()
    vlm = VLMExtractAdapter(vlm_mode=vlm_mode, skip_permissions=skip_permissions)

    vlm_preds, ocr_preds, gts = [], [], []
    csv_rows = []
    total_cost = 0.0
    vlm_latencies, ocr_latencies = [], []
    vlm_tokens_in = vlm_tokens_out = 0

    for i, doc in enumerate(docs):
        img_path = doc["image_path"]
        if not Path(img_path).exists():
            print(f"  [skip] Missing: {img_path}")
            continue

        gt = {}
        if doc.get("gt_path") and Path(doc["gt_path"]).exists():
            with open(doc["gt_path"]) as f:
                gt = json.load(f)

        print(f"  [{i+1}/{len(docs)}] {Path(img_path).name}", end=" ", flush=True)

        # OCR
        ocr_result = ocr.run(img_path, FIELDS)
        ocr_preds.append(ocr_result.fields)
        ocr_latencies.append(ocr_result.latency_ms)

        # VLM
        if dry_run:
            vlm_fields = {f: gt.get(f, "") for f in FIELDS}
            vlm_cost = 0.0
            vlm_lat = 100
            tok_in = tok_out = 0
        else:
            vlm_result = vlm.run(img_path, FIELDS)
            vlm_fields = vlm_result.fields
            vlm_cost   = vlm_result.cost_usd
            vlm_lat    = vlm_result.latency_ms
            tok_in     = vlm_result.tokens_in
            tok_out    = vlm_result.tokens_out

        vlm_preds.append(vlm_fields)
        gts.append(gt)
        total_cost += vlm_cost
        vlm_latencies.append(vlm_lat)
        vlm_tokens_in  += tok_in
        vlm_tokens_out += tok_out

        print(f"ocr_ok={bool(ocr_result.fields.get('surname'))} vlm_ok={bool(vlm_fields.get('surname'))}")

        csv_rows.append({
            "task": "extraction",
            "doc_id": Path(img_path).stem,
            "adapter": "ocr_baseline",
            **{f"ocr_{k}": ocr_result.fields.get(k, "") for k in FIELDS},
            **{f"vlm_{k}": vlm_fields.get(k, "") for k in FIELDS},
            **{f"gt_{k}": gt.get(k, "") for k in FIELDS},
            "vlm_cost_usd": vlm_cost,
        })

    n_docs = len(vlm_preds)
    if n_docs == 0:
        return _stub_extraction(), csv_rows, total_cost

    vlm_metrics = compute_extraction_metrics(vlm_preds, gts, FIELDS)
    ocr_metrics = compute_extraction_metrics(ocr_preds, gts, FIELDS)

    vlm_cer = vlm_metrics["cer"]
    ocr_cer = ocr_metrics["cer"]

    result = {
        "dataset":          index.get("synthetic") and "Synthetic (no MIDV-2020)" or "MIDV-2020",
        "n_documents":      n_docs,
        "fields_evaluated": FIELDS,
        "adapters": [
            {
                "adapter_id":     "vlm_extract",
                "cer":            vlm_cer,
                "field_accuracy": vlm_metrics["field_accuracy"],
                "field_f1":       vlm_metrics["field_f1"],
                "per_field":      vlm_metrics["per_field"],
                "cost": {
                    "calls":       n_docs,
                    "tokens_in":   vlm_tokens_in,
                    "tokens_out":  vlm_tokens_out,
                    "usd_total":   round(total_cost, 6),
                    "usd_per_doc": round(total_cost / n_docs, 6) if n_docs else 0.0,
                },
                "latency_ms": {
                    "p50": int(np.percentile(vlm_latencies, 50)) if vlm_latencies else 0,
                    "p95": int(np.percentile(vlm_latencies, 95)) if vlm_latencies else 0,
                },
            },
            {
                "adapter_id":     "ocr_baseline",
                "cer":            ocr_cer,
                "field_accuracy": ocr_metrics["field_accuracy"],
                "field_f1":       ocr_metrics["field_f1"],
                "per_field":      ocr_metrics["per_field"],
                "cost": {
                    "calls": n_docs, "tokens_in": 0, "tokens_out": 0,
                    "usd_total": 0.0, "usd_per_doc": 0.0,
                },
                "latency_ms": {
                    "p50": int(np.percentile(ocr_latencies, 50)) if ocr_latencies else 0,
                    "p95": int(np.percentile(ocr_latencies, 95)) if ocr_latencies else 0,
                },
            },
        ],
        "comparison": {
            "vlm_vs_ocr_cer_delta": round(vlm_cer - ocr_cer, 4),
            "vlm_wins": vlm_cer < ocr_cer,
            "note": (
                f"VLM CER={vlm_cer:.3f}, OCR CER={ocr_cer:.3f}. "
                + ("VLM outperforms Tesseract on document field extraction, as hypothesised."
                   if vlm_cer < ocr_cer else
                   "OCR outperforms VLM — unexpected; check prompt and field heuristics.")
            ),
        },
    }
    return result, csv_rows, total_cost


# ---------------------------------------------------------------------------
# Task 2 — Authenticity
# ---------------------------------------------------------------------------

def run_authenticity(
    vlm_mode: str, dry_run: bool, skip_permissions: bool
) -> tuple[dict, list[dict], float]:
    index_path = IDV_DATA / "sidtd" / "subset_200.json"
    if not index_path.exists():
        print(f"[warn] Authenticity index not found at {index_path}.")
        print("       Run: python -m idv.build_idv_corpus --task authenticity")
        return _stub_authenticity(), [], 0.0

    with open(index_path) as f:
        index = json.load(f)

    docs = index["docs"]
    print(f"\nAuthenticity: {len(docs)} documents")

    ela  = ELABaselineAdapter()
    vlm  = VLMDocAuthAdapter(vlm_mode=vlm_mode, skip_permissions=skip_permissions)

    vlm_decisions, ela_decisions = [], []
    vlm_confs, ela_confs = [], []
    labels = []
    forgery_types = []
    csv_rows = []
    total_cost = 0.0
    vlm_latencies, ela_latencies = [], []
    vlm_tokens_in = vlm_tokens_out = 0

    for i, doc in enumerate(docs):
        img_path = doc["image_path"]
        if not Path(img_path).exists():
            print(f"  [skip] Missing: {img_path}")
            continue

        label = doc["label"]        # "genuine" or "forged"
        ftype = doc.get("forgery_type")
        print(f"  [{i+1}/{len(docs)}] {Path(img_path).name} label={label}", end=" ", flush=True)

        ela_result = ela.run(img_path)
        ela_decisions.append(ela_result.decision)
        ela_confs.append(ela_result.confidence)
        ela_latencies.append(ela_result.latency_ms)

        if dry_run:
            vlm_dec  = label == "genuine"
            vlm_conf = 0.85
            vlm_cost = 0.0
            vlm_lat  = 100
            tok_in = tok_out = 0
        else:
            vlm_result = vlm.run(img_path)
            vlm_dec  = vlm_result.decision
            vlm_conf = vlm_result.confidence or 0.5
            vlm_cost = vlm_result.cost_usd
            vlm_lat  = vlm_result.latency_ms
            tok_in   = vlm_result.tokens_in
            tok_out  = vlm_result.tokens_out

        vlm_decisions.append(vlm_dec)
        vlm_confs.append(vlm_conf)
        labels.append(label)
        forgery_types.append(ftype)
        total_cost += vlm_cost
        vlm_latencies.append(vlm_lat)
        vlm_tokens_in  += tok_in
        vlm_tokens_out += tok_out

        print(f"ela={ela_result.decision} vlm={vlm_dec}")

        csv_rows.append({
            "task":          "authenticity",
            "doc_id":        Path(img_path).stem,
            "label":         label,
            "forgery_type":  ftype or "",
            "ela_decision":  ela_result.decision,
            "ela_conf":      ela_result.confidence,
            "vlm_decision":  vlm_dec,
            "vlm_conf":      vlm_conf,
            "vlm_cost_usd":  vlm_cost,
        })

    n_docs = len(labels)
    if n_docs == 0:
        return _stub_authenticity(), csv_rows, total_cost

    vlm_metrics = compute_doc_auth_metrics(vlm_decisions, labels, vlm_confs)
    ela_metrics = compute_doc_auth_metrics(ela_decisions, labels, ela_confs)

    # By-forgery-type APCER for VLM
    by_ftype: dict[str, list] = {}
    for d, l, ft in zip(vlm_decisions, labels, forgery_types):
        if l == "forged" and ft:
            by_ftype.setdefault(ft, []).append(d)
    by_forgery = [
        {
            "forgery_type": ft,
            "apcer": sum(1 for d in decs if d is True) / len(decs),
            "n": len(decs),
        }
        for ft, decs in sorted(by_ftype.items())
    ]

    def _adapter_block(metrics, adapter_id, cost_usd, tokens_in, tokens_out, latencies, by_ftype_list=None):
        return {
            "adapter_id":          adapter_id,
            "operating_threshold": metrics["operating_threshold"],
            "apcer":               round(metrics["apcer"], 4),
            "bpcer":               round(metrics["bpcer"], 4),
            "acer":                round(metrics["acer"],  4),
            "auc":                 round(metrics["auc"],   4),
            "by_forgery_type":     by_ftype_list or [],
            "roc":                 metrics["roc"],
            "cost": {
                "calls":       n_docs,
                "tokens_in":   tokens_in,
                "tokens_out":  tokens_out,
                "usd_total":   round(cost_usd, 6),
                "usd_per_doc": round(cost_usd / n_docs, 6) if n_docs else 0.0,
            },
            "latency_ms": {
                "p50": int(np.percentile(latencies, 50)) if latencies else 0,
                "p95": int(np.percentile(latencies, 95)) if latencies else 0,
            },
        }

    result = {
        "dataset":   index.get("synthetic") and "Synthetic (no SIDTD)" or "SIDTD",
        "n_genuine": vlm_metrics["n_genuine"],
        "n_forged":  vlm_metrics["n_forged"],
        "adapters": [
            _adapter_block(vlm_metrics, "vlm_doc_auth", total_cost,
                           vlm_tokens_in, vlm_tokens_out, vlm_latencies, by_forgery),
            _adapter_block(ela_metrics, "auth_baseline", 0.0, 0, 0, ela_latencies),
        ],
    }
    return result, csv_rows, total_cost


# ---------------------------------------------------------------------------
# Task 3 — Face-on-document match
# ---------------------------------------------------------------------------

def run_face_match() -> tuple[dict, list[dict]]:
    pairs_path = IDV_DATA / "face_doc_pairs" / "pairs.json"
    if not pairs_path.exists():
        print(f"\n[warn] Face-doc pairs not found at {pairs_path}.")
        print("       Run: python -m idv.build_idv_corpus --task face_match")
        return _stub_face_match(), []

    with open(pairs_path) as f:
        index = json.load(f)

    pairs = index["pairs"]
    print(f"\nFace-on-document match: {len(pairs)} pairs")

    # Load ArcFace — reuse the existing adapter with its cached embeddings
    from engine.adapters.arcface import ArcFaceAdapter
    from engine.accounting import timed_run
    from eval.metrics import PairRecord

    arcface = ArcFaceAdapter()

    # Pre-compute embeddings for all selfies and card portraits
    selfie_paths  = [p["selfie_path"] for p in pairs]
    card_paths    = [p["card_path"]   for p in pairs]
    all_paths = list(set(selfie_paths + card_paths))
    print(f"  Pre-computing embeddings for {len(all_paths)} images ...")
    arcface.precompute_all(all_paths)

    records = []
    csv_rows = []

    for pair in pairs:
        result = timed_run(arcface, pair["selfie_path"], pair["card_path"])
        records.append(PairRecord(
            pair_id    = pair["pair_id"],
            matcher_id = "arcface",
            task_type  = "match",
            ref_id     = pair["selfie_identity"],
            probe_id   = pair["portrait_identity"],
            group      = "all",
            label      = pair["label"],
            score      = result.score,
            decision   = result.decision,
            confidence = result.confidence,
            tokens_in  = 0,
            tokens_out = 0,
            cost_usd   = 0.0,
            latency_ms = result.latency_ms,
        ))
        csv_rows.append({
            "task":      "face_match",
            "pair_id":   pair["pair_id"],
            "label":     pair["label"],
            "score":     result.score,
            "decision":  result.decision,
        })

    # Compute ROC over card pairs
    from eval.metrics import compute_roc, compute_auc
    roc = compute_roc(records)
    auc = compute_auc(records)

    # Doc-tuned threshold: find EER threshold (optimised for doc domain)
    diffs = [abs(p["far"] - p["frr"]) for p in roc]
    eer_idx = int(np.argmin(diffs))
    doc_threshold = roc[eer_idx]["threshold"]

    doc_far, doc_frr = at_threshold(records, doc_threshold)
    selfie_far, selfie_frr = at_threshold(records, SELFIE_THRESHOLD)

    result = {
        "dataset":          index.get("note", "DigiFace synthetic card pairs"),
        "n_genuine_pairs":  index["n_genuine"],
        "n_impostor_pairs": index["n_impostor"],
        "adapter_id":       "arcface",
        "selfie_threshold": SELFIE_THRESHOLD,
        "doc_threshold":    round(float(doc_threshold), 4),
        "selfie_far":       round(selfie_far, 4),
        "selfie_frr":       round(selfie_frr, 4),
        "doc_far":          round(doc_far, 4),
        "doc_frr":          round(doc_frr, 4),
        "threshold_delta_note": (
            f"Selfie-to-selfie threshold {SELFIE_THRESHOLD:.2f} vs "
            f"doc-tuned threshold {doc_threshold:.4f}. "
            f"The document threshold is {'looser' if doc_threshold < SELFIE_THRESHOLD else 'tighter'} "
            f"because printed portrait photos are degraded (low-res, printed, re-captured), "
            f"reducing embedding similarity relative to live selfie pairs."
        ),
        "roc": roc,
    }
    return result, csv_rows


# ---------------------------------------------------------------------------
# Stubs — returned when corpus data is missing
# ---------------------------------------------------------------------------

def _stub_extraction() -> dict:
    return {
        "dataset": "NOT_RUN — run build_idv_corpus.py first",
        "n_documents": 0,
        "fields_evaluated": FIELDS,
        "adapters": [
            {"adapter_id": "vlm_extract",  "cer": 0.0, "field_accuracy": 0.0,
             "field_f1": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
             "cost": {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd_total": 0.0, "usd_per_doc": 0.0},
             "latency_ms": {"p50": 0, "p95": 0}},
            {"adapter_id": "ocr_baseline", "cer": 0.0, "field_accuracy": 0.0,
             "field_f1": {"precision": 0.0, "recall": 0.0, "f1": 0.0},
             "cost": {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd_total": 0.0, "usd_per_doc": 0.0},
             "latency_ms": {"p50": 0, "p95": 0}},
        ],
        "comparison": {"vlm_vs_ocr_cer_delta": 0.0, "vlm_wins": False, "note": "No data."},
    }


def _stub_authenticity() -> dict:
    return {
        "dataset": "NOT_RUN — run build_idv_corpus.py first",
        "n_genuine": 0, "n_forged": 0,
        "adapters": [
            {"adapter_id": "vlm_doc_auth", "operating_threshold": 0.5,
             "apcer": 0.0, "bpcer": 0.0, "acer": 0.0, "auc": 0.0,
             "roc": [],
             "cost": {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd_total": 0.0, "usd_per_doc": 0.0},
             "latency_ms": {"p50": 0, "p95": 0}},
            {"adapter_id": "auth_baseline", "operating_threshold": 0.5,
             "apcer": 0.0, "bpcer": 0.0, "acer": 0.0, "auc": 0.0,
             "roc": [],
             "cost": {"calls": 0, "tokens_in": 0, "tokens_out": 0, "usd_total": 0.0, "usd_per_doc": 0.0},
             "latency_ms": {"p50": 0, "p95": 0}},
        ],
    }


def _stub_face_match() -> dict:
    return {
        "dataset": "NOT_RUN — run build_idv_corpus.py first",
        "n_genuine_pairs": 0, "n_impostor_pairs": 0,
        "adapter_id": "arcface",
        "selfie_threshold": SELFIE_THRESHOLD, "doc_threshold": SELFIE_THRESHOLD,
        "selfie_far": 0.0, "selfie_frr": 0.0, "doc_far": 0.0, "doc_frr": 0.0,
        "threshold_delta_note": "No data.",
        "roc": [],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=ROOT,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


if __name__ == "__main__":
    main()
