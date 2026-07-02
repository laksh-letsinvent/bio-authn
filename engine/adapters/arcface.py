"""
ArcFace adapter — InsightFace buffalo_l, ONNX/CPU (no TensorFlow).

Uses insightface.app.FaceAnalysis with the buffalo_l pack:
  - w600k_r50.onnx  → 512-d ArcFace embedding
  - det_10g.onnx    → face detector (handles the full image as input)

DigiFace-1M images are RGBA (4-channel PNG). We convert BGRA→BGR before
passing to InsightFace, which expects 3-channel BGR.

Embeddings are computed once and cached to corpus/embeddings_arcface.pkl.
The ~9,750 pairwise comparisons are then pure cosine ops in memory.
"""

from __future__ import annotations

import pickle
from pathlib import Path

import cv2
import numpy as np

from engine.adapters.base import MatcherAdapter, MatchResult

CACHE_PATH   = Path(__file__).parent.parent.parent / "corpus" / "embeddings_arcface.pkl"
MODEL_ROOT   = str(Path(__file__).parent.parent.parent / "models" / "insightface")

# Cosine similarity threshold for ArcFace's own naive decision.
# buffalo_l scores are L2-normalised; 0.28 ≈ EER on LFW for this model.
# The harness overrides this with its tuned threshold; this is just the adapter's call.
_ARCFACE_DEFAULT_THRESHOLD = 0.28


class ArcFaceAdapter(MatcherAdapter):
    matcher_id = "arcface"
    task_type  = "match"

    def __init__(self) -> None:
        self._cache: dict[str, list[float]] = {}
        self._app = None           # lazy-loaded on first embed() call
        self._load_cache()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def embed(self, image: str) -> list[float]:
        """Return cached 512-d ArcFace embedding, computing on first call."""
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
            decision   = score >= _ARCFACE_DEFAULT_THRESHOLD,
            confidence = None,
            reasoning  = None,
            tokens_in  = 0,
            tokens_out = 0,
            cost_usd   = 0.0,
            latency_ms = 0,
        )

    def precompute_all(self, image_paths: list[str]) -> None:
        """Batch-compute and cache all embeddings before the main eval loop."""
        missing = [p for p in image_paths if p not in self._cache]
        if not missing:
            print(f"[arcface] All {len(self._cache)} embeddings already cached.")
            return
        self._ensure_app()
        print(f"[arcface] Computing embeddings for {len(missing)} images ...")
        from tqdm import tqdm
        for path in tqdm(missing, desc="ArcFace embed"):
            self._cache[path] = self._compute_embedding(path)
        self._save_cache()
        print(f"[arcface] Cache: {len(self._cache)} entries → {CACHE_PATH}")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _ensure_app(self) -> None:
        if self._app is not None:
            return
        import insightface
        self._app = insightface.app.FaceAnalysis(
            name      = "buffalo_l",
            root      = MODEL_ROOT,
            providers = ["CPUExecutionProvider"],
        )
        # det_size=(640,640): works for full-frame card images (640×400). DigiFace
        # selfies (112×112) still fall through to the direct-recognition fallback below.
        self._app.prepare(ctx_id=-1, det_size=(640, 640))
        print("[arcface] InsightFace buffalo_l ready (CPU).")

    def _compute_embedding(self, image_path: str) -> list[float]:
        """
        Load image, flatten RGBA→BGR, run InsightFace detection + ArcFace embedding.
        Falls back to direct recognition model if no face is detected.
        """
        self._ensure_app()
        img = _load_bgr(image_path)

        # Detector may fail on 112×112 input (SCRFD anchor math requires larger images).
        # DigiFace images are pre-cropped faces, so the fallback path is the norm.
        try:
            faces = self._app.get(img)
        except Exception:
            faces = []
        if faces:
            emb = faces[0].embedding          # already L2-normalised by buffalo_l
            return emb.tolist()

        # Fallback: run recognition model directly on pre-cropped face.
        img_112 = cv2.resize(img, (112, 112))
        rec = self._app.models.get("recognition")
        if rec is None:
            raise RuntimeError("No recognition model found in buffalo_l.")
        emb = rec.get_feat([img_112]).flatten()
        return emb.tolist()

    def _load_cache(self) -> None:
        if CACHE_PATH.exists():
            with open(CACHE_PATH, "rb") as f:
                self._cache = pickle.load(f)
            print(f"[arcface] Loaded {len(self._cache)} cached embeddings.")

    def _save_cache(self) -> None:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_PATH, "wb") as f:
            pickle.dump(self._cache, f)


# ---------------------------------------------------------------------------
# Helpers (also imported by corpus/build_corpus.py for consistent image loading)
# ---------------------------------------------------------------------------

def _load_bgr(image_path: str) -> np.ndarray:
    """Load image file and ensure it is 3-channel BGR (handles RGBA PNGs)."""
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
