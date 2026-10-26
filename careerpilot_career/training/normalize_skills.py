"""Normalise free-text skill and role names to canonical ones, and self-check.

    python training/normalize_skills.py                      # run the built-in checks
    python training/normalize_skills.py "JS" "react.js" "ML"  # normalise your own terms

The normaliser itself lives in ai-service/app/career/knowledge.py, so training
and serving resolve names identically. This script exercises it and FAILS if a
required distinction is lost (Java, JavaScript and TypeScript must stay apart).
"""
from __future__ import annotations

import sys

import common  # noqa: F401  (sets up import paths)

from app.career.knowledge import get_knowledge, parse_level

SAME = {
    "JavaScript": ["JS", "Javascript", "Java Script", "javascript"],
    "React": ["ReactJS", "React.js", "React", "react js"],
    "Node.js": ["nodejs", "Node JS", "node"],
    "Python": ["python3", "Python"],
    "Object Oriented Programming": ["OOP", "oops"],
    "Machine Learning": ["ML", "machine learning"],
}
DISTINCT = ["Java", "JavaScript", "TypeScript", "C", "C++", "C#", "SQL", "MySQL", "PostgreSQL", "React", "React Native"]
ROLES = {"Full Stack Developer": ["fullstack developer", "Full-Stack Developer"], "Software Engineer": ["SDE", "software developer"],
         "Site Reliability Engineer": ["SRE"], "MERN Developer": ["MERN stack developer"]}
LEVELS = {"Intermediate": "intermediate", "expert": "advanced", "basic": "beginner", "weak": "beginner", None: "beginner"}


def main() -> None:
    kb = get_knowledge()
    if len(sys.argv) > 1:
        for term in sys.argv[1:]:
            print(f"{term!r:<28} skill={kb.skill(term)!r:<32} role={kb.role(term)!r}")
        return

    failures = []
    for canonical, variants in SAME.items():
        for v in variants:
            if kb.skill(v) != canonical:
                failures.append(f"skill {v!r} -> {kb.skill(v)!r}, expected {canonical!r}")
    resolved = [kb.skill(s) for s in DISTINCT]
    if resolved != DISTINCT or len(set(resolved)) != len(DISTINCT):
        failures.append(f"distinct skills collapsed: {list(zip(DISTINCT, resolved))}")
    for canonical, variants in ROLES.items():
        for v in variants:
            if kb.role(v) != canonical:
                failures.append(f"role {v!r} -> {kb.role(v)!r}, expected {canonical!r}")
    for text, level in LEVELS.items():
        if parse_level(text) != level:
            failures.append(f"level {text!r} -> {parse_level(text)!r}, expected {level!r}")
    if kb.skill("Underwater Basket Weaving") is not None:
        failures.append("an unknown skill was mapped to something")

    checks = sum(len(v) for v in SAME.values()) + len(DISTINCT) + sum(len(v) for v in ROLES.values()) + len(LEVELS) + 1
    if failures:
        print(f"NORMALISATION FAILURES ({len(failures)}):\n  " + "\n  ".join(failures))
        sys.exit(1)
    print(f"normalisation: {checks} checks passed | {len(kb.skills)} skills, {len(kb.roles)} roles, knowledge {kb.version}")


if __name__ == "__main__":
    main()
