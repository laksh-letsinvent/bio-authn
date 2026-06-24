from typing import Any
import jsonschema

RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["schema_version", "run", "matchers", "disagreement"],
    "additionalProperties": False,
    "properties": {
        "schema_version": {"type": "string", "const": "1.0"},
        "run": {
            "type": "object",
            "required": ["id", "timestamp", "git_sha", "config_hash", "corpus_version", "vlm_mode"],
            "additionalProperties": False,
            "properties": {
                "id":             {"type": "string"},
                "timestamp":      {"type": "string"},
                "git_sha":        {"type": "string"},
                "config_hash":    {"type": "string"},
                "corpus_version": {"type": "string"},
                "vlm_mode":       {"type": "string", "enum": ["local", "api", "cli"]},
            },
        },
        "matchers": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "matcher_id", "task_type", "operating_threshold",
                    "overall", "roc", "by_group", "disparity_ratio",
                    "calibration", "pad", "cost", "latency_ms",
                ],
                "additionalProperties": False,
                "properties": {
                    "matcher_id":          {"type": "string"},
                    "task_type":           {"type": "string"},
                    "operating_threshold": {"type": "number"},
                    "overall": {
                        "type": "object",
                        "required": ["far", "frr", "eer", "auc", "tar_at_far"],
                        "additionalProperties": False,
                        "properties": {
                            "far": {"type": "number"},
                            "frr": {"type": "number"},
                            "eer": {"type": "number"},
                            "auc": {"type": "number"},
                            "tar_at_far": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "1e-2": {"type": ["number", "null"]},
                                    "1e-3": {"type": ["number", "null"]},
                                },
                            },
                        },
                    },
                    "roc": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["threshold", "far", "frr", "tar"],
                            "additionalProperties": False,
                            "properties": {
                                "threshold": {"type": "number"},
                                "far":       {"type": "number"},
                                "frr":       {"type": "number"},
                                "tar":       {"type": "number"},
                            },
                        },
                    },
                    "by_group": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["group", "frr", "far", "n_pairs"],
                            "additionalProperties": False,
                            "properties": {
                                "group":   {"type": "string"},
                                "frr":     {"type": "number"},
                                "far":     {"type": "number"},
                                "n_pairs": {"type": "integer"},
                            },
                        },
                    },
                    "disparity_ratio": {"type": ["number", "null"]},
                    "calibration": {
                        "oneOf": [
                            {"type": "null"},
                            {
                                "type": "object",
                                "required": ["ece", "bins"],
                                "additionalProperties": False,
                                "properties": {
                                    "ece": {"type": "number"},
                                    "bins": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "required": ["conf", "acc", "n"],
                                            "additionalProperties": False,
                                            "properties": {
                                                "conf": {"type": "number"},
                                                "acc":  {"type": "number"},
                                                "n":    {"type": "integer"},
                                            },
                                        },
                                    },
                                },
                            },
                        ]
                    },
                    "pad": {
                        "oneOf": [
                            {"type": "null"},
                            {
                                "type": "object",
                                "required": ["apcer", "bpcer", "acer", "operating_threshold", "n_bonafide", "n_attack"],
                                "additionalProperties": False,
                                "properties": {
                                    "apcer":               {"type": "number"},
                                    "bpcer":               {"type": "number"},
                                    "acer":                {"type": "number"},
                                    "operating_threshold": {"type": "number"},
                                    "n_bonafide":          {"type": "integer"},
                                    "n_attack":            {"type": "integer"},
                                },
                            },
                        ]
                    },
                    "cost": {
                        "type": "object",
                        "required": ["calls", "tokens_in", "tokens_out", "usd_total", "usd_per_decision"],
                        "additionalProperties": False,
                        "properties": {
                            "calls":           {"type": "integer"},
                            "tokens_in":       {"type": "integer"},
                            "tokens_out":      {"type": "integer"},
                            "usd_total":       {"type": "number"},
                            "usd_per_decision":{"type": "number"},
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
        "disagreement": {
            "type": "object",
            "required": ["uncertain_band", "n_in_band", "vlm_correct_in_band", "examples"],
            "additionalProperties": False,
            "properties": {
                "uncertain_band":      {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                "n_in_band":           {"type": "integer"},
                "vlm_correct_in_band": {"type": "integer"},
                "examples": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["pair_id", "arcface_score", "vlm_decision", "label"],
                        "additionalProperties": False,
                        "properties": {
                            "pair_id":      {"type": "string"},
                            "arcface_score":{"type": "number"},
                            "vlm_decision": {"type": "boolean"},
                            "label":        {"type": "string"},
                        },
                    },
                },
            },
        },
    },
}


def validate_result(data: Any) -> None:
    """Validate result JSON against schema_version 1.0. Raises ValidationError on failure."""
    jsonschema.validate(instance=data, schema=RESULT_SCHEMA)
