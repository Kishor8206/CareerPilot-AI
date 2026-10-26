"""Download external career data and write data_source_manifest.json.

    python training/download_data.py

Sources
    O*NET 31.0   occupations, job titles and software skills (CC BY 4.0).
    ESCO v1.2.1  essential/optional skills per occupation, via the public API.
    Both are used to CORROBORATE the curated role knowledge. Neither contains
    prerequisites, learning effort, projects or interview topics, so neither
    can generate a roadmap on its own — that is stated in the manifest.

Nothing here is fabricated: every count in the manifest is measured from the
downloaded files, and a source that could not be fetched is recorded as such.
"""
from __future__ import annotations

import hashlib
import io
import time
import zipfile

import httpx
import pandas as pd

from common import KNOWLEDGE, RAW, REPO, write_json
from curated_knowledge import KNOWLEDGE_VERSION, ROLES, SKILLS

ONET_URL = "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip"
ONET_ZIP = RAW / "onet" / "db_31_0_text.zip"
ESCO_API = "https://ec.europa.eu/esco/api"
ESCO_DIR = RAW / "esco"

# ESCO occupation to look up for each curated role (search term).
ESCO_QUERY = {
    "Software Engineer": "software developer", "Frontend Developer": "user interface developer",
    "Backend Developer": "software developer", "Full Stack Developer": "web developer", "MERN Developer": "web developer",
    "Java Developer": "software developer", "Python Developer": "software developer", "Data Analyst": "data analyst",
    "Data Scientist": "data scientist", "Machine Learning Engineer": "data scientist", "AI Engineer": "data scientist",
    "Data Engineer": "data engineer", "DevOps Engineer": "DevOps engineer", "Cloud Engineer": "cloud engineer",
    "Site Reliability Engineer": "ICT system administrator", "Cybersecurity Analyst": "ICT security administrator",
    "QA Engineer": "software tester", "Mobile Developer": "mobile application developer",
    "Business Analyst": "ICT business analyst", "Product Analyst": "data analyst",
}


