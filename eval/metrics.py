"""
Metric computations for the bio-authN eval harness.

All biometric metrics implemented from first principles.
sklearn used only for AUC (roc_auc_score).

Statistical caveat: ~25 identities/bucket gives trend-level bias signal, not tight CIs.
"""

from __future__ import annotations

import math
from typing import Optional

import numpy as np
from sklearn.metrics import roc_auc_score


# ---------------------------------------------------------------------------
# Core types
# ---------------------------------------------------------------------------

class PairRecord:
    """One row of results for a single pair × matcher."""
    __slots__ = (
        "pair_id", "matcher_id", "task_type", "ref_id", "probe_id",
        "group", "label", "score", "decision", "confidence",
        "tokens_in", "tokens_out", "cost_usd", "latency_ms",
    )

    def __init__(
        self,
        pair_id: str, matcher_id: str, task_type: str,
        ref_id: str, probe_id: str, group: str, label: str,
        score: float, decision: bool, confidence: Optional[float],
        tokens_in: int, tokens_out: int, cost_usd: float, latency_ms: int,
    ) -> None:
        for attr in self.__slots__:
            setattr(self, attr, locals()[attr])

    def to_csv_row(self) -> dict:
        return {k: getattr(self, k) for k in self.__slots__}


# ---------------------------------------------------------------------------
# ROC / EER / AUC
# ---------------------------------------------------------------------------

def compute_roc(records: list[PairRecord], n_thresholds: int = 500) -> list[dict]:
    """
    Sweep thresholds and return list of {threshold, far, frr, tar}.
    Thresholds span [min_score, max_score] in n_thresholds steps.
    """
    scores  = np.array([r.score  for r in records])
    labels  = np.array([r.label  for r in records])  # "genuine" or "impostor"
    genuine = labels == "genuine"
    impostor = ~genuine

    thresholds = np.linspace(scores.min(), scores.max(), n_thresholds)
    roc = []
    for t in thresholds:
        decisions = scores >= t
        far = float(decisions[impostor].sum() / impostor.sum()) if impostor.sum() > 0 else 0.0
        frr = float((~decisions[genuine]).sum() / genuine.sum()) if genuine.sum() > 0 else 0.0
        tar = 1.0 - frr
        roc.append({"threshold": float(t), "far": far, "frr": frr, "tar": tar})
    return roc


def compute_eer(roc: list[dict]) -> float:
    """Equal Error Rate: interpolated threshold where FAR ≈ FRR."""
    diffs = [abs(p["far"] - p["frr"]) for p in roc]
    idx = int(np.argmin(diffs))
    return float((roc[idx]["far"] + roc[idx]["frr"]) / 2)


def compute_auc(records: list[PairRecord]) -> float:
    scores = [r.score for r in records]
    labels = [1 if r.label == "genuine" else 0 for r in records]
    if len(set(labels)) < 2:
        return 0.0
    return float(roc_auc_score(labels, scores))


# ---------------------------------------------------------------------------
# Operating threshold & TAR@FAR
# ---------------------------------------------------------------------------

def find_operating_threshold(roc: list[dict], target_far: float) -> float:
    """
    Return the lowest threshold where FAR ≤ target_far.
    Lower threshold = more lenient = fewer false rejections while still meeting the FAR budget.
    """
    candidates = [p for p in roc if p["far"] <= target_far]
    if not candidates:
        # No threshold meets the FAR budget; return the one with lowest FAR
        return min(roc, key=lambda p: p["far"])["threshold"]
    return min(candidates, key=lambda p: p["threshold"])["threshold"]


def compute_tar_at_far(
    records: list[PairRecord],
    target_fars: list[float],
    roc: list[dict],
) -> dict[str, Optional[float]]:
    """
    Return TAR at each target FAR, or None if corpus can't resolve cleanly.
    At FAR=1e-3 with 7,500 impostors we can resolve at most 7-8 accepted pairs
    — flag when the nearest roc point is > 0.1 away from target_far.
    """
    result: dict[str, Optional[float]] = {}
    for far_target in target_fars:
        key = f"{far_target:.0e}".replace("e-0", "e-").replace("e+0", "e+")
        candidates = [p for p in roc if p["far"] <= far_target]
        if not candidates:
            result[key] = None
            continue
        best = max(candidates, key=lambda p: p["far"])
        # Flag if resolution is poor (nearest FAR is more than 50% off target)
        if abs(best["far"] - far_target) > far_target * 0.5 and far_target <= 1e-3:
            result[key] = None
        else:
            result[key] = float(best["tar"])
    return result


