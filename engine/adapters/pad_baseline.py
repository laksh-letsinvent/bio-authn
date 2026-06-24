"""
PAD baseline adapter — frequency/texture detector.

Two features combined into a liveness score (higher = more live):

  1. FFT high-frequency energy ratio: genuine faces retain richer high-spatial-frequency
     texture than print attacks (blurred by scan optics, smoothed by halftone) or screen
     replays (filtered by LCD panel + secondary lens).

  2. Local texture variance: genuine faces have higher local standard deviation (pores,
     fine skin texture) than attack artifacts (smoother surfaces).

No outbound calls. Deterministic. Runs in < 10 ms per image.
"""

from __future__ import annotations

import cv2
import numpy as np

from engine.adapters.base import MatcherAdapter, MatchResult

_DEFAULT_THRESHOLD = 0.5


class PADBaselineAdapter(MatcherAdapter):
    matcher_id = "pad_baseline"
    task_type  = "pad"

    def run(self, reference, probe: str) -> MatchResult:
        score = _liveness_score(probe)
        return MatchResult(
            matcher_id = self.matcher_id,
            task_type  = self.task_type,
            score      = score,
            decision   = score >= _DEFAULT_THRESHOLD,
            confidence = None,
            reasoning  = None,
            tokens_in  = 0,
            tokens_out = 0,
            cost_usd   = 0.0,
            latency_ms = 0,
        )


def _liveness_score(image_path: str) -> float:
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read: {image_path}")
    if img.ndim == 2:
        gray = img.astype(np.float32)
    elif img.shape[2] == 4:
        gray = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGRA2BGR), cv2.COLOR_BGR2GRAY).astype(np.float32)
    else:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)

    fft_score     = _fft_hf_score(gray)
    texture_score = _local_variance_score(gray)
    return float(np.clip(0.6 * fft_score + 0.4 * texture_score, 0.0, 1.0))


def _fft_hf_score(gray: np.ndarray) -> float:
    """
    Fraction of FFT power in the outer 50% of spatial frequencies, scaled to [0, 1].
    Genuine faces (~0.92–0.98 HF fraction) score higher than attacks (~0.82–0.94).
    """
    f       = np.fft.fft2(gray)
    fshift  = np.fft.fftshift(f)
    mag     = np.abs(fshift) ** 2
    total   = mag.sum()
    if total == 0:
        return 0.5

    h, w = gray.shape
    cy, cx = h // 2, w // 2
    # Inner square = low-freq region (inner 50% of each axis)
    r = min(h, w) // 4
    low_freq = mag[cy - r:cy + r, cx - r:cx + r].sum()
    hf_ratio = float((total - low_freq) / total)

    # Linear rescale: 0.85 → 0.0, 0.97 → 1.0
    score = (hf_ratio - 0.85) / 0.12
    return float(np.clip(score, 0.0, 1.0))


def _local_variance_score(gray: np.ndarray) -> float:
    """
    Mean local std in 7×7 windows. Genuine faces score higher (more micro-texture).
    Calibrated: genuine ~10–30, attacks ~4–15. Linear: 4.0 → 0.0, 24.0 → 1.0.
    """
    # Residual from Gaussian blur ≈ local variation
    blur     = cv2.GaussianBlur(gray, (7, 7), 0)
    residual = gray - blur
    mean_std = float(np.sqrt(np.mean(residual ** 2)))

    score = (mean_std - 4.0) / 20.0
    return float(np.clip(score, 0.0, 1.0))
