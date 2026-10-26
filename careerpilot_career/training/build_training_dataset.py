"""Generate the supervised fine-tuning examples.  ->  data/generated/career_sft.jsonl

    python training/build_training_dataset.py            # 10,000 examples
    python training/build_training_dataset.py --n 2000

HOW EXAMPLES ARE MADE — and what that means
    Each example is: a synthetic learner profile  ->  the deterministic planner
    (ai-service/app/career/planner.py) over the curated knowledge  ->  the plan,
    reduced to the sections the task asks for.
    The learner profiles are SYNTHETIC combinations. The career facts are not
    invented per example: every skill, level, prerequisite, project, topic and
    resource ID comes from the knowledge layer, and each record stores the
    exact facts it was built from so it can be re-validated on its own.
    So the model learns to reproduce this planner's reasoning from a request
    plus supplied knowledge. It is not learning from real human-written
    roadmaps, because no such dataset exists.

TASKS
    32 task types (the spec's A to AF). They differ in the learner scenario,
    in the wording of the request, and in which output sections are filled.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
from collections import Counter
from typing import Any

from common import DATASET_VERSION, GENERATED

from app.career.knowledge import LEVEL_INDEX, LEVELS, get_knowledge
from app.career.planner import MAX_WEEKS, build_plan, daily_tasks
from app.career.prompts import ALL_SECTIONS, chat_messages, knowledge_block
from app.career.resources import get_catalogue
from app.career.skill_gap import article
from app.career.validation import facts_from_context

SEED = 42
FULL = ALL_SECTIONS
UNKNOWN_SKILLS = ["Photoshop", "AutoCAD", "SAP FICO", "Video Editing", "Tally", "Content Writing", "Blender", "Salesforce Admin"]
NON_TECH = ["Excel", "Communication", "Project Management", "Business Analysis", "Teamwork"]

# code: (task name, sections, archetypes, flags, weight)
TASKS: dict[str, tuple[str, tuple[str, ...], tuple[str, ...], dict[str, Any], float]] = {
    "A":  ("Career selection", ("skill_gap",), ("beginner", "intermediate"), {"compare": 3}, 2),
    "B":  ("Career role analysis", ("skill_gap", "roadmap", "projects", "interview_preparation"), ("blank",), {}, 2),
    "C":  ("Skill analysis", ("skill_gap",), ("beginner", "intermediate", "advanced"), {}, 2),
    "D":  ("Skill-gap analysis", ("skill_gap",), ("beginner", "intermediate"), {}, 3),
    "E":  ("Skill prioritisation", ("skill_gap",), ("beginner", "intermediate"), {"sort_priority": True}, 3),
    "F":  ("Prerequisite reasoning", ("roadmap",), ("blank", "beginner"), {}, 3),
    "G":  ("Learning sequence", ("roadmap",), ("beginner", "intermediate"), {}, 3),
    "H":  ("Career roadmap", FULL, ("beginner", "intermediate"), {}, 6),
    "I":  ("Weekly study plan", ("study_plan",), ("beginner", "intermediate"), {}, 4),
    "J":  ("Daily study plan", ("study_plan",), ("beginner", "intermediate"), {"daily": True}, 3),
    "K":  ("Project recommendation", ("projects",), ("beginner", "intermediate", "advanced"), {}, 2),
    "L":  ("Interview preparation", ("interview_preparation",), ("intermediate", "advanced"), {}, 2),
    "M":  ("Resource selection", ("resource_ids",), ("beginner", "intermediate"), {}, 3),
    "N":  ("Time-constrained roadmap", FULL, ("beginner", "intermediate"), {"hours": (1, 1.5), "days": (3, 4, 5)}, 4),
    "O":  ("Deadline-based roadmap", FULL, ("beginner", "intermediate"), {"deadline": (4, 6, 8, 10, 12)}, 4),
    "P":  ("Beginner roadmap", FULL, ("blank", "beginner"), {}, 4),
    "Q":  ("Intermediate roadmap", FULL, ("intermediate",), {}, 4),
    "R":  ("Advanced roadmap", FULL, ("advanced",), {}, 3),
    "S":  ("Career switching", FULL, ("switcher",), {"experience": "CAREER_SWITCHER"}, 3),
    "T":  ("Fresh graduate roadmap", FULL, ("beginner", "intermediate"), {"experience": "FRESH_GRADUATE"}, 3),
    "U":  ("Student roadmap", FULL, ("blank", "beginner"), {"experience": "STUDENT"}, 3),
    "V":  ("Partial skill profile", FULL, ("beginner",), {"unknown": True, "bare_names": True}, 3),
    "W":  ("Progress adaptation", FULL, ("beginner", "intermediate"), {"progress": True}, 4),
    "X":  ("Failed learning plan adaptation", FULL, ("beginner", "intermediate"), {"progress": True, "behind": True}, 3),
    "Y":  ("Changing target role", FULL, ("intermediate",), {"switch_role": True}, 3),
    "Z":  ("Multi-role comparison", ("skill_gap", "roadmap"), ("beginner", "intermediate"), {"compare": 3}, 2),
    "AA": ("Resume-derived career guidance", FULL, ("beginner", "intermediate"), {"resume": True, "bare_names": True}, 3),
    "AB": ("ATS-result-based career guidance", FULL, ("beginner", "intermediate"), {"ats": True}, 4),
    "AC": ("Skill reinforcement", ("skill_gap", "roadmap", "resource_ids"), ("intermediate",), {"reinforce": True}, 2),
    "AD": ("Revision planning", ("study_plan",), ("intermediate", "advanced"), {"revision": True}, 2),
    "AE": ("Interview gap analysis", ("skill_gap", "interview_preparation"), ("intermediate", "advanced"), {}, 2),
    "AF": ("Project portfolio planning", ("skill_gap", "projects"), ("beginner", "intermediate"), {}, 2),
}
KNOWN_SHARE = {"blank": (0.0, 0.0), "beginner": (0.1, 0.3), "intermediate": (0.4, 0.65), "advanced": (0.75, 0.95), "switcher": (0.0, 0.12)}
LEVEL_WORD = {"beginner": ["basic", "beginner-level", "some"], "intermediate": ["intermediate", "working knowledge of", "decent"],
              "advanced": ["advanced", "strong", "solid"]}


# ------------------------------------------------------------- scenario
def sample_skills(rng: random.Random, kb, role: str, archetype: str, flags: dict) -> list[dict[str, str]]:
    order = kb.roles[role]["recommended_learning_order"]
    required = {r["skill"]: r["required_level"] for r in kb.role_requirements(role)}
    lo, hi = KNOWN_SHARE[archetype]
    k = round(rng.uniform(lo, hi) * len(order))
    pool = order[: min(len(order), k + 3)]
    chosen = sorted(rng.sample(pool, min(k, len(pool))), key=order.index)
    skills = []
    for s in chosen:
        target = LEVEL_INDEX[required.get(s, "intermediate")]
        if flags.get("reinforce"):
            level = max(1, target - 1)                       # everything one step short
        elif archetype == "advanced":
            level = target if rng.random() < 0.8 else max(1, target - 1)
        else:
            level = max(1, target - rng.choice([0, 1, 1]))
        skills.append({"skill": s, "level": LEVELS[level]})
    if archetype == "switcher":
        skills += [{"skill": s, "level": rng.choice(["intermediate", "advanced"])} for s in rng.sample(NON_TECH, 2)]
    others = [s for s in kb.skills if s not in order and kb.skills[s]["category"] != "SOFT"]
    for s in rng.sample(others, rng.choice([0, 0, 1, 2])):   # skills irrelevant to this role
        skills.append({"skill": s, "level": rng.choice(["beginner", "intermediate"])})
    if flags.get("unknown") or rng.random() < 0.12:
        skills.append({"skill": rng.choice(UNKNOWN_SKILLS), "level": "intermediate"})
    rng.shuffle(skills)
    return skills


def sample_scenario(rng: random.Random, kb, code: str) -> dict[str, Any]:
    _, _, archetypes, flags, _ = TASKS[code]
    role = rng.choice(sorted(kb.roles))
    archetype = rng.choice(archetypes)
    skills = sample_skills(rng, kb, role, archetype, flags)
    hours = rng.choice(flags.get("hours") or (1, 1.5, 2, 2, 3, 3, 4, 5, 6))
    days = rng.choice(flags.get("days") or (3, 4, 5, 5, 6, 6, 7))
    deadline = rng.choice(flags["deadline"]) if "deadline" in flags else rng.choice([None, None, None, 8, 12, 16, 20, 24])
    experience = flags.get("experience") or rng.choice(["STUDENT", "STUDENT", "FRESH_GRADUATE", "ENTRY_LEVEL", "MID_LEVEL"])
    request = {
        "target_role": role, "current_skills": skills,
        "user_profile": {"available_hours_per_day": hours, "available_days_per_week": days, "deadline_weeks": deadline,
                         "experience_level": experience,
                         "preferred_learning_style": rng.choice([None, None, "video", "reading", "hands-on", "course"])},
        "ats_context": {}, "progress": {},
    }
    scenario = {"code": code, "archetype": archetype, "flags": flags, "request": request, "notes": {}}

    if flags.get("ats") or flags.get("resume"):
        gaps = [g["skill"] for g in build_plan(request)["context"]["gap_analysis"]["gaps"] if g["tier"] != "prerequisite"]
        if flags.get("ats") and gaps:
            missing = rng.sample(gaps, min(len(gaps), rng.randint(2, 4)))
            request["ats_context"] = {"missing_skills": missing, "matched_skills": [s["skill"] for s in skills][:5],
                                      "ats_score": rng.randint(35, 78)}
    if flags.get("progress"):
        first = build_plan(request)["context"]["kept_gaps"]
        done = [g["skill"] for g in first[: rng.randint(1, max(1, min(4, len(first))))]]
        request["progress"] = {"completed_skills": done, "completed_projects": [], "current_phase": ""}
        if flags.get("behind"):
            scenario["notes"]["previous_hours"] = hours
            request["user_profile"]["available_hours_per_day"] = max(1, hours - rng.choice([1, 1, 2]))
    if flags.get("switch_role"):
        related = [r for r in kb.roles[role]["related_roles"] if r in kb.roles] or [r for r in kb.roles if r != role]
        scenario["notes"]["previous_role"] = rng.choice(related)
    return scenario


# -------------------------------------------------------- request wording
def describe_skills(rng: random.Random, skills: list[dict], bare: bool) -> str:
    if not skills:
        return "I have no relevant skills yet"
    if bare:
        return "My skills: " + ", ".join(s["skill"] for s in skills)
    parts = [f"{rng.choice(LEVEL_WORD[s['level']])} {s['skill']}" for s in skills]
    return rng.choice(["I know ", "I have ", "My current skills are "]) + ", ".join(parts)


def request_text(rng: random.Random, scenario: dict[str, Any]) -> str:
    req, flags, notes = scenario["request"], scenario["flags"], scenario["notes"]
    profile, role = req["user_profile"], req["target_role"]
    if rng.random() < 0.25 and not flags.get("compare"):
        return json.dumps({k: v for k, v in req.items() if v}, ensure_ascii=False)       # structured form (spec §14)

    who = {"STUDENT": "I am a student", "FRESH_GRADUATE": "I am a fresh graduate", "ENTRY_LEVEL": "I am in an entry-level job",
           "MID_LEVEL": "I have a few years of work experience", "CAREER_SWITCHER": "I am switching careers from a non-technical field"}
    lines = [who[profile["experience_level"]] + "."]
    if flags.get("resume"):
        lines.append("These skills were extracted from my resume. " + describe_skills(rng, req["current_skills"], True) + ".")
    else:
        lines.append(describe_skills(rng, req["current_skills"], bool(flags.get("bare_names"))) + ".")
    if flags.get("compare"):
        lines.append("I am deciding between these roles: " + ", ".join(notes["candidates"]) + ". Which fits me best?")
    elif flags.get("switch_role"):
        lines.append(f"I was preparing for {notes['previous_role']} but I now want to become {article(role)}.")
    else:
        lines.append(rng.choice([f"I want to become {article(role)}.", f"My goal is {article(role)} role.", f"Target role: {role}."]))
    lines.append(f"I can study {profile['available_hours_per_day']:g} hours a day, {profile['available_days_per_week']} days a week.")
    if profile.get("deadline_weeks"):
        lines.append(rng.choice([f"I have {profile['deadline_weeks']} weeks.", f"My deadline is {profile['deadline_weeks']} weeks from now."]))
    if req["ats_context"].get("missing_skills"):
        lines.append(f"My ATS score was {req['ats_context']['ats_score']} and it listed these as missing: "
                     + ", ".join(req["ats_context"]["missing_skills"]) + ".")
    if req["progress"].get("completed_skills"):
        lines.append("Since my last plan I have completed: " + ", ".join(req["progress"]["completed_skills"]) + ".")
    if flags.get("behind"):
        lines.append(f"I fell behind my previous plan of {notes['previous_hours']:g} hours a day and need a realistic one.")
    if profile.get("preferred_learning_style"):
        lines.append(f"I prefer {profile['preferred_learning_style']} resources.")
    if flags.get("revision"):
        lines.append("Plan my revision of the skills I already have.")
    return " ".join(lines)


# ------------------------------------------------------------- examples
def make_example(rng: random.Random, kb, catalogue, code: str) -> dict[str, Any] | None:
    name, sections, _, flags, _ = TASKS[code]
    scenario = sample_scenario(rng, kb, code)
    req = scenario["request"]
    extra_knowledge: list[str] = []

    if flags.get("compare"):
        role = req["target_role"]
        pool = [r for r in kb.roles[role]["related_roles"] if r in kb.roles] + [r for r in sorted(kb.roles) if r != role]
        candidates = [role] + list(dict.fromkeys(pool))[: flags["compare"] - 1]
        scored = []
        for c in candidates:
            ctx = build_plan({**req, "target_role": c})["context"]["gap_analysis"]
            scored.append((c, ctx["readiness_percent"], ctx["total_gap_hours"]))
        best = max(scored, key=lambda x: (x[1], -x[2], x[0]))
        req["target_role"] = best[0]
        rng.shuffle(candidates)
        scenario["notes"]["candidates"] = candidates
        extra_knowledge.append("candidate_roles (role | readiness_percent | gap_hours): "
                               + "; ".join(f"{c} | {r:g} | {h:g}" for c, r, h in sorted(scored)))

    out = build_plan(req)
    plan, ctx = out["plan"], out["context"]
    if not ctx["kept_gaps"] and code not in ("AD", "K", "L"):
        return None                                           # nothing to plan: not a useful example for this task

    # Candidate resources shown to the model: the relevant ones plus distractors, shuffled.
    relevant = ctx["candidate_resources"]
    gap_skills = {g["skill"] for g in ctx["kept_gaps"]}
    others = [r for r in catalogue.by_id.values() if r["verification_status"] in ("verified", "reachable")
              and not set(r["skill_ids"]) & gap_skills]
    shown = relevant + rng.sample(others, min(len(others), rng.randint(2, 4)))
    rng.shuffle(shown)

    target = {"target_role": plan["target_role"], "readiness_summary": plan["readiness_summary"],
              **{s: (plan[s] if s in sections else []) for s in ALL_SECTIONS}}
    max_weeks = int(min(MAX_WEEKS, ctx["deadline_weeks"] or MAX_WEEKS))

    if flags.get("compare"):
        ranked = sorted(scored, key=lambda x: -x[1])
        target["readiness_summary"] = (
            f"Of the roles compared, {best[0]} is the closest fit at {best[1]:g}% readiness, against "
            + " and ".join(f"{r:g}% for {c}" for c, r, _ in ranked if c != best[0])
            + f". Closing the gap needs about {best[2]:g} study hours.")
    if flags.get("sort_priority"):
        scores = {g["skill"]: g["priority_score"] for g in ctx["kept_gaps"]}
        target["skill_gap"] = sorted(target["skill_gap"], key=lambda g: -scores[g["skill"]])
    if flags.get("daily"):
        if not plan["study_plan"]:
            return None
        week = rng.choice(plan["study_plan"][: min(6, len(plan["study_plan"]))])
        days = daily_tasks(week, ctx["hours_per_day"], ctx["days_per_week"])
        target["study_plan"] = [{"week": week["week"], "tasks": [f"Day {d['day']}: " + "; ".join(d["tasks"]) for d in days]}]
        extra_knowledge.append(f"week_to_expand: {week['week']} | week_tasks: " + " ; ".join(week["tasks"]))
    if flags.get("revision"):
        met = ctx["gap_analysis"]["met"]
        if len(met) < 2:
            return None
        weeks, per_week = rng.choice([2, 3, 4]), 3
        hours_each = round(ctx["weekly_hours"] / per_week, 1)
        target["study_plan"] = [{"week": w + 1, "tasks": [f"Revise {met[(w * per_week + i) % len(met)]}: re-solve practice problems and summarise key ideas ({hours_each:g}h)"
                                                          for i in range(per_week)]} for w in range(weeks)]
        target["readiness_summary"] = (f"A {weeks}-week revision plan cycling through the {len(met)} skills you already have for "
                                       f"{plan['target_role']}, {per_week} per week at {hours_each:g} hours each.")
        extra_knowledge.append(f"revision_weeks: {weeks} | skills_per_week: {per_week} | hours_per_skill: {hours_each:g}")

    inputs = {"gaps": ctx["kept_gaps"], "deferred": ctx["deferred"], "projects": ctx["eligible_projects"],
              "interview_topics": ctx["interview_topics"], "resources": shown}
    knowledge = knowledge_block(ctx, inputs) + ("\n" + "\n".join(extra_knowledge) if extra_knowledge else "")
    text = request_text(rng, scenario)
    facts = facts_from_context(ctx, sections=sections, resources=shown, max_weeks=max_weeks)

    profile_key = hashlib.sha256(json.dumps([req["target_role"], sorted((s["skill"], s["level"]) for s in req["current_skills"])]).encode()).hexdigest()[:16]
    return {
        "id": "", "task_code": code, "task": name, "role": plan["target_role"], "archetype": scenario["archetype"],
        "profile_key": profile_key,
        "messages": chat_messages(name, sections, text, knowledge, target),
        "facts": {"role": facts["role"], "met": sorted(facts["met"]), "weekly_hours": facts["weekly_hours"],
                  "max_weeks": facts["max_weeks"], "resource_ids": sorted(facts["resource_ids"]),
                  "project_titles": sorted(facts["project_titles"]), "sections": sorted(facts["sections"]),
                  "gaps": {s: {"current_level": g["current_level"], "required_level": g["required_level"], "priority": g["priority"]}
                           for s, g in facts["gaps"].items()}},
        "provenance": {"learner_profile": "SYNTHETIC", "career_facts": "curated knowledge " + ctx["knowledge_version"],
                       "target_generator": "deterministic planner"},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10000)
    args = ap.parse_args()
    rng = random.Random(SEED)
    kb, catalogue = get_knowledge(), get_catalogue()
    codes, weights = list(TASKS), [TASKS[c][4] for c in TASKS]

    seen, records, skipped, attempts = set(), [], Counter(), 0
    while len(records) < args.n and attempts < args.n * 6:
        attempts += 1
        code = rng.choices(codes, weights)[0]
        ex = make_example(rng, kb, catalogue, code)
        if ex is None:
            skipped["not_useful"] += 1
            continue
        digest = hashlib.sha256(ex["messages"][1]["content"].encode()).hexdigest()
        if digest in seen:
            skipped["duplicate_prompt"] += 1
            continue
        seen.add(digest)
        ex["id"] = f"cr-{digest[:12]}"
        records.append(ex)

    GENERATED.mkdir(parents=True, exist_ok=True)
    with open(GENERATED / "career_sft.jsonl", "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    by_task = Counter(r["task_code"] for r in records)
    print(f"generated {len(records)} examples in {attempts} attempts | skipped {dict(skipped)} | dataset {DATASET_VERSION}")
    print(f"tasks covered: {len(by_task)}/{len(TASKS)} | roles: {len({r['role'] for r in records})} | "
          f"distinct learner profiles: {len({r['profile_key'] for r in records})}")
    print("per task:", dict(sorted(by_task.items())))


if __name__ == "__main__":
    main()
