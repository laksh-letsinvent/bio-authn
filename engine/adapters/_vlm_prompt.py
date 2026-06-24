"""
Shared VLM prompt construction and response parsing.
All three transports (api, local, cli) use the same prompt and parser.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any


_SYSTEM_TEXT = (
    "You are a face-matching expert. Given two face images, decide whether they "
    "show the same person. Respond ONLY with a JSON object — no markdown, no extra text."
)

_USER_TEXT = (
    "Image 1 is the reference face. Image 2 is the probe face.\n"
    "Are they the same person?\n\n"
    'Respond with exactly this JSON and nothing else:\n'
    '{"same_person": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}'
)


def build_prompt_messages(ref_path: str, probe_path: str, transport: str = "api") -> list[dict]:
    """Build Anthropic Messages API message list with inline base64 images."""
    ref_b64   = _b64(ref_path)
    probe_b64 = _b64(probe_path)
    ref_mt    = _media_type(ref_path)
    probe_mt  = _media_type(probe_path)

    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": ref_mt,   "data": ref_b64}},
                {"type": "image", "source": {"type": "base64", "media_type": probe_mt, "data": probe_b64}},
                {"type": "text",  "text": _USER_TEXT},
            ],
        }
    ]


def build_prompt_text() -> str:
    """Plain text prompt for Ollama (images passed separately as base64 list)."""
    return (
        "You are a face-matching expert. Image 1 (first image) is the reference face. "
        "Image 2 (second image) is the probe face.\n"
        "Are they the same person?\n\n"
        "Respond ONLY with this JSON, no other text:\n"
        '{"same_person": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}'
    )


def build_cli_prompt(ref_path: str, probe_path: str) -> str:
    """
    Prompt for Claude Code headless CLI. Claude Code can read image files
    via its Read tool, so we include absolute paths.
    """
    return (
        f"Read the two image files at the paths below, then determine if they show "
        f"the same person.\n\n"
        f"Reference face: {ref_path}\n"
        f"Probe face:     {probe_path}\n\n"
        f"Respond ONLY with this JSON, no markdown, no other text:\n"
        f'{{"same_person": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}}'
    )


def parse_vlm_response(raw: str) -> dict[str, Any]:
    """
    Defensively extract {same_person, confidence, reasoning} from model output.
    Falls back to a safe default (same_person=False, confidence=0.5) on parse failure.
    """
    # Strip markdown code fences if present
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    # Try direct JSON parse
    try:
        data = json.loads(raw)
        return _normalise(data)
    except json.JSONDecodeError:
        pass

    # Try to extract first {...} block
    match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return _normalise(data)
        except json.JSONDecodeError:
            pass

    # Fallback: try keyword sniffing
    same = None
    if re.search(r"\bsame[_\s]person['\"]?\s*:\s*true", raw, re.I):
        same = True
    elif re.search(r"\bsame[_\s]person['\"]?\s*:\s*false", raw, re.I):
        same = False

    conf_match = re.search(r"confidence['\"]?\s*:\s*([0-9.]+)", raw, re.I)
    conf = float(conf_match.group(1)) if conf_match else 0.5

    reason_match = re.search(r'reasoning[\'"]?\s*:\s*[\'"]([^\'"]+)[\'"]', raw, re.I)
    reasoning = reason_match.group(1) if reason_match else "parse error — see raw output"

    return {
        "same_person": same if same is not None else False,
        "confidence":  min(max(conf, 0.0), 1.0),
        "reasoning":   reasoning,
    }


def _normalise(data: dict) -> dict:
    same = bool(data.get("same_person", False))
    conf = float(data.get("confidence", 0.5))
    conf = min(max(conf, 0.0), 1.0)
    return {
        "same_person": same,
        "confidence":  conf,
        "reasoning":   str(data.get("reasoning", "")),
    }


def _b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _media_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {"png": "image/png", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "image/png")
