"""Coding review and analytics endpoints (§33)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.agents.orchestrator import run_agent
from app.core.errors import success_response

router = APIRouter(prefix="/ai", tags=["coding", "analytics", "mentorship"])


@router.post("/coding/review")
async def review_code(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Reviews a submission's complexity and readability. Never executes code."""
    result = await run_agent("CODING_ASSESSMENT", payload)
    return success_response(result["data"], result["meta"])


@router.post("/mentorship/match")
async def match_mentors(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Ranks verified alumni against the student's gaps and targets."""
    result = await run_agent("ALUMNI_MENTORSHIP", payload)
    return success_response(result["data"], result["meta"])


@router.post("/mentorship/feedback")
async def ingest_feedback(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Converts structured alumni feedback into APIE-consumable signals."""
    result = await run_agent("ALUMNI_FEEDBACK_INGEST", payload)
    return success_response(result["data"], result["meta"])


@router.post("/analytics/cohort")
async def cohort_analytics(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Aggregates cohort readiness into institutional insights and interventions."""
    result = await run_agent("ANALYTICS", payload)
    return success_response(result["data"], result["meta"])