def at_threshold(records: list[PairRecord], threshold: float) -> tuple[float, float]:
    """Return (FAR, FRR) at a specific threshold."""
    genuine  = [r for r in records if r.label == "genuine"]
    impostor = [r for r in records if r.label == "impostor"]
    far = sum(1 for r in impostor if r.score >= threshold) / len(impostor) if impostor else 0.0
    frr = sum(1 for r in genuine  if r.score <  threshold) / len(genuine)  if genuine  else 0.0
    return far, frr


# ---------------------------------------------------------------------------
# Demographic differential
# ---------------------------------------------------------------------------

def compute_by_group(records: list[PairRecord], threshold: float) -> tuple[list[dict], Optional[float]]:
    """
    Per-group FAR and FRR at the operating threshold.
    Returns (by_group_list, disparity_ratio).
    disparity_ratio = worst_group_FRR / best_group_FRR; None if best == 0.
    """
    groups: dict[str, list[PairRecord]] = {}
    for r in records:
        groups.setdefault(r.group, []).append(r)

    by_group = []
    frrs: list[float] = []
    for group, recs in sorted(groups.items()):
        genuine  = [r for r in recs if r.label == "genuine"]
        impostor = [r for r in recs if r.label == "impostor"]
        far = sum(1 for r in impostor if r.score >= threshold) / len(impostor) if impostor else 0.0
        frr = sum(1 for r in genuine  if r.score <  threshold) / len(genuine)  if genuine  else 0.0
        by_group.append({"group": group, "frr": frr, "far": far, "n_pairs": len(recs)})
        frrs.append(frr)

    if not frrs:
        return by_group, None

    best_frr  = min(frrs)
    worst_frr = max(frrs)
    if best_frr == 0.0:
        disparity_ratio = None  # guard: division by zero
    else:
        disparity_ratio = float(worst_frr / best_frr)

    return by_group, disparity_ratio


# ---------------------------------------------------------------------------
# Calibration (VLM only)
# ---------------------------------------------------------------------------

def compute_calibration(records: list[PairRecord], n_bins: int = 10) -> dict:
    """
    Reliability diagram + ECE for VLM records that have a stated confidence.
    Confidence is the model's probability that its decision is correct.
    """
    # Only use records with a confidence value
    recs = [r for r in records if r.confidence is not None]
    if not recs:
        return {"ece": 0.0, "bins": []}

    bins = []
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    total = len(recs)
    ece = 0.0

    for i in range(n_bins):
        lo, hi = bin_edges[i], bin_edges[i + 1]
        # Interpret confidence as probability of being "genuine"
        in_bin = [r for r in recs if lo <= r.confidence < hi]
        if not in_bin:
            continue
        avg_conf = float(np.mean([r.confidence for r in in_bin]))
        # Accuracy = fraction where VLM decision matches label
        acc = sum(
            1 for r in in_bin
            if (r.decision and r.label == "genuine") or (not r.decision and r.label == "impostor")
        ) / len(in_bin)
        n = len(in_bin)
        bins.append({"conf": avg_conf, "acc": acc, "n": n})
        ece += (n / total) * abs(avg_conf - acc)

    return {"ece": float(ece), "bins": bins}


# ---------------------------------------------------------------------------
# Cost & latency
# ---------------------------------------------------------------------------

def compute_cost(records: list[PairRecord]) -> dict:
    calls       = len(records)
    tokens_in   = sum(r.tokens_in  for r in records)
    tokens_out  = sum(r.tokens_out for r in records)
    usd_total   = sum(r.cost_usd   for r in records)
    usd_per_dec = usd_total / calls if calls > 0 else 0.0
    return {
        "calls":            calls,
        "tokens_in":        tokens_in,
        "tokens_out":       tokens_out,
        "usd_total":        usd_total,
        "usd_per_decision": usd_per_dec,
    }


