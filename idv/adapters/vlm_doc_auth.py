"""
VLM document authenticity adapter — Claude judges genuine vs tampered.

Same three transports as vlm_extract: local / api / cli.
Returns AuthResult with decision, confidence, and reasoning.

The hypothesis: VLM catches obvious tampering (photo substitution, gross
font inconsistency) and misses subtle forgeries — the same floor-and-ceiling
pattern as selfie liveness. State it as obvious-forgery performance.
"""

from __future__ import annotations

import json
import subprocess
import time

from idv.adapters.base_idv import AuthAdapter, AuthResult
from idv.adapters._idv_prompts import (
    build_auth_messages,
    build_auth_cli_prompt,
    parse_auth_response,
)

MODEL = "claude-opus-4-7"
MAX_TOKENS = 256
TIMEOUT_SECS = 120


class VLMDocAuthAdapter(AuthAdapter):
    adapter_id = "vlm_doc_auth"

    def __init__(self, vlm_mode: str = "cli", skip_permissions: bool = False) -> None:
        self._mode = vlm_mode
        self._skip_permissions = skip_permissions

    def run(self, image_path: str) -> AuthResult:
        start = time.perf_counter()
        if self._mode == "api":
            result = self._run_api(image_path)
        elif self._mode == "cli":
            result = self._run_cli(image_path)
        elif self._mode == "local":
            result = self._run_local(image_path)
        else:
            raise ValueError(f"Unknown vlm_mode: {self._mode!r}")
        result.latency_ms = int((time.perf_counter() - start) * 1000)
        return result

    # ------------------------------------------------------------------
    def _run_api(self, image_path: str) -> AuthResult:
        import anthropic
        client = anthropic.Anthropic()
        messages = build_auth_messages(image_path)
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=(
                "You are a document forensics expert. Examine identity document images "
                "for signs of tampering or forgery. Respond ONLY with a JSON object."
            ),
            messages=messages,
        )
        raw = response.content[0].text
        parsed = parse_auth_response(raw)
        usage = response.usage
        return AuthResult(
            adapter_id=self.adapter_id,
            decision=parsed["genuine"],
            confidence=parsed["confidence"],
            reasoning=parsed.get("reasoning"),
            tokens_in=usage.input_tokens,
            tokens_out=usage.output_tokens,
            cost_usd=_api_cost(usage.input_tokens, usage.output_tokens),
            latency_ms=0,
        )

    def _run_cli(self, image_path: str) -> AuthResult:
        prompt = build_auth_cli_prompt(image_path)
        cmd = ["claude", "-p", prompt, "--output-format", "json"]
        if self._skip_permissions:
            cmd.append("--dangerously-skip-permissions")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_SECS)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"claude CLI timed out after {TIMEOUT_SECS}s")
        except FileNotFoundError:
            raise RuntimeError("'claude' not found in PATH")

        if proc.returncode != 0:
            raise RuntimeError(
                f"claude CLI exit {proc.returncode}\nstderr: {proc.stderr[:400]}"
            )

        cli_json = _parse_cli_stdout(proc.stdout)
        raw = cli_json.get("result", "") or cli_json.get("response", "") or proc.stdout
        cost = _extract_cli_cost(cli_json)
        parsed = parse_auth_response(raw)
        return AuthResult(
            adapter_id=self.adapter_id,
            decision=parsed["genuine"],
            confidence=parsed["confidence"],
            reasoning=parsed.get("reasoning"),
            tokens_in=0,
            tokens_out=0,
            cost_usd=cost,
            latency_ms=0,
        )

    def _run_local(self, image_path: str) -> AuthResult:
        import base64
        try:
            import requests
        except ImportError:
            raise RuntimeError("requests not installed — pip install requests")

        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        prompt = (
            "Examine this identity document for signs of tampering or forgery. "
            "Look for inconsistent fonts, photo substitution, compression artifacts. "
            "Respond ONLY with JSON: "
            '{"genuine": true_or_false, "confidence": 0.0_to_1.0, "reasoning": "one sentence"}'
        )
        payload = {"model": "llava", "prompt": prompt, "images": [img_b64], "stream": False}
        resp = __import__("requests").post(
            "http://localhost:11434/api/generate", json=payload, timeout=TIMEOUT_SECS
        )
        resp.raise_for_status()
        raw = resp.json().get("response", "")
        parsed = parse_auth_response(raw)
        return AuthResult(
            adapter_id=self.adapter_id,
            decision=parsed["genuine"],
            confidence=parsed["confidence"],
            reasoning=parsed.get("reasoning"),
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
