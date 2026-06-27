"""FastAPI routes: /enroll, /step-up, /users, /events."""
from __future__ import annotations
import base64
import json
import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import db, embedder

router = APIRouter()

# Load operating threshold and band margin from the eval result artifact.
_THRESHOLD = 0.298
_BAND_MARGIN = 0.07

try:
    _data = json.loads(
        (Path(__file__).parent.parent.parent / "results" / "eval_run.json").read_text()
    )
    for _m in _data.get("matchers", []):
        if _m.get("matcher_id") == "arcface":
            _THRESHOLD = _m.get("operating_threshold", _THRESHOLD)
            break
    print(f"[live/routes] Threshold loaded from eval_run.json: {_THRESHOLD:.4f}, band ±{_BAND_MARGIN}")
except Exception as _e:
    print(f"[live/routes] Could not load threshold: {_e}. Using default {_THRESHOLD}.")

RESEARCH_MODE = os.getenv("RESEARCH_MODE", "0") == "1"
VLM_SECOND_OPINION = os.getenv("VLM_SECOND_OPINION", "0") == "1"


class EnrollRequest(BaseModel):
    name: str
    image: str          # data URL: "data:image/jpeg;base64,..."
    liveness_passed: bool = True


class StepUpRequest(BaseModel):
    user_id: str
    image: str
    liveness_passed: bool = True


def _decode_image(data_url: str) -> bytes:
    """Strip data URL header and base64-decode to bytes."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


@router.get("/health")
def health():
    return {"status": "ok", "service": "bio-authN live"}


@router.post("/enroll")
def enroll(req: EnrollRequest):
    t0 = time.perf_counter()
    if not req.name.strip():
        raise HTTPException(400, "Name is required.")
    image_bytes = _decode_image(req.image)
    try:
        emb = embedder.embed_bytes(image_bytes)
    except Exception as e:
        raise HTTPException(422, f"Embedding failed: {e}")

    ref_image = image_bytes if RESEARCH_MODE else None
    user_id = db.create_user(req.name.strip(), emb, ref_image)
    latency_ms = int((time.perf_counter() - t0) * 1000)
    db.log_event(
        user_id=user_id,
        event_type="enroll",
        liveness_passed=req.liveness_passed,
        latency_ms=latency_ms,
    )
    return {"enrolled": True, "user_id": user_id, "name": req.name.strip()}


@router.post("/step-up")
def step_up(req: StepUpRequest):
    t0 = time.perf_counter()
    user = db.get_user(req.user_id)
    if user is None:
        raise HTTPException(404, "User not found. Enrol first.")

    image_bytes = _decode_image(req.image)
    try:
        probe_emb = embedder.embed_bytes(image_bytes)
    except Exception as e:
        raise HTTPException(422, f"Embedding failed: {e}")

    score = embedder.cosine(user["embedding"], probe_emb)
    verified = score >= _THRESHOLD
    band_lo = round(_THRESHOLD - _BAND_MARGIN, 4)
    band_hi = round(_THRESHOLD + _BAND_MARGIN, 4)
    in_band = band_lo <= score <= band_hi

    # VLM second opinion: fires only in band, only when VLM_SECOND_OPINION=1 (stubbed off)
    vlm_result = None
    if in_band and VLM_SECOND_OPINION:
        pass  # TODO: wire VLM adapter

    latency_ms = int((time.perf_counter() - t0) * 1000)
    db.log_event(
        user_id=req.user_id,
        event_type="step_up",
        liveness_passed=req.liveness_passed,
        arcface_score=score,
        arcface_verified=verified,
        threshold=_THRESHOLD,
        in_uncertain_band=in_band,
        latency_ms=latency_ms,
    )

    return {
        "verified": verified,
        "score": round(score, 4),
        "threshold": round(_THRESHOLD, 4),
        "band": [band_lo, band_hi],
        "in_uncertain_band": in_band,
        "liveness_passed": req.liveness_passed,
        "vlm": vlm_result,
        "latency_ms": latency_ms,
    }


@router.get("/users")
def get_users():
    return db.list_users()


@router.get("/events")
def get_events():
    return db.list_events()
