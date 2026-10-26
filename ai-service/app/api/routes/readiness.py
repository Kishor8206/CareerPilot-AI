"""Readiness and ML endpoints (§33)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query

from app.agents.orchestrator import run_agent
from app.core.errors import ErrorCode, ServiceError, success_response
from app.ml import predict as ml_predict
from app.ml.features import describe_features

router = APIRouter(prefix="/ai", tags=["readiness"])


@router.post("/readiness/predict")
async def predict_readiness(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Runs APIE and returns the Placement Readiness Score with full breakdown."""
    result = await run_agent("PLACEMENT_READINESS", payload)
    return success_response(result["data"], result["meta"])


@router.get("/ml/metrics")
async def ml_metrics() -> dict[str, Any]:
    """Held-out evaluation metrics for the trained readiness model (§7).

    Returns `trained: false` when no model exists rather than inventing numbers.
    """
    metrics = ml_predict.get_metrics()
    if metrics is None:
        return success_response({
            "trained": False,
            "message": (
                "No readiness model has been trained yet. "
                "Run: python -m app.ml.train (from the ai-service directory)."
            ),
            "features": describe_features(),
        })
    return success_response({"trained": True, **metrics, "features": describe_features()})


@router.post("/ml/predict")
async def ml_predict_direct(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Direct ML classification, bypassing APIE. Used by the admin model console."""
    return success_response(ml_predict.predict(payload))


@router.post("/ml/train")
async def ml_train(
    samples: int = Query(3000, ge=200, le=50_000),
    model: str = Query("random_forest"),
    seed: int | None = Query(None),
) -> dict[str, Any]:
    """Retrains on freshly generated synthetic data (§7).

    Exposed so a model can be trained during a demonstration. Training on real
    labelled outcomes uses the CLI, which can take a dataset path.
    """
    from app.ml.train import SUPPORTED_MODELS, train

    if model not in SUPPORTED_MODELS:
        raise ServiceError(
            f"Unknown model '{model}'. Supported: {', '.join(sorted(SUPPORTED_MODELS))}.",
            code=ErrorCode.VALIDATION_ERROR,
        )

    metrics = train(model_name=model, samples=samples, seed=seed)
    ml_predict.reset_model_cache()
    return success_response({"trained": True, **metrics})
