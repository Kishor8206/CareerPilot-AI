"""Career knowledge, skill-gap service, planner, resources and verification.

No model is involved: these pin the deterministic layer that the career model
is trained from, validated against, and falls back to.
"""
from __future__ import annotations

import itertools
import re

import pytest

from app.career.knowledge import LEVEL_INDEX, get_knowledge
from app.career.planner import MAX_WEEKS, build_plan, daily_tasks
from app.career.resources import get_catalogue
from app.career.schemas import CareerPlan
from app.career.skill_gap import analyse
from app.career.verification import BlockedUrl, check_url

KB = get_knowledge()
ROLES = sorted(KB.roles)
PROFILES = [
    {"available_hours_per_day": 1, "available_days_per_week": 5},
    {"available_hours_per_day": 2, "available_days_per_week": 6, "deadline_weeks": 16},
    {"available_hours_per_day": 4, "available_days_per_week": 6, "deadline_weeks": 12},
    {"available_hours_per_day": 3, "available_days_per_week": 7, "deadline_weeks": 4, "experience_level": "CAREER_SWITCHER"},
    {"available_hours_per_day": 6, "available_days_per_week": 5, "experience_level": "MID_LEVEL"},
]
SKILLSETS = [
    [],
    [{"skill": "Python", "level": "beginner"}],
    [{"skill": "JavaScript", "level": "advanced"}, {"skill": "React", "level": "intermediate"}, {"skill": "SQL", "level": "basic"}],
    [{"skill": "Java", "level": "intermediate"}, {"skill": "Spring Boot", "level": "beginner"}, {"skill": "Git", "level": "intermediate"}],
]


def hours_in(tasks: list[str]) -> float:
    return round(sum(float(x) for t in tasks for x in re.findall(r"\(([\d.]+)h\)", t)), 2)


def plan(role, skills, profile, **extra):
    return build_plan({"target_role": role, "current_skills": skills, "user_profile": profile, **extra})


# ------------------------------------------------------------- knowledge
def test_distinct_skills_stay_distinct_and_aliases_resolve():
    assert [KB.skill(s) for s in ("Java", "JavaScript", "TypeScript")] == ["Java", "JavaScript", "TypeScript"]
    assert KB.skill("JS") == KB.skill("Java Script") == "JavaScript"
    assert KB.skill("React.js") == "React" and KB.skill("no such skill") is None


def test_prerequisite_graph_is_acyclic_and_ordered():
    for skill in KB.skills:
        for pre in KB.all_prerequisites(skill):
            assert KB.topo_index[pre] < KB.topo_index[skill], f"{pre} must come before {skill}"


# ------------------------------------------------------------- skill gap
def test_owning_a_skill_implies_its_prerequisites():
    result = analyse("Full Stack Developer", [{"skill": "React", "level": "intermediate"}])
    gaps = {g["skill"] for g in result["gaps"]}
    assert "JavaScript" not in gaps and "HTML" not in gaps      # not sent back to basics
    assert result["assumed_from_prerequisites"]["JavaScript"] == "intermediate"


def test_advanced_user_is_not_told_to_learn_the_basics():
    result = analyse("Frontend Developer", [{"skill": "JavaScript", "level": "advanced"}])
    assert "JavaScript" in result["met"]
    assert all(g["skill"] != "JavaScript" for g in result["gaps"])


def test_ats_missing_skills_raise_priority():
    base = {g["skill"]: g for g in analyse("Backend Developer", [])["gaps"]}
    boosted = {g["skill"]: g for g in analyse("Backend Developer", [], ats_missing=["Docker"])["gaps"]}
    assert boosted["Docker"]["priority_score"] == base["Docker"]["priority_score"] + 12
    assert "ATS analysis" in boosted["Docker"]["reason"]


def test_unknown_skills_are_reported_not_guessed():
    result = analyse("Data Analyst", ["Underwater Basket Weaving", "SQL"])
    assert result["unrecognised_skills"] == ["Underwater Basket Weaving"]


def test_unknown_role_is_an_error():
    with pytest.raises(ValueError):
        analyse("Dragon Tamer", [])


# --------------------------------------------- planner invariants, exhaustively
@pytest.mark.parametrize("role,skills,profile", list(itertools.product(ROLES, SKILLSETS, PROFILES)))
def test_plan_invariants(role, skills, profile):
    out = plan(role, skills, profile)
    p, ctx = out["plan"], out["context"]
    CareerPlan.model_validate(p)                                             # strict schema

    weekly = ctx["weekly_hours"]
    assert weekly == profile["available_hours_per_day"] * profile["available_days_per_week"]
    for week in p["study_plan"]:                                             # mathematically feasible
        assert hours_in(week["tasks"]) <= weekly + 0.11, week
    assert len(p["study_plan"]) <= min(MAX_WEEKS, profile.get("deadline_weeks", MAX_WEEKS))
    assert [w["week"] for w in p["study_plan"]] == list(range(1, len(p["study_plan"]) + 1))

    phase_of = {s: i for i, ph in enumerate(p["roadmap"]) for s in ph["skills"]}
    for skill, index in phase_of.items():                                    # prerequisites never come later
        for pre in KB.all_prerequisites(skill):
            assert phase_of.get(pre, -1) <= index, f"{pre} is scheduled after {skill}"

    gap_skills = [g["skill"] for g in p["skill_gap"]]
    assert sorted(gap_skills) == sorted(phase_of)                            # every gap is in exactly one phase
    assert len(set(gap_skills)) == len(gap_skills)
    for g in p["skill_gap"]:
        assert g["skill"] in KB.skills
        assert LEVEL_INDEX[g["required_level"]] > LEVEL_INDEX[g["current_level"]]
    assert not set(gap_skills) & set(ctx["gap_analysis"]["met"])             # nothing already met is recommended

    catalogue = get_catalogue()
    assert all(catalogue.exists(r) for r in p["resource_ids"])               # no invented resources
    assert not re.search(r"https?://", str(p))                               # the plan never contains a URL
    known = set(ctx["gap_analysis"]["current"]) | set(ctx["gap_analysis"]["assumed_from_prerequisites"])
    for project in p["projects"]:
        assert set(project["skills"]) <= known | set(gap_skills)             # buildable with planned skills


