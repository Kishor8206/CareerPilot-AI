"""Agent orchestration layer (§5).

Agents never invoke one another. All composition happens here, through named
workflows with an explicit, finite step list. That gives three properties the
spec requires:

  * the call graph is acyclic and cannot loop
  * every multi-agent flow is auditable as a single named workflow
  * a failure in one step is contained and reported against that step

`registry` is the single source of truth for which agents exist; `/ai/agents`
serves it so the admin console can display the live agent roster with schemas.
"""
from __future__ import annotations

import time
from typing import Any

from app.agents.base import BaseAgent
from app.agents.coding_agent import CodingAssessmentAgent
from app.agents.interview_agents import (
    BehavioralInterviewAgent,
    HrInterviewAgent,
    InterviewEvaluationAgent,
    TechnicalInterviewAgent,
)
from app.agents.job_matching_agent import JobMatchingAgent
from app.agents.mentorship_agent import (
    AlumniFeedbackIngestAgent,
    AlumniMentorshipAgent,
    AnalyticsAgent,
)
from app.agents.readiness_agent import PlacementReadinessAgent
from app.agents.resume_agent import ResumeIntelligenceAgent
from app.core.errors import ServiceError
from app.core.logging import get_logger

log = get_logger(__name__)

#: The eleven agents named in §5, plus the three supporting evaluation agents
#: that share their domain.
registry: dict[str, BaseAgent] = {
    agent.name: agent
    for agent in (
        ResumeIntelligenceAgent(),
        JobMatchingAgent(),
        CodingAssessmentAgent(),
        TechnicalInterviewAgent(),
        HrInterviewAgent(),
        BehavioralInterviewAgent(),
        InterviewEvaluationAgent(),
        PlacementReadinessAgent(),
        AlumniMentorshipAgent(),
        AlumniFeedbackIngestAgent(),
        AnalyticsAgent(),
    )
}

#: Maps an interview mode onto the agent that generates its questions.
INTERVIEW_MODE_AGENT = {
    "TECHNICAL": "TECHNICAL_INTERVIEW",
    "COMPANY_SPECIFIC": "TECHNICAL_INTERVIEW",
    "ROLE_SPECIFIC": "TECHNICAL_INTERVIEW",
    "RESUME_BASED": "TECHNICAL_INTERVIEW",
    "HR": "HR_INTERVIEW",
    "BEHAVIORAL": "BEHAVIORAL_INTERVIEW",
}


def get_agent(name: str) -> BaseAgent:
    agent = registry.get(name.upper())
    if agent is None:
        raise ServiceError(
            f"Unknown agent '{name}'. Available agents: {', '.join(sorted(registry))}.",
            code="AGENT_NOT_FOUND",
            status_code=404,
        )
    return agent


async def run_agent(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Runs a single agent and returns its validated result plus metadata."""
    result = await get_agent(name).run(payload)
    return {"data": result.data.model_dump(), "meta": result.meta.model_dump()}


def describe_agents() -> list[dict[str, Any]]:
    return [agent.describe() for agent in registry.values()]


# --------------------------------------------------------------------------
# Named workflows
# --------------------------------------------------------------------------

async def workflow_resume_to_match(payload: dict[str, Any]) -> dict[str, Any]:
    """Resume analysis -> job matching, in one round trip (§1 central workflow).

    The resume agent's extracted skills feed the matcher directly, so the caller
    does not have to make two calls and stitch the result together.
    """
    steps: list[dict[str, Any]] = []
    started = time.perf_counter()

    resume_result = await get_agent("RESUME_INTELLIGENCE").run(payload.get("resume", {}))
    resume_data = resume_result.data.model_dump()
    steps.append({"agent": "RESUME_INTELLIGENCE", "status": "SUCCESS", "latencyMs": resume_result.meta.latencyMs})

    match_input = {
        **payload.get("job", {}),
        # Skills from the resume take precedence over anything the caller guessed.
        "studentSkills": resume_data["parsed"].get("skills", []),
        "studentProjects": [p.get("title", "") for p in resume_data["parsed"].get("projects", [])],
        "studentSummary": resume_data["parsed"].get("sections", {}).get("summary", ""),
        "totalExperienceMonths": resume_data["parsed"].get("totalExperienceMonths", 0),
    }

    match_result = await get_agent("JOB_MATCHING").run(match_input)
    steps.append({"agent": "JOB_MATCHING", "status": "SUCCESS", "latencyMs": match_result.meta.latencyMs})

    return {
        "resumeAnalysis": resume_data,
        "jobMatch": match_result.data.model_dump(),
        "workflow": "RESUME_TO_MATCH",
        "steps": steps,
        "totalLatencyMs": int((time.perf_counter() - started) * 1000),
    }


async def workflow_interview_turn(payload: dict[str, Any]) -> dict[str, Any]:
    """Evaluate the previous answer, then generate the next question (§11).

    Doing both in one call is what makes the interview adaptive: the score from
    the answer just given feeds `recentScores`, which drives the difficulty of
    the question that follows.
    """
    steps: list[dict[str, Any]] = []
    started = time.perf_counter()
    evaluation: dict[str, Any] | None = None

    previous = payload.get("previousAnswer")
    if previous:
        evaluation_result = await get_agent("INTERVIEW_EVALUATION").run(previous)
        evaluation = evaluation_result.data.model_dump()
        steps.append({"agent": "INTERVIEW_EVALUATION", "status": "SUCCESS", "latencyMs": evaluation_result.meta.latencyMs})

    generate_input = dict(payload.get("generate", {}))
    if evaluation:
        scores = list(generate_input.get("recentScores", []))
        scores.append(evaluation["overall"])
        generate_input["recentScores"] = scores

    question: dict[str, Any] | None = None
    if not payload.get("finalQuestionReached"):
        agent_name = INTERVIEW_MODE_AGENT.get(str(generate_input.get("mode", "TECHNICAL")).upper(), "TECHNICAL_INTERVIEW")
        question_result = await get_agent(agent_name).run(generate_input)
        question = question_result.data.model_dump()
        steps.append({"agent": agent_name, "status": "SUCCESS", "latencyMs": question_result.meta.latencyMs})

    return {
        "evaluation": evaluation,
        "nextQuestion": question,
        "workflow": "INTERVIEW_TURN",
        "steps": steps,
        "totalLatencyMs": int((time.perf_counter() - started) * 1000),
    }


WORKFLOWS = {
    "RESUME_TO_MATCH": workflow_resume_to_match,
    "INTERVIEW_TURN": workflow_interview_turn,
}


async def run_workflow(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    workflow = WORKFLOWS.get(name.upper())
    if workflow is None:
        raise ServiceError(
            f"Unknown workflow '{name}'. Available workflows: {', '.join(sorted(WORKFLOWS))}.",
            code="WORKFLOW_NOT_FOUND",
            status_code=404,
        )
    log.info("Running workflow", extra={"workflow": name})
    return await workflow(payload)
