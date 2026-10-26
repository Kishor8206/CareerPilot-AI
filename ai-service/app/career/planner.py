"""Deterministic career planner: gap analysis -> phased roadmap -> feasible study plan.

Three jobs, one implementation:
  * the FALLBACK when the fine-tuned career model is unavailable or invalid;
  * the TEACHER that produces the fine-tuning targets;
  * the REFERENCE that model output is validated and evaluated against.

Scheduling is arithmetic, not judgement, so it lives here rather than in the
model: a plan can never ask for more hours in a week than the user has.

Time budget
    weekly_hours = hours_per_day x days_per_week
    Learning gets 75% of the available time, projects 15%, revision and
    interview preparation 10%. (A stated design split.)
    With a deadline, if learning needs more hours than are available:
      1. defer LOW-priority gaps, least important first;
      2. then defer MEDIUM-priority secondary gaps;
      3. if it still does not fit, keep the plan and say plainly that the
         deadline is not achievable at this pace.
    A skill is never deferred while a kept skill still depends on it.
    Without a deadline the plan runs as long as it needs, capped at MAX_WEEKS.
"""
from __future__ import annotations

import math
from typing import Any

from app.career.knowledge import LEVEL_INDEX, CareerKnowledge, get_knowledge
from app.career.resources import ResourceCatalogue, get_catalogue
from app.career.skill_gap import analyse

MAX_WEEKS = 24
LEARN_SHARE, PROJECT_SHARE, REVIEW_SHARE = 0.75, 0.15, 0.10
PROJECT_HOURS = {"beginner": 12, "intermediate": 25, "advanced": 40}

PHASE_NAME = {
    ("FOUNDATION", "programming"): "Programming foundations", ("FOUNDATION", "dsa"): "Data structures and algorithms",
    ("FOUNDATION", "cs-core"): "Computer science fundamentals", ("FOUNDATION", "architecture"): "System design",
    ("FOUNDATION", "web"): "Web fundamentals",
}
CATEGORY_PHASE = {
    "LANGUAGE": "Core programming languages", "FRONTEND": "Frontend development", "BACKEND": "Backend development",
    "DATABASE": "Databases", "DEVOPS": "Deployment and DevOps", "CLOUD": "Cloud platforms", "DATA": "Data analysis",
    "ML": "Machine learning", "DATA_ENG": "Data engineering", "MOBILE": "Mobile development", "QA": "Testing and quality",
    "SECURITY": "Security", "BUSINESS": "Business and product skills", "TOOL": "Developer tools and workflow",
    "PRACTICE": "Engineering practices", "SOFT": "Professional skills",
}
OBJECTIVE = {
    "beginner": "Understand the core concepts of {s} and use them in small guided exercises",
    "intermediate": "Build working features with {s} independently and explain the main trade-offs",
    "advanced": "Design, optimise and debug non-trivial work in {s} with confidence",
}
CRITERION = {
    "beginner": "Complete a guided exercise set in {s} without referring to a solution",
    "intermediate": "Build a small working piece using {s} and explain how it works",
    "advanced": "Solve an unfamiliar, non-trivial problem in {s} and justify your design choices",
}


def _phase_of(kb: CareerKnowledge, skill: str) -> str:
    s = kb.skills[skill]
    return PHASE_NAME.get((s["category"], s["subcategory"])) or CATEGORY_PHASE.get(s["category"], "Additional skills")


def _fit_to_deadline(kb: CareerKnowledge, gaps: list[dict[str, Any]], learn_capacity: float) -> tuple[list[dict], list[dict]]:
    """Defer lower-priority gaps until the learning hours fit. Returns (kept, deferred)."""
    kept = {g["skill"]: g for g in gaps}

    def needed() -> float:
        return sum(g["estimated_hours"] for g in kept.values())

    def blocked(skill: str) -> bool:      # something we are keeping still needs it
        return any(skill in kb.all_prerequisites(other) for other in kept if other != skill)

    deferred: list[dict] = []
    for eligible in (lambda g: g["priority"] == "LOW",
                     lambda g: g["priority"] == "MEDIUM" and g["tier"] == "secondary"):
        while needed() > learn_capacity:
            candidates = [g for g in kept.values() if eligible(g) and not blocked(g["skill"])]
            if not candidates:
                break
            drop = min(candidates, key=lambda g: (g["priority_score"], -kb.topo_index[g["skill"]]))
            deferred.append(kept.pop(drop["skill"]))
    return [g for g in gaps if g["skill"] in kept], deferred


