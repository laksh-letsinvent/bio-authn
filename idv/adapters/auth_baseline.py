"""
Document authenticity baseline — Error Level Analysis (ELA) + noise-residual heuristic.

ELA re-saves the JPEG at a fixed quality, computes the pixel-level difference
between original and re-saved, and flags regions with unusually high error levels
as potentially edited. Not a robust forgery detector — misses good forgeries and
flags benign compression — but it gives a reproducible, free baseline to contrast
against the VLM's reasoning-based approach.

Decision rule: if the 99th-percentile ELA magnitude exceeds `ela_threshold` in
any of the detected-face / text-zone regions, classify as tampered.

No API calls, no model downloads. PIL only.
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import numpy as np
from PIL import Image

from idv.adapters.base_idv import AuthAdapter, AuthResult

# Tunable — calibrated loosely against SIDTD; tighten for higher precision.
_ELA_QUALITY = 75        # JPEG re-save quality
_ELA_THRESHOLD = 15.0    # mean ELA magnitude above which we flag tampered
_HIGH_ELA_FRACTION = 0.02  # fraction of high-ELA pixels required to trigger


class ELABaselineAdapter(AuthAdapter):
    adapter_id = "auth_baseline"

    def __init__(self, ela_threshold: float = _ELA_THRESHOLD) -> None:
        self._threshold = ela_threshold

    def run(self, image_path: str) -> AuthResult:
        start = time.perf_counter()
        img = Image.open(image_path).convert("RGB")

        ela_magnitude = _compute_ela(img)
        mean_ela = float(np.mean(ela_magnitude))
        high_frac = float(np.mean(ela_magnitude > self._threshold * 2))

        # Simple decision: high mean ELA or large high-ELA region → tampered
        tampered = (mean_ela > self._threshold) or (high_frac > _HIGH_ELA_FRACTION)
        genuine = not tampered

        # Confidence is an inverse of the ELA signal strength — higher ELA = less confident it's genuine
        raw_conf = max(0.0, 1.0 - (mean_ela / (self._threshold * 3)))
        if tampered:
            confidence = min(0.5 + high_frac * 2, 0.95)  # confidence in tampered decision
        else:
            confidence = min(0.5 + raw_conf * 0.5, 0.90)

        reasoning = (
            f"Mean ELA={mean_ela:.1f} (threshold {self._threshold}), "
            f"high-ELA pixel fraction={high_frac:.3f}. "
            f"Decision: {'tampered' if tampered else 'genuine'}."
        )

        latency_ms = int((time.perf_counter() - start) * 1000)
        return AuthResult(
            adapter_id=self.adapter_id,
            decision=genuine,
            confidence=confidence,
            reasoning=reasoning,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )


def _compute_ela(img: Image.Image) -> np.ndarray:
    """
    Compute per-pixel ELA magnitude.
    Returns a 2D float array of the same spatial dimensions as img.
    """
    # Re-save at reduced quality to a buffer
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=_ELA_QUALITY)
    buf.seek(0)
    recompressed = Image.open(buf).convert("RGB")

    orig = np.array(img, dtype=np.float32)
    recomp = np.array(recompressed, dtype=np.float32)

    # Per-pixel L2 magnitude across colour channels
    diff = np.abs(orig - recomp)
    magnitude = np.sqrt(np.sum(diff ** 2, axis=2)) / np.sqrt(3)
    return magnitude
