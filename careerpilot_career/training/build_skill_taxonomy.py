"""Compile the canonical skill taxonomy.  ->  skill_taxonomy.json

    python training/build_skill_taxonomy.py

Each skill gets: canonical_skill, aliases, category, subcategory, related_skills,
prerequisites, difficulty, importance, hours.

Aliases come from two places: CareerPilot's existing taxonomy (so "ReactJS" and
"React.js" already resolve to React, exactly as the ATS resolves them) and the
extra aliases in curated_knowledge.py. The build FAILS if two different skills
would claim the same alias — that is how Java, JavaScript and TypeScript are
guaranteed to stay distinct.
"""
from __future__ import annotations

import sys
from collections import defaultdict

from common import publish
from curated_knowledge import KNOWLEDGE_VERSION, ROLES, SKILLS

from app.career.knowledge import key
from app.nlp.skills_taxonomy import SKILLS as EXISTING


def main() -> None:
    existing = {s.name: s for s in EXISTING}

    usage: dict[str, float] = defaultdict(float)
    for role in ROLES:
        for req in role["core_skills"]:
            usage[req["skill"]] += req["importance"]
        for req in role["secondary_skills"]:
            usage[req["skill"]] += req["importance"] * 0.5
    top = max(usage.values())

    dependents: dict[str, list[str]] = defaultdict(list)
    for name, (_, _, _, _, prereqs, _) in SKILLS.items():
        for pre in prereqs:
            dependents[pre].append(name)

    claimed: dict[str, str] = {}
    collisions: list[str] = []
    skills = []
    for name, (category, sub, difficulty, hours, prereqs, extra) in SKILLS.items():
        aliases = list(dict.fromkeys([*(existing[name].aliases if name in existing else ()), *extra]))
        for alias in (name, *aliases):
            owner = claimed.setdefault(key(alias), name)
            if owner != name:
                collisions.append(f"'{alias}' is claimed by both {owner} and {name}")
        siblings = [n for n, v in SKILLS.items() if n != name and v[0] == category and v[1] == sub]
        related = list(dict.fromkeys([*dependents[name], *siblings]))[:6]
        skills.append({
            "canonical_skill": name, "aliases": aliases, "category": category, "subcategory": sub,
            "related_skills": related, "prerequisites": prereqs, "difficulty": difficulty,
            "importance": round(usage[name] / top, 3), "hours": hours,
            "in_ats_taxonomy": name in existing,
        })

    if collisions:
        print("ALIAS COLLISIONS — refusing to build:\n  " + "\n  ".join(collisions))
        sys.exit(1)

    publish("skill_taxonomy.json", {"knowledge_version": KNOWLEDGE_VERSION, "skills": skills})
    shared = sum(s["in_ats_taxonomy"] for s in skills)
    print(f"skills: {len(skills)} ({shared} shared with the ATS taxonomy, {len(skills) - shared} career-only)")
    print(f"aliases: {sum(len(s['aliases']) for s in skills)} | categories: {len({s['category'] for s in skills})}")
    print("alias collisions: 0")


if __name__ == "__main__":
    main()
