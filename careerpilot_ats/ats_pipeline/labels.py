"""Weak-label generation (§6). LABEL_VERSION tracks every change to a formula.

These are WEAK LABELS, not ground truth. Each component is a documented,
deterministic function of the resume (and JD) text, built on CareerPilot's
existing ATS engine — its per-criterion scores and its own primitives
(QUANTIFIER_RE, ACTION_VERBS, WEAK_PHRASES, extract_skills, keyword_match).
No label is ever produced by an LLM.

Notation: engine[X] = the existing engine's criterion X as a 0-100 ratio.
All components are clamped to [0, 100].

Why blend the engine with section-text heuristics? On the public corpus the
engine's item extractors return empty lists even after section restoration
(entries inside a section are still run together), so e.g. "Education Details"
scores 0 for resumes that plainly contain an education section. Blending with
section-text evidence keeps the engine as the anchor while correcting for a
known extraction artefact, instead of editing the production parser.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from app.nlp.resume_parser import parse_resume
from app.nlp.skills_taxonomy import extract_skills
from app.services.ats import ACTION_VERBS, QUANTIFIER_RE, WEAK_PHRASES, keyword_match, score_resume

from .scoring import clamp, final_score

LABEL_VERSION = "weak-v1"

# Dataset fit-label anchoring for JOB_MATCH (see job_match_components).
# FIT_LABEL_LAMBDA is the share of a holistic component taken from the
# dataset's 3-class label; the rest comes from measurable text evidence.
FIT_LABEL_LAMBDA = 0.35
FIT_BAND_CENTRE = {"No Fit": 20.0, "Potential Fit": 55.0, "Good Fit": 85.0}

CORE_SECTIONS = ("summary", "experience", "education", "skills", "projects")
_DEGREE = re.compile(
    r"\b(b\.?\s?tech|b\.?\s?e\b|bachelor|master|m\.?\s?tech|mba|ph\.?d|degree|diploma|"
    r"associate|b\.?\s?sc|m\.?\s?sc|bca|mca|university|college)\b",
    re.I,
)
_JD_DEGREE_REQ = re.compile(r"\b(bachelor|master|ph\.?d|degree|b\.?\s?tech|mba|diploma)\b", re.I)
_WORD = re.compile(r"[a-z][a-z+#.]{2,}")
_STOP = set(
    """the and for with you your are our will this that from have has not but all any can
