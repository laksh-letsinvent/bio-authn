"""
bio-authN v2 evaluation harness.

Usage:
    python eval/run_eval.py --config config/eval.yaml [--resume]

Matchers (v2):
    match track:  ArcFace, InsightFace, VLM (subset)
    PAD track:    pad_baseline (all PAD samples), pad_vlm (vlm_subset only)

Outputs:
    results/eval_run.json   — schema-valid (schema_version 1.0)
    results/pairs_raw.csv   — per-comparison row (match + PAD records)

Workflow:
    1. python corpus/build_corpus.py --config config/eval.yaml
    2. python corpus/attacks.py      --config config/eval.yaml
    3. python eval/run_eval.py       --config config/eval.yaml
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from engine.accounting import timed_run
from engine.registry import get_adapters
from eval.metrics import (
    PairRecord, compute_matcher_result, compute_pad_result, compute_disagreement,
)
from eval.schema import validate_result


RESULTS_DIR   = ROOT / "results"
MANIFEST_PATH = ROOT / "corpus" / "manifest.json"


# ---------------------------------------------------------------------------
# Provenance helpers
# ---------------------------------------------------------------------------

def _git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, cwd=ROOT,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "not-a-git-repo"


def _config_hash(cfg: dict) -> str:
    blob = json.dumps(cfg, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Pair runner (match track)
# ---------------------------------------------------------------------------

def _run_matcher_on_pairs(
    adapter,
    pairs: list[dict],
    subset_flag: Optional[str] = None,
) -> list[PairRecord]:
    from tqdm import tqdm
    target_pairs = pairs if subset_flag is None else [p for p in pairs if p.get(subset_flag)]
    records: list[PairRecord] = []
    n_errors = 0

    for pair in tqdm(target_pairs, desc=adapter.matcher_id, unit="pair"):
        try:
            result = timed_run(adapter, pair["ref_path"], pair["probe_path"])
        except Exception as exc:
            n_errors += 1
            print(f"\n[eval] WARNING: {adapter.matcher_id} failed on {pair['pair_id']}: {exc}")
            continue
        rec = PairRecord(
            pair_id    = pair["pair_id"],
            matcher_id = result.matcher_id,
            task_type  = result.task_type,
            ref_id     = pair["ref_id"],
            probe_id   = pair["probe_id"],
            group      = pair["group"],
            label      = pair["label"],
            score      = result.score,
            decision   = result.decision,
            confidence = result.confidence,
            tokens_in  = result.tokens_in,
            tokens_out = result.tokens_out,
            cost_usd   = result.cost_usd,
            latency_ms = result.latency_ms,
        )
        records.append(rec)

    if n_errors:
        print(f"[eval] {adapter.matcher_id}: {n_errors} pairs failed and were skipped.")
    return records


# ---------------------------------------------------------------------------
# PAD runner
# ---------------------------------------------------------------------------

def _run_pad_matcher(adapter, pad_samples: list[dict]) -> list[PairRecord]:
    from tqdm import tqdm
    records:  list[PairRecord] = []
    n_errors = 0

    for sample in tqdm(pad_samples, desc=adapter.matcher_id, unit="sample"):
        try:
            result = timed_run(adapter, None, sample["image_path"])
        except Exception as exc:
            n_errors += 1
            print(f"\n[eval] WARNING: {adapter.matcher_id} failed on {sample['sample_id']}: {exc}")
            continue
        label = sample.get("label", "bonafide")   # "bonafide" | "attack"
        group = sample.get("attack_type") or "bonafide"
        rec = PairRecord(
            pair_id    = sample["sample_id"],
            matcher_id = result.matcher_id,
            task_type  = result.task_type,
            ref_id     = "",
            probe_id   = sample.get("identity_id", ""),
            group      = group,
            label      = label,
            score      = result.score,
            decision   = result.decision,
            confidence = result.confidence,
            tokens_in  = result.tokens_in,
            tokens_out = result.tokens_out,
            cost_usd   = result.cost_usd,
            latency_ms = result.latency_ms,
        )
        records.append(rec)

    if n_errors:
        print(f"[eval] {adapter.matcher_id}: {n_errors} PAD samples failed and were skipped.")
    return records


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "pair_id", "matcher_id", "task_type", "ref_id", "probe_id",
    "group", "label", "score", "decision", "confidence",
    "tokens_in", "tokens_out", "cost_usd", "latency_ms",
]


def _write_csv(all_records: list[PairRecord], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for rec in all_records:
            row = rec.to_csv_row()
            row["decision"] = int(row["decision"])
            writer.writerow({k: row[k] for k in CSV_COLUMNS})
    print(f"[eval] pairs_raw.csv → {out_path} ({len(all_records)} rows)")


# ---------------------------------------------------------------------------
# VLM cache (resume support)
# ---------------------------------------------------------------------------

def _load_vlm_cache(csv_path: Path) -> dict[str, PairRecord]:
    """Load already-completed VLM records from pairs_raw.csv keyed by pair_id."""
    cache: dict[str, PairRecord] = {}
    if not csv_path.exists():
        return cache
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            if row["matcher_id"] != "vlm_claude":
                continue
            cache[row["pair_id"]] = PairRecord(
                pair_id    = row["pair_id"],
                matcher_id = row["matcher_id"],
                task_type  = row["task_type"],
                ref_id     = row["ref_id"],
                probe_id   = row["probe_id"],
                group      = row["group"],
                label      = row["label"],
                score      = float(row["score"]),
                decision   = bool(int(row["decision"])),
                confidence = float(row["confidence"]) if row["confidence"] else None,
                tokens_in  = int(row["tokens_in"]),
                tokens_out = int(row["tokens_out"]),
                cost_usd   = float(row["cost_usd"]),
                latency_ms = int(row["latency_ms"]),
            )
    return cache


def _load_pad_vlm_cache(csv_path: Path) -> dict[str, PairRecord]:
    """Load already-completed pad_vlm records from pairs_raw.csv keyed by pair_id."""
    cache: dict[str, PairRecord] = {}
    if not csv_path.exists():
        return cache
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            if row["matcher_id"] != "pad_vlm":
                continue
            cache[row["pair_id"]] = PairRecord(
                pair_id    = row["pair_id"],
                matcher_id = row["matcher_id"],
                task_type  = row["task_type"],
                ref_id     = row["ref_id"],
                probe_id   = row["probe_id"],
                group      = row["group"],
                label      = row["label"],
                score      = float(row["score"]),
                decision   = bool(int(row["decision"])),
                confidence = float(row["confidence"]) if row["confidence"] else None,
                tokens_in  = int(row["tokens_in"]),
                tokens_out = int(row["tokens_out"]),
                cost_usd   = float(row["cost_usd"]),
                latency_ms = int(row["latency_ms"]),
            )
    return cache


# ---------------------------------------------------------------------------
# Main eval loop
# ---------------------------------------------------------------------------

def run_eval(config_path: str = "config/eval.yaml", resume: bool = False) -> dict:
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    if not MANIFEST_PATH.exists():
        print(
            f"[eval] ERROR: {MANIFEST_PATH} not found.\n"
            "Run: python corpus/build_corpus.py --config config/eval.yaml\n"
            "Then: python corpus/attacks.py     --config config/eval.yaml"
        )
        sys.exit(1)

    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    pairs: list[dict]    = manifest["pairs"]
    pad_samples: list[dict] = manifest.get("pad_samples", [])

    target_far   = cfg["thresholds"]["target_far"]
    far_targets  = cfg.get("far_targets", [0.01, 0.001])
    vlm_mode     = cfg.get("vlm_mode", "local")

    # Uncertain band config (v2 Fix 1: relative mode)
    thr_cfg              = cfg["thresholds"]
    uncertain_band_mode  = thr_cfg.get("uncertain_band_mode", "fixed")
    uncertain_band_margin = thr_cfg.get("uncertain_band_margin", 0.07)
    uncertain_band_raw   = thr_cfg.get("uncertain_band", [0.55, 0.75])
    uncertain_band       = tuple(uncertain_band_raw)  # updated below for relative mode

    # Multi-axis demographic groups from manifest (v2 Fix 2)
    pair_groups: dict[str, dict[str, str]] = {
        p["pair_id"]: p.get("groups", {}) for p in pairs
    }

    adapters = get_adapters(cfg)
    arcface_adapter     = next((a for a in adapters if a.matcher_id == "arcface"),     None)
    insightface_adapter = next((a for a in adapters if a.matcher_id == "insightface"), None)
    vlm_adapter         = next((a for a in adapters if a.matcher_id == "vlm_claude"),  None)
    pad_baseline_adapter = next((a for a in adapters if a.matcher_id == "pad_baseline"), None)
    pad_vlm_adapter     = next((a for a in adapters if a.matcher_id == "pad_vlm"),     None)

    all_records:     list[PairRecord] = []
    matcher_results: list[dict]       = []
    arcface_records: list[PairRecord] = []
    vlm_records:     list[PairRecord] = []

    # --- ArcFace (all pairs) ---
    if arcface_adapter is not None:
        all_paths = list({p["ref_path"] for p in pairs} | {p["probe_path"] for p in pairs})
        arcface_adapter.precompute_all(all_paths)

        print(f"[eval] Running ArcFace on {len(pairs)} pairs ...")
        arcface_records = _run_matcher_on_pairs(arcface_adapter, pairs)
        all_records.extend(arcface_records)
        print(f"[eval] ArcFace: {len(arcface_records)} results")

        mr = compute_matcher_result(
            arcface_records, "arcface", "match",
            target_far, far_targets, False, pair_groups,
        )
        matcher_results.append(mr)

        # Compute relative uncertain band now that we have the operating threshold (v2 Fix 1)
        if uncertain_band_mode == "relative":
            op_thr = mr["operating_threshold"]
            uncertain_band = (op_thr - uncertain_band_margin, op_thr + uncertain_band_margin)
            print(
                f"[eval] Uncertain band (relative, ±{uncertain_band_margin}): "
                f"{uncertain_band[0]:.3f}–{uncertain_band[1]:.3f} "
                f"(centred on ArcFace op_thr={op_thr:.3f})"
            )

    # --- InsightFace (all pairs, v2) ---
    if insightface_adapter is not None:
        all_paths_if = list({p["ref_path"] for p in pairs} | {p["probe_path"] for p in pairs})
        insightface_adapter.precompute_all(all_paths_if)

        print(f"[eval] Running InsightFace on {len(pairs)} pairs ...")
        insightface_records = _run_matcher_on_pairs(insightface_adapter, pairs)
        all_records.extend(insightface_records)
        print(f"[eval] InsightFace: {len(insightface_records)} results")

        mr = compute_matcher_result(
            insightface_records, "insightface", "match",
            target_far, far_targets, False, pair_groups,
        )
        matcher_results.append(mr)

    # --- VLM matching (vlm_subset only) ---
    if vlm_adapter is not None:
        vlm_cache: dict[str, PairRecord] = {}
        if resume:
            vlm_cache = _load_vlm_cache(RESULTS_DIR / "pairs_raw.csv")
            print(f"[eval] Resume: {len(vlm_cache)} VLM pairs already in cache.")

        vlm_pairs = [p for p in pairs if p.get("vlm_subset")]
        pending   = [p for p in vlm_pairs if p["pair_id"] not in vlm_cache]
        print(f"[eval] Running VLM ({vlm_mode}) on {len(pending)}/{len(vlm_pairs)} pairs ...")
        new_vlm_records = _run_matcher_on_pairs(vlm_adapter, pending)

        vlm_records = list(vlm_cache.values()) + new_vlm_records
        all_records.extend(vlm_records)
        print(
            f"[eval] VLM: {len(vlm_records)} results ({len(new_vlm_records)} new), "
            f"cost=${sum(r.cost_usd for r in new_vlm_records):.4f} this run"
        )

        mr = compute_matcher_result(
            vlm_records, "vlm_claude", "match",
            target_far, far_targets, True, pair_groups,
        )
        matcher_results.append(mr)

    # --- PAD baseline (all PAD samples, v2) ---
    if pad_baseline_adapter is not None and pad_samples:
        print(f"[eval] Running pad_baseline on {len(pad_samples)} PAD samples ...")
        pad_bl_records = _run_pad_matcher(pad_baseline_adapter, pad_samples)
        all_records.extend(pad_bl_records)
        print(f"[eval] pad_baseline: {len(pad_bl_records)} results")
        mr = compute_pad_result(pad_bl_records, "pad_baseline", is_vlm=False)
        matcher_results.append(mr)
    elif pad_baseline_adapter is not None:
        print("[eval] pad_baseline enabled but no pad_samples in manifest — run corpus/attacks.py first.")

    # --- PAD VLM (vlm_subset only, v2) ---
    if pad_vlm_adapter is not None and pad_samples:
        vlm_pad_samples = [s for s in pad_samples if s.get("pad_vlm_subset")]
        pad_vlm_cache: dict[str, PairRecord] = {}
        if resume:
            pad_vlm_cache = _load_pad_vlm_cache(RESULTS_DIR / "pairs_raw.csv")
            print(f"[eval] Resume: {len(pad_vlm_cache)} pad_vlm samples already in cache.")
        pending_pad = [s for s in vlm_pad_samples if s["sample_id"] not in pad_vlm_cache]
        print(f"[eval] Running pad_vlm ({vlm_mode}) on {len(pending_pad)}/{len(vlm_pad_samples)} PAD VLM-subset samples ...")
        new_pad_vlm_records = _run_pad_matcher(pad_vlm_adapter, pending_pad)
        pad_vlm_records = list(pad_vlm_cache.values()) + new_pad_vlm_records
        all_records.extend(pad_vlm_records)
        print(
            f"[eval] pad_vlm: {len(pad_vlm_records)} results "
            f"({len(new_pad_vlm_records)} new), "
            f"cost=${sum(r.cost_usd for r in new_pad_vlm_records):.4f} this run"
        )
        mr = compute_pad_result(pad_vlm_records, "pad_vlm", is_vlm=True)
        matcher_results.append(mr)

    # --- Disagreement analysis ---
    disagreement = compute_disagreement(arcface_records, vlm_records, uncertain_band)

    # --- Assemble result ---
    result = {
        "schema_version": "1.0",
        "run": {
            "id":             str(uuid.uuid4()),
            "timestamp":      datetime.now(timezone.utc).isoformat(),
            "git_sha":        _git_sha(),
            "config_hash":    _config_hash(cfg),
            "corpus_version": manifest.get("corpus_version", "unknown"),
            "vlm_mode":       vlm_mode,
        },
        "matchers":     matcher_results,
        "disagreement": disagreement,
    }

    validate_result(result)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = RESULTS_DIR / "eval_run.json"
    with open(json_path, "w") as f:
        json.dump(result, f, indent=2)
    print(f"[eval] eval_run.json → {json_path}")

    _write_csv(all_records, RESULTS_DIR / "pairs_raw.csv")

    # Summary
    for mr in matcher_results:
        ov = mr["overall"]
        if mr["task_type"] == "pad":
            pad = mr.get("pad", {}) or {}
            print(
                f"[eval] {mr['matcher_id']:12s}  "
                f"APCER={pad.get('apcer',0):.3f}  BPCER={pad.get('bpcer',0):.3f}  "
                f"ACER={pad.get('acer',0):.3f}  "
                f"cost=${mr['cost']['usd_total']:.4f}"
            )
        else:
            print(
                f"[eval] {mr['matcher_id']:12s}  "
                f"EER={ov['eer']:.3f}  AUC={ov['auc']:.3f}  "
                f"FAR={ov['far']:.4f}  FRR={ov['frr']:.4f}  "
                f"cost=${mr['cost']['usd_total']:.4f}"
            )
    print(
        f"[eval] Disagreement: {disagreement['n_in_band']} pairs in uncertain band "
        f"({uncertain_band[0]:.3f}–{uncertain_band[1]:.3f}), "
        f"VLM correct: {disagreement['vlm_correct_in_band']}"
    )

    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="bio-authN v2 eval harness")
    parser.add_argument("--config", default="config/eval.yaml")
    parser.add_argument(
        "--resume", action="store_true",
        help="Skip VLM pairs already in pairs_raw.csv; merge with new results",
    )
    args = parser.parse_args()
    run_eval(args.config, resume=args.resume)
