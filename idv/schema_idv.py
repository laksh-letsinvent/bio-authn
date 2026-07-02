"""
JSON schema and validator for idv_run.json.

Three top-level result blocks:
  extraction   — CER, field accuracy, structured F1 per adapter, adapter comparison
  authenticity — APCER, BPCER, ACER, ROC per adapter
  face_match   — FAR/FRR/ROC with the doc-tuned threshold, reusing the face shape

The face-matching schema (schema_version 1.0) is untouched — this is a
separate file for a separate output.
"""

from typing import Any
import jsonschema

IDV_RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["schema_version", "run", "extraction", "authenticity", "face_match"],
    "additionalProperties": False,
    "properties": {
        "schema_version": {"type": "string", "const": "idv-1.0"},
        "run": {
            "type": "object",
            "required": ["id", "timestamp", "git_sha", "vlm_mode", "total_cost_usd"],
            "additionalProperties": False,
            "properties": {
                "id":            {"type": "string"},
                "timestamp":     {"type": "string"},
                "git_sha":       {"type": "string"},
                "vlm_mode":      {"type": "string", "enum": ["local", "api", "cli"]},
                "total_cost_usd": {"type": "number"},
            },
        },
        "extraction": {
            "type": "object",
            "required": ["dataset", "n_documents", "fields_evaluated", "adapters", "comparison"],
            "additionalProperties": False,
            "properties": {
                "dataset":          {"type": "string"},
                "n_documents":      {"type": "integer"},
                "fields_evaluated": {"type": "array", "items": {"type": "string"}},
                "adapters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["adapter_id", "cer", "field_accuracy", "field_f1", "cost", "latency_ms"],
                        "additionalProperties": False,
                        "properties": {
                            "adapter_id":     {"type": "string"},
                            "cer":            {"type": "number"},
                            "field_accuracy": {"type": "number"},
                            "field_f1": {
                                "type": "object",
                                "required": ["precision", "recall", "f1"],
                                "additionalProperties": False,
                                "properties": {
                                    "precision": {"type": "number"},
                                    "recall":    {"type": "number"},
                                    "f1":        {"type": "number"},
                                },
                            },
                            "per_field": {
                                "type": "object",
                                "additionalProperties": {
                                    "type": "object",
                                    "required": ["cer", "accuracy"],
                                    "properties": {
                                        "cer":      {"type": "number"},
                                        "accuracy": {"type": "number"},
                                    },
                                },
                            },
                            "cost": {
                                "type": "object",
                                "required": ["calls", "tokens_in", "tokens_out", "usd_total", "usd_per_doc"],
                                "additionalProperties": False,
                                "properties": {
                                    "calls":       {"type": "integer"},
                                    "tokens_in":   {"type": "integer"},
                                    "tokens_out":  {"type": "integer"},
                                    "usd_total":   {"type": "number"},
                                    "usd_per_doc": {"type": "number"},
                                },
                            },
                            "latency_ms": {
                                "type": "object",
                                "required": ["p50", "p95"],
                                "additionalProperties": False,
                                "properties": {
                                    "p50": {"type": "integer"},
                                    "p95": {"type": "integer"},
                                },
                            },
                        },
                    },
                },
                "comparison": {
                    "type": "object",
                    "required": ["vlm_vs_ocr_cer_delta", "vlm_wins"],
                    "additionalProperties": False,
                    "properties": {
                        "vlm_vs_ocr_cer_delta": {"type": "number"},
                        "vlm_wins":             {"type": "boolean"},
                        "note":                 {"type": "string"},
                    },
                },
            },
        },
        "authenticity": {
            "type": "object",
            "required": ["dataset", "n_genuine", "n_forged", "adapters"],
            "additionalProperties": False,
            "properties": {
                "dataset":  {"type": "string"},
                "n_genuine": {"type": "integer"},
                "n_forged":  {"type": "integer"},
                "adapters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": [
                            "adapter_id", "operating_threshold",
                            "apcer", "bpcer", "acer", "auc", "roc", "cost", "latency_ms",
                        ],
                        "additionalProperties": False,
                        "properties": {
                            "adapter_id":          {"type": "string"},
                            "operating_threshold": {"type": "number"},
                            "apcer":               {"type": "number"},
                            "bpcer":               {"type": "number"},
                            "acer":                {"type": "number"},
                            "auc":                 {"type": "number"},
                            "by_forgery_type": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["forgery_type", "apcer", "n"],
                                    "properties": {
                                        "forgery_type": {"type": "string"},
                                        "apcer":        {"type": "number"},
                                        "n":            {"type": "integer"},
                                    },
                                },
                            },
                            "roc": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "required": ["threshold", "apcer", "bpcer"],
                                    "properties": {
                                        "threshold": {"type": "number"},
                                        "apcer":     {"type": "number"},
                                        "bpcer":     {"type": "number"},
                                    },
                                },
                            },
                            "cost": {
                                "type": "object",
                                "required": ["calls", "tokens_in", "tokens_out", "usd_total", "usd_per_doc"],
                                "additionalProperties": False,
                                "properties": {
                                    "calls":       {"type": "integer"},
                                    "tokens_in":   {"type": "integer"},
                                    "tokens_out":  {"type": "integer"},
                                    "usd_total":   {"type": "number"},
                                    "usd_per_doc": {"type": "number"},
                                },
                            },
                            "latency_ms": {
                                "type": "object",
                                "required": ["p50", "p95"],
                                "additionalProperties": False,
                                "properties": {
                                    "p50": {"type": "integer"},
                                    "p95": {"type": "integer"},
                                },
                            },
                        },
                    },
                },
            },
        },
        "face_match": {
            "type": "object",
            "required": [
                "dataset", "n_genuine_pairs", "n_impostor_pairs",
                "adapter_id", "selfie_threshold", "doc_threshold",
                "selfie_far", "selfie_frr", "doc_far", "doc_frr",
                "threshold_delta_note", "roc",
            ],
            "additionalProperties": False,
            "properties": {
                "dataset":           {"type": "string"},
                "n_genuine_pairs":   {"type": "integer"},
                "n_impostor_pairs":  {"type": "integer"},
                "adapter_id":        {"type": "string"},
                "selfie_threshold":  {"type": "number"},
                "doc_threshold":     {"type": "number"},
                "selfie_far":        {"type": "number"},
                "selfie_frr":        {"type": "number"},
                "doc_far":           {"type": "number"},
                "doc_frr":           {"type": "number"},
                "threshold_delta_note": {"type": "string"},
                "roc": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["threshold", "far", "frr", "tar"],
                        "properties": {
                            "threshold": {"type": "number"},
                            "far":       {"type": "number"},
                            "frr":       {"type": "number"},
                            "tar":       {"type": "number"},
                        },
                    },
                },
            },
        },
    },
}


def validate_idv_result(data: Any) -> None:
    """Validate idv_run.json against idv-1.0 schema. Raises jsonschema.ValidationError on failure."""
    jsonschema.validate(instance=data, schema=IDV_RESULT_SCHEMA)
