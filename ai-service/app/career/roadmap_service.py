"""Roadmap service: the full career-plan pipeline.

    profile + skills + target role (+ ATS output, + progress)
        -> skill-gap service              deterministic
        -> prerequisite graph / planner   deterministic  (the reference plan)
        -> resource retrieval             candidate IDs, verified resources only
        -> career model                   reasoning and wording          [optional]
        -> validation                     schema + facts
        -> repair / retry / fallback
        -> resource resolution            IDs -> real, verified resources
        -> final career plan

What the model is trusted with, and what it is not
    The model's wording, grouping and resource choice are used when they pass
    validation. Anything arithmetic or factual is checked against the
    deterministic plan, and REPAIRED from it when wrong:
      * an infeasible or missing study plan is replaced by the scheduler's;
      * unknown resource IDs are dropped (a hallucinated ID never resolves);
      * priorities and levels are restored to the skill-gap service's values.
    Repairs are counted and returned, so a repaired answer is never presented
    as a clean model answer. If the output cannot be parsed or still fails
    after repair, generation is retried once, then the deterministic plan is
    returned. The ATS model is never used as a substitute.
"""
from __future__ import annotations

import asyncio
import copy
import time
from typing import Any

from app.career.knowledge import get_knowledge
from app.career.model_service import MODEL_VERSION, CareerModelUnavailable, get_generator, load_error
from app.career.planner import MAX_WEEKS, build_plan, daily_tasks
from app.career.prompts import ALL_SECTIONS, chat_messages, knowledge_block
from app.career.resources import get_catalogue, public_view
from app.career.validation import extract_json, facts_from_context, validate_plan
from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

TASK = "Career roadmap"
DISCLAIMER = (
    "This roadmap is generated from CareerPilot's curated career knowledge and your stated skills and time. "
    "Study-hour figures are planning estimates, and the plan is guidance for preparation, not a guarantee of any outcome."
)

def describe_request(request: dict[str, Any]) -> str:
    """The REQUEST text shown to the model, in the phrasing it was trained on."""
    profile = request.get("user_profile") or {}
    skills = request.get("current_skills") or []
    parts = []
    if skills:
        parts.append("I have " + ", ".join(f"{s.get('level', 'beginner')} {s['skill']}" if isinstance(s, dict) else str(s) for s in skills) + ".")
    else:
        parts.append("I have no relevant skills yet.")
    parts.append(f"Target role: {request['target_role']}.")
    parts.append(f"I can study {float(profile.get('available_hours_per_day') or 2):g} hours a day, "
                 f"{int(profile.get('available_days_per_week') or 5)} days a week.")
    if profile.get("deadline_weeks"):
        parts.append(f"I have {profile['deadline_weeks']} weeks.")
    ats = request.get("ats_context") or {}
    if ats.get("missing_skills"):
        parts.append(f"My ATS score was {ats.get('ats_score', 'not given')} and it listed these as missing: "
                     + ", ".join(ats["missing_skills"]) + ".")
    done = (request.get("progress") or {}).get("completed_skills")
    if done:
        parts.append("Since my last plan I have completed: " + ", ".join(done) + ".")
    return " ".join(parts)


