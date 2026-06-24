from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class MatchResult:
    matcher_id: str                 # e.g. "arcface", "vlm_claude"  (v2: "insightface", "pad_baseline", "pad_vlm")
    task_type: str                  # "match" | "pad"   (v1 only ever emits "match")
    score: float                    # higher = more genuine (match) / more live (pad)
    decision: bool                  # adapter's own call at its default threshold; harness re-decides at tuned threshold
    confidence: Optional[float]     # model-stated confidence in [0,1], or None
    reasoning: Optional[str]        # natural-language rationale (VLM only), else None
    tokens_in: int                  # 0 for non-LLM adapters
    tokens_out: int                 # 0 for non-LLM adapters
    cost_usd: float                 # 0.0 for local adapters
    latency_ms: int


class MatcherAdapter(ABC):
    matcher_id: str
    task_type: str                  # "match" or "pad"

    @abstractmethod
    def run(self, reference, probe) -> MatchResult:
        """match: reference+probe are images (or precomputed embeddings).
           pad:   probe is the sample, reference is None.   (pad is v2)"""
        ...

    # Optional fast path for embedding matchers; harness caches the output.
    def embed(self, image):
        raise NotImplementedError