def compute_latency(records: list[PairRecord]) -> dict:
    latencies = sorted(r.latency_ms for r in records)
    if not latencies:
        return {"p50": 0, "p95": 0}
    p50 = int(np.percentile(latencies, 50))
    p95 = int(np.percentile(latencies, 95))
    return {"p50": p50, "p95": p95}


# ---------------------------------------------------------------------------
# Multi-axis demographic breakdown (v2 Fix 2)
# ---------------------------------------------------------------------------

def _compute_by_group_from_map(
    records: list[PairRecord],
    threshold: float,
    group_map: dict[str, str],
) -> tuple[list[dict], Optional[float]]:
    """compute_by_group variant using an explicit pair_id → group_name mapping."""
    groups: dict[str, list[PairRecord]] = {}
    for r in records:
        g = group_map.get(r.pair_id, "unknown")
        groups.setdefault(g, []).append(r)

    by_group = []
    frrs: list[float] = []
    for group, recs in sorted(groups.items()):
        genuine  = [r for r in recs if r.label == "genuine"]
        impostor = [r for r in recs if r.label == "impostor"]
        far = sum(1 for r in impostor if r.score >= threshold) / len(impostor) if impostor else 0.0
        frr = sum(1 for r in genuine  if r.score <  threshold) / len(genuine)  if genuine  else 0.0
        by_group.append({"group": group, "frr": frr, "far": far, "n_pairs": len(recs)})
        frrs.append(frr)

    if not frrs:
        return by_group, None
    best_frr  = min(frrs)
    worst_frr = max(frrs)
    disparity_ratio = float(worst_frr / best_frr) if best_frr > 0 else None
    return by_group, disparity_ratio


def compute_by_group_multiaxis(
    records: list[PairRecord],
    pair_groups: dict[str, dict[str, str]],
    threshold: float,
    axes: list[str] = None,
) -> tuple[list[dict], Optional[float]]:
    """
    Compute by_group for all demographic axes simultaneously.

    pair_groups: {pair_id: {"sex": "Male", "age": "25_to_44", "skin": "light"}}
    Returns a flat by_group list (groups prefixed "sex:Male", "age:under_25", etc.)
    and the max disparity_ratio across all axes.
    Falls back to single-axis (r.group) when pair_groups is empty.
    """
    if not pair_groups:
        return compute_by_group(records, threshold)

    if axes is None:
        axes = ["sex", "age", "skin"]

    all_by_group: list[dict] = []
    disparities: list[float] = []

    for axis in axes:
        group_map = {
            pid: f"{axis}:{gdata.get(axis, 'unknown')}"
            for pid, gdata in pair_groups.items()
        }
        bg_axis, disp_axis = _compute_by_group_from_map(records, threshold, group_map)
        all_by_group.extend(bg_axis)
        if disp_axis is not None:
            disparities.append(disp_axis)

    max_disparity = float(max(disparities)) if disparities else None
    return all_by_group, max_disparity


# ---------------------------------------------------------------------------
# PAD metrics (v2)
# ---------------------------------------------------------------------------

