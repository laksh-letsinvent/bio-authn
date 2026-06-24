"""
PAD VLM prompt and response parser.

Single-image passive liveness prompt for all three transports (api, cli, local).
Symmetric to _vlm_prompt.py but for task_type="pad".
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

_USER_TEXT = (
    "Examine this face image carefully. Determine whether it shows a LIVE PERSON or a "
    "PRESENTATION ATTACK (printed photograph or screen/video replay).\n\n"
    "Look for:\n"
    "- Print attack: moiré patterns, flat texture, paper grain, warm yellow-orange cast, "
    "loss of pore-level depth\n"
    "- Screen replay: horizontal scan lines, bezel edges, blue-cool LED tint, specular "
    "glare patch, screen-door grid\n"
    "- Genuine live face: natural skin texture with pores, micro-shadows, 3D depth cues, "
    "neutral colour temperature\n\n"
    "Respond ONLY with this JSON and nothing else:\n"
    '{"live": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}'
)


def build_prompt_messages(probe_path: str) -> list[dict]:
    """Anthropic Messages API: single image + liveness prompt."""
    probe_b64 = _b64(probe_path)
    probe_mt  = _media_type(probe_path)
    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": probe_mt, "data": probe_b64}},
                {"type": "text",  "text": _USER_TEXT},
            ],
        }
    ]


def build_cli_prompt(probe_path: str) -> str:
    return (
        f"Read the face image at: {probe_path}\n\n"
        f"Determine whether it shows a live person or a presentation attack "
        f"(printed photo or screen replay).\n\n"
        f"Look for:\n"
        f"- Print attack: moiré patterns, flat texture, paper grain, warm yellow-orange cast\n"
        f"- Screen replay: scan lines, bezel edges, blue-cool tint, specular glare patch\n"
        f"- Genuine live face: natural pores, micro-shadows, 3D depth cues\n\n"
        f"Respond ONLY with this JSON, no markdown, no other text:\n"
        f'{{"live": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}}'
    )


def build_local_prompt() -> str:
    return (
        "Is this face image a live person or a presentation attack "
        "(printed photo or screen replay)?\n"
        "Respond ONLY with this JSON:\n"
        '{"live": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}'
    )


def parse_pad_response(raw: str) -> dict[str, Any]:
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    try:
        return _normalise(json.loads(raw))
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
    if match:
        try:
            return _normalise(json.loads(match.group()))
        except json.JSONDecodeError:
            pass

    # Keyword sniff fallback
    live = None
    if re.search(r'\blive[\'"]?\s*:\s*true', raw, re.I):
        live = True
    elif re.search(r'\blive[\'"]?\s*:\s*false', raw, re.I):
        live = False
    conf_m = re.search(r"confidence['\"]?\s*:\s*([0-9.]+)", raw, re.I)
    conf   = float(conf_m.group(1)) if conf_m else 0.5
    r_m    = re.search(r'reasoning[\'"]?\s*:\s*[\'"]([^\'"]+)[\'"]', raw, re.I)
    return {
        "live":       live if live is not None else False,
        "confidence": min(max(conf, 0.0), 1.0),
        "reasoning":  r_m.group(1) if r_m else "parse error",
    }


def _normalise(data: dict) -> dict:
    live = bool(data.get("live", False))
    conf = min(max(float(data.get("confidence", 0.5)), 0.0), 1.0)
    return {"live": live, "confidence": conf, "reasoning": str(data.get("reasoning", ""))}


def _b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _media_type(path: str) -> str:
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(
        Path(path).suffix.lower(), "image/png"
    )
