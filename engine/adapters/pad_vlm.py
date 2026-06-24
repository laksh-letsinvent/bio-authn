"""
PAD VLM adapter — Claude passive-liveness prompt, three transports.

Single-image input: reference=None, probe=image_path (the liveness sample).
Same transport selection as the matching VLM adapters (api | cli | local).

Liveness score mapping:
  live=True,  confidence=0.8  →  score = 0.8   (confident live)
  live=False, confidence=0.8  →  score = 0.2   (confident attack → low liveness)
"""

from __future__ import annotations

import json
import subprocess

from engine.adapters.base import MatcherAdapter, MatchResult
from engine.adapters._pad_vlm_prompt import (
    build_prompt_messages, build_cli_prompt, build_local_prompt, parse_pad_response,
)

MODEL      = "claude-opus-4-7"
MAX_TOKENS = 256
TIMEOUT    = 120
CLAUDE_BIN = "claude"


class PADVLMApiAdapter(MatcherAdapter):
    matcher_id = "pad_vlm"
    task_type  = "pad"

    def __init__(self) -> None:
        import anthropic
        self._client = anthropic.Anthropic()

    def run(self, reference, probe: str) -> MatchResult:
        messages = build_prompt_messages(probe)
        response = self._client.messages.create(
            model=MODEL, max_tokens=MAX_TOKENS, messages=messages,
        )
        raw  = response.content[0].text
        parsed = parse_pad_response(raw)
        usage  = response.usage
        # Claude Opus 4.7 pricing: $15/M input, $75/M output
        cost = (usage.input_tokens * 15 + usage.output_tokens * 75) / 1_000_000
        return _to_result(parsed, usage.input_tokens, usage.output_tokens, cost)


class PADVLMCLIAdapter(MatcherAdapter):
    matcher_id = "pad_vlm"
    task_type  = "pad"

    def __init__(self, skip_permissions: bool = False) -> None:
        self._skip = skip_permissions

    def run(self, reference, probe: str) -> MatchResult:
        prompt = build_cli_prompt(probe)
        cmd    = [CLAUDE_BIN, "-p", prompt, "--output-format", "json"]
        if self._skip:
            cmd.append("--dangerously-skip-permissions")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"claude CLI timed out after {TIMEOUT}s")
        except FileNotFoundError:
            raise RuntimeError("'claude' not found in PATH — is Claude Code installed?")
        if proc.returncode != 0:
            raise RuntimeError(
                f"claude CLI returned {proc.returncode}.\nstderr: {proc.stderr[:300]}"
            )
        cli_json    = _parse_cli_stdout(proc.stdout)
        model_text  = cli_json.get("result", "") or cli_json.get("response", "")
        cost        = _extract_cost(cli_json)
        parsed      = parse_pad_response(model_text)
        return _to_result(parsed, 0, 0, cost)


class PADVLMLocalAdapter(MatcherAdapter):
    matcher_id = "pad_vlm"
    task_type  = "pad"

    def __init__(self, model: str = "llava") -> None:
        self._model = model

    def run(self, reference, probe: str) -> MatchResult:
        import base64
        import requests as req_lib

        with open(probe, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        resp = req_lib.post(
            "http://localhost:11434/api/generate",
            json={"model": self._model, "prompt": build_local_prompt(), "images": [b64], "stream": False},
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        parsed = parse_pad_response(resp.json().get("response", ""))
        return _to_result(parsed, 0, 0, 0.0)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _to_result(parsed: dict, tokens_in: int, tokens_out: int, cost_usd: float) -> MatchResult:
    live  = parsed["live"]
    conf  = float(parsed["confidence"])
    # Liveness score: high = live, low = attack
    score = conf if live else 1.0 - conf
    return MatchResult(
        matcher_id = "pad_vlm",
        task_type  = "pad",
        score      = score,
        decision   = live,
        confidence = conf,
        reasoning  = parsed.get("reasoning"),
        tokens_in  = tokens_in,
        tokens_out = tokens_out,
        cost_usd   = cost_usd,
        latency_ms = 0,
    )


def _parse_cli_stdout(stdout: str) -> dict:
    text  = stdout.strip()
    start = text.find("{")
    if start == -1:
        return {"result": text}
    try:
        return json.loads(text[start:])
    except json.JSONDecodeError:
        return {"result": text}


def _extract_cost(cli_json: dict) -> float:
    for key in ("cost_usd", "total_cost_usd"):
        if key in cli_json:
            try:
                return float(cli_json[key])
            except (TypeError, ValueError):
                pass
    return 0.0
