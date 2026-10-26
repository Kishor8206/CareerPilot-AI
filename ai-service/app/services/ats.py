"""ATS-oriented resume scoring (§8).

What this is
------------
A transparent, rule-based approximation of how applicant-tracking systems and
recruiters filter resumes. Every criterion is scored independently and returned
in a breakdown, so a student can see exactly why they scored what they did and
what to change. There is no opaque model here by design.

What this is not
----------------
It is not a replica of any specific vendor's ATS. Real systems are proprietary
and vary. The score is a preparation aid, and the API labels it as such.
"""
from __future__ import annotations

import re
from typing import Any

from app.nlp.skills_taxonomy import canonicalise, normalise

ENGINE_VERSION = "1.0.0"

DISCLAIMER = (
    "This ATS score is a rule-based approximation produced by CareerPilot AI to help you improve "
    "your resume. It is not the output of any specific employer's applicant-tracking system."
)

# Weights sum to 100. Contact and section structure are weighted heavily because
# a resume an ATS cannot parse is rejected regardless of content quality.
CRITERIA_WEIGHTS = {
    "contact_information": 10,
    "section_structure": 15,
    "skills_coverage": 20,
    "experience_evidence": 15,
    "education_details": 10,
    "quantified_impact": 10,
    "action_verbs": 5,
    "formatting_hygiene": 10,
    "length_appropriateness": 5,
}

ACTION_VERBS = {
    "developed", "designed", "implemented", "built", "created", "led", "managed",
    "improved", "optimized", "optimised", "reduced", "increased", "automated",
    "deployed", "integrated", "architected", "engineered", "delivered", "launched",
    "streamlined", "migrated", "refactored", "collaborated", "coordinated",
    "analyzed", "analysed", "researched", "tested", "debugged", "maintained",
    "achieved", "spearheaded", "mentored", "trained", "presented", "published",
}

WEAK_PHRASES = {
    "responsible for", "worked on", "helped with", "involved in", "assisted with",
    "participated in", "was part of", "duties included", "tasked with",
}

# Sections a recruiter expects to find, and whether their absence is fatal.
EXPECTED_SECTIONS = {
    "education": True,
    "skills": True,
    "projects": False,
    "experience": False,
    "certifications": False,
    "summary": False,
    "achievements": False,
}

QUANTIFIER_RE = re.compile(
    r"(\d+\s*%|\b\d[\d,]*\s*(?:users|customers|students|records|requests|queries|hours|days|weeks|months|"
    r"times|x|k|m|lakh|crore|rupees|dollars|\$|₹)|\bby\s+\d+|\breduced\s+\w+\s+(?:by\s+)?\d+|"
    r"\bfrom\s+\d+\s*(?:%|\w+)?\s*to\s+\d+)",
    re.IGNORECASE,
)


def _score(points: float, maximum: float) -> float:
    return round(max(0.0, min(points, maximum)), 2)


def _criterion(name: str, score: float, detail: str) -> dict[str, Any]:
    maximum = CRITERIA_WEIGHTS[name]
    return {
        "criterion": name.replace("_", " ").title(),
        "score": _score(score, maximum),
        "maxScore": maximum,
        "weight": maximum / 100,
        "detail": detail,
    }


