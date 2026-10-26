"""CareerPilot AI - Python AI/ML service entry point.

Run it:
    uvicorn app.main:app --reload --port 8000    (from the ai-service directory)
    npm run dev:ai                                (from the repository root)

Security posture
----------------
This service is INTERNAL. Every route except `/health*` requires the
`X-Internal-Key` shared secret, and CORS is restricted to the Node gateway's
origin. It should never be exposed directly to the internet.
"""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import agents, career, coding, health, interview, rag, readiness, resume, speech
from app.core.config import settings
from app.core.errors import ErrorCode, ServiceError, error_response
from app.core.logging import configure_logging, correlation_id, get_logger
from app.core.security import require_internal_key

configure_logging()
log = get_logger("app.main")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Eagerly construct the providers so a misconfiguration surfaces at startup
    # rather than on a student's first request.
    from app.ml import predict as ml_predict
    from app.rag import pipeline
    from app.services.embeddings import get_embedder
    from app.services.llm import get_llm
    from app.services.speech import get_speech_provider

    llm = get_llm()
    embedder = get_embedder()
    speech_provider = get_speech_provider()

    log.info(
        "AI service starting",
        extra={
            "provider": llm.name,
            "embeddings": embedder.name,
            "vectorStore": pipeline.stats().get("provider"),
            "mlTrained": ml_predict.is_trained(),
            "speech": f"{speech_provider.name} (available={speech_provider.available})",
            "demoMode": settings.demo_mode,
        },
    )

    if llm.name == "mock":
        log.warning(
            "Running with the OFFLINE MOCK provider. All generated content is deterministic placeholder "
            "output and is labelled as such. Set AI_PROVIDER and AI_API_KEY to use a real model."
        )
    if not ml_predict.is_trained():
        log.warning("No readiness model is trained. Run: python -m app.ml.train")

    yield
    log.info("AI service shutting down")


app = FastAPI(
    title="CareerPilot AI - AI/ML Service",
    description=(
        "Internal AI/ML service for CareerPilot AI: resume intelligence, job matching, adaptive "
        "interviews, RAG, the Adaptive Placement Intelligence Engine and the "
        "placement-readiness ML pipeline."
    ),
    version=settings.version,
    lifespan=lifespan,
    # Interactive docs are development-only; an internal service should not
    # advertise its surface in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Internal-Key", "X-Correlation-Id"],
)


@app.middleware("http")
async def correlation_and_timing(request: Request, call_next):
    """Threads the gateway's correlation id through logs and times the request."""
    token = correlation_id.set(request.headers.get("X-Correlation-Id") or str(uuid.uuid4()))
    started = time.perf_counter()
    try:
        response = await call_next(request)
    finally:
        duration_ms = (time.perf_counter() - started) * 1000
        if not request.url.path.startswith("/health"):
            log.info(
                "Request handled",
                extra={"method": request.method, "path": request.url.path, "durationMs": round(duration_ms, 1)},
            )
        correlation_id.reset(token)
    response.headers["X-Correlation-Id"] = correlation_id.get()
    return response


# ---- Error handlers: every failure returns the standard envelope (§37) ----

@app.exception_handler(ServiceError)
async def service_error_handler(_request: Request, exc: ServiceError):
    return error_response(exc.code, exc.message, exc.status_code, exc.details)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    return error_response(
        ErrorCode.VALIDATION_ERROR,
        "The request body failed validation.",
        422,
        [{"path": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()],
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, exc: StarletteHTTPException):
    detail: Any = exc.detail
    if isinstance(detail, dict):
        return error_response(detail.get("code", "HTTP_ERROR"), detail.get("message", "Request failed."), exc.status_code)
    return error_response("HTTP_ERROR", str(detail), exc.status_code)


@app.exception_handler(Exception)
async def unhandled_error_handler(_request: Request, exc: Exception):
    # Log the detail, return a generic message: internals never reach the caller.
    log.exception("Unhandled exception")
    return error_response(
        ErrorCode.INTERNAL_ERROR,
        "An unexpected error occurred in the AI service. Please try again.",
        500,
    )


# ---- Routes ----
# Health is public; everything else requires the internal shared secret.
app.include_router(health.router)

protected = [
    resume.router, interview.router, readiness.router,
    rag.router, agents.router, coding.router, speech.router, career.router,
]
for router in protected:
    app.include_router(router, dependencies=[Depends(require_internal_key)])


@app.get("/", tags=["health"])
async def root() -> dict[str, Any]:
    return {
        "success": True,
        "data": {
            "service": settings.app_name,
            "version": settings.version,
            "docs": None if settings.is_production else "/docs",
            "health": "/health",
            "note": "Internal service. All /ai/* endpoints require the X-Internal-Key header.",
        },
    }
