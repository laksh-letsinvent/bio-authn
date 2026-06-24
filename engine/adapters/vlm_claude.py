"""
VLM adapter — Anthropic Messages API transport.

Requires ANTHROPIC_API_KEY in environment. ~$2-3 per 240-pair run.
Token usage and cost come from the API response.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from engine.adapters.base import MatcherAdapter, MatchResult
from engine.adapters._vlm_prompt import build_prompt_messages, parse_vlm_response

MODEL = "claude-opus-4-7"
MAX_TOKENS = 256


class VLMClaudeAdapter(MatcherAdapter):
    matcher_id = "vlm_claude"
    task_type  = "match"

    def __init__(self) -> None:
        import anthropic
        self._client = anthropic.Anthropic()

    def run(self, reference: str, probe: str) -> MatchResult:
        messages = build_prompt_messages(reference, probe, transport="api")
        response = self._client.messages.create(
            model      = MODEL,
            max_tokens = MAX_TOKENS,
            messages   = messages,
        )
        raw_text = response.content[0].text
        parsed   = parse_vlm_response(raw_text)
        usage    = response.usage

        # Cost estimate: Claude Opus 4.7 pricing (update if model changes)
        cost_usd = _estimate_cost(usage.input_tokens, usage.output_tokens)

        return MatchResult(
            matcher_id = self.matcher_id,
            task_type  = self.task_type,
            score      = float(parsed["confidence"]) if parsed["same_person"] else 1.0 - float(parsed["confidence"]),
            decision   = parsed["same_person"],
            confidence = float(parsed["confidence"]),
            reasoning  = parsed.get("reasoning"),
            tokens_in  = usage.input_tokens,
            tokens_out = usage.output_tokens,
            cost_usd   = cost_usd,
            latency_ms = 0,
        )


def _estimate_cost(tokens_in: int, tokens_out: int) -> float:
    # Claude Opus 4.7: $15/M input, $75/M output (update with current pricing)
    return (tokens_in * 15 + tokens_out * 75) / 1_000_000
