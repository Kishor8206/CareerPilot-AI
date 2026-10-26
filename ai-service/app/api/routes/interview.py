"""Interview endpoints (§33): /ai/interview/generate, /ai/interview/evaluate."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.agents.orchestrator import INTERVIEW_MODE_AGENT, run_agent, run_workflow
from app.core.errors import success_response

router = APIRouter(prefix="/ai/interview", tags=["interview"])


@router.post("/generate")
async def generate_question(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Generates the next adaptive interview question for the session."""
    mode = str(payload.get("mode", "TECHNICAL")).upper()
    agent_name = INTERVIEW_MODE_AGENT.get(mode, "TECHNICAL_INTERVIEW")
    result = await run_agent(agent_name, payload)
    return success_response(result["data"], result["meta"])


@router.post("/evaluate")
async def evaluate_answer(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Evaluates a single answer on content and objective delivery signals."""
    result = await run_agent("INTERVIEW_EVALUATION", payload)
    return success_response(result["data"], result["meta"])


@router.post("/turn")
async def interview_turn(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Evaluates the previous answer and generates the next question in one call.

    This is the adaptive loop: the score just produced feeds the difficulty
    decision for the question that follows.
    """
    result = await run_workflow("INTERVIEW_TURN", payload)
    return success_response(result, {"workflow": "INTERVIEW_TURN"})
