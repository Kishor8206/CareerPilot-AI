"""Career knowledge base: skills, prerequisite graph and roles.

Loads the JSON compiled by careerpilot_career/training/build_*.py. Everything
here is deterministic and read-only at runtime: students and model output can
never modify it. The fine-tuned career model reasons; this module supplies the
facts it reasons over, and validates what it says.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

DATA_DIR = Path(__file__).resolve().parent / "data"

LEVELS = ["none", "beginner", "intermediate", "advanced"]
LEVEL_INDEX = {name: i for i, name in enumerate(LEVELS)}
# Share of a skill's `hours` needed to reach each level from zero.
LEVEL_FRACTION = {"none": 0.0, "beginner": 0.35, "intermediate": 1.0, "advanced": 2.2}

_LEVEL_WORDS = {
    "none": "none", "no": "none", "0": "none", "unknown": "none", "": "none",
    "beginner": "beginner", "basic": "beginner", "basics": "beginner", "novice": "beginner", "learning": "beginner",
    "familiar": "beginner", "1": "beginner", "weak": "beginner",
    "intermediate": "intermediate", "moderate": "intermediate", "proficient": "intermediate", "good": "intermediate",
    "working": "intermediate", "2": "intermediate", "comfortable": "intermediate",
    "advanced": "advanced", "expert": "advanced", "strong": "advanced", "3": "advanced", "professional": "advanced",
}


def key(text: str) -> str:
    """Comparison key: 'Node.js' -> 'nodejs'. Keeps + and # so C, C++ and C# stay distinct."""
    return re.sub(r"[^a-z0-9+#]", "", str(text).lower())


def parse_level(value: Any, default: str = "beginner") -> str:
    """Free-text level -> canonical level. Unrecognised text falls back to
    `default` rather than raising, since user profiles are messy."""
    if value is None:
        return default
    return _LEVEL_WORDS.get(str(value).strip().lower(), default)


class CareerKnowledge:
    def __init__(self, taxonomy: dict[str, Any], graph: dict[str, Any], roles: dict[str, Any]) -> None:
        self.version: str = taxonomy.get("knowledge_version", "unknown")
        self.skills: dict[str, dict[str, Any]] = {s["canonical_skill"]: s for s in taxonomy["skills"]}
        self.roles: dict[str, dict[str, Any]] = {r["canonical_name"]: r for r in roles["roles"]}
        self.topo_index: dict[str, int] = {name: i for i, name in enumerate(graph["topological_order"])}
        self.depth: dict[str, int] = graph["depth"]

        self._skill_alias: dict[str, str] = {}
        for name, skill in self.skills.items():
            for alias in (name, *skill.get("aliases", [])):
                self._skill_alias.setdefault(key(alias), name)
        self._role_alias: dict[str, str] = {}
        for name, role in self.roles.items():
            for alias in (name, *role.get("aliases", [])):
                self._role_alias.setdefault(key(alias), name)

    # -------------------------------------------------------- normalisation
    def skill(self, text: str) -> str | None:
        """Canonical skill name, or None. 'JS' -> 'JavaScript'; Java, JavaScript
        and TypeScript remain three different skills."""
        return self._skill_alias.get(key(text)) if isinstance(text, str) else None

    def role(self, text: str) -> str | None:
        return self._role_alias.get(key(text)) if isinstance(text, str) else None

    # ---------------------------------------------------------------- graph
    def prerequisites(self, skill: str) -> list[str]:
        return list(self.skills[skill]["prerequisites"])

    def all_prerequisites(self, skill: str) -> list[str]:
        """Transitive prerequisites, in learning order."""
        seen: list[str] = []

        def visit(name: str) -> None:
            for pre in self.skills[name]["prerequisites"]:
                if pre not in seen:
                    visit(pre)
                    seen.append(pre)

        visit(skill)
        return seen

    def learning_order(self, skills: Iterable[str]) -> list[str]:
        """Sort skills so every prerequisite precedes what depends on it."""
        return sorted(set(skills), key=lambda s: self.topo_index[s])

    def hours(self, skill: str, from_level: str, to_level: str) -> float:
        """Estimated study hours to move a skill between two levels."""
        span = LEVEL_FRACTION[to_level] - LEVEL_FRACTION[from_level]
        return round(max(0.0, span) * self.skills[skill]["hours"], 1)

    def role_requirements(self, role: str) -> list[dict[str, Any]]:
        """Core then secondary requirements, each tagged with its tier."""
        r = self.roles[role]
        return ([{**x, "tier": "core"} for x in r["core_skills"]]
                + [{**x, "tier": "secondary"} for x in r["secondary_skills"]])


@lru_cache(maxsize=1)
def get_knowledge() -> CareerKnowledge:
    def load(name: str) -> dict[str, Any]:
        return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))

    return CareerKnowledge(load("skill_taxonomy.json"), load("skill_graph.json"), load("career_roles.json"))
