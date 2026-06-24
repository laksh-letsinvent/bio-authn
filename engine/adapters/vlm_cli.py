"""
VLM adapter — Claude Code headless CLI transport.

Shells out to: claude -p "<prompt>" --output-format json [--dangerously-skip-permissions]
No API key required; uses the user's Claude Code auth.

Trade-off: per-call agent spin-up adds ~2-5s latency vs raw API. Note this in writeups.
"""

from __future__ import annotations

import json
import shlex
import subprocess
from typing import Any

from engine.adapters.base import MatcherAdapter, MatchResult
from engine.adapters._vlm_prompt import build_cli_prompt, parse_vlm_response

CLAUDE_BIN     = "claude"
TIMEOUT_SECS   = 120


class VLMCLIAdapter(MatcherAdapter):
    matcher_id = "vlm_claude"  # same matcher_id — transport is an impl detail
    task_type  = "match"

    def __init__(self, skip_permissions: bool = False) -> None:
        self._skip_permissions = skip_permissions

    def run(self, reference: str, probe: str) -> MatchResult:
        prompt = build_cli_prompt(reference, probe)
        cmd    = [CLAUDE_BIN, "-p", prompt, "--output-format", "json"]
        if self._skip_permissions:
            cmd.append("--dangerously-skip-permissions")

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECS,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"claude CLI timed out after {TIMEOUT_SECS}s")
        except FileNotFoundError:
            raise RuntimeError("'claude' not found in PATH — is Claude Code installed?")

        if proc.returncode != 0:
            raise RuntimeError(
                f"claude CLI returned exit code {proc.returncode}.\n"
                f"stderr: {proc.stderr[:500]}\n"
                f"stdout: {proc.stdout[:500]}"
            )

        cli_json = _parse_cli_stdout(proc.stdout)
        model_answer = cli_json.get("result", "") or cli_json.get("response", "")
        cost_usd = _extract_cost(cli_json)

        parsed = parse_vlm_response(model_answer)
        return MatchResult(
            matcher_id = self.matcher_id,
            task_type  = self.task_type,
            score      = float(parsed["confidence"]) if parsed["same_person"] else 1.0 - float(parsed["confidence"]),
            decision   = parsed["same_person"],
            confidence = float(parsed["confidence"]),
            reasoning  = parsed.get("reasoning"),
            tokens_in  = 0,
            tokens_out = 0,
            cost_usd   = cost_usd,
            latency_ms = 0,
        )


def _parse_cli_stdout(stdout: str) -> dict:
    """Parse claude CLI JSON output. Returns empty dict on failure."""
    text = stdout.strip()
    if not text:
        return {}
    # CLI may prefix with non-JSON lines; find first '{' and parse from there
    start = text.find("{")
    if start == -1:
        return {"result": text}
    try:
        return json.loads(text[start:])
    except json.JSONDecodeError:
        return {"result": text}


def _extract_cost(cli_json: dict) -> float:
    """
    Try cost_usd first, then total_cost_usd; log 0.0 if neither present.
    Field name varies by Claude Code version.
    """
    for key in ("cost_usd", "total_cost_usd"):
        if key in cli_json:
            try:
                return float(cli_json[key])
            except (TypeError, ValueError):
                pass
    return 0.0
