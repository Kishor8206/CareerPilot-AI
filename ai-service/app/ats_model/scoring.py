"""Deterministic score aggregation (§11).

The model predicts component scores. It never produces the final ATS score:
Python computes it here, from fixed weights, every time. A model that emits an
`atsScore` of its own has that value discarded and recomputed.
"""
from __future__ import annotations

import math

GENERAL_WEIGHTS: dict[str, float] = {
    "structure": 0.15,
    "sectionCompleteness": 0.10,
    "skills": 0.15,
    "experience": 0.15,
    "projects": 0.15,
    "achievements": 0.10,
    "keywords": 0.10,
    "formatting": 0.10,
}

JOB_MATCH_WEIGHTS: dict[str, float] = {
    "requiredSkillMatch": 0.30,
    "experienceRelevance": 0.20,
    "projectRelevance": 0.15,
    "keywordCoverage": 0.15,
    "educationEligibility": 0.10,
    "structure": 0.05,
    "formatting": 0.05,
}

WEIGHTS = {"GENERAL_ATS": GENERAL_WEIGHTS, "JOB_MATCH_ATS": JOB_MATCH_WEIGHTS}

for _mode, _w in WEIGHTS.items():
    assert math.isclose(sum(_w.values()), 1.0, abs_tol=1e-9), f"{_mode} weights must sum to 1.0"


def clamp(value: float) -> float:
    """Valid component range. NaN and infinities are rejected, not coerced."""
    if value is None or not math.isfinite(float(value)):
        raise ValueError(f"component score is not a finite number: {value!r}")
    return round(max(0.0, min(100.0, float(value))), 2)


def final_score(mode: str, components: dict[str, float]) -> float:
    weights = WEIGHTS[mode]
    missing = set(weights) - set(components)
    extra = set(components) - set(weights)
    if missing or extra:
        raise ValueError(f"{mode} components mismatch — missing={sorted(missing)} extra={sorted(extra)}")
    return round(sum(clamp(components[k]) * w for k, w in weights.items()), 2)