def repair(plan: dict[str, Any], reference: dict[str, Any], facts: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Restore everything factual or arithmetic from the deterministic plan,
    keeping the model's wording where it is safe to. Returns (plan, repairs made)."""
    kb = get_knowledge()
    fixed, repairs = copy.deepcopy(plan), []
    ref_gap = {g["skill"]: g for g in reference["skill_gap"]}

    original = fixed.get("skill_gap") if isinstance(fixed.get("skill_gap"), list) else []
    restored: dict[str, dict[str, Any]] = {}
    for item in original:
        skill = kb.skill(item.get("skill", "")) if isinstance(item, dict) else None
        if skill in ref_gap and skill not in restored:
            reason = item.get("reason") if isinstance(item.get("reason"), str) and item["reason"].strip() else ref_gap[skill]["reason"]
            restored[skill] = {**ref_gap[skill], "reason": reason}        # the model's explanation, the application's facts
    for skill, gap in ref_gap.items():
        restored.setdefault(skill, gap)                                   # a gap the model omitted
    new_gap = sorted(restored.values(), key=lambda g: kb.topo_index[g["skill"]])
    if new_gap != original:
        repairs.append("skill_gap: levels, priorities and missing gaps restored from the skill-gap service")
    fixed["skill_gap"] = new_gap

    if validate_plan({**reference, "roadmap": fixed.get("roadmap") or []}, facts):
        fixed["roadmap"] = reference["roadmap"]
        repairs.append("roadmap: replaced (unknown skill, missing gap, or a skill before its prerequisite)")
    if not fixed.get("study_plan") or validate_plan({**reference, "study_plan": fixed["study_plan"]}, facts):
        fixed["study_plan"] = reference["study_plan"]
        repairs.append("study_plan: replaced by the deterministic schedule (missing or exceeded weekly hours)")

    projects = [p for p in fixed.get("projects") or [] if isinstance(p, dict) and p.get("title") in facts["project_titles"]]
    if len(projects) != len(fixed.get("projects") or []):
        repairs.append("projects: entries that were not offered were removed")
    fixed["projects"] = projects or reference["projects"]

    ids = list(dict.fromkeys(r for r in fixed.get("resource_ids") or [] if r in facts["resource_ids"]))
    if len(ids) != len(fixed.get("resource_ids") or []):
        repairs.append(f"resource_ids: {len(fixed.get('resource_ids') or []) - len(ids)} unknown or duplicate ID(s) removed")
    fixed["resource_ids"] = ids or reference["resource_ids"]

    fixed["target_role"] = reference["target_role"]
    if not isinstance(fixed.get("interview_preparation"), list) or not fixed["interview_preparation"]:
        fixed["interview_preparation"] = reference["interview_preparation"]
    if not isinstance(fixed.get("readiness_summary"), str) or not fixed["readiness_summary"].strip():
        fixed["readiness_summary"] = reference["readiness_summary"]
    return fixed, repairs


async def generate_plan(request: dict[str, Any]) -> dict[str, Any]:
    """Always returns a valid plan. `inference` says exactly how it was produced."""
    kb, catalogue = get_knowledge(), get_catalogue()
    started = time.monotonic()
    reference_out = build_plan(request, kb=kb, catalogue=catalogue)
    reference, ctx = reference_out["plan"], reference_out["context"]
    candidates = ctx["candidate_resources"]
    max_weeks = int(min(MAX_WEEKS, ctx["deadline_weeks"] or MAX_WEEKS))
    facts = facts_from_context(ctx, sections=ALL_SECTIONS, resources=candidates, max_weeks=max_weeks)

    inference: dict[str, Any] = {"model_version": MODEL_VERSION, "provider": "deterministic", "degraded": False,
                                 "attempts": 0, "repairs": [], "errors": []}
    plan = reference
    generator = get_generator()

    if generator is None:
        provider = settings.career_model_provider.lower().strip()
        if provider not in ("", "none"):
            inference.update(degraded=True, errors=[load_error() or "career model unavailable"])
    elif ctx["kept_gaps"]:
        inputs = {"gaps": ctx["kept_gaps"], "deferred": ctx["deferred"], "projects": ctx["eligible_projects"],
                  "interview_topics": ctx["interview_topics"], "resources": candidates}
        messages = chat_messages(TASK, ALL_SECTIONS, describe_request(request), knowledge_block(ctx, inputs))
        accepted = None
        for attempt in (1, 2):
            inference["attempts"] = attempt
            try:
                raw = await asyncio.wait_for(generator.generate(messages), timeout=settings.career_model_timeout_s)
            except asyncio.TimeoutError:
                inference["errors"].append(f"timeout after {settings.career_model_timeout_s}s")
                break
            except Exception as exc:
                inference["errors"].append(f"{type(exc).__name__}: {exc}"[:200])
                break
            try:
                candidate = extract_json(raw)
            except (ValueError, TypeError) as exc:
                inference["errors"].append(f"attempt {attempt}: json: {exc}")
                continue                                  # unparseable: retry generation
            problems = validate_plan(candidate, facts, kb)
            repairs: list[str] = []
            if problems:
                try:
                    candidate, repairs = repair(candidate, reference, facts)
                except Exception as exc:                  # structure too broken to repair
                    inference["errors"].append(f"attempt {attempt}: unrepairable ({type(exc).__name__})")
                    continue
                remaining = validate_plan(candidate, facts, kb)
                if remaining:
                    inference["errors"].append(f"attempt {attempt}: {remaining[0][0]}: {remaining[0][1]}")
                    continue
            accepted, inference["repairs"] = candidate, repairs
            inference["model_errors_before_repair"] = [code for code, _ in problems]
            break
        if accepted is not None:
            plan = accepted
            inference["provider"] = generator.name
        else:
            inference["degraded"] = True

    resources, rejected = catalogue.resolve(plan["resource_ids"])
    hours_per_day, days_per_week = ctx["hours_per_day"], ctx["days_per_week"]
    inference["latency_ms"] = int((time.monotonic() - started) * 1000)
    gap = ctx["gap_analysis"]
    return {
        "plan": plan,
        "resources": [public_view(r) for r in resources],
        # Every gap skill with its own courses/documentation and videos (retrieval only, no model).
        "resources_by_skill": catalogue.by_skill(
            [g for g in ctx["kept_gaps"] if g["skill"] in {x["skill"] for x in plan["skill_gap"]}],
            preference=(request.get("user_profile") or {}).get("preferred_learning_style")),
        "daily_plan": [{"week": w["week"], "days": daily_tasks(w, hours_per_day, days_per_week)} for w in plan["study_plan"][:4]],
        "readiness": {"percent": gap["readiness_percent"], "requirements_met": len(gap["met"]),
                      "requirements_total": gap["requirements_total"], "met_skills": gap["met"],
                      "assumed_from_prerequisites": gap["assumed_from_prerequisites"],
                      "unrecognised_skills": gap["unrecognised_skills"]},
        "schedule": {"weekly_hours": ctx["weekly_hours"], "hours_per_day": hours_per_day, "days_per_week": days_per_week,
                     "deadline_weeks": ctx["deadline_weeks"], "weeks_needed": ctx["weeks_needed"],
                     "fits_deadline": ctx["fits_deadline"], "deferred": ctx["deferred"]},
        "inference": inference,
        "knowledge_version": kb.version,
        "disclaimer": DISCLAIMER,
    }


def ats_to_career_request(ats_output: dict[str, Any], target_role: str, profile: dict[str, Any] | None = None,
                          progress: dict[str, Any] | None = None) -> dict[str, Any]:
    """Bridge: the ATS model's OUTPUT becomes the career model's INPUT.

    Only results cross this boundary — matched skills, missing skills, score.
    No weights, checkpoints or prompts are shared between the two models.
    """
    parsed = ats_output.get("parsed") or {}
    skills = list(dict.fromkeys([*(parsed.get("skills") or []), *(ats_output.get("matchedKeywords") or [])]))
    return {
        "target_role": target_role,
        "current_skills": [{"skill": s, "level": "beginner"} for s in skills],      # a resume shows presence, not depth
        "user_profile": profile or {},
        "ats_context": {"matched_skills": ats_output.get("matchedKeywords") or [],
                        "missing_skills": ats_output.get("missingKeywords") or [],
                        "ats_score": ats_output.get("atsScore")},
        "progress": progress or {},
    }