def _phases(kb: CareerKnowledge, gaps: list[dict[str, Any]], known: set[str]) -> list[dict[str, Any]]:
    """Group gaps into phases without ever placing a skill before its prerequisite.

    Gaps arrive in learning order. A skill joins the latest phase of its own
    kind that comes at or after every phase holding one of its prerequisites;
    otherwise a new phase is opened. So "React" can never land in a frontend
    phase that precedes the phase teaching JavaScript.
    """
    phases: list[dict[str, Any]] = []
    where: dict[str, int] = {}
    for gap in gaps:
        skill, name = gap["skill"], _phase_of(kb, gap["skill"])
        earliest = max((where[p] for p in kb.all_prerequisites(skill) if p in where), default=-1)
        target = next((i for i in range(len(phases) - 1, -1, -1) if phases[i]["_kind"] == name and i >= earliest), None)
        if target is None:
            repeat = sum(1 for p in phases if p["_kind"] == name)
            phases.append({"_kind": name, "phase": name if not repeat else f"{name} (advanced)", "_gaps": []})
            target = len(phases) - 1
        phases[target]["_gaps"].append(gap)
        where[skill] = target

    out = []
    for p in phases:
        skills = [g["skill"] for g in p["_gaps"]]
        outside = []
        for s in skills:
            for pre in kb.prerequisites(s):
                if pre not in skills and pre not in outside:
                    outside.append(pre)
        out.append({
            "phase": p["phase"], "skills": skills,
            "objectives": [OBJECTIVE[g["required_level"]].format(s=g["skill"]) for g in p["_gaps"]],
            "estimated_hours": round(sum(g["estimated_hours"] for g in p["_gaps"]), 1),
            "prerequisites": outside,
            "completion_criteria": [CRITERION[g["required_level"]].format(s=g["skill"]) for g in p["_gaps"]],
        })
    return out


def _projects(kb: CareerKnowledge, role: str, available: set[str], gap_skills: set[str], limit: int) -> list[dict[str, Any]]:
    out = []
    for project in kb.roles[role]["typical_projects"]:
        if not set(project["skills"]) <= available:
            continue                      # needs a skill that is neither known nor in this plan
        practised = [s for s in project["skills"] if s in gap_skills]
        reason = (f"Applies {', '.join(practised)} from your roadmap in one piece of work you can show to recruiters."
                  if practised else "Consolidates skills you already have into a piece of work you can show to recruiters.")
        out.append({"title": project["title"], "skills": project["skills"], "difficulty": project["difficulty"], "reason": reason})
    return out[:limit]


def _schedule(phases: list[dict], projects: list[dict], hours: dict[str, float], levels: dict[str, str], weekly: float,
              weeks: int, role: str, interview: list[str]) -> list[dict[str, Any]]:
    """Fill weeks in order. Every week's task hours sum to at most `weekly`."""
    queue: list[tuple[str, float]] = []
    for phase in phases:
        for skill in phase["skills"]:
            queue.append((f"Learn {skill} to {levels[skill]} level", hours[skill] * 1.0))
    for project in projects:
        queue.append((f"Build project: {project['title']}", float(PROJECT_HOURS[project["difficulty"]])))
    if interview:
        queue.append((f"Interview preparation: {interview[0]}", round(weekly * 0.4, 1)))
        queue.append((f"Mock interviews and revision for {role}", round(weekly * 0.4, 1)))

    plan, i, carried = [], 0, 0.0
    for week in range(1, weeks + 1):
        remaining, tasks = weekly, []
        review = round(min(weekly * REVIEW_SHARE, remaining), 1) if week % 2 == 0 and i < len(queue) else 0.0
        remaining -= review
        while remaining > 0.24 and i < len(queue):
            label, total = queue[i]
            left = total - carried
            spend = round(min(left, remaining), 1)
            if spend <= 0:
                i, carried = i + 1, 0.0
                continue
            tasks.append(f"{label} ({spend:g}h)")
            remaining = round(remaining - spend, 2)
            carried += spend
            if carried >= total - 0.05:
                i, carried = i + 1, 0.0
        if review:
            tasks.append(f"Revise and self-test the week's topics ({review:g}h)")
        if not tasks:
            break
        plan.append({"week": week, "tasks": tasks})
    return plan


