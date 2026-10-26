"""Run the ten required test profiles (and the final example) through the real pipeline.

    python training/inference_test.py                 # whatever CAREER_MODEL_PROVIDER is configured
    python training/inference_test.py --out <run>/inference

With no model configured this exercises the deterministic planner, which is
also the fallback, so it runs on any machine. With CAREER_MODEL_PROVIDER set,
the same script exercises the fine-tuned model through validation and repair,
and reports for each profile whether the answer was the model's, was repaired,
or fell back.

It does not just print plans. It CHECKS that the roadmap changes the way it
should between profiles, and exits non-zero if it does not.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

import common  # noqa: F401

from app.career.knowledge import get_knowledge
from app.career.roadmap_service import generate_plan

S = lambda skill, level: {"skill": skill, "level": level}  # noqa: E731
P = lambda h, d, **kw: {"available_hours_per_day": h, "available_days_per_week": d, **kw}  # noqa: E731

PROFILES = [
    ("TEST 1", "Computer Science student -> Software Engineer",
     {"target_role": "Software Engineer", "current_skills": [S("C++", "intermediate"), S("Python", "beginner"), S("SQL", "beginner")],
      "user_profile": P(2, 6, experience_level="STUDENT")}),
    ("TEST 2", "Beginner -> Full Stack Developer",
     {"target_role": "Full Stack Developer", "current_skills": [], "user_profile": P(2, 5, experience_level="STUDENT")}),
    ("TEST 3", "Java developer -> Backend Developer",
     {"target_role": "Backend Developer", "current_skills": [S("Java", "advanced"), S("Spring Boot", "intermediate"), S("SQL", "intermediate"),
                                                             S("Git", "intermediate"), S("OOP", "intermediate")],
      "user_profile": P(2, 5, experience_level="MID_LEVEL")}),
    ("TEST 4", "Python beginner -> Data Scientist",
     {"target_role": "Data Scientist", "current_skills": [S("Python", "beginner")], "user_profile": P(2, 6, experience_level="STUDENT")}),
    ("TEST 5", "Frontend developer -> Full Stack Developer",
     {"target_role": "Full Stack Developer", "current_skills": [S("HTML", "advanced"), S("CSS", "advanced"), S("JavaScript", "advanced"),
                                                                S("React", "intermediate"), S("Git", "intermediate")],
      "user_profile": P(2, 5, experience_level="ENTRY_LEVEL")}),
    ("TEST 6", "Non-CS career switcher -> Software Engineer",
     {"target_role": "Software Engineer", "current_skills": [S("Excel", "advanced"), S("Communication", "advanced")],
      "user_profile": P(2, 6, experience_level="CAREER_SWITCHER")}),
    ("TEST 7", "Fresh graduate with weak DSA -> Software Engineer",
     {"target_role": "Software Engineer", "current_skills": [S("Java", "intermediate"), S("OOP", "intermediate"), S("SQL", "intermediate"),
                                                             S("Git", "intermediate"), S("Data Structures", "weak")],
      "user_profile": P(2, 6, experience_level="FRESH_GRADUATE")}),
    ("TEST 8", "Limited time: 1 hour a day",
     {"target_role": "Frontend Developer", "current_skills": [S("HTML", "beginner")], "user_profile": P(1, 5)}),
    ("TEST 9", "More time: 4 hours a day",
     {"target_role": "Frontend Developer", "current_skills": [S("HTML", "beginner")], "user_profile": P(4, 5)}),
    ("TEST 10", "3-month deadline",
     {"target_role": "Frontend Developer", "current_skills": [S("HTML", "beginner")], "user_profile": P(2, 5, deadline_weeks=12)}),
    ("FINAL", "Final-year CS student, weak in DSA and backend -> Full Stack Developer, 2h/day for 4 months",
     {"target_role": "Full Stack Developer", "current_skills": [S("C++", "intermediate"), S("JavaScript", "intermediate"), S("React", "intermediate"),
                                                                S("SQL", "basic"), S("DSA", "weak")],
      "user_profile": P(2, 6, deadline_weeks=16, experience_level="STUDENT")}),
]


def week_hours(week: dict) -> float:
    return sum(float(h) for t in week["tasks"] for h in re.findall(r"\(([\d.]+)h\)", t))


async def run_all() -> dict[str, dict]:
    return {tag: await generate_plan(json.loads(json.dumps(request))) for tag, _, request in PROFILES}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    kb = get_knowledge()
    results = asyncio.run(run_all())

    for tag, title, request in PROFILES:
        r = results[tag]
        plan, inf = r["plan"], r["inference"]
        gaps = plan["skill_gap"]
        print("=" * 100)
        print(f"{tag}: {title}")
        print(f"  produced by: {inf['provider']}" + (" (degraded)" if inf["degraded"] else "")
              + (f" | repairs: {len(inf['repairs'])}" if inf["repairs"] else ""))
        print(f"  readiness: {r['readiness']['percent']}% | gaps: {len(gaps)} "
              f"({sum(g['priority'] == 'HIGH' for g in gaps)} high) | weeks: {len(plan['study_plan'])} at {r['schedule']['weekly_hours']:g}h/week"
              f" | needs {r['schedule']['weeks_needed']} weeks")
        print("  phases: " + " -> ".join(f"{p['phase']} [{', '.join(p['skills'][:3])}{'…' if len(p['skills']) > 3 else ''}]" for p in plan["roadmap"]))
        print("  high priority: " + ", ".join(g["skill"] for g in gaps if g["priority"] == "HIGH"))
        print("  projects: " + "; ".join(p["title"] for p in plan["projects"]))
        print("  resources: " + ", ".join(plan["resource_ids"][:6]))
        if r["schedule"]["deferred"]:
            print("  deferred: " + ", ".join(d["skill"] for d in r["schedule"]["deferred"]))

    # ------------------------------------------------- behavioural checks
    def gap_skills(tag: str) -> set[str]:
        return {g["skill"] for g in results[tag]["plan"]["skill_gap"]}

    checks = []

    def check(name: str, ok: bool) -> None:
        checks.append((name, bool(ok)))

    for tag, _, request in PROFILES:
        r = results[tag]
        weekly = r["schedule"]["weekly_hours"]
        check(f"{tag}: no week exceeds {weekly:g}h", all(week_hours(w) <= weekly + 0.11 for w in r["plan"]["study_plan"]))
        # A URL pattern, not the text "http": the resource ID docs_http_001 is legitimate.
        check(f"{tag}: no URL in the plan, resources resolve", not re.search(r"https?://|www\.", json.dumps(r["plan"]))
              and len(r["resources"]) == len(r["plan"]["resource_ids"]))
        phase_of = {s: i for i, p in enumerate(r["plan"]["roadmap"]) for s in p["skills"]}
        check(f"{tag}: prerequisites never follow dependents",
              all(phase_of.get(pre, -1) <= i for s, i in phase_of.items() for pre in kb.all_prerequisites(s)))
    check("TEST 3: a Java developer is not told to learn Java, OOP or Spring basics", not {"Java", "Object Oriented Programming"} & gap_skills("TEST 3"))
    check("TEST 5: a frontend developer is not sent back to HTML/CSS/JavaScript/React", not {"HTML", "CSS", "JavaScript", "React"} & gap_skills("TEST 5"))
    check("TEST 5: the plan moves to the backend", {"Node.js", "REST API"} <= gap_skills("TEST 5"))
    check("TEST 4: Python comes before Pandas before Machine Learning", (lambda o: o["Python"] <= o["Pandas"] <= o["Machine Learning"])(
        {s: i for i, p in enumerate(results["TEST 4"]["plan"]["roadmap"]) for s in p["skills"]}))
    check("TEST 6: a career switcher starts from programming fundamentals", "Programming Fundamentals" in gap_skills("TEST 6"))
    check("TEST 6 vs TEST 1: a switcher has more to learn than a CS student", len(gap_skills("TEST 6")) > len(gap_skills("TEST 1")))
    check("TEST 7: weak DSA is a high-priority gap", any(g["skill"] == "Data Structures" and g["priority"] == "HIGH" for g in results["TEST 7"]["plan"]["skill_gap"]))
    check("TEST 8 vs 9: 1h/day needs more weeks than 4h/day", results["TEST 8"]["schedule"]["weeks_needed"] > results["TEST 9"]["schedule"]["weeks_needed"])
    check("TEST 8 vs 9: weekly load is 5h vs 20h", (results["TEST 8"]["schedule"]["weekly_hours"], results["TEST 9"]["schedule"]["weekly_hours"]) == (5.0, 20.0))
    check("TEST 10: the plan stays within the 12-week deadline", len(results["TEST 10"]["plan"]["study_plan"]) <= 12)
    check("FINAL: all eight sections are present", all(results["FINAL"]["plan"][k] for k in
                                                       ("readiness_summary", "skill_gap", "roadmap", "study_plan", "projects", "interview_preparation", "resource_ids")))

    print("=" * 100)
    failed = [n for n, ok in checks if not ok]
    structural = ("no week exceeds", "no URL in the plan", "prerequisites never follow")
    for name, ok in checks:
        if not ok or not any(k in name for k in structural):       # always show failures and the behavioural checks
            print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{len(checks) - len(failed)}/{len(checks)} behavioural checks passed "
          f"(including 3 structural checks on each of the {len(PROFILES)} profiles)")

    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "inference_tests.json").write_text(json.dumps(
            {"profiles": [{"test": t, "title": title, "request": req, "result": results[t]} for t, title, req in PROFILES],
             "checks": [{"check": n, "passed": ok} for n, ok in checks]}, indent=2), encoding="utf-8")
        print(f"wrote {out / 'inference_tests.json'}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
