"""Feature definition for the placement-readiness model (§7).

The feature list is declared once, here, and used by the training pipeline, the
prediction API and the synthetic data generator. That is what guarantees the
column order at inference time matches training - the single most common cause
of silently wrong predictions in a deployed model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    minimum: float
    maximum: float
    #: Value substituted when a student has no evidence for this feature yet.
    default: float
    description: str


FEATURES: tuple[Feature, ...] = (
    Feature("atsScore", "ATS / Resume Score", 0, 100, 0, "Resume quality and ATS keyword coverage."),
    Feature("codingScore", "Coding Score", 0, 100, 0, "Mean score across submitted coding assessments."),
    Feature("technicalScore", "Technical Interview Score", 0, 100, 0, "Mean AI technical interview score."),
    Feature("hrScore", "HR Interview Score", 0, 100, 0, "Mean AI HR interview score."),
    Feature("communicationScore", "Communication Score", 0, 100, 0, "Communication measured across interviews."),
    Feature("aptitudeScore", "Aptitude Score", 0, 100, 0, "Mean aptitude assessment score."),
    Feature("academicScore", "Academic Score", 0, 100, 0, "CGPA normalised to 0-100, adjusted for backlogs."),
    Feature("projectCount", "Project Count", 0, 15, 0, "Number of projects on the profile."),
    Feature("certificationCount", "Certification Count", 0, 15, 0, "Number of certifications."),
    Feature("internshipMonths", "Internship Experience (months)", 0, 36, 0, "Total internship duration."),
    Feature("alumniFeedbackScore", "Alumni Feedback Score", 0, 100, 0, "Mean human alumni evaluation."),
    Feature("skillGapCount", "Open Skill Gaps", 0, 30, 0, "Unresolved skill gaps against target roles."),
    Feature("assessmentsTaken", "Assessments Completed", 0, 40, 0, "Total assessments submitted."),
    Feature("interviewsTaken", "Interviews Completed", 0, 40, 0, "Total AI interviews completed."),
)

FEATURE_NAMES: tuple[str, ...] = tuple(f.name for f in FEATURES)

CLASS_LABELS: tuple[str, ...] = ("AT_RISK", "NEEDS_IMPROVEMENT", "PLACEMENT_READY", "HIGHLY_READY")


def to_vector(payload: dict[str, Any]) -> np.ndarray:
    """Builds the model input row, in the canonical feature order.

    Missing values fall back to the feature default and out-of-range values are
    clipped, so a malformed request degrades to a conservative prediction rather
    than an exception or a nonsense extrapolation.
    """
    values: list[float] = []
    for feature in FEATURES:
        raw = payload.get(feature.name, None)
        if raw is None:
            value = feature.default
        else:
            try:
                value = float(raw)
            except (TypeError, ValueError):
                value = feature.default
        values.append(float(np.clip(value, feature.minimum, feature.maximum)))
    return np.asarray(values, dtype=np.float64).reshape(1, -1)


def describe_features() -> list[dict[str, Any]]:
    return [
        {
            "name": f.name,
            "label": f.label,
            "min": f.minimum,
            "max": f.maximum,
            "default": f.default,
            "description": f.description,
        }
        for f in FEATURES
    ]
