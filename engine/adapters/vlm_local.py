"""
VLM adapter — Ollama local transport (LLaVA or similar).

Free, for development. Quality weaker than frontier; do not publish these numbers.
Expects Ollama running at localhost:11434 with a vision-capable model pulled.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

import requests

from engine.adapters.base import MatcherAdapter, MatchResult
from engine.adapters._vlm_prompt import build_prompt_text, parse_vlm_response

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL      = "llava"
TIMEOUT    = 120


class VLMLocalAdapter(MatcherAdapter):
    matcher_id = "vlm_claude"  # same matcher_id — transport is an impl detail
    task_type  = "match"

    def __init__(self, model: str = MODEL, ollama_url: str = OLLAMA_URL) -> None:
        self._model = model
        self._url   = ollama_url

    def run(self, reference: str, probe: str) -> MatchResult:
        ref_b64   = _b64(reference)
        probe_b64 = _b64(probe)
        prompt    = build_prompt_text()

        payload = {
            "model":  self._model,
            "prompt": prompt,
            "images": [ref_b64, probe_b64],
            "stream": False,
            "options": {"temperature": 0},
        }
        try:
            resp = requests.post(self._url, json=payload, timeout=TIMEOUT)
            resp.raise_for_status()
            raw_text = resp.json().get("response", "")
        except Exception as exc:
            raise RuntimeError(f"Ollama request failed: {exc}") from exc

        parsed = parse_vlm_response(raw_text)
        return MatchResult(
            matcher_id = self.matcher_id,
            task_type  = self.task_type,
            score      = float(parsed["confidence"]) if parsed["same_person"] else 1.0 - float(parsed["confidence"]),
            decision   = parsed["same_person"],
            confidence = float(parsed["confidence"]),
            reasoning  = parsed.get("reasoning"),
            tokens_in  = 0,
            tokens_out = 0,
            cost_usd   = 0.0,
            latency_ms = 0,
        )


def _b64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")