def compute_pad_result(
    records: list[PairRecord],
    matcher_id: str,
    is_vlm: bool,
    target_apcer: float = 0.05,
) -> dict:
    """
    Compute PAD metrics from liveness-scored records.

    Labels: "bonafide" (live) | "attack" (PAI).
    Score convention: higher = more live.

    Maps onto the standard matcher result shape so the schema stays valid:
      overall.far  = APCER (attack false acceptance rate)
      overall.frr  = BPCER (bona-fide false rejection rate)
      overall.eer  = EER on the PAD ROC
      overall.auc  = AUC
    The pad block carries the ISO-named metrics explicitly.
    """
    scores = np.array([r.score for r in records])
    labels = np.array([r.label for r in records])

    is_bonafide = labels == "bonafide"
    is_attack   = labels == "attack"
    n_bonafide  = int(is_bonafide.sum())
    n_attack    = int(is_attack.sum())

    thresholds = np.linspace(scores.min(), scores.max(), 500)
    roc = []
    for t in thresholds:
        accepted = scores >= t
        # APCER: attacks accepted as live / total attacks
        apcer = float(accepted[is_attack].sum()  / n_attack)   if n_attack   > 0 else 0.0
        # BPCER: bonafide rejected / total bonafide
        bpcer = float((~accepted[is_bonafide]).sum() / n_bonafide) if n_bonafide > 0 else 0.0
        roc.append({"threshold": float(t), "far": apcer, "frr": bpcer, "tar": 1.0 - bpcer})

    # Operating point: lowest threshold where APCER ≤ target_apcer
    candidates = [p for p in roc if p["far"] <= target_apcer]
    if candidates:
        op = min(candidates, key=lambda p: p["threshold"])
    else:
        op = min(roc, key=lambda p: p["far"])

    apcer_op  = op["far"]
    bpcer_op  = op["frr"]
    acer_op   = (apcer_op + bpcer_op) / 2
    op_thresh = op["threshold"]

    # EER on PAD ROC
    diffs   = [abs(p["far"] - p["frr"]) for p in roc]
    eer_idx = int(np.argmin(diffs))
    eer     = float((roc[eer_idx]["far"] + roc[eer_idx]["frr"]) / 2)

    # AUC
    if n_bonafide > 0 and n_attack > 0:
        all_s = np.concatenate([scores[is_bonafide], scores[is_attack]])
        all_l = np.concatenate([np.ones(n_bonafide), np.zeros(n_attack)])
        auc   = float(roc_auc_score(all_l, all_s))
    else:
        auc = 0.0

    calibration = compute_calibration(records) if is_vlm else None
    cost    = compute_cost(records)
    latency = compute_latency(records)

    return {
        "matcher_id":          matcher_id,
        "task_type":           "pad",
        "operating_threshold": op_thresh,
        "overall": {
            "far":        apcer_op,
            "frr":        bpcer_op,
            "eer":        eer,
            "auc":        auc,
            "tar_at_far": {},        # not applicable for PAD (different FAR targets)
        },
        "roc":             roc,
        "by_group":        [],       # PAD samples not demographic-grouped in v2
        "disparity_ratio": None,
        "calibration":     calibration,
        "pad": {
            "apcer":               apcer_op,
            "bpcer":               bpcer_op,
            "acer":                acer_op,
            "operating_threshold": op_thresh,
            "n_bonafide":          n_bonafide,
            "n_attack":            n_attack,
        },
        "cost":            cost,
        "latency_ms":      latency,
    }


# ---------------------------------------------------------------------------
# Disagreement analysis
# ---------------------------------------------------------------------------

def compute_disagreement(
    arcface_records: list[PairRecord],
    vlm_records: list[PairRecord],
    uncertain_band: tuple[float, float],
    n_examples: int = 5,
) -> dict:
    """
    Within pairs where ArcFace score falls in uncertain_band AND VLM also ran,
    count how often VLM got the right label.
    """
    band_lo, band_hi = uncertain_band
    vlm_by_pair = {r.pair_id: r for r in vlm_records}
    arc_in_band = [r for r in arcface_records if band_lo <= r.score <= band_hi]

    in_band_with_vlm = [r for r in arc_in_band if r.pair_id in vlm_by_pair]
    n_in_band = len(in_band_with_vlm)

    vlm_correct = 0
    examples = []
    for arc_rec in in_band_with_vlm:
        vlm_rec = vlm_by_pair[arc_rec.pair_id]
        correct = (vlm_rec.decision and arc_rec.label == "genuine") or \
                  (not vlm_rec.decision and arc_rec.label == "impostor")
        if correct:
            vlm_correct += 1
        if len(examples) < n_examples:
            examples.append({
                "pair_id":       arc_rec.pair_id,
                "arcface_score": arc_rec.score,
                "vlm_decision":  vlm_rec.decision,
                "label":         arc_rec.label,
            })

    return {
        "uncertain_band":      list(uncertain_band),
        "n_in_band":           n_in_band,
        "vlm_correct_in_band": vlm_correct,
        "examples":            examples,
    }


