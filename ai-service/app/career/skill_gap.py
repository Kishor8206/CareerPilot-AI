"""Skill-gap service: deterministic comparison of what a user has with what a role needs.

No model is involved. The result is the factual context the career model
explains, the fallback when the model is unavailable, and the reference the
model's skill-gap output is evaluated against.

Method
  1. Normalise skill names and levels.
  2. Infer prerequisites of skills the user already has: knowing React at
     intermediate level is evidence of at least beginner JavaScript, so the
     plan does not send an experienced user back to "learn JavaScript basics".
  3. For each role requirement, gap = required level above current level.
  4. Add any prerequisite the user lacks that a gap skill depends on.
  5. Score each gap, map the score to HIGH / MEDIUM / LOW, and state why.

Priority score (transparent, additive):
    importance x 10              role importance, 1-5 (a prerequisite inherits
                                 80% of the most important skill that needs it)
  + 8   if a core requirement
  + 6 per gap skill it unblocks  (capped at 24)
  + 12  if the ATS analysis listed it as missing
  + 4 per level to climb
  HIGH >= 62, MEDIUM >= 40, otherwise LOW.
The weights are a stated design choice, not learned or validated values.
"""
from __future__ import annotations

from typing import Any, Iterable

from app.career.knowledge import LEVEL_FRACTION, LEVEL_INDEX, LEVELS, CareerKnowledge, get_knowledge, parse_level

HIGH_AT, MEDIUM_AT = 62, 40
# Study-time multiplier by background: prior experience speeds learning up.
EXPERIENCE_MULTIPLIER = {"STUDENT": 1.0, "FRESH_GRADUATE": 1.0, "ENTRY_LEVEL": 0.95, "MID_LEVEL": 0.85, "CAREER_SWITCHER": 1.15}


def normalise_skills(kb: CareerKnowledge, current: Iterable[Any], completed: Iterable[str] = ()) -> tuple[dict[str, str], list[str]]:
    """-> ({canonical skill: level}, [unrecognised names]). Accepts
    {"skill", "level"} objects or bare names (treated as beginner)."""
    have: dict[str, str] = {}
    unknown: list[str] = []

    def put(name: Any, level: str) -> None:
        canonical = kb.skill(name) if isinstance(name, str) else None
        if canonical is None:
            if isinstance(name, str) and name.strip() and name.strip() not in unknown:
                unknown.append(name.strip())
            return
        if LEVEL_INDEX[level] > LEVEL_INDEX[have.get(canonical, "none")]:
            have[canonical] = level

    for item in current or []:
        if isinstance(item, dict):
            put(item.get("skill"), parse_level(item.get("level")))
        else:
            put(item, "beginner")
    for name in completed or []:
        put(name, "intermediate")       # a completed skill counts as at least intermediate
    return have, unknown


def infer_prerequisites(kb: CareerKnowledge, have: dict[str, str]) -> dict[str, str]:
    """Levels implied by skills the user has. Returns only the INFERRED entries."""
    inferred: dict[str, str] = {}
    for skill, level in have.items():
        if LEVEL_INDEX[level] < 1:
            continue
        implied = LEVELS[min(LEVEL_INDEX[level], LEVEL_INDEX["intermediate"])]
        for pre in kb.all_prerequisites(skill):
            best = max(have.get(pre, "none"), inferred.get(pre, "none"), key=LEVEL_INDEX.get)
            if LEVEL_INDEX[implied] > LEVEL_INDEX[best]:
                inferred[pre] = implied
    return inferred


