"""
Thin wrapper over InsightFace buffalo_l for bytes-based embedding in the live flow.
Same model as engine/adapters/arcface.py; accepts raw image bytes instead of a file path.
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import cv2
import numpy as np

MODEL_ROOT = str(Path(__file__).parent.parent.parent / "models" / "insightface")

_app = None


def _ensure_app() -> None:
    global _app
    if _app is not None:
        return
    import insightface
    _app = insightface.app.FaceAnalysis(
        name="buffalo_l",
        root=MODEL_ROOT,
        providers=["CPUExecutionProvider"],
    )
    _app.prepare(ctx_id=-1, det_size=(112, 112))
    print("[live/embedder] InsightFace buffalo_l ready.")


def embed_bytes(image_bytes: bytes) -> list[float]:
    """Return 512-d ArcFace embedding from raw JPEG/PNG bytes."""
    _ensure_app()
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image.")
    h, w = img.shape[:2]
    if h < 112 or w < 112:
        img = cv2.resize(img, (112, 112))
    try:
        faces = _app.get(img)
    except Exception:
        faces = []
    if faces:
        return faces[0].embedding.tolist()
    # Fallback: recognition model directly on centre crop (same as arcface adapter)
    img_112 = cv2.resize(img, (112, 112))
    rec = _app.models.get("recognition")
    if rec is None:
        raise RuntimeError("Recognition model not found in buffalo_l pack.")
    return rec.get_feat([img_112]).flatten().tolist()


def cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    return float(np.dot(va, vb) / (na * nb)) if na and nb else 0.0