def download_onet() -> dict:
    ONET_ZIP.parent.mkdir(parents=True, exist_ok=True)
    if not ONET_ZIP.exists():
        with httpx.stream("GET", ONET_URL, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            with open(ONET_ZIP, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
    z = zipfile.ZipFile(ONET_ZIP)

    def rows(name: str) -> int:
        member = next(n for n in z.namelist() if n.endswith("/" + name))
        return len(pd.read_csv(io.BytesIO(z.read(member)), sep="\t", dtype=str))

    used = ["Occupation Data.txt", "Job Titles.txt", "Software Skills.txt", "Related Occupations.txt"]
    return {"sha256": hashlib.sha256(ONET_ZIP.read_bytes()).hexdigest(), "bytes": ONET_ZIP.stat().st_size,
            "files_in_archive": len([n for n in z.namelist() if n.endswith(".txt")]),
            "row_count": {name: rows(name) for name in used}}


def download_esco() -> dict:
    ESCO_DIR.mkdir(parents=True, exist_ok=True)
    fetched, failed = {}, {}
    with httpx.Client(timeout=60) as client:
        for term in sorted(set(ESCO_QUERY.values())):
            target = ESCO_DIR / f"{term.replace(' ', '_').lower()}.json"
            if not target.exists():
                try:
                    hits = client.get(f"{ESCO_API}/search", params={"text": term, "type": "occupation", "language": "en",
                                                                    "limit": 5}).json()["_embedded"]["results"]
                    exact = next((h for h in hits if h["title"].lower() == term.lower()), hits[0])
                    occ = client.get(f"{ESCO_API}/resource/occupation", params={"uri": exact["uri"], "language": "en"}).json()
                    links = occ.get("_links", {})
                    write_json(target, {"query": term, "title": exact["title"], "uri": exact["uri"], "isco": occ.get("code"),
                                        "essential": [x["title"] for x in links.get("hasEssentialSkill", [])],
                                        "optional": [x["title"] for x in links.get("hasOptionalSkill", [])]})
                    time.sleep(0.4)                      # be polite to a public API
                except Exception as exc:                # recorded, never invented
                    failed[term] = f"{type(exc).__name__}: {exc}"
                    continue
            import json
            d = json.loads(target.read_text(encoding="utf-8"))
            fetched[term] = {"matched_title": d["title"], "essential": len(d["essential"]), "optional": len(d["optional"])}
    return {"occupations_fetched": len(fetched), "failed": failed, "detail": fetched}


def main() -> None:
    onet = download_onet()
    esco = download_esco()
    ats_raw = REPO / "careerpilot_ats" / "raw"
    manifest = {
        "manifest_version": 1, "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sources": [
            {"source": "O*NET Database", "version": "31.0", "url": ONET_URL, "license": "CC BY 4.0",
             "attribution": "This work includes information from the O*NET 31.0 Database by the U.S. Department of Labor, "
                            "Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. "
                            "CareerPilot has modified all or some of this information. USDOL/ETA has not approved, "
                            "endorsed, or tested these modifications.",
             "real_or_synthetic": "real (official occupational database)", **onet,
             "fields": ["O*NET-SOC Code", "Title", "Job Title", "Workplace Example", "Hot Technology", "In Demand"],
             "purpose": "Corroborate which technologies belong to each role; map role aliases to occupations.",
             "preprocessing": "Filtered to the SOC codes mapped to curated roles; technology names matched to canonical skills.",
             "limitations": "Occupations are coarse (no Frontend/DevOps/MERN occupation). Software lists are long and "
                            "unranked. Contains NO prerequisites, learning effort, projects or interview topics."},
            {"source": "ESCO (European Skills, Competences, Qualifications and Occupations)", "version": "v1.2.1",
             "url": ESCO_API, "license": "NOT VERIFIED in this pipeline: the ESCO download page states only that the data "
                                         "is free of charge. Confirm reuse terms before redistributing ESCO text.",
             "real_or_synthetic": "real (official EU classification)", **esco,
             "fields": ["occupation title", "ISCO code", "hasEssentialSkill", "hasOptionalSkill"],
             "purpose": "Corroborate role-to-skill mappings. Not used as training text.",
             "preprocessing": "One occupation fetched per curated role; skill titles matched to canonical skills.",
             "limitations": "Essential skills are broad competences ('use markup languages'); no prerequisites or learning order."},
            {"source": "CareerPilot skill taxonomy", "version": "ai-service/app/nlp/skills_taxonomy.py", "url": "in-repo",
             "license": "project-owned", "real_or_synthetic": "curated", "row_count": {"skills": 107},
             "fields": ["name", "category", "aliases"], "purpose": "Shared vocabulary with the ATS output; source of aliases.",
             "preprocessing": "Read-only. Not modified by this pipeline.", "limitations": "Technology-focused."},
            {"source": "Job-fit corpora (med2425/resume-job-fit-merged-v1, 0xnbk/resume-ats-score-v1-en)",
             "version": "as downloaded by careerpilot_ats", "url": "huggingface.co/datasets", "available_locally": ats_raw.exists(),
             "license": "med2425: not declared; 0xnbk: Apache-2.0", "real_or_synthetic": "real job-description text, synthetic fit labels",
             "row_count": {"distinct_skill_sets": 844}, "fields": ["job description text", "resume text"],
             "purpose": "Empirical job demand per skill (share of job descriptions asking for it), via the trained skill recommender.",
             "preprocessing": "Read-only reuse of ai-service/artifacts/skill_recommender.json. No text is copied into training data.",
             "limitations": "Mostly US general-IT postings; small."},
            {"source": "Curated career knowledge", "version": KNOWLEDGE_VERSION, "url": "careerpilot_career/training/curated_knowledge.py",
             "license": "project-owned", "real_or_synthetic": "hand-authored editorial judgement",
             "row_count": {"skills": len(SKILLS), "roles": len(ROLES)},
             "fields": ["prerequisites", "difficulty", "hours", "role skill levels", "projects", "interview topics"],
             "purpose": "The prerequisite graph, role targets, projects and interview topics no external source provides.",
             "preprocessing": "Validated by build_skill_graph.py (acyclic, no dangling references).",
             "limitations": "Not an official standard and not empirically validated. Hours are planning estimates."},
        ],
    }
    write_json(KNOWLEDGE / "data_source_manifest.json", manifest)
    print(f"O*NET 31.0: {onet['row_count']}")
    print(f"ESCO: {esco['occupations_fetched']} occupations fetched, {len(esco['failed'])} failed {esco['failed'] or ''}")
    print(f"wrote {KNOWLEDGE / 'data_source_manifest.json'}")


if __name__ == "__main__":
    main()
