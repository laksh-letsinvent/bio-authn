"""
VLM extraction adapter — Claude reads a document image and returns structured fields.

Supports three transports via vlm_mode config:
  local  — Ollama LLaVA (free, dev; limited vision quality)
  api    — Anthropic Messages API (requires ANTHROPIC_API_KEY)
  cli    — Claude Code headless CLI (no key; uses claude CLI auth)

The headline hypothesis: VLM beats Tesseract OCR on real document layouts.
"""

from __future__ import annotations

import json
import subprocess
import time
from typing import Any

from idv.adapters.base_idv import ExtractionAdapter, ExtractionResult
from idv.adapters._idv_prompts import (
    build_extract_messages,
    build_extract_cli_prompt,
    parse_extract_response,
    _AUTH_SYSTEM,
)

MODEL = "claude-opus-4-7"
MAX_TOKENS = 512
TIMEOUT_SECS = 120


class VLMExtractAdapter(ExtractionAdapter):
    adapter_id = "vlm_extract"

    def __init__(self, vlm_mode: str = "cli", skip_permissions: bool = False) -> None:
        self._mode = vlm_mode
        self._skip_permissions = skip_permissions

    def run(self, image_path: str, fields: list[str]) -> ExtractionResult:
        start = time.perf_counter()
        if self._mode == "api":
            result = self._run_api(image_path, fields)
        elif self._mode == "cli":
            result = self._run_cli(image_path, fields)
        elif self._mode == "local":
            result = self._run_local(image_path, fields)
        else:
            raise ValueError(f"Unknown vlm_mode: {self._mode!r}")
        result.latency_ms = int((time.perf_counter() - start) * 1000)
        return result

    # ------------------------------------------------------------------
    def _run_api(self, image_path: str, fields: list[str]) -> ExtractionResult:
        import anthropic
        client = anthropic.Anthropic()
        messages = build_extract_messages(image_path, fields)
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system="You are an identity document reading expert. Extract the requested fields exactly as printed. Return ONLY a JSON object — no markdown, no extra text.",
            messages=messages,
        )
        raw = response.content[0].text
        extracted = parse_extract_response(raw, fields)
        usage = response.usage
        return ExtractionResult(
            adapter_id=self.adapter_id,
            fields=extracted,
            raw_text=raw,
            tokens_in=usage.input_tokens,
            tokens_out=usage.output_tokens,
            cost_usd=_api_cost(usage.input_tokens, usage.output_tokens),
            latency_ms=0,
        )

    def _run_cli(self, image_path: str, fields: list[str]) -> ExtractionResult:
        prompt = build_extract_cli_prompt(image_path, fields)
        cmd = ["claude", "-p", prompt, "--output-format", "json"]
        if self._skip_permissions:
            cmd.append("--dangerously-skip-permissions")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_SECS)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"claude CLI timed out after {TIMEOUT_SECS}s")
        except FileNotFoundError:
            raise RuntimeError("'claude' not found in PATH — is Claude Code installed?")

        if proc.returncode != 0:
            raise RuntimeError(
                f"claude CLI exit {proc.returncode}\nstderr: {proc.stderr[:400]}\nstdout: {proc.stdout[:400]}"
            )

        cli_json = _parse_cli_stdout(proc.stdout)
        raw = cli_json.get("result", "") or cli_json.get("response", "") or proc.stdout
        cost = _extract_cli_cost(cli_json)
        extracted = parse_extract_response(raw, fields)
        return ExtractionResult(
            adapter_id=self.adapter_id,
            fields=extracted,
            raw_text=raw,
            tokens_in=0,
            tokens_out=0,
            cost_usd=cost,
            latency_ms=0,
        )

    def _run_local(self, image_path: str, fields: list[str]) -> ExtractionResult:
        import base64
        try:
            import requests
        except ImportError:
            raise RuntimeError("requests not installed — pip install requests")

        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        fields_str = ", ".join(f'"{f}"' for f in fields)
        field_template = ", ".join(f'"{f}": "value"' for f in fields)
        prompt = (
            f"Extract these fields from the identity document: {fields_str}. "
            f"Use the exact value as printed. Empty string if not visible. "
            f"Respond ONLY with JSON: {{{field_template}}}"
        )
        payload = {"model": "llava", "prompt": prompt, "images": [img_b64], "stream": False}
        resp = requests.post("http://localhost:11434/api/generate", json=payload, timeout=TIMEOUT_SECS)
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        extracted = parse_extract_response(raw, fields)
        return ExtractionResult(
            adapter_id=self.adapter_id,
            fields=extracted,
            raw_text=raw,
            tokens_in=0,
            tokens_out=0,
            cost_usd=0.0,
            latency_ms=0,
        )


# ---------------------------------------------------------------------------
def _api_cost(tokens_in: int, tokens_out: int) -> float:
    return (tokens_in * 15 + tokens_out * 75) / 1_000_000


def _parse_cli_stdout(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        return {}
    start = text.find("{")
    if start == -1:
        return {"result": text}
    try:
        return json.loads(text[start:])
    except json.JSONDecodeError:
        return {"result": text}


def _extract_cli_cost(cli_json: dict) -> float:
    for key in ("cost_usd", "total_cost_usd"):
        if key in cli_json:
            try:
                return float(cli_json[key])
            except (TypeError, ValueError):
                pass
    return 0.0
