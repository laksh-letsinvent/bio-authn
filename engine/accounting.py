"""Timing wrapper. Wraps adapter.run() and fills latency_ms on the result."""

from __future__ import annotations

import time
from typing import Any

from engine.adapters.base import MatcherAdapter, MatchResult


def timed_run(adapter: MatcherAdapter, reference: Any, probe: Any) -> MatchResult:
    """Call adapter.run() and record wall-clock latency in the returned MatchResult."""
    start = time.perf_counter()
    result = adapter.run(reference, probe)
    result.latency_ms = int((time.perf_counter() - start) * 1000)
    return result
