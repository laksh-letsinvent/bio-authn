"""
InsightFace adapter — buffalo_l (w600k_r50), ONNX/CPU, full detection+alignment pipeline.

Difference from ArcFace adapter: attempts face detection at 224×224 (upscaled from
the 112×112 DigiFace-1M input). When the SCRFD detector succeeds, InsightFace's 5-point
alignment produces a different 112×112 crop than ArcFace's direct recognition fallback,
resulting in marginally different embeddings from the same backbone.

For DigiFace-1M synthetic pre-cropped images, detection succeeds on a fraction of images;
both fall back to direct rec on the rest. Scores are highly correlated with ArcFace (same
w600k_r50 backbone), and that correlation itself is a finding — the model-vs-model
infrastructure and ROC overlay are the teaching value regardless.

Embeddings cached separately to corpus/embeddings_insightface.pkl.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import cv2
import numpy as np

from engine.adapters.base import MatcherAdapter, MatchResult

CACHE_PATH = Path(__file__).parent.parent.parent / "corpus" / "embeddings_insightface.pkl"
MODEL_ROOT = str(Path(__file__).parent.parent.parent / "models" / "insightface")

_DEFAULT_THRESHOLD = 0.28


class InsightFaceAdapter(MatcherAdapter):
    matcher_id = "insightface"
    task_type  = "match"

    def __init__(self) -> None:
        self._cache: dict[str, list[float]] = {}
        self._app = None
        self._load_cache()

    def embed(self, image: str) -> list[float]:
        if image not in self._cache:
            self._cache[image] = self._compute_embedding(image)
        return self._cache[image]

    def run(self, reference: str, probe: str) -> MatchResult:
        e_ref   = np.array(self.embed(reference))
        e_probe = np.array(self.embed(probe))
        score   = float(_cosine(e_ref, e_probe))
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

    def precompute_all(self, image_paths: list[str]) -> None:
        missing = [p for p in image_paths if p not in self._cache]
        if not missing:
            print(f"[insightface] All {len(self._cache)} embeddings already cached.")
            return
        self._ensure_app()
        print(f"[insightface] Computing embeddings for {len(missing)} images ...")
        from tqdm import tqdm
        for path in tqdm(missing, desc="InsightFace embed"):
            self._cache[path] = self._compute_embedding(path)
        self._save_cache()
        print(f"[insightface] Cache: {len(self._cache)} entries → {CACHE_PATH}")

    def _ensure_app(self) -> None:
        if self._app is not None:
            return
        import insightface
        self._app = insightface.app.FaceAnalysis(
            name      = "buffalo_l",
            root      = MODEL_ROOT,
            providers = ["CPUExecutionProvider"],
        )
        # 224×224 detection window gives the SCRFD detector a better chance on upscaled
        # 112×112 DigiFace-1M input, producing a different alignment path than ArcFace.
        self._app.prepare(ctx_id=-1, det_size=(224, 224))
        print("[insightface] InsightFace buffalo_l ready (CPU, det=224×224).")

    def _compute_embedding(self, image_path: str) -> list[float]:
        self._ensure_app()
        img_bgr = _load_bgr(image_path)

        # Upscale to 224×224 before detection; better SCRFD anchor coverage.
        img_224 = cv2.resize(img_bgr, (224, 224), interpolation=cv2.INTER_LINEAR)

        try:
            faces = self._app.get(img_224)
        except Exception:
            faces = []

        if faces:
            # Aligned embedding via 5-point landmark → affine crop → recognition.
            return faces[0].embedding.tolist()

        # Fallback: direct recognition on 112×112 (same as ArcFace fallback).
        img_112 = cv2.resize(img_bgr, (112, 112))
        rec = self._app.models.get("recognition")
        if rec is None:
            raise RuntimeError("No recognition model found in buffalo_l.")
        return rec.get_feat([img_112]).flatten().tolist()

    def _load_cache(self) -> None:
        if CACHE_PATH.exists():
            with open(CACHE_PATH, "rb") as f:
                self._cache = pickle.load(f)
            print(f"[insightface] Loaded {len(self._cache)} cached embeddings.")

    def _save_cache(self) -> None:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_PATH, "wb") as f:
            pickle.dump(self._cache, f)


def _load_bgr(image_path: str) -> np.ndarray:
    img = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    return img


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))
