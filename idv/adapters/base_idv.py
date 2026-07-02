"""
Base types for IDV adapters. Separate from engine.adapters.base — IDV is a
different task shape (field extraction and authenticity, not score/threshold matching).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ExtractionResult:
    """Output of one document field-extraction run."""
    adapter_id: str
    fields: dict[str, str]          # field_name → extracted value (empty string if not found)
    raw_text: Optional[str]         # raw OCR or VLM output, for debugging
    tokens_in: int                  # 0 for non-LLM adapters
    tokens_out: int                 # 0 for non-LLM adapters
    cost_usd: float                 # 0.0 for local adapters
    latency_ms: int


@dataclass
class AuthResult:
    """Output of one document authenticity check."""
    adapter_id: str
    decision: bool                  # True = genuine, False = forged/tampered
    confidence: Optional[float]     # model-stated [0,1], or None
    reasoning: Optional[str]        # VLM rationale, else None
    tokens_in: int
    tokens_out: int
    cost_usd: float
    latency_ms: int


class ExtractionAdapter(ABC):
    adapter_id: str

    @abstractmethod
    def run(self, image_path: str, fields: list[str]) -> ExtractionResult:
        """Extract the named fields from the document image."""
        ...


class AuthAdapter(ABC):
    adapter_id: str

    @abstractmethod
    def run(self, image_path: str) -> AuthResult:
        """Classify the document image as genuine (True) or tampered (False)."""
        ...
