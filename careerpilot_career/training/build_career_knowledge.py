"""Compile and validate career roles, and measure external corroboration.  ->  career_roles.json

    python training/build_career_knowledge.py     (after build_skill_graph.py and download_data.py)

Validation (the build FAILS on any of these):
  * every skill a role references exists in the taxonomy;
  * no skill is both core and secondary for a role;
  * every project skill and related role exists.

Corroboration (reported, never used to alter the curated data):
  for each role requirement, is the skill ALSO attached to that role by
    - O*NET 31.0  (software skills listed for the mapped occupation),
    - ESCO v1.2.1 (essential/optional skills of the mapped occupation),
    - real job descriptions (demand share in the trained skill recommender)?
  Concept skills such as "Data Structures" cannot appear in O*NET's software
  list by construction, so technology skills are reported separately.
"""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile

import pandas as pd

from common import KNOWLEDGE, RAW, REPO, publish, read_json
from curated_knowledge import ROLES
from download_data import ESCO_QUERY

from app.career.knowledge import key

TECH_CATEGORIES = {"LANGUAGE", "FRONTEND", "BACKEND", "DATABASE", "DEVOPS", "CLOUD", "ML", "DATA_ENG", "MOBILE", "QA", "TOOL", "DATA"}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> None:
    taxonomy = read_json(KNOWLEDGE / "skill_taxonomy.json")
    graph = read_json(KNOWLEDGE / "skill_graph.json")
    skills = {s["canonical_skill"]: s for s in taxonomy["skills"]}
    position = {n: i for i, n in enumerate(graph["topological_order"])}
    alias = {}
    for name, s in skills.items():
        for a in (name, *s["aliases"]):
            alias.setdefault(key(a), name)
    role_names = {r["canonical_name"] for r in ROLES}

    errors: list[str] = []
    for r in ROLES:
        core = [x["skill"] for x in r["core_skills"]]
        secondary = [x["skill"] for x in r["secondary_skills"]]
        for s in [*core, *secondary, *r["soft_skills"], *(sk for p in r["typical_projects"] for sk in p["skills"])]:
            if s not in skills:
                errors.append(f"{r['canonical_name']}: unknown skill '{s}'")
        for s in set(core) & set(secondary):
            errors.append(f"{r['canonical_name']}: '{s}' is both core and secondary")
        if len(core) != len(set(core)) or len(secondary) != len(set(secondary)):
            errors.append(f"{r['canonical_name']}: duplicate skill in a tier")
        for rel in r["related_roles"]:
            if rel not in role_names:
                errors.append(f"{r['canonical_name']}: unknown related role '{rel}'")
    if errors:
        print("ROLE KNOWLEDGE ERRORS — refusing to build:\n  " + "\n  ".join(errors))
        sys.exit(1)

    # ---- external evidence ------------------------------------------------
    z = zipfile.ZipFile(RAW / "onet" / "db_31_0_text.zip")

    def table(name: str) -> pd.DataFrame:
        return pd.read_csv(io.BytesIO(z.read(next(n for n in z.namelist() if n.endswith("/" + name)))), sep="\t", dtype=str)

    software, occupations = table("Software Skills.txt"), table("Occupation Data.txt")
    onet_title = dict(zip(occupations["O*NET-SOC Code"], occupations["Title"]))
    onet_skills: dict[str, set[str]] = {}
    for soc, group in software.groupby("O*NET-SOC Code"):
        found = set()
        for example in group["Workplace Example"]:
            # "Oracle Java" / "Python" / "Amazon Web Services AWS software": try the phrase, then each token.
            for candidate in (example, *re.split(r"[\s/,()]+", example)):
                hit = alias.get(key(candidate))
                if hit and len(key(candidate)) > 1:
                    found.add(hit)
        onet_skills[soc] = found

    esco_skills: dict[str, set[str]] = {}
    for term in set(ESCO_QUERY.values()):
        path = RAW / "esco" / f"{term.replace(' ', '_').lower()}.json"
        if not path.exists():
            continue
        d = json.loads(path.read_text(encoding="utf-8"))
        found = set()
        for title in (*d["essential"], *d["optional"]):
            for candidate in (title, re.sub(r"\s*\(.*?\)", "", title), *re.split(r"[\s/,()]+", title)):
                hit = alias.get(key(candidate))
                if hit and len(key(candidate)) > 1:
                    found.add(hit)
        esco_skills[term] = found

    demand: dict[str, float] = {}
    recommender = REPO / "ai-service" / "artifacts" / "skill_recommender.json"
    if recommender.exists():
        art = json.loads(recommender.read_text(encoding="utf-8"))
        demand = dict(zip(art["vocab"], art["demand"]))

    # ---- compile ----------------------------------------------------------
    compiled, totals = [], {"all": [0, 0], "tech": [0, 0]}
    per_source = {"onet": 0, "esco": 0, "jobs": 0}
    for r in ROLES:
        requirements = [*r["core_skills"], *r["secondary_skills"]]
        required = {x["skill"] for x in requirements}
        implied: list[str] = []

        def close(name: str) -> None:
            for pre in skills[name]["prerequisites"]:
                if pre not in required and pre not in implied:
                    close(pre)
                    implied.append(pre)

        for s in sorted(required, key=position.get):
            close(s)
        learning_order = sorted(required | set(implied), key=position.get)

        soc, esco_term = r["onet_soc"], ESCO_QUERY.get(r["canonical_name"])
        evidence, corroborated = {}, 0
        for x in requirements:
            s = x["skill"]
            src = [name for name, ok in (("onet", s in onet_skills.get(soc, ())),
                                         ("esco", s in esco_skills.get(esco_term, ())),
                                         ("jobs", demand.get(s, 0) >= 0.02)) if ok]
            evidence[s] = src
            for name in src:
                per_source[name] += 1
            is_tech = skills[s]["category"] in TECH_CATEGORIES
            totals["all"][1] += 1
            totals["all"][0] += bool(src)
            if is_tech:
                totals["tech"][1] += 1
                totals["tech"][0] += bool(src)
            corroborated += bool(src)

        compiled.append({
            "role_id": slug(r["canonical_name"]), **{k: v for k, v in r.items() if k != "track_order"},
            "track_order": r["track_order"], "onet_title": onet_title.get(soc), "esco_occupation": esco_term,
            "tools": [x["skill"] for x in requirements if skills[x["skill"]]["category"] == "TOOL"],
            "technologies": [x["skill"] for x in requirements if skills[x["skill"]]["category"] in TECH_CATEGORIES - {"TOOL"}],
            "knowledge_areas": [x["skill"] for x in requirements if skills[x["skill"]]["category"] not in TECH_CATEGORIES],
            "prerequisites": implied, "recommended_learning_order": learning_order,
            "experience_level": ["STUDENT", "FRESH_GRADUATE", "ENTRY_LEVEL", "MID_LEVEL", "CAREER_SWITCHER"],
            "evidence": evidence,
            "corroboration": {"requirements": len(requirements), "externally_corroborated": corroborated},
        })

    report = {
        "roles": len(compiled),
        "requirements": totals["all"][1],
        "corroborated_by_any_source": totals["all"][0],
        "corroborated_share": round(totals["all"][0] / totals["all"][1], 3),
        "technology_requirements": totals["tech"][1],
        "technology_corroborated_share": round(totals["tech"][0] / max(1, totals["tech"][1]), 3),
        "by_source": per_source,
        "note": "Corroboration means an external source also attaches the skill to the role. It supports the "
                "mapping; it does not validate required levels, prerequisites, hours, projects or interview topics.",
    }
    publish("career_roles.json", {"knowledge_version": taxonomy["knowledge_version"], "roles": compiled,
                                  "corroboration_report": report})
    print(f"roles: {len(compiled)} | requirements: {report['requirements']} | validation errors: 0")
    print(f"corroborated by O*NET, ESCO or job data: {report['corroborated_by_any_source']}/{report['requirements']} "
          f"({report['corroborated_share']:.0%}) | technology skills only: {report['technology_corroborated_share']:.0%}")
    print(f"by source: {per_source}")
    weakest = sorted(compiled, key=lambda c: c["corroboration"]["externally_corroborated"] / c["corroboration"]["requirements"])[:4]
    for c in weakest:
        k = c["corroboration"]
        uncorroborated = [s for s, src in c["evidence"].items() if not src]
        print(f"  least corroborated: {c['canonical_name']} {k['externally_corroborated']}/{k['requirements']} — unsupported: {uncorroborated[:6]}")


if __name__ == "__main__":
    main()
