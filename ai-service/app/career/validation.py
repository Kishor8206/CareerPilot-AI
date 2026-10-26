"""Validate a career plan against the schema AND against the facts it was given.

One implementation, three uses: rejecting bad training examples, checking model
output before it reaches a user, and computing evaluation metrics. A plan that
is well-formed JSON can still be wrong — recommending a skill the learner has,
ordering React before JavaScript, scheduling 20 hours into a 10-hour week, or
citing a resource that does not exist. Each of those is a named check here.

`facts` is what the prompt contained (see `facts_from_context`): the model may
use nothing else.
"""
from __future__ import annotations

import json
import re
from typing import Any

from pydantic import ValidationError

from app.career.knowledge import LEVEL_INDEX, CareerKnowledge, get_knowledge
from app.career.schemas import CareerPlan

_URL = re.compile(r"https?://|www\.", re.I)
_HOURS = re.compile(r"\(([\d.]+)h\)")
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)
_THINK = re.compile(r"<think>.*?</think>", re.S)

# Every check has a stable code so evaluation can count failures by kind.
CHECKS = ("json", "schema", "role", "unknown_skill", "skill_not_in_gaps", "recommends_met_skill", "level",
          "gap_mismatch", "priority_mismatch", "prerequisite_order", "phase_coverage", "duplicate", "week_overload", "week_sequence",
          "too_many_weeks", "unknown_resource", "unknown_project", "url", "section_not_requested", "empty")


def extract_json(text: str) -> dict[str, Any]:
    """First balanced JSON object in the text, ignoring <think> blocks and code fences."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty output")
    text = _THINK.sub("", text)
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object found")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                obj = json.loads(text[start:i + 1])
                if not isinstance(obj, dict):
                    raise ValueError("top-level JSON is not an object")
                return obj
    raise ValueError("unterminated JSON (output likely truncated)")


def facts_from_context(context: dict[str, Any], *, sections: tuple[str, ...], resources: list[dict[str, Any]],
                       max_weeks: int) -> dict[str, Any]:
    """The allowed universe for one request, derived from what the prompt showed."""
    gap = context["gap_analysis"]
    return {
        "role": gap["target_role"], "met": set(gap["met"]),
        "gaps": {g["skill"]: g for g in context["kept_gaps"]},
        "weekly_hours": context["weekly_hours"], "max_weeks": max_weeks,
        "resource_ids": {r["resource_id"] for r in resources},
        "project_titles": {p["title"] for p in context["eligible_projects"]},
        "sections": set(sections),
    }


def validate_plan(plan: Any, facts: dict[str, Any], kb: CareerKnowledge | None = None) -> list[tuple[str, str]]:
    """-> list of (check_code, message). Empty list = valid."""
    kb = kb or get_knowledge()
    try:
        parsed = CareerPlan.model_validate(plan).model_dump()
    except ValidationError as exc:
        first = exc.errors()[0]
        return [("schema", f"{'.'.join(map(str, first['loc']))}: {first['msg']}")]

    errors: list[tuple[str, str]] = []
    gaps, sections = facts["gaps"], facts["sections"]

    if kb.role(parsed["target_role"]) != facts["role"]:
        errors.append(("role", f"target_role {parsed['target_role']!r} is not {facts['role']!r}"))
    if _URL.search(json.dumps(parsed)):
        errors.append(("url", "the plan contains a URL; resources must be referenced by ID"))

    for section in ("skill_gap", "roadmap", "study_plan", "projects", "interview_preparation", "resource_ids"):
        if parsed[section] and section not in sections:
            errors.append(("section_not_requested", f"{section} was filled but the task did not ask for it"))
    if not any(parsed[s] for s in sections) and gaps:
        errors.append(("empty", "none of the requested sections was filled"))

    # ---- skill gap
    seen = set()
    for item in parsed["skill_gap"]:
        skill = item["skill"]
        if skill not in kb.skills:
            errors.append(("unknown_skill", f"skill_gap: {skill!r} is not a known skill"))
            continue
        if skill in seen:
            errors.append(("duplicate", f"skill_gap lists {skill} twice"))
        seen.add(skill)
        if skill in facts["met"]:
            errors.append(("recommends_met_skill", f"{skill} is already at the required level"))
        elif skill not in gaps:
            errors.append(("skill_not_in_gaps", f"{skill} is not one of the supplied gaps"))
        else:
            g = gaps[skill]
            if (item["current_level"], item["required_level"]) != (g["current_level"], g["required_level"]):
                errors.append(("gap_mismatch", f"{skill}: levels {item['current_level']}->{item['required_level']} "
                                               f"differ from the supplied {g['current_level']}->{g['required_level']}"))
            if g.get("priority") and item["priority"] != g["priority"]:
                errors.append(("priority_mismatch", f"{skill}: priority {item['priority']} differs from the supplied {g['priority']}"))
        if LEVEL_INDEX[item["required_level"]] <= LEVEL_INDEX[item["current_level"]]:
            errors.append(("level", f"{skill}: required level is not above the current level"))

    # ---- roadmap
    phase_of: dict[str, int] = {}
    for index, phase in enumerate(parsed["roadmap"]):
        for skill in phase["skills"]:
            if skill not in kb.skills:
                errors.append(("unknown_skill", f"roadmap: {skill!r} is not a known skill"))
            elif skill in phase_of:
                errors.append(("duplicate", f"{skill} appears in more than one phase"))
            else:
                phase_of[skill] = index
                if skill in facts["met"]:
                    errors.append(("recommends_met_skill", f"roadmap teaches {skill}, which is already met"))
                elif skill not in gaps:
                    errors.append(("skill_not_in_gaps", f"roadmap: {skill} is not one of the supplied gaps"))
    for skill, index in phase_of.items():
        if skill in kb.skills:
            for pre in kb.all_prerequisites(skill):
                if phase_of.get(pre, -1) > index:
                    errors.append(("prerequisite_order", f"{skill} is scheduled before its prerequisite {pre}"))
    if "roadmap" in sections and parsed["roadmap"] and set(phase_of) != set(gaps):
        missing = sorted(set(gaps) - set(phase_of))
        if missing:
            errors.append(("phase_coverage", f"roadmap omits gap skills: {', '.join(missing[:5])}"))

    # ---- study plan
    weeks = [w["week"] for w in parsed["study_plan"]]
    if weeks and weeks != list(range(weeks[0], weeks[0] + len(weeks))):
        errors.append(("week_sequence", f"weeks are not consecutive: {weeks[:8]}"))
    if len(weeks) > facts["max_weeks"]:
        errors.append(("too_many_weeks", f"{len(weeks)} weeks exceeds the limit of {facts['max_weeks']}"))
    for week in parsed["study_plan"]:
        total = sum(float(h) for task in week["tasks"] for h in _HOURS.findall(task))
        if total > facts["weekly_hours"] + 0.11:
            errors.append(("week_overload", f"week {week['week']} has {total:g}h but only {facts['weekly_hours']:g}h are available"))

    # ---- projects and resources
    for project in parsed["projects"]:
        if project["title"] not in facts["project_titles"]:
            errors.append(("unknown_project", f"project {project['title']!r} was not offered"))
    if len(set(parsed["resource_ids"])) != len(parsed["resource_ids"]):
        errors.append(("duplicate", "resource_ids contains duplicates"))
    for rid in parsed["resource_ids"]:
        if rid not in facts["resource_ids"]:
            errors.append(("unknown_resource", f"resource {rid!r} was not offered (hallucinated ID)"))
    return errors
