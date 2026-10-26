"""Agent and workflow endpoints (§33): /ai/agents, /ai/agents/run."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.agents.orchestrator import WORKFLOWS, describe_agents, registry, run_agent, run_workflow
from app.core.errors import ServiceError, success_response

router = APIRouter(prefix="/ai/agents", tags=["agents"])


@router.get("")
async def list_agents() -> dict[str, Any]:
    """The live agent roster with input/output schemas, for the admin console."""
    return success_response({
        "agents": describe_agents(),
        "workflows": [
            {"name": name, "description": (fn.__doc__ or "").strip().split("\n")[0]}
            for name, fn in WORKFLOWS.items()
        ],
        "count": len(registry),
    })


@router.post("/run")
async def run(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Invokes a single agent by name.

    Body: `{"agent": "<AGENT_NAME>", "input": { ... }}`
    """
    agent = str(payload.get("agent") or "").strip()
    if not agent:
        raise ServiceError(
            f"An 'agent' name is required. Available: {', '.join(sorted(registry))}."
        )
    result = await run_agent(agent, payload.get("input", {}))
    return success_response(result["data"], result["meta"])


@router.post("/workflow")
async def workflow(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Runs a named multi-agent workflow.

    Body: `{"workflow": "<WORKFLOW_NAME>", "input": { ... }}`
    """
    name = str(payload.get("workflow") or "").strip()
    if not name:
        raise ServiceError(f"A 'workflow' name is required. Available: {', '.join(sorted(WORKFLOWS))}.")
    result = await run_workflow(name, payload.get("input", {}))
    return success_response(result, {"workflow": name})
