"""
Adapter registry. Returns active adapters based on config.
"""

from __future__ import annotations

from typing import Any

from engine.adapters.base import MatcherAdapter


def get_adapters(cfg: dict) -> list[MatcherAdapter]:
    """
    Build and return enabled adapters in a deterministic order.
    Config shape:
        matchers:
          arcface: true
          insightface: true   # v2
          vlm_claude: true
          pad_baseline: true  # v2
          pad_vlm: true       # v2
        vlm_mode: local | api | cli
    """
    adapters: list[MatcherAdapter] = []
    matchers_cfg = cfg.get("matchers", {})
    vlm_mode     = cfg.get("vlm_mode", "local")

    if matchers_cfg.get("arcface", False):
        from engine.adapters.arcface import ArcFaceAdapter
        adapters.append(ArcFaceAdapter())

    if matchers_cfg.get("insightface", False):
        from engine.adapters.insightface import InsightFaceAdapter
        adapters.append(InsightFaceAdapter())

    if matchers_cfg.get("vlm_claude", False):
        adapters.append(_build_vlm_adapter(vlm_mode))

    if matchers_cfg.get("pad_baseline", False):
        from engine.adapters.pad_baseline import PADBaselineAdapter
        adapters.append(PADBaselineAdapter())

    if matchers_cfg.get("pad_vlm", False):
        adapters.append(_build_pad_vlm_adapter(vlm_mode))

    if not adapters:
        raise ValueError("No matchers enabled in config — set at least one to true.")

    return adapters


def _build_vlm_adapter(vlm_mode: str) -> MatcherAdapter:
    if vlm_mode == "api":
        from engine.adapters.vlm_claude import VLMClaudeAdapter
        return VLMClaudeAdapter()
    elif vlm_mode == "local":
        from engine.adapters.vlm_local import VLMLocalAdapter
        return VLMLocalAdapter()
    elif vlm_mode == "cli":
        from engine.adapters.vlm_cli import VLMCLIAdapter
        return VLMCLIAdapter(skip_permissions=True)
    else:
        raise ValueError(f"Unknown vlm_mode '{vlm_mode}'. Expected: local | api | cli")


def _build_pad_vlm_adapter(vlm_mode: str) -> MatcherAdapter:
    from engine.adapters.pad_vlm import PADVLMApiAdapter, PADVLMCLIAdapter, PADVLMLocalAdapter
    if vlm_mode == "api":
        return PADVLMApiAdapter()
    elif vlm_mode == "cli":
        return PADVLMCLIAdapter(skip_permissions=True)
    elif vlm_mode == "local":
        return PADVLMLocalAdapter()
    else:
        raise ValueError(f"Unknown vlm_mode '{vlm_mode}'. Expected: local | api | cli")