def score_resume(parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
    """Scores a parsed resume and returns the score plus a full breakdown."""
    breakdown: list[dict[str, Any]] = []
    strengths: list[str] = []
    weaknesses: list[str] = []
    formatting: list[str] = []

    lower_text = raw_text.lower()
    sections = parsed.get("sections", {})
    word_count = int(parsed.get("wordCount", 0))

    # ---- 1. Contact information -------------------------------------------
    has_email = bool(parsed.get("email"))
    has_phone = bool(parsed.get("phone"))
    has_name = bool(parsed.get("name"))
    links = parsed.get("links", [])
    has_profile_link = any("linkedin" in l.lower() or "github" in l.lower() for l in links)

    contact_score = (3 if has_name else 0) + (3 if has_email else 0) + (2 if has_phone else 0) + (2 if has_profile_link else 0)
    missing_contact = [
        label for label, present in
        (("name", has_name), ("email", has_email), ("phone number", has_phone), ("LinkedIn or GitHub link", has_profile_link))
        if not present
    ]
    breakdown.append(_criterion(
        "contact_information",
        contact_score,
        "All key contact details were detected." if not missing_contact
        else f"Could not detect: {', '.join(missing_contact)}.",
    ))
    if missing_contact:
        weaknesses.append(f"Your resume is missing or hiding: {', '.join(missing_contact)}.")
        formatting.append(
            "Put your name, phone, email and LinkedIn/GitHub on separate lines at the very top, as plain text - "
            "ATS parsers often fail to read details placed inside headers, footers or images."
        )
    else:
        strengths.append("Contact details are complete and machine-readable.")

    # ---- 2. Section structure ---------------------------------------------
    present_sections = {k for k in sections if k != "header"}
    found_required = [s for s, required in EXPECTED_SECTIONS.items() if required and s in present_sections]
    found_optional = [s for s, required in EXPECTED_SECTIONS.items() if not required and s in present_sections]
    required_total = sum(1 for r in EXPECTED_SECTIONS.values() if r)

    structure_score = (len(found_required) / required_total) * 9 + min(6.0, len(found_optional) * 1.5)
    missing_required = [s for s, required in EXPECTED_SECTIONS.items() if required and s not in present_sections]
    breakdown.append(_criterion(
        "section_structure",
        structure_score,
        f"Detected {len(present_sections)} standard section(s): {', '.join(sorted(present_sections)) or 'none'}.",
    ))
    if missing_required:
        weaknesses.append(f"Standard section heading(s) not found: {', '.join(missing_required)}.")
        formatting.append(
            "Use conventional, plainly-spelled section headings ('Education', 'Technical Skills', 'Projects'). "
            "Creative headings frequently defeat automated section detection."
        )
    else:
        strengths.append("Your resume uses standard section headings that parsers recognise.")

    # ---- 3. Skills coverage ------------------------------------------------
    skills = parsed.get("skills", [])
    languages = parsed.get("programmingLanguages", [])
    frameworks = parsed.get("frameworks", [])
    fundamentals = parsed.get("fundamentals", [])

    skills_score = (
        min(8.0, len(skills) * 0.55)
        + min(4.0, len(languages) * 1.4)
        + min(4.0, len(frameworks) * 1.2)
        + min(4.0, len(fundamentals) * 1.4)
    )
    breakdown.append(_criterion(
        "skills_coverage",
        skills_score,
        f"{len(skills)} recognised skill(s): {len(languages)} language(s), {len(frameworks)} framework(s), "
        f"{len(fundamentals)} CS fundamental(s).",
    ))
    if len(skills) < 8:
        weaknesses.append(f"Only {len(skills)} recognised skills were found. Most shortlisted resumes list 10-18.")
    else:
        strengths.append(f"A healthy breadth of {len(skills)} recognised skills was detected.")
    if not fundamentals:
        weaknesses.append(
            "No CS fundamentals (Data Structures, DBMS, OS, Networks) were detected - these are explicit "
            "keyword filters for most campus roles."
        )

    # ---- 4. Experience evidence -------------------------------------------
    projects = parsed.get("projects", [])
    internships = parsed.get("internships", [])
    experience = parsed.get("experience", [])

    experience_score = min(7.0, len(projects) * 2.2) + min(5.0, len(internships) * 2.5) + min(3.0, len(experience) * 3.0)
    breakdown.append(_criterion(
        "experience_evidence",
        experience_score,
        f"{len(projects)} project(s), {len(internships)} internship(s), {len(experience)} work entry(ies).",
    ))
    if not projects:
        weaknesses.append("No projects were detected. Projects are the primary evidence of ability for a fresher.")
    elif len(projects) >= 2:
        strengths.append(f"{len(projects)} projects give concrete evidence of applied skill.")
    if internships:
        strengths.append(f"{len(internships)} internship(s) detected - this is a strong differentiator.")

    # ---- 5. Education details ---------------------------------------------
    education = parsed.get("education", [])
    has_cgpa = any(e.get("cgpa") or e.get("percentage") for e in education)
    has_institution = any(e.get("institution") for e in education)
    has_year = any(e.get("endYear") for e in education)

    education_score = (4.0 if education else 0) + (3.0 if has_cgpa else 0) + (1.5 if has_institution else 0) + (1.5 if has_year else 0)
    breakdown.append(_criterion(
        "education_details",
        education_score,
        f"{len(education)} education entry(ies); CGPA/percentage {'present' if has_cgpa else 'not detected'}.",
    ))
    if not has_cgpa:
        weaknesses.append(
            "No CGPA or percentage was detected. Most campus recruiters apply a hard academic cut-off, and a "
            "missing score is often treated as a fail."
        )
        formatting.append("State your CGPA explicitly, for example 'CGPA: 8.4/10'.")

    # ---- 6. Quantified impact ---------------------------------------------
    quantifiers = QUANTIFIER_RE.findall(raw_text)
    quantified_score = min(10.0, len(quantifiers) * 1.8)
    breakdown.append(_criterion(
        "quantified_impact",
        quantified_score,
        f"{len(quantifiers)} quantified result(s) detected.",
    ))
    if len(quantifiers) < 3:
        weaknesses.append(
            f"Only {len(quantifiers)} quantified result(s) found. Numbers are what make a bullet memorable."
        )
        formatting.append(
            "Rewrite outcomes with numbers: 'Reduced page load from 4.2s to 1.1s' beats 'Improved performance'."
        )
    else:
        strengths.append(f"{len(quantifiers)} quantified results give your claims credibility.")

    # ---- 7. Action verbs ---------------------------------------------------
    verb_hits = {v for v in ACTION_VERBS if re.search(rf"\b{v}\b", lower_text)}
    weak_hits = [p for p in WEAK_PHRASES if p in lower_text]
    verb_score = min(5.0, len(verb_hits) * 0.45) - min(2.0, len(weak_hits) * 0.7)
    breakdown.append(_criterion(
        "action_verbs",
        verb_score,
        f"{len(verb_hits)} distinct action verb(s); {len(weak_hits)} weak phrase(s) detected.",
    ))
    if weak_hits:
        weaknesses.append(f"Weak phrasing detected: {', '.join(weak_hits[:3])}.")
        formatting.append(
            f"Replace passive phrases such as '{weak_hits[0]}' with a strong action verb - 'Built', 'Designed', 'Automated'."
        )

    # ---- 8. Formatting hygiene --------------------------------------------
    lines = [ln for ln in raw_text.split("\n") if ln.strip()]
    bullet_lines = sum(1 for ln in lines if re.match(r"^\s*[-•*▪●]", ln))
    long_lines = sum(1 for ln in lines if len(ln) > 160)
    table_markers = raw_text.count("|")
    special_char_ratio = len(re.findall(r"[^\w\s.,;:()/@%+&'\"-]", raw_text)) / max(1, len(raw_text))

    formatting_score = 10.0
    formatting_notes: list[str] = []
    if bullet_lines < 5:
        formatting_score -= 2.5
        formatting_notes.append("few bullet points")
    if long_lines > 5:
        formatting_score -= 2.0
        formatting_notes.append(f"{long_lines} very long lines")
    if table_markers > 25:
        formatting_score -= 2.0
        formatting_notes.append("heavy table/column layout")
    if special_char_ratio > 0.02:
        formatting_score -= 1.5
        formatting_notes.append("unusual symbols")

    breakdown.append(_criterion(
        "formatting_hygiene",
        formatting_score,
        "Clean, parser-friendly formatting." if not formatting_notes else f"Issues: {', '.join(formatting_notes)}.",
    ))
    if bullet_lines < 5:
        formatting.append("Use bullet points rather than paragraphs; recruiters scan a resume in roughly 7 seconds.")
    if table_markers > 25:
        formatting.append(
            "Multi-column and table layouts often scramble in ATS text extraction. A single-column layout is safest."
        )

    # ---- 9. Length ---------------------------------------------------------
    if word_count < 200:
        length_score, length_note = 1.5, f"{word_count} words - too sparse for a complete profile."
        weaknesses.append("Your resume is very short. Add detail to your projects and skills.")
    elif word_count <= 700:
        length_score, length_note = 5.0, f"{word_count} words - ideal for a one-page fresher resume."
        strengths.append("The resume length is well judged for a fresher.")
    elif word_count <= 1100:
        length_score, length_note = 3.5, f"{word_count} words - slightly long; aim for one page."
    else:
        length_score, length_note = 2.0, f"{word_count} words - too long for a fresher resume."
        formatting.append("Trim to a single page. For a fresher, two pages usually signal poor prioritisation.")

    breakdown.append(_criterion("length_appropriateness", length_score, length_note))

    total = round(sum(item["score"] for item in breakdown), 2)

    return {
        "atsScore": min(100.0, max(0.0, total)),
        "breakdown": breakdown,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "formattingRecommendations": formatting,
        "engineVersion": ENGINE_VERSION,
        "disclaimer": DISCLAIMER,
    }


def keyword_match(parsed: dict[str, Any], raw_text: str, jd_keywords: list[str]) -> dict[str, Any]:
    """Compares the resume against a job description's keyword set.

    Matching is alias-aware: a resume saying "ReactJS" matches a JD asking for
    "React". Keywords not in the taxonomy fall back to a literal, word-boundary
    text search so JD-specific terms are not silently dropped.
    """
    resume_skill_keys = {normalise(s) for s in parsed.get("skills", [])}
    lower_text = raw_text.lower()

    matched: list[str] = []
    missing: list[str] = []

    for keyword in jd_keywords:
        canonical = canonicalise(keyword)
        if canonical is not None:
            if normalise(canonical.name) in resume_skill_keys:
                matched.append(canonical.name)
            else:
                missing.append(canonical.name)
            continue

        pattern = rf"(?<![a-z0-9]){re.escape(keyword.lower())}(?![a-z0-9])"
        (matched if re.search(pattern, lower_text) else missing).append(keyword)

    # De-duplicate while preserving order.
    matched = list(dict.fromkeys(matched))
    missing = list(dict.fromkeys(k for k in missing if k not in matched))

    total = len(matched) + len(missing)
    coverage = round((len(matched) / total) * 100, 2) if total else 0.0

    return {"matchedKeywords": matched, "missingKeywords": missing, "keywordCoverage": coverage}
