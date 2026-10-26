"""Career roadmap endpoints: /ai/career/*  (internal key required, like every AI route).

Separate from the ATS endpoints. The ATS model is never called here; an ATS
result can be passed IN as `ats_context`, which is the only link between them.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body

from app.career.knowledge import get_knowledge
from app.career.model_service import info as model_info
from app.career.resources import ResourceProviderUnavailable, get_catalogue, public_view, search_youtube
from app.career.roadmap_service import ats_to_career_request, generate_plan
from app.career.skill_gap import analyse
from app.core.errors import ServiceError, success_response

router = APIRouter(prefix="/ai/career", tags=["career"])


def _require_role(payload: dict[str, Any]) -> str:
    role = get_knowledge().role(str(payload.get("target_role") or ""))
    if role is None:
        raise ServiceError(f"Unknown target role '{payload.get('target_role')}'. See GET /ai/career/roles for the supported roles.")
    return role


@router.get("/roles")
async def roles() -> dict[str, Any]:
    """Supported roles and the skill vocabulary, for the role picker."""
    kb = get_knowledge()
    return success_response({
        "roles": [{"role_id": r["role_id"], "name": name, "description": r["description"], "aliases": r["aliases"],
                   "core_skills": [s["skill"] for s in r["core_skills"]]} for name, r in sorted(kb.roles.items())],
        "skills": sorted(s for s, v in kb.skills.items() if v["category"] != "SOFT"),
        "levels": ["beginner", "intermediate", "advanced"],
        "knowledge_version": kb.version, "model": model_info(),
    })


@router.post("/skill-gap")
async def skill_gap(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Deterministic skill-gap analysis. No model involved."""
    role = _require_role(payload)
    ats = payload.get("ats_context") or {}
    profile = payload.get("user_profile") or {}
    return success_response(analyse(role, payload.get("current_skills") or [], ats_missing=ats.get("missing_skills") or [],
                                    completed_skills=(payload.get("progress") or {}).get("completed_skills") or [],
                                    experience=str(profile.get("experience_level") or "STUDENT").upper()))


@router.post("/roadmap")
async def roadmap(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """The full plan: skill gaps, phases, study plan, projects, interview preparation, resources."""
    payload["target_role"] = _require_role(payload)
    result = await generate_plan(payload)
    inf = result["inference"]
    return success_response(result, {"agent": "CAREER_ROADMAP", "provider": inf["provider"], "degraded": inf["degraded"],
                                     "latencyMs": inf["latency_ms"]})


@router.post("/roadmap/from-ats")
async def roadmap_from_ats(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """ATS output in, career plan out. Body: {ats_output, target_role, user_profile?, progress?}."""
    request = ats_to_career_request(payload.get("ats_output") or {}, str(payload.get("target_role") or ""),
                                    payload.get("user_profile"), payload.get("progress"))
    request["target_role"] = _require_role(request)
    result = await generate_plan(request)
    return success_response(result, {"agent": "CAREER_ROADMAP", "provider": result["inference"]["provider"],
                                     "degraded": result["inference"]["degraded"]})


@router.get("/resources")
async def resources(skill: str, stage: str = "beginner", preference: str | None = None, limit: int = 5) -> dict[str, Any]:
    """Ranked, verified resources for one skill."""
    kb = get_knowledge()
    canonical = kb.skill(skill)
    if canonical is None:
        raise ServiceError(f"Unknown skill '{skill}'.")
    found = get_catalogue().candidates(canonical, stage, preference=preference, limit=max(1, min(limit, 20)))
    return success_response({"skill": canonical, "resources": [public_view(r) for r in found]})


@router.get("/resources/youtube")
async def youtube(skill: str, stage: str = "beginner", objective: str = "") -> dict[str, Any]:
    """Live YouTube candidates. They are UNVERIFIED search results, labelled as such."""
    try:
        return success_response({"candidates": [public_view(r) for r in search_youtube(skill, stage, objective=objective)],
                                 "note": "Live search results. Not yet verified or added to the catalogue."})
    except ResourceProviderUnavailable as exc:
        raise ServiceError(str(exc)) from exc
    except ValueError as exc:
        raise ServiceError(str(exc)) from exc
