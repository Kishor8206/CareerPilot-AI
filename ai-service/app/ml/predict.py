"""Inference for the placement-readiness model (§7).

The model is loaded lazily and cached, with the artefact's modification time
checked so a retrained model is picked up without restarting the service.

If no model has been trained, prediction raises `ModelNotTrainedError` rather
than returning a fabricated score. APIE handles that by falling back to its
rule-based readiness computation and saying so, which is the honest behaviour.
"""
from __future__ import annotations

import threading
from typing import Any

import joblib
import numpy as np

from app.core.config import settings
from app.core.errors import ModelNotTrainedError
from app.core.logging import get_logger
from app.ml.features import FEATURE_NAMES, to_vector
from app.ml.train import METRICS_FILENAME, MODEL_FILENAME

log = get_logger(__name__)

_lock = threading.RLock()
_bundle: dict[str, Any] | None = None
_loaded_mtime: float | None = None


def _model_path():
    return settings.artifacts_path / MODEL_FILENAME


def is_trained() -> bool:
    return _model_path().exists()


def load_model(force: bool = False) -> dict[str, Any]:
    global _bundle, _loaded_mtime
    path = _model_path()

    if not path.exists():
        raise ModelNotTrainedError(
            "The placement-readiness model has not been trained yet. "
            "Run: python -m app.ml.train (from the ai-service directory)."
        )

    mtime = path.stat().st_mtime
    with _lock:
        if _bundle is None or force or _loaded_mtime != mtime:
            _bundle = joblib.load(path)
            _loaded_mtime = mtime
            log.info("Readiness model loaded", extra={"version": _bundle.get("metrics", {}).get("modelVersion")})

            # A model trained on a different feature set would silently produce
            # garbage, so the mismatch is refused outright.
            trained_features = list(_bundle.get("featureNames", []))
            if trained_features and trained_features != list(FEATURE_NAMES):
                raise ModelNotTrainedError(
                    "The saved model was trained on a different feature set than the current code expects. "
                    "Retrain with: python -m app.ml.train"
                )
        return _bundle


def get_metrics() -> dict[str, Any] | None:
    """Returns the persisted evaluation metrics, or None if untrained."""
    metrics_path = settings.artifacts_path / METRICS_FILENAME
    if not metrics_path.exists():
        return None
    import json

    try:
        return json.loads(metrics_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.warning("Could not read model metrics", extra={"reason": str(exc)})
        return None


def _band_to_score(band: str, probabilities: dict[str, float]) -> float:
    """Converts the predicted class into an indicative 0-100 score.

    Band midpoints are weighted by class probability, so a confident
    HIGHLY_READY prediction scores higher than a marginal one. This is a
    *derived* indicator; the authoritative PRS comes from APIE.
    """
    midpoints = {"AT_RISK": 20.0, "NEEDS_IMPROVEMENT": 50.0, "PLACEMENT_READY": 70.0, "HIGHLY_READY": 90.0}
    if probabilities:
        total = sum(probabilities.values())
        if total > 0:
            return round(sum(midpoints.get(k, 50.0) * v for k, v in probabilities.items()) / total, 1)
    return midpoints.get(band, 50.0)


def _contributions(vector: np.ndarray, importances: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pairs global feature importance with this student's actual values.

    This is an interpretability aid, not a SHAP-style local attribution: it says
    "this feature matters a lot to the model, and here is your value for it".
    The API labels it accordingly.
    """
    values = {name: float(v) for name, v in zip(FEATURE_NAMES, vector[0])}
    return [
        {"feature": item["feature"], "importance": item["importance"], "value": values.get(item["feature"], 0.0)}
        for item in importances[:8]
    ]


def predict(payload: dict[str, Any]) -> dict[str, Any]:
    """Predicts a readiness band with class probabilities and confidence."""
    bundle = load_model()
    pipeline = bundle["pipeline"]
    metrics = bundle.get("metrics", {})

    vector = to_vector(payload)
    predicted = str(pipeline.predict(vector)[0])

    probabilities: dict[str, float] = {}
    if hasattr(pipeline, "predict_proba"):
        raw = pipeline.predict_proba(vector)[0]
        probabilities = {
            str(label): round(float(probability), 4)
            for label, probability in zip(pipeline.classes_, raw)
        }

    confidence = round(float(max(probabilities.values())), 4) if probabilities else 0.0

    return {
        "band": predicted,
        "score": _band_to_score(predicted, probabilities),
        "confidence": confidence,
        "classProbabilities": probabilities,
        "featureContributions": _contributions(vector, metrics.get("featureImportance", [])),
        "modelVersion": metrics.get("modelVersion", settings.ml_model_version),
        "algorithm": metrics.get("algorithm", "unknown"),
        "trainedOn": metrics.get("datasetProvenance", "SYNTHETIC"),
        "trainedAt": metrics.get("trainedAt"),
        "testAccuracy": metrics.get("accuracy"),
        "disclaimer": (
            f"{metrics.get('evaluationLabel', 'Prototype model')}. This prediction is produced by a prototype "
            "classifier and is an indicator to guide preparation, not a forecast of any hiring outcome."
        ),
        "featureContributionNote": (
            "Feature contributions pair the model's global feature importance with this student's values. "
            "They indicate which inputs the model weighs most, not a per-prediction causal attribution."
        ),
    }


def reset_model_cache() -> None:
    global _bundle, _loaded_mtime
    with _lock:
        _bundle = None
        _loaded_mtime = None