def build_plan(request: dict[str, Any], *, kb: CareerKnowledge | None = None,
               catalogue: ResourceCatalogue | None = None) -> dict[str, Any]:
    """request: target_role, current_skills, user_profile, ats_context, progress.
    Returns {"plan": <CareerPlan dict>, "context": <facts behind it>}."""
    kb = kb or get_knowledge()
    catalogue = catalogue or get_catalogue()
    profile = request.get("user_profile") or {}
    progress = request.get("progress") or {}
    ats = request.get("ats_context") or {}

    hours_per_day = float(min(12.0, max(0.5, profile.get("available_hours_per_day") or 2)))
    days_per_week = int(min(7, max(1, profile.get("available_days_per_week") or 5)))
    weekly = round(hours_per_day * days_per_week, 1)
    deadline_weeks = profile.get("deadline_weeks")
    experience = str(profile.get("experience_level") or "STUDENT").upper()

    gap = analyse(request["target_role"], request.get("current_skills") or [],
                  ats_missing=ats.get("missing_skills") or [], completed_skills=progress.get("completed_skills") or [],
                  experience=experience, kb=kb)
    role, gaps = gap["target_role"], gap["gaps"]

    deferred: list[dict] = []
    needed = sum(g["estimated_hours"] for g in gaps)
    if deadline_weeks:
        weeks_available = int(min(MAX_WEEKS, max(1, deadline_weeks)))
        gaps, deferred = _fit_to_deadline(kb, gaps, weeks_available * weekly * LEARN_SHARE)
    kept_hours = sum(g["estimated_hours"] for g in gaps)

    known = set(gap["current"]) | set(gap["assumed_from_prerequisites"])
    gap_skills = {g["skill"] for g in gaps}
    phases = _phases(kb, gaps, known)

    # Weeks: the deadline if there is one, otherwise as long as the learning needs.
    weeks_needed = max(1, math.ceil(kept_hours / (weekly * LEARN_SHARE))) if gaps else 1
    weeks = int(min(MAX_WEEKS, deadline_weeks or weeks_needed))
    fits = weeks_needed <= weeks

    # Projects are chosen to fit their own share of the time, hardest that fits first,
    # so they can never push the plan past the weeks the learning was sized for.
    project_budget = weeks * weekly * PROJECT_SHARE
    done = {str(p).strip().lower() for p in progress.get("completed_projects") or []}
    eligible = [p for p in _projects(kb, role, known | gap_skills, gap_skills, 3) if p["title"].lower() not in done]
    projects, spent = [], 0.0
    for project in sorted(eligible, key=lambda p: -PROJECT_HOURS[p["difficulty"]]):
        if spent + PROJECT_HOURS[project["difficulty"]] <= project_budget:
            projects.append(project)
            spent += PROJECT_HOURS[project["difficulty"]]
    if not projects and eligible:                       # always offer at least the smallest one
        projects = [min(eligible, key=lambda p: PROJECT_HOURS[p["difficulty"]])]
    projects.sort(key=lambda p: PROJECT_HOURS[p["difficulty"]])

    # Interview preparation: revise the most important CORE gaps first, then the role's topics.
    core_gaps = [g["skill"] for g in sorted(gaps, key=lambda g: -g["priority_score"])
                 if g["tier"] == "core" and g["priority"] == "HIGH"]
    topics = kb.roles[role]["interview_topics"]
    interview = [f"Revise {s}: a high-priority gap for this role" for s in core_gaps[:2]] + topics[:6]

    study_plan = _schedule(phases, projects, {g["skill"]: g["estimated_hours"] for g in gaps},
                           {g["skill"]: g["required_level"] for g in gaps}, weekly, weeks, role, topics)

    resources = catalogue.for_gaps(gaps, preference=profile.get("preferred_learning_style"), limit=8)

    summary = (f"You meet {len(gap['met'])} of {gap['requirements_total']} skill requirements for {role} "
               f"(readiness {gap['readiness_percent']:g}%). ")
    if not gaps:
        summary += "You have no outstanding skill gaps for this role; focus on projects and interview practice."
    else:
        counts = {p: sum(1 for g in gaps if g["priority"] == p) for p in ("HIGH", "MEDIUM", "LOW")}
        summary += (f"This plan covers {len(gaps)} skill gaps ({counts['HIGH']} high, {counts['MEDIUM']} medium, "
                    f"{counts['LOW']} low priority), about {kept_hours:g} study hours. At {weekly:g} hours a week "
                    f"({hours_per_day:g}h x {days_per_week} days) it needs about {weeks_needed} weeks.")
    if deferred:
        summary += (f" To fit your {deadline_weeks}-week deadline, {len(deferred)} lower-priority skill(s) are deferred: "
                    f"{', '.join(d['skill'] for d in deferred[:5])}{'…' if len(deferred) > 5 else ''}.")
    if deadline_weeks and not fits:
        summary += (f" Even so, the plan needs about {weeks_needed} weeks, so a {deadline_weeks}-week deadline is not "
                    "achievable at this pace; increase your weekly hours or extend the deadline.")

    plan = {
        "target_role": role, "readiness_summary": summary,
        "skill_gap": [{k: g[k] for k in ("skill", "current_level", "required_level", "priority", "reason")} for g in gaps],
        "roadmap": phases, "study_plan": study_plan, "projects": projects,
        "interview_preparation": interview, "resource_ids": [r["resource_id"] for r in resources],
    }
    context = {
        "gap_analysis": gap, "weekly_hours": weekly, "hours_per_day": hours_per_day, "days_per_week": days_per_week,
        "deadline_weeks": deadline_weeks, "weeks_planned": len(study_plan), "weeks_needed": weeks_needed,
        "fits_deadline": fits, "hours_needed_before_deferral": round(needed, 1), "hours_planned": round(kept_hours, 1),
        "deferred": [{"skill": d["skill"], "priority": d["priority"]} for d in deferred],
        "candidate_resources": resources, "knowledge_version": kb.version,
        # Facts the career model is shown (see app/career/prompts.py).
        "kept_gaps": gaps, "eligible_projects": eligible, "interview_topics": topics,
    }
    return {"plan": plan, "context": context}


def daily_tasks(week: dict[str, Any], hours_per_day: float, days_per_week: int) -> list[dict[str, Any]]:
    """Expand one week's tasks into days. Pure arithmetic: no day exceeds
    hours_per_day and the days sum to the week's hours."""
    import re
    items = []
    for task in week["tasks"]:
        m = re.search(r"\(([\d.]+)h\)\s*$", task)
        items.append([re.sub(r"\s*\([\d.]+h\)\s*$", "", task), float(m.group(1)) if m else 0.0])
    days, i = [], 0
    for day in range(1, days_per_week + 1):
        left, tasks = hours_per_day, []
        while left > 0.05 and i < len(items):
            spend = round(min(items[i][1], left), 1)
            if spend > 0:
                tasks.append(f"{items[i][0]} ({spend:g}h)")
                items[i][1] = round(items[i][1] - spend, 2)
                left = round(left - spend, 2)
            if items[i][1] <= 0.05:
                i += 1
        if tasks:
            days.append({"day": day, "tasks": tasks})
    return days
