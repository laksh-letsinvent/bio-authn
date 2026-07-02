"""
Shared prompt builders and response parsers for IDV VLM adapters.
Mirrors engine/adapters/_vlm_prompt.py — same pattern, different tasks.
"""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Extraction prompts
# ---------------------------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You are an identity document reading expert. Extract the requested fields "
    "from the document image exactly as printed. Return ONLY a JSON object — "
    "no markdown, no extra text."
)


def build_extract_messages(image_path: str, fields: list[str]) -> list[dict]:
    """Anthropic Messages API format — inline base64 image."""
    img_b64 = _b64(image_path)
    mt = _media_type(image_path)
    fields_str = ", ".join('"' + f + '"' for f in fields)
    field_template = ", ".join('"' + f + '": "value"' for f in fields)
    user_text = (
        "Extract these fields from the identity document: " + fields_str + ".\n\n"
        "Rules:\n"
        "- Use the exact value as printed on the document.\n"
        "- For MRZ fields, strip filler characters (<).\n"
        "- If a field is not visible or not present, use an empty string.\n"
        "- Do not invent or hallucinate values.\n\n"
        "Respond with ONLY this JSON structure and nothing else:\n"
        "{" + field_template + "}"
    )
    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mt, "data": img_b64}},
                {"type": "text", "text": user_text},
            ],
        }
    ]


def build_extract_cli_prompt(image_path: str, fields: list[str]) -> str:
    """CLI prompt — Claude Code reads the image file via its Read tool."""
    fields_str = ", ".join(f'"{f}"' for f in fields)
    field_template = ", ".join(f'"{f}": "value"' for f in fields)
    return (
        f"Read the identity document image at: {image_path}\n\n"
        f"Extract these fields: {fields_str}\n\n"
        f"Rules:\n"
        f"- Use the exact value as printed on the document.\n"
        f"- For MRZ fields, strip filler characters (<).\n"
        f"- If a field is not visible or not present, use an empty string.\n"
        f"- Do not invent or hallucinate values.\n\n"
        f"Respond with ONLY this JSON and nothing else:\n"
        f"{{{field_template}}}"
    )


def parse_extract_response(raw: str, fields: list[str]) -> dict[str, str]:
    """Parse VLM extraction response. Falls back to empty strings on failure."""
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    try:
        data = json.loads(raw)
        return {f: str(data.get(f, "")) for f in fields}
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return {f: str(data.get(f, "")) for f in fields}
        except json.JSONDecodeError:
            pass

    # Last resort: field-by-field regex
    result = {}
    for f in fields:
        m = re.search(rf'"{re.escape(f)}"\s*:\s*"([^"]*)"', raw)
        result[f] = m.group(1) if m else ""
    return result


# ---------------------------------------------------------------------------
# Authenticity prompts
# ---------------------------------------------------------------------------

_AUTH_SYSTEM = (
    "You are a document forensics expert. Examine the identity document image "
    "for signs of tampering, forgery, or digital manipulation. "
    "Respond ONLY with a JSON object — no markdown, no extra text."
)

_AUTH_USER = (
    "Examine this identity document for signs of tampering or forgery.\n\n"
    "Look for:\n"
    "- Inconsistent fonts, spacing, or alignment in text fields\n"
    "- Photo substitution or photo edges showing manipulation\n"
    "- Unusual compression artifacts or noise patterns in specific regions\n"
    "- Mismatched security feature appearance (holograms, guilloche)\n"
    "- MRZ/VIZ field inconsistencies\n\n"
    "Respond with ONLY this JSON:\n"
    '{"genuine": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one or two sentences naming specific evidence"}'
)


def build_auth_messages(image_path: str) -> list[dict]:
    """Anthropic Messages API format — inline base64 image."""
    img_b64 = _b64(image_path)
    mt = _media_type(image_path)
    return [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mt, "data": img_b64}},
                {"type": "text", "text": _AUTH_USER},
            ],
        }
    ]


def build_auth_cli_prompt(image_path: str) -> str:
    """CLI prompt — Claude Code reads the image file via its Read tool."""
    return (
        f"Read the identity document image at: {image_path}\n\n"
        f"Examine it for signs of tampering or forgery.\n\n"
        f"Look for:\n"
        f"- Inconsistent fonts, spacing, or alignment in text fields\n"
        f"- Photo substitution or photo edges showing manipulation\n"
        f"- Unusual compression artifacts or noise patterns in specific regions\n"
        f"- Mismatched security feature appearance\n"
        f"- MRZ/VIZ field inconsistencies\n\n"
        f"Respond with ONLY this JSON and nothing else:\n"
        f'{{"genuine": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one or two sentences naming specific evidence"}}'
    )


def parse_auth_response(raw: str) -> dict[str, Any]:
    """Parse VLM authenticity response. Falls back to safe default on failure."""
    raw = re.sub(r"```(?:json)?", "", raw).strip()

    try:
        data = json.loads(raw)
        return _normalise_auth(data)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group())
            return _normalise_auth(data)
        except json.JSONDecodeError:
            pass

    genuine = None
    if re.search(r'"genuine"\s*:\s*true', raw, re.I):
        genuine = True
    elif re.search(r'"genuine"\s*:\s*false', raw, re.I):
        genuine = False

    conf_m = re.search(r'"confidence"\s*:\s*([0-9.]+)', raw, re.I)
    conf = float(conf_m.group(1)) if conf_m else 0.5

    reason_m = re.search(r'"reasoning"\s*:\s*"([^"]+)"', raw, re.I)
    reasoning = reason_m.group(1) if reason_m else "parse error — see raw output"

    return {"genuine": genuine if genuine is not None else True, "confidence": conf, "reasoning": reasoning}


def _normalise_auth(data: dict) -> dict:
    genuine = bool(data.get("genuine", True))
    conf = float(data.get("confidence", 0.5))
    conf = min(max(conf, 0.0), 1.0)
    return {"genuine": genuine, "confidence": conf, "reasoning": str(data.get("reasoning", ""))}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _b64(path: str) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _media_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(ext, "image/jpeg")