# ---------------------------------------------------------------------------
# IDV extraction metrics (CER, field accuracy, structured F1)
# ---------------------------------------------------------------------------

def char_error_rate(hypothesis: str, reference: str) -> float:
    """
    Character Error Rate = edit_distance(hyp, ref) / len(ref).
    Returns 0.0 if reference is empty. Capped at 1.0 (no negative CER).
    """
    if not reference:
        return 0.0 if not hypothesis else 1.0
    return min(_edit_distance(hypothesis, reference) / len(reference), 1.0)


def _edit_distance(a: str, b: str) -> int:
    """Standard Levenshtein edit distance."""
    if len(a) < len(b):
        a, b = b, a
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for ch_a in a:
        curr = [prev[0] + 1]
        for j, ch_b in enumerate(b):
            curr.append(min(prev[j + 1] + 1, curr[j] + 1, prev[j] + (ch_a != ch_b)))
        prev = curr
    return prev[-1]


def compute_extraction_metrics(
    predictions: list[dict[str, str]],
    ground_truths: list[dict[str, str]],
    fields: list[str],
) -> dict:
    """
    Compute CER, field accuracy, and structured-field F1 over a list of
    (predicted_fields, ground_truth_fields) pairs.

    predictions: list of {field_name: extracted_value} dicts
    ground_truths: list of {field_name: ground_truth_value} dicts
    fields: canonical field list (used for F1 denominator)

    Returns:
      cer           — mean CER across all field values
      field_accuracy — fraction of (doc, field) pairs where extraction is exact-match
      field_f1      — {precision, recall, f1} treating exact-match fields as TP
      per_field     — {field_name: {cer, accuracy}} for each field
    """
    assert len(predictions) == len(ground_truths)

    all_cer: list[float] = []
    exact_matches = 0
    total_fields = 0
    per_field_cer: dict[str, list[float]] = {f: [] for f in fields}
    per_field_exact: dict[str, int] = {f: 0 for f in fields}
    per_field_total: dict[str, int] = {f: 0 for f in fields}

    tp = fp = fn = 0

    for pred, gt in zip(predictions, ground_truths):
        for f in fields:
            gt_val   = (gt.get(f)   or "").strip()
            pred_val = (pred.get(f) or "").strip()

            # Skip fields with no ground truth (can't score them)
            if not gt_val:
                continue

            cer = char_error_rate(pred_val, gt_val)
            per_field_cer[f].append(cer)
            per_field_total[f] += 1
            total_fields += 1
            all_cer.append(cer)

            if pred_val == gt_val:
                exact_matches += 1
                per_field_exact[f] += 1
                tp += 1
            else:
                if pred_val:
                    fp += 1   # extracted something, but wrong
                fn += 1       # missed the correct value

    mean_cer = float(np.mean(all_cer)) if all_cer else 0.0
    field_accuracy = exact_matches / total_fields if total_fields > 0 else 0.0

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    per_field = {}
    for f in fields:
        n = per_field_total[f]
        per_field[f] = {
            "cer":      float(np.mean(per_field_cer[f])) if per_field_cer[f] else 0.0,
            "accuracy": per_field_exact[f] / n if n > 0 else 0.0,
        }

    return {
        "cer":            mean_cer,
        "field_accuracy": field_accuracy,
        "field_f1":       {"precision": precision, "recall": recall, "f1": f1},
        "per_field":      per_field,
    }


# ---------------------------------------------------------------------------
# IDV authenticity metrics (APCER, BPCER, ACER, ROC)
# ---------------------------------------------------------------------------

