"""Health and observability endpoints (§38).

These are the only routes exempt from the internal-key requirement, so a
container orchestrator or the Node gateway can probe liveness without holding
the shared secret.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter

from app.core.config import settings
from app.core.errors import success_response
from app.ml import predict as ml_predict
from app.rag import pipeline
from app.services.embeddings import get_embedder
from app.services.llm import get_llm

router = APIRouter(tags=["health"])

_STARTED_AT = time.time()


@router.get("/health")
async def health() -> dict[str, Any]:
    """Aggregate health. Always 200: a degraded AI service is still useful."""
    llm = get_llm()
    llm_health = await llm.health()

    checks = [
        {
            "name": "llm-provider",
            "status": "OK" if llm_health["reachable"] else "DOWN",
            "provider": llm_health["provider"],
            "detail": llm_health.get("detail"),
        },
        {
            "name": "embeddings",
            "status": "OK",
            "provider": get_embedder().name,
            "detail": f"dimension {get_embedder().dimension}",
        },
        {
            "name": "vector-store",
            "status": "OK",
            "detail": pipeline.stats(),
        },
        {
            "name": "ml-model",
            "status": "OK" if ml_predict.is_trained() else "DEGRADED",
            "detail": (
                "Readiness model is trained and loadable."
                if ml_predict.is_trained()
                else "No trained model. Run: python -m app.ml.train"
            ),
        },
    ]

    degraded = [c for c in checks if c["status"] != "OK"]

    return success_response({
        "status": "OK" if not degraded else "DEGRADED",
        "service": settings.app_name,
        "version": settings.version,
        "environment": settings.node_env,
        "uptimeSeconds": round(time.time() - _STARTED_AT, 1),
        "aiProvider": llm.name,
        "demoMode": settings.demo_mode,
        "checks": checks,
    })


@router.get("/health/live")
async def live() -> dict[str, Any]:
    """Liveness only: touches no dependency."""
    return success_response({"alive": True, "uptimeSeconds": round(time.time() - _STARTED_AT, 1)})


@router.get("/health/ready")
async def ready() -> dict[str, Any]:
    """Readiness: the service can serve requests even without a trained model."""
    return success_response({
        "ready": True,
        "llmProvider": get_llm().name,
        "embeddingProvider": get_embedder().name,
        "vectorStore": pipeline.stats(),
        "mlTrained": ml_predict.is_trained(),
    })
