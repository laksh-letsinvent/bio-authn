"""
OCR baseline adapter — Tesseract via pytesseract.

Runs page-segmentation mode 6 (single block) for full-document extraction,
then applies field-name heuristics to map raw text to the requested fields.
For MRZ lines, uses a separate pass with OSD disabled (PSM 6) and the eng
character whitelist for the MRZ charset.

This is the baseline the VLM is expected to beat on real document layouts.
Tesseract 5.5+ required; pytesseract Python wrapper required.
"""

from __future__ import annotations

import re
import time

from idv.adapters.base_idv import ExtractionAdapter, ExtractionResult

_MRZ_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"

# Simple heuristics: patterns for common fields in printed documents.
# Exact layout varies — this is the weak point OCR-based extraction has vs VLM.
_FIELD_PATTERNS: dict[str, list[str]] = {
    "surname":       [r"surname[:\s]+([A-Z][A-Za-z\-]+)", r"last\s*name[:\s]+([A-Z][A-Za-z\-]+)"],
    "given_names":   [r"given\s*names?[:\s]+([A-Z][A-Za-z\s\-]+)", r"first\s*name[:\s]+([A-Z][A-Za-z\-]+)"],
    "dob":           [r"(?:date\s*of\s*birth|dob|born)[:\s]+(\d{1,2}[\s./\-]\w+[\s./\-]\d{2,4})"],
    "doc_number":    [r"(?:document|passport|licence|id)\s*(?:no|number|num)[.:\s]+([A-Z0-9]{6,12})", r"\bNo\.?\s+([A-Z0-9]{6,12})\b"],
    "expiry":        [r"(?:expiry|expiration|expires?|valid\s*until)[:\s]+(\d{1,2}[\s./\-]\w+[\s./\-]\d{2,4})"],
    "nationality":   [r"nationality[:\s]+([A-Za-z]+)"],
    "sex":           [r"\bsex[:\s]+([MFmf])\b", r"\bgender[:\s]+([A-Za-z]+)"],
    "issue_date":    [r"(?:date\s*of\s*issue|issued)[:\s]+(\d{1,2}[\s./\-]\w+[\s./\-]\d{2,4})"],
    "issuing_state": [r"(?:issuing\s*state|authority|issued\s*by)[:\s]+([A-Za-z\s]+)"],
    "mrz_line1":     [],  # handled separately
    "mrz_line2":     [],
}


class OCRBaselineAdapter(ExtractionAdapter):
    adapter_id = "ocr_baseline"

    def __init__(self) -> None:
        try:
            import pytesseract
            self._tess = pytesseract
        except ImportError:
            raise RuntimeError("pytesseract not installed — run: pip install pytesseract")
        # Verify binary
        try:
            self._tess.get_tesseract_version()
        except Exception as e:
            raise RuntimeError(f"Tesseract binary not found: {e}")

    def run(self, image_path: str, fields: list[str]) -> ExtractionResult:
        from PIL import Image

        start = time.perf_counter()
        img = Image.open(image_path).convert("RGB")

        # Full-page OCR
        raw_text = self._tess.image_to_string(img, config="--psm 6")

        # MRZ-specific pass: bottom strip, restrict to MRZ charset
        mrz_raw = ""
        if any(f.startswith("mrz") for f in fields):
            width, height = img.size
            mrz_strip = img.crop((0, int(height * 0.75), width, height))
            mrz_config = f"--psm 6 -c tessedit_char_whitelist={_MRZ_CHARSET}"
            mrz_raw = self._tess.image_to_string(mrz_strip, config=mrz_config)

        extracted = {}
        for f in fields:
            if f == "mrz_line1":
                extracted[f] = _extract_mrz_line(mrz_raw, 0)
            elif f == "mrz_line2":
                extracted[f] = _extract_mrz_line(mrz_raw, 1)
            else:
                extracted[f] = _extract_field(f, raw_text)

        latency_ms = int((time.perf_counter() - start) * 1000)
        return ExtractionResult(
            adapter_id=self.adapter_id,
            fields=extracted,
            raw_text=raw_text,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            latency_ms=latency_ms,
        )


def _extract_field(field_name: str, text: str) -> str:
    patterns = _FIELD_PATTERNS.get(field_name, [])
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE | re.MULTILINE)
        if m:
            return m.group(1).strip()
    return ""


def _extract_mrz_line(mrz_raw: str, line_index: int) -> str:
    """Extract MRZ lines from the MRZ-restricted OCR pass."""
    lines = [
        ln.strip()
        for ln in mrz_raw.splitlines()
        if len(ln.strip()) >= 30 and re.match(r"^[A-Z0-9<]+$", ln.strip())
    ]
    if line_index < len(lines):
        return lines[line_index]
    return ""