def analyse(target_role: str, current_skills: Iterable[Any], *, ats_missing: Iterable[str] = (),
            completed_skills: Iterable[str] = (), experience: str = "STUDENT",
            kb: CareerKnowledge | None = None) -> dict[str, Any]:
    kb = kb or get_knowledge()
    role = kb.role(target_role)
    if role is None:
        raise ValueError(f"unknown target role: {target_role!r}")

    have, unknown = normalise_skills(kb, current_skills, completed_skills)
    inferred = infer_prerequisites(kb, have)
    effective = {**inferred, **have}
    ats = {kb.skill(s) for s in ats_missing or []} - {None}
    multiplier = EXPERIENCE_MULTIPLIER.get(experience, 1.0)

    requirements = kb.role_requirements(role)
    gaps: dict[str, dict[str, Any]] = {}
    met: list[str] = []
    weight_total = weight_met = 0.0
    for req in requirements:
        skill, required = req["skill"], req["required_level"]
        current = effective.get(skill, "none")
        weight_total += req["importance"]
        weight_met += req["importance"] * min(1.0, LEVEL_FRACTION[current] / LEVEL_FRACTION[required])
        if LEVEL_INDEX[current] >= LEVEL_INDEX[required]:
            met.append(skill)
        else:
            gaps[skill] = {"skill": skill, "current_level": current, "required_level": required,
                           "tier": req["tier"], "importance": float(req["importance"])}

    # Prerequisites the user lacks entirely, needed by something on the path.
    for skill in list(gaps):
        for pre in kb.all_prerequisites(skill):
            if pre not in gaps and effective.get(pre, "none") == "none":
                gaps[pre] = {"skill": pre, "current_level": "none", "required_level": "beginner",
                             "tier": "prerequisite", "importance": 0.0}

    dependents: dict[str, list[str]] = {s: [] for s in gaps}
    for skill in gaps:
        for pre in kb.all_prerequisites(skill):
            if pre in gaps:
                dependents[pre].append(skill)
    for skill, gap in gaps.items():
        if gap["tier"] == "prerequisite":
            gap["importance"] = round(0.8 * max((gaps[d]["importance"] for d in dependents[skill]
                                                 if gaps[d]["tier"] != "prerequisite"), default=2.0), 2)

    for skill, gap in gaps.items():
        climb = LEVEL_INDEX[gap["required_level"]] - LEVEL_INDEX[gap["current_level"]]
        unblocks = sorted(dependents[skill], key=lambda s: kb.topo_index[s])
        score = (gap["importance"] * 10 + (8 if gap["tier"] == "core" else 0) + min(24, 6 * len(unblocks))
                 + (12 if skill in ats else 0) + 4 * climb)
        gap.update(
            priority_score=round(score, 1),
            priority="HIGH" if score >= HIGH_AT else "MEDIUM" if score >= MEDIUM_AT else "LOW",
            unblocks=unblocks, ats_flagged=skill in ats,
            estimated_hours=round(kb.hours(skill, gap["current_level"], gap["required_level"]) * multiplier, 1),
            prerequisites=kb.prerequisites(skill),
        )
        gap["reason"] = _reason(gap, role)

    ordered = sorted(gaps.values(), key=lambda g: kb.topo_index[g["skill"]])
    return {
        "target_role": role,
        "gaps": ordered,
        "met": sorted(met, key=lambda s: kb.topo_index[s]),
        "current": dict(sorted(have.items())),
        "assumed_from_prerequisites": dict(sorted(inferred.items())),
        "unrecognised_skills": unknown,
        "readiness_percent": round(100 * weight_met / weight_total, 1) if weight_total else 0.0,
        "requirements_total": len(requirements),
        "total_gap_hours": round(sum(g["estimated_hours"] for g in ordered), 1),
        "knowledge_version": kb.version,
    }


def article(noun: str) -> str:
    """'an AI Engineer', 'a Data Analyst', 'an SRE-style' — by first sound, approximated by first letter."""
    return ("an " if noun[:1].lower() in "aeiou" or noun.split()[0] in ("ML", "MERN", "SRE", "HR") else "a ") + noun


def _reason(gap: dict[str, Any], role: str) -> str:
    """One sentence built only from the facts that produced the priority."""
    if gap["tier"] == "core":
        lead = f"{gap['skill']} is a core skill for {article(role)}"
    elif gap["tier"] == "secondary":
        lead = f"{gap['skill']} is a supporting skill for {article(role)}"
    else:
        lead = f"{gap['skill']} is a prerequisite you have not covered yet"
    if gap["current_level"] == "none":
        lead += f" and needs to reach {gap['required_level']} level"
    else:
        lead += f" and needs to move from {gap['current_level']} to {gap['required_level']}"
    extras = []
    if gap["unblocks"]:
        shown = ", ".join(gap["unblocks"][:3])
        extras.append(f"it unlocks {shown}" + (" and more" if len(gap["unblocks"]) > 3 else ""))
    if gap["ats_flagged"]:
        extras.append("your ATS analysis flagged it as missing")
    return lead + ("; " + "; ".join(extras) if extras else "") + "."