def compute_doc_auth_metrics(
    decisions: list[bool],
    labels: list[str],
    confidences: list[Optional[float]],
    target_bpcer: float = 0.10,
) -> dict:
    """
    Compute document authenticity metrics from per-document decisions.

    decisions:    list of bools — True = predicted genuine, False = predicted tampered
    labels:       list of "genuine" or "forged" strings
    confidences:  model confidence per doc (may be None for baselines)
    target_bpcer: target bona-fide rejection rate for operating point selection

    Returns: {apcer, bpcer, acer, auc, operating_threshold, roc}
    where operating_threshold is confidence-based (0.5 for binary adapters).
    """
    assert len(decisions) == len(labels)
    n = len(decisions)

    n_genuine = sum(1 for l in labels if l == "genuine")
    n_forged  = sum(1 for l in labels if l == "forged")

    # Binary metrics at the decision threshold (confidence=0.5 for binary adapters)
    apcer = sum(
        1 for d, l in zip(decisions, labels) if l == "forged" and d is True
    ) / n_forged if n_forged > 0 else 0.0

    bpcer = sum(
        1 for d, l in zip(decisions, labels) if l == "genuine" and d is False
    ) / n_genuine if n_genuine > 0 else 0.0

    acer = (apcer + bpcer) / 2

    # ROC over confidence scores (if available).
    # confidence is confidence in the decision, so for forged docs (d=False),
    # P(genuine) = 1 - confidence.
    confs = []
    for c, d in zip(confidences, decisions):
        if c is None:
            confs.append(0.9 if d else 0.1)
        else:
            confs.append(c if d else 1.0 - c)
    label_arr = np.array([1 if l == "genuine" else 0 for l in labels])
    score_arr  = np.array(confs)  # higher = more likely genuine

    auc = 0.0
    if n_genuine > 0 and n_forged > 0:
        try:
            auc = float(roc_auc_score(label_arr, score_arr))
        except Exception:
            auc = 0.0

    # ROC curve for output
    thresholds = np.linspace(score_arr.min(), score_arr.max(), 200)
    roc_curve = []
    for t in thresholds:
        predicted_genuine = score_arr >= t
        apcer_t = float((predicted_genuine[label_arr == 0]).sum() / n_forged) if n_forged > 0 else 0.0
        bpcer_t = float((~predicted_genuine[label_arr == 1]).sum() / n_genuine) if n_genuine > 0 else 0.0
        roc_curve.append({"threshold": float(t), "apcer": apcer_t, "bpcer": bpcer_t})

    return {
        "apcer":               apcer,
        "bpcer":               bpcer,
        "acer":                acer,
        "auc":                 auc,
        "operating_threshold": 0.5,
        "roc":                 roc_curve,
        "n_genuine":           n_genuine,
        "n_forged":            n_forged,
    }


# ---------------------------------------------------------------------------
# Full matcher result block
# ---------------------------------------------------------------------------

def compute_matcher_result(
    records: list[PairRecord],
    matcher_id: str,
    task_type: str,
    target_far: float,
    far_targets: list[float],
    is_vlm: bool,
    pair_groups: dict[str, dict[str, str]] = None,
) -> dict:
    roc = compute_roc(records)
    eer = compute_eer(roc)
    auc = compute_auc(records)
    op_thresh = find_operating_threshold(roc, target_far)
    far_at_op, frr_at_op = at_threshold(records, op_thresh)
    tar_at_far = compute_tar_at_far(records, far_targets, roc)
    if pair_groups:
        by_group, disparity_ratio = compute_by_group_multiaxis(records, pair_groups, op_thresh)
    else:
        by_group, disparity_ratio = compute_by_group(records, op_thresh)
    calibration = compute_calibration(records) if is_vlm else None
    cost = compute_cost(records)
    latency = compute_latency(records)

    return {
        "matcher_id":          matcher_id,
        "task_type":           task_type,
        "operating_threshold": op_thresh,
        "overall": {
            "far":        far_at_op,
            "frr":        frr_at_op,
            "eer":        eer,
            "auc":        auc,
            "tar_at_far": tar_at_far,
        },
        "roc":             roc,
        "by_group":        by_group,
        "disparity_ratio": disparity_ratio,
        "calibration":     calibration,
        "pad":             None,
        "cost":            cost,
        "latency_ms":      latency,
    }