their they them into been who what when where which while would should could about more most
other such than then also able must work working team role job position company including
experience years year strong skills knowledge ability excellent good well within across using""".split()
)


# --------------------------------------------------------------------- helpers
def _engine_ratios(ats: dict[str, Any]) -> dict[str, float]:
    return {b["criterion"]: 100.0 * b["score"] / b["maxScore"] for b in ats["breakdown"] if b["maxScore"]}


def _words(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP]


def _snippet(text: str, start: int, end: int, pad: int = 45) -> str:
    """A verbatim substring of the resume: evidence must be quotable."""
    s, e = max(0, start - pad), min(len(text), end + pad)
    return " ".join(text[s:e].split())


def _cosine(a: list[str], b: list[str]) -> float:
    ca, cb = Counter(a), Counter(b)
    num = sum(ca[t] * cb[t] for t in set(ca) & set(cb))
    den = (sum(v * v for v in ca.values()) ** 0.5) * (sum(v * v for v in cb.values()) ** 0.5)
    return num / den if den else 0.0


# ------------------------------------------------------------- shared signals
def analyse_resume(resume: str) -> dict[str, Any]:
    parsed = parse_resume(resume)
    ats = score_resume(parsed, resume)
    sections = {k: v for k, v in parsed["sections"].items() if v and v.strip()}
    lower = resume.lower()
    return {
        "parsed": parsed,
        "ats": ats,
        "engine": _engine_ratios(ats),
        "sections": sections,
        "skills": [s.name for s in extract_skills(resume)],
        "quant": list(QUANTIFIER_RE.finditer(resume)),
        "verbs": sum(1 for w in re.findall(r"[a-z]+", lower) if w in ACTION_VERBS),
        "weak": sum(lower.count(p) for p in WEAK_PHRASES),
        "months": parsed.get("totalExperienceMonths") or 0,
    }


def _structure(sig: dict[str, Any]) -> float:
    present = sum(1 for s in CORE_SECTIONS if s in sig["sections"])
    return 0.5 * sig["engine"].get("Section Structure", 0) + 0.5 * min(100, present / 4 * 100)


def _formatting(sig: dict[str, Any]) -> float:
    e = sig["engine"]
    return (e.get("Formatting Hygiene", 0) + e.get("Length Appropriateness", 0)) / 2


def _has_education(sig: dict[str, Any]) -> bool:
    return bool(sig["parsed"]["education"]) or bool(_DEGREE.search(sig["sections"].get("education", "")))


# ---------------------------------------------------------------- GENERAL_ATS
def general_components(sig: dict[str, Any]) -> dict[str, float]:
    """
    structure           = 0.5*engine[Section Structure] + 0.5*min(100, coreSectionsPresent/4*100)
    sectionCompleteness = mean(engine[Contact Information], hasEducation, hasSkills, hasExperienceOrProjects)
    skills              = 0.6*engine[Skills Coverage] + 0.4*min(100, distinctSkills/12*100)
    experience          = 0.5*engine[Experience Evidence] + 0.5*min(100, months/36*60 + 40*[expSection>=40 words])
    projects            = projects section: min(100, 40 + 15*distinctSkillsInProjects)
                          else 25 if experience mentions "project", else 0
    achievements        = 0.5*engine[Quantified Impact] + 0.5*min(100, quantifiedPhrases/5*100) + 15*[achievements section]
    keywords            = 0.5*engine[Action Verbs] + 0.5*min(100, actionVerbs/10*100) - 5*weakPhrases
    formatting          = mean(engine[Formatting Hygiene], engine[Length Appropriateness])
    """
    e, secs = sig["engine"], sig["sections"]

    completeness = sum([
        e.get("Contact Information", 0),
        100.0 if _has_education(sig) else 0.0,
        100.0 if ("skills" in secs or len(sig["skills"]) >= 5) else 0.0,
        100.0 if ("experience" in secs or "projects" in secs) else 0.0,
    ]) / 4

    skills = 0.6 * e.get("Skills Coverage", 0) + 0.4 * min(100, len(sig["skills"]) / 12 * 100)

    exp_text = secs.get("experience", "")
    exp_heur = min(100, sig["months"] / 36 * 60 + (40 if len(exp_text.split()) >= 40 else 0))
    experience = 0.5 * e.get("Experience Evidence", 0) + 0.5 * exp_heur

    proj_text = secs.get("projects", "")
    if proj_text:
        projects = min(100, 40 + 15 * len({s.name for s in extract_skills(proj_text)}))
    elif re.search(r"\bproject", exp_text, re.I):
        projects = 25.0  # projects described inside experience, no section of their own
    else:
        projects = 0.0

    ach_bonus = 15 if "achievements" in secs else 0
    achievements = (0.5 * e.get("Quantified Impact", 0)
                    + 0.5 * min(100, len(sig["quant"]) / 5 * 100) + ach_bonus)

    keywords = 0.5 * e.get("Action Verbs", 0) + 0.5 * min(100, sig["verbs"] / 10 * 100) - 5 * sig["weak"]

    raw = {
        "structure": _structure(sig), "sectionCompleteness": completeness, "skills": skills,
        "experience": experience, "projects": projects, "achievements": achievements,
        "keywords": keywords, "formatting": _formatting(sig),
    }
    return {k: clamp(v) for k, v in raw.items()}


# -------------------------------------------------------------- JOB_MATCH_ATS
def job_match_components(sig: dict[str, Any], jd: str,
                         fit_label: str | None) -> tuple[dict[str, float], dict[str, Any]]:
    """
    requiredSkillMatch   = keyword_match coverage of the JD's taxonomy skills (50 if the JD names none).
                           NEVER label-anchored, so it always agrees with matchedSkills/missingSkills.
    keywordCoverage      = % of the JD's top-20 content terms present in the resume
    experienceRelevance  = min(100, 220*cosine(experienceTerms, jdTerms) + min(25, months/48*25))
    projectRelevance     = % of JD skills that appear inside projects/experience text (40 if JD names none)
    educationEligibility = 100 if education present; else 30 if the JD requires a degree, else 70
    structure/formatting = identical to GENERAL_ATS

    Dataset anchoring: experienceRelevance, projectRelevance and keywordCoverage become
    (1-λ)*heuristic + λ*bandCentre(fitLabel), λ = FIT_LABEL_LAMBDA. These three are the
    holistic judgements lexical heuristics under-measure; everything else stays pure evidence.
    """
    secs, resume_skills = sig["sections"], sig["skills"]
    jd_skills = [s.name for s in extract_skills(jd)]
    haystack = " ".join([*secs.values(), " ".join(resume_skills)])
    km = (keyword_match(sig["parsed"], haystack, jd_skills) if jd_skills
          else {"matchedKeywords": [], "missingKeywords": [], "keywordCoverage": 0.0})

    required = km["keywordCoverage"] if jd_skills else 50.0

    jd_terms = [t for t, _ in Counter(_words(jd)).most_common(20)]
    resume_vocab = set(_words(" ".join(secs.values())))
    kw_cov = 100.0 * sum(t in resume_vocab for t in jd_terms) / max(1, len(jd_terms))

    exp_words = _words(secs.get("experience", "") or " ".join(secs.values()))
    exp_rel = min(100, 220 * _cosine(exp_words, _words(jd)) + min(25, sig["months"] / 48 * 25))

    applied = (secs.get("projects", "") + " " + secs.get("experience", "")).lower()
    proj_rel = (100.0 * sum(s.lower() in applied for s in jd_skills) / len(jd_skills)) if jd_skills else 40.0

    has_edu, needs_degree = _has_education(sig), bool(_JD_DEGREE_REQ.search(jd))
    edu = 100.0 if has_edu else (30.0 if needs_degree else 70.0)

    heuristic = {k: clamp(v) for k, v in {
        "requiredSkillMatch": required, "experienceRelevance": exp_rel, "projectRelevance": proj_rel,
        "keywordCoverage": kw_cov, "educationEligibility": edu,
        "structure": _structure(sig), "formatting": _formatting(sig),
    }.items()}

    anchored = dict(heuristic)
    if fit_label in FIT_BAND_CENTRE:
        centre = FIT_BAND_CENTRE[fit_label]
        for k in ("experienceRelevance", "projectRelevance", "keywordCoverage"):
            anchored[k] = clamp((1 - FIT_LABEL_LAMBDA) * heuristic[k] + FIT_LABEL_LAMBDA * centre)

    meta = {
        "jd_skills": jd_skills, "matched": km["matchedKeywords"], "missing": km["missingKeywords"],
        "heuristic_score": final_score("JOB_MATCH_ATS", heuristic), "fit_label": fit_label,
    }
    return anchored, meta


# ------------------------------------------------------- narrative (grounded)
_GEN_TEXT = {
    "structure": ("Clear, parseable section structure", "Sections are hard for an ATS to identify",
                  "Use standard headings (Summary, Experience, Education, Skills, Projects), one per line."),
    "sectionCompleteness": ("Core sections and contact details are present",
                            "Some core sections or contact details are missing",
                            "Make sure contact details, education, skills and experience or projects are all present."),
    "skills": ("Broad, clearly listed skill set", "Few recognisable skills are listed",
               "Add a dedicated Skills section listing the tools and technologies you have actually used."),
    "experience": ("Substantial, dated work experience", "Limited or undated work experience",
                   "Give each role a title, organisation and date range, with 2-4 bullet points of what you did."),
    "projects": ("Projects demonstrate applied skills", "No projects section showing applied work",
                 "Add 2-3 projects naming the technologies used and what each one achieved."),
    "achievements": ("Impact is quantified with numbers", "Achievements are not quantified",
                     "Quantify outcomes where you truthfully can (e.g. % improvement, users, time saved)."),
    "keywords": ("Strong action-oriented language", "Passive phrasing weakens the bullets",
                 "Start bullets with action verbs (built, led, reduced) instead of 'responsible for'."),
    "formatting": ("Clean formatting and appropriate length", "Formatting or length may hinder ATS parsing",
                   "Keep to 1-2 pages, avoid tables and graphics, and use consistent bullet formatting."),
}
_JM_TEXT = {
    "requiredSkillMatch": ("Covers most skills the job requires", "Many required skills are not evidenced", None),
    "experienceRelevance": ("Experience closely matches the role", "Experience is only loosely related to this role",
                            "Reorder bullets so the experience most relevant to this job comes first."),
    "projectRelevance": ("Projects use the job's required technologies",
                         "Projects do not show the job's required skills",
                         "Highlight projects that use the technologies this job asks for."),
    "keywordCoverage": ("Uses the job description's key terminology", "Misses much of the job's key terminology",
                        "Mirror the job description's terminology where it truthfully describes your work."),
    "educationEligibility": ("Education meets the stated requirement", "Education requirement may not be met",
                             "State your degree, institution and graduation year explicitly."),
    "structure": _GEN_TEXT["structure"],
    "formatting": _GEN_TEXT["formatting"],
}


def _narrative(components: dict[str, float], table: dict) -> tuple[list[str], list[str], list[str]]:
    ranked = sorted(components.items(), key=lambda kv: kv[1])
    strengths = [table[k][0] for k, v in sorted(components.items(), key=lambda kv: -kv[1]) if v >= 70][:4]
    weaknesses = [table[k][1] for k, v in ranked if v <= 45][:4]
    recs = [table[k][2] for k, v in ranked if v < 60 and table[k][2]][:4]
    return strengths, weaknesses, recs


def _general_evidence(sig: dict[str, Any], resume: str) -> list[str]:
    ev = []
    if sig["sections"]:
        ev.append("Sections detected: " + ", ".join(sorted(sig["sections"])))
    if sig["skills"]:
        ev.append("Skills found in resume: " + ", ".join(sig["skills"][:12]))
    if sig["months"]:
        ev.append(f"Dated experience totals about {sig['months']} months")
    for m in sig["quant"][:2]:
        ev.append(f'Quantified: "{_snippet(resume, m.start(), m.end())}"')
    return ev[:6]


# ------------------------------------------------------------------ targets
def general_target(resume: str) -> dict[str, Any]:
    sig = analyse_resume(resume)
    comps = general_components(sig)
    s, w, r = _narrative(comps, _GEN_TEXT)
    return {
        "mode": "GENERAL_ATS", "componentScores": comps, "atsScore": final_score("GENERAL_ATS", comps),
        "strengths": s, "weaknesses": w, "recommendations": r, "evidence": _general_evidence(sig, resume),
    }


def job_match_target(resume: str, jd: str,
                     fit_label: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    sig = analyse_resume(resume)
    comps, meta = job_match_components(sig, jd, fit_label)
    s, w, r = _narrative(comps, _JM_TEXT)
    # Missing-skill advice never tells the candidate to claim a skill they lack.
    for skill in meta["missing"][:3]:
        r.append(f"The job asks for {skill}, which the resume does not mention. If you have used it, "
                 f"add a concrete example; if not, consider a small project that uses it.")
    ev = []
    if meta["jd_skills"]:
        ev.append("Job requires: " + ", ".join(meta["jd_skills"][:12]))
    if meta["matched"]:
        ev.append("Resume evidences: " + ", ".join(meta["matched"][:12]))
    if meta["missing"]:
        ev.append("Not found in resume: " + ", ".join(meta["missing"][:12]))
    if sig["months"]:
        ev.append(f"Dated experience totals about {sig['months']} months")
    target = {
        "mode": "JOB_MATCH_ATS", "componentScores": comps, "atsScore": final_score("JOB_MATCH_ATS", comps),
        "matchedSkills": meta["matched"], "missingSkills": meta["missing"],
        "strengths": s, "weaknesses": w, "recommendations": r[:6], "evidence": ev[:6],
    }
    return target, meta