# ----------------------------------------------------- personalisation
def test_less_time_means_more_weeks():
    slow = plan("Full Stack Developer", [], {"available_hours_per_day": 1, "available_days_per_week": 5})["context"]
    fast = plan("Full Stack Developer", [], {"available_hours_per_day": 4, "available_days_per_week": 6})["context"]
    assert slow["weeks_needed"] > fast["weeks_needed"]


def test_tight_deadline_defers_low_priority_skills_and_says_so():
    out = plan("Full Stack Developer", [], {"available_hours_per_day": 2, "available_days_per_week": 6, "deadline_weeks": 12})
    assert out["context"]["deferred"]
    assert "deferred" in out["plan"]["readiness_summary"]
    kept = {g["skill"] for g in out["plan"]["skill_gap"]}
    for skill in kept:                                                       # nothing kept depends on something deferred
        assert not set(KB.all_prerequisites(skill)) & {d["skill"] for d in out["context"]["deferred"]}


def test_impossible_deadline_is_stated_plainly():
    out = plan("Machine Learning Engineer", [], {"available_hours_per_day": 1, "available_days_per_week": 3, "deadline_weeks": 2})
    assert out["context"]["fits_deadline"] is False
    assert "not achievable" in out["plan"]["readiness_summary"]


def test_progress_moves_the_roadmap_forward():
    profile = {"available_hours_per_day": 2, "available_days_per_week": 6}
    before = {g["skill"] for g in plan("Full Stack Developer", [], profile)["plan"]["skill_gap"]}
    after = {g["skill"] for g in plan("Full Stack Developer", [], profile,
                                      progress={"completed_skills": ["JavaScript", "React"]})["plan"]["skill_gap"]}
    assert {"JavaScript", "React"} <= before and not {"JavaScript", "React", "HTML", "CSS"} & after
    assert "Node.js" in after                                                # progresses toward the backend


def test_experience_shortens_estimates():
    hours = lambda level: analyse("Backend Developer", [], experience=level)["total_gap_hours"]
    assert hours("MID_LEVEL") < hours("STUDENT") < hours("CAREER_SWITCHER")


def test_daily_tasks_respect_the_daily_limit_and_cover_the_week():
    p = plan("Data Analyst", [], {"available_hours_per_day": 2, "available_days_per_week": 6})["plan"]
    week = p["study_plan"][0]
    days = daily_tasks(week, 2, 6)
    assert all(hours_in(d["tasks"]) <= 2.01 for d in days)
    assert hours_in([t for d in days for t in d["tasks"]]) == pytest.approx(hours_in(week["tasks"]), abs=0.2)


# ----------------------------------------------------------- resources
def test_only_verified_or_reachable_resources_are_offered():
    catalogue = get_catalogue()
    unusable = [r["resource_id"] for r in catalogue.by_id.values() if r["verification_status"] not in ("verified", "reachable")]
    for skill in KB.skills:
        assert not {r["resource_id"] for r in catalogue.candidates(skill, "beginner", limit=10)} & set(unusable)


def test_unknown_resource_ids_are_rejected():
    found, rejected = get_catalogue().resolve(["docs_react_001", "yt_made_up_999", "https://evil.example/x"])
    assert [r["resource_id"] for r in found] == ["docs_react_001"]
    assert rejected == ["yt_made_up_999", "https://evil.example/x"]


# --------------------------------------------------- verification / SSRF
@pytest.mark.parametrize("url,domains", [
    ("http://react.dev/learn", ["react.dev"]),                    # not https
    ("https://127.0.0.1/admin", ["127.0.0.1"]),                   # literal IP
    ("https://localhost/secret", ["localhost"]),                  # loopback
    ("https://evil.example/react.dev", ["react.dev"]),            # wrong host
    ("https://react.dev.evil.example/", ["react.dev"]),           # look-alike suffix
    ("https://user:pass@react.dev/", ["react.dev"]),              # embedded credentials
    ("file:///etc/passwd", ["react.dev"]),
])
def test_ssrf_guard_blocks_unsafe_urls(url, domains):
    with pytest.raises(BlockedUrl):
        check_url(url, domains)
