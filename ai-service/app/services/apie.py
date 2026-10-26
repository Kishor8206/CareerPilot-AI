"""Adaptive Placement Intelligence Engine (§6).

APIE is the central intelligence layer. It takes every measured signal about a
student and produces a single, explainable Placement Readiness Score plus the
strengths, gaps, recommendations and reassessment triggers that drive the rest
of the platform.

Ten responsibilities, in order:
  1. aggregate performance evidence
  2. normalise heterogeneous scores onto 0-100
  3. identify skill gaps
  4. identify strengths
  5. compute the Placement Readiness Score
  6. compute target-role and target-company readiness
  7. generate recommendations
  8. feed the career plan
  9. track improvement against the previous computation
 10. trigger reassessment where evidence has gone stale

Design commitments
------------------
*Not a plain average.* Components are weighted, evidence-count aware, and
modified by projects, certifications, internships and human alumni feedback.

*Configurable.* Weights, modifiers and band cut-offs are passed in by the Node
gateway from the `SystemConfiguration` collection. Nothing here is hardcoded
policy; the constants below are only the fallback when configuration is absent.

*Prototype.* The weighting is a defensible starting point derived from campus
placement practice. It is not empirically validated, and every payload says so.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.core.logging import get_logger

log = get_logger(__name__)

MODEL_DISCLAIMER = (
    "PROTOTYPE SCORING MODEL. The Placement Readiness Score is produced by a configurable weighted model "
    "developed for this project. It has not been validated against real placement outcomes and must be "
    "used as a preparation guide, not as a prediction of employment."
)

# Fallbacks, used only when the gateway supplies no configuration.
DEFAULT_WEIGHTS = {
    "resume": 0.10, "coding": 0.25, "technical": 0.20, "hr": 0.10,
    "communication": 0.15, "aptitude": 0.10, "academic": 0.10,
}

DEFAULT_MODIFIERS = {
    "projectBonusMax": 3.0, "projectCap": 4,
    "certificationBonusMax": 2.0, "certificationCap": 4,
    "internshipBonusMax": 3.0, "internshipCap": 2,
    "alumniFeedbackInfluence": 4.0,
    "missingComponentPenalty": 0.0,
}

DEFAULT_BANDS = [
    {"band": "AT_RISK", "min": 0, "max": 39.999},
    {"band": "NEEDS_IMPROVEMENT", "min": 40, "max": 59.999},
    {"band": "PLACEMENT_READY", "min": 60, "max": 79.999},
    {"band": "HIGHLY_READY", "min": 80, "max": 100},
]

COMPONENT_LABELS = {
    "resume": "Resume & ATS",
    "coding": "Coding",
    "technical": "Technical Interview",
    "hr": "HR Interview",
    "communication": "Communication",
    "aptitude": "Aptitude",
    "academic": "Academic",
}

# Where a student should go to improve each component.
COMPONENT_ROUTES = {
    "resume": ("/resume", "Analyse your resume"),
    "coding": ("/coding", "Practise coding problems"),
    "technical": ("/interview", "Start a technical mock interview"),
    "hr": ("/interview", "Practise an HR round"),
    "communication": ("/interview", "Practise structured answers"),
    "aptitude": ("/assessments", "Take an aptitude test"),
    "academic": ("/profile", "Complete your academic details"),
}

STRENGTH_THRESHOLD = 70.0
WEAKNESS_THRESHOLD = 50.0


def _band_for(score: float, bands: list[dict[str, Any]]) -> str:
    for band in bands:
        if float(band["min"]) <= score <= float(band["max"]):
            return str(band["band"])
    return "AT_RISK"


def _days_since(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        stamp = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - stamp).total_seconds() / 86400
    except ValueError:
        return None


def _normalise_academic(cgpa: float | None, backlogs: int) -> float | None:
    """CGPA on a /10 scale to 0-100, with a backlog penalty.

    Backlogs matter here because most campus recruiters treat them as a hard
    filter, so a profile with them genuinely is less placement-ready.
    """
    if cgpa is None:
        return None
    base = max(0.0, min(100.0, (cgpa / 10.0) * 100.0))
    penalty = min(25.0, backlogs * 8.0)
    return round(max(0.0, base - penalty), 2)


def compute_readiness(payload: dict[str, Any]) -> dict[str, Any]:
    """Runs the full APIE computation.

    `payload` carries raw component evidence, profile counts, configuration and
    (optionally) the previous score for delta tracking.
    """
    weights: dict[str, float] = {**DEFAULT_WEIGHTS, **(payload.get("weights") or {})}
    modifiers: dict[str, Any] = {**DEFAULT_MODIFIERS, **(payload.get("modifiers") or {})}
    bands: list[dict[str, Any]] = payload.get("bands") or DEFAULT_BANDS
    stale_after_days: float = float(payload.get("reassessmentDays", 30))

    raw_components: dict[str, Any] = payload.get("components") or {}
    profile: dict[str, Any] = payload.get("profile") or {}

    # ---- 1 & 2. Aggregate and normalise -----------------------------------
    components: list[dict[str, Any]] = []
    weighted_total = 0.0
    effective_weight = 0.0

    for key, weight in weights.items():
        entry = raw_components.get(key) or {}
        raw_value = entry.get("value")
        evidence_count = int(entry.get("evidenceCount", 0) or 0)
        last_updated = entry.get("lastUpdated")

        # Academic is derived rather than measured.
        if key == "academic" and raw_value is None:
            raw_value = _normalise_academic(profile.get("cgpa"), int(profile.get("backlogs", 0) or 0))
            evidence_count = 1 if raw_value is not None else 0

        has_evidence = raw_value is not None and evidence_count > 0
        normalised = max(0.0, min(100.0, float(raw_value))) if has_evidence else 0.0

        age_days = _days_since(last_updated)
        stale = bool(has_evidence and age_days is not None and age_days > stale_after_days)

        contribution = normalised * weight
        weighted_total += contribution
        # Components with no evidence still consume their weight: a student who
        # has never attempted a coding test is not "coding-ready by default".
        effective_weight += weight

        components.append({
            "key": key,
            "label": COMPONENT_LABELS.get(key, key.title()),
            "raw": round(float(raw_value), 2) if has_evidence else None,
            "normalized": round(normalised, 2),
            "weight": round(weight, 4),
            "weighted": round(contribution, 3),
            "evidenceCount": evidence_count,
            "lastUpdated": last_updated,
            "stale": stale,
            "ageDays": round(age_days, 1) if age_days is not None else None,
        })

    base_score = (weighted_total / effective_weight) if effective_weight else 0.0

    # ---- Modifiers ---------------------------------------------------------
    applied_modifiers: list[dict[str, Any]] = []

    project_count = int(profile.get("projectCount", 0) or 0)
    if project_count:
        delta = min(project_count, int(modifiers["projectCap"])) / max(1, int(modifiers["projectCap"])) * float(modifiers["projectBonusMax"])
        applied_modifiers.append({
            "label": "Projects",
            "delta": round(delta, 2),
            "reason": f"{project_count} project(s) on your profile provide evidence of applied skill.",
        })

    certification_count = int(profile.get("certificationCount", 0) or 0)
    if certification_count:
        delta = min(certification_count, int(modifiers["certificationCap"])) / max(1, int(modifiers["certificationCap"])) * float(modifiers["certificationBonusMax"])
        applied_modifiers.append({
            "label": "Certifications",
            "delta": round(delta, 2),
            "reason": f"{certification_count} certification(s) demonstrate structured learning.",
        })

    internship_months = float(profile.get("internshipMonths", 0) or 0)
    if internship_months > 0:
        capped = min(internship_months / 6.0, float(modifiers["internshipCap"]))
        delta = (capped / max(1e-6, float(modifiers["internshipCap"]))) * float(modifiers["internshipBonusMax"])
        applied_modifiers.append({
            "label": "Internship experience",
            "delta": round(delta, 2),
            "reason": f"{round(internship_months)} month(s) of internship experience is a strong differentiator.",
        })

    # Human-in-the-loop: alumni feedback moves the score in both directions (§43).
    alumni_score = profile.get("alumniFeedbackScore")
    if alumni_score is not None:
        influence = float(modifiers["alumniFeedbackInfluence"])
        delta = ((float(alumni_score) - 60.0) / 40.0) * influence
        delta = max(-influence, min(influence, delta))
        applied_modifiers.append({
            "label": "Alumni feedback",
            "delta": round(delta, 2),
            "reason": (
                f"Verified alumni rated your mock interview performance {round(float(alumni_score))}/100. "
                "Human evaluation is weighted directly into your readiness."
            ),
        })

    missing = [c for c in components if c["raw"] is None]
    if missing and float(modifiers.get("missingComponentPenalty", 0)) > 0:
        delta = -float(modifiers["missingComponentPenalty"]) * len(missing)
        applied_modifiers.append({
            "label": "Missing evidence",
            "delta": round(delta, 2),
            "reason": f"{len(missing)} component(s) have no evidence yet: {', '.join(c['label'] for c in missing)}.",
        })

    score = round(max(0.0, min(100.0, base_score + sum(m["delta"] for m in applied_modifiers))), 2)
    band = _band_for(score, bands)

    # ---- 3 & 4. Strengths and weaknesses ----------------------------------
    measured = [c for c in components if c["raw"] is not None]
    strengths = [
        f"{c['label']} is a clear strength at {c['normalized']}/100."
        for c in sorted(measured, key=lambda c: -c["normalized"])
        if c["normalized"] >= STRENGTH_THRESHOLD
    ][:5]

    weaknesses = [
        f"{c['label']} is below the target level at {c['normalized']}/100 "
        f"(weight {int(c['weight'] * 100)}% of your readiness score)."
        for c in sorted(measured, key=lambda c: c["normalized"])
        if c["normalized"] < WEAKNESS_THRESHOLD
    ][:5]

    for component in components:
        if component["raw"] is None:
            weaknesses.append(
                f"{component['label']} has no evidence yet. It carries {int(component['weight'] * 100)}% "
                "of your readiness score, so this is costing you points."
            )
    weaknesses = weaknesses[:7]

    if not strengths and measured:
        best = max(measured, key=lambda c: c["normalized"])
        strengths.append(f"{best['label']} is your strongest area so far at {best['normalized']}/100.")

    # ---- 6. Target readiness ----------------------------------------------
    role_readiness = _role_readiness(payload, score, band, bands)
    company_readiness = _company_readiness(payload, score, bands)

    # ---- 10. Reassessment triggers ----------------------------------------
    reassessment = [
        {
            "component": c["label"],
            "reason": (
                f"Your {c['label'].lower()} score is {c['ageDays']:.0f} days old. "
                "Skills and readiness drift, so a fresh measurement keeps your score meaningful."
                if c["stale"]
                else f"No {c['label'].lower()} evidence has been recorded yet."
            ),
            "dueInDays": 0 if c["raw"] is None else max(0, int(stale_after_days - (c["ageDays"] or 0))),
        }
        for c in components
        if c["stale"] or c["raw"] is None
    ][:6]

    # ---- 9. Improvement tracking ------------------------------------------
    previous = payload.get("previousScore")
    delta = round(score - float(previous), 2) if previous is not None else None

    result = {
        "score": score,
        "band": band,
        "baseScore": round(base_score, 2),
        "components": components,
        "modifiers": applied_modifiers,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "targetRoleReadiness": role_readiness,
        "targetCompanyReadiness": company_readiness,
        "reassessmentSuggestions": reassessment,
        "previousScore": previous,
        "delta": delta,
        "improvementSummary": _improvement_summary(delta, score, band),
        "weightsSnapshot": weights,
        "weightsVersion": payload.get("weightsVersion", "1.0.0"),
        "modelDisclaimer": MODEL_DISCLAIMER,
        "computedAt": datetime.now(timezone.utc).isoformat(),
        "evidenceCoverage": round(len(measured) / max(1, len(components)) * 100, 1),
    }

    log.info(
        "APIE computation complete",
        extra={"score": score, "band": band, "evidenceCoverage": result["evidenceCoverage"]},
    )
    return result


def _role_readiness(payload: dict[str, Any], score: float, band: str, bands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adjusts overall readiness per target role by that role's skill coverage."""
    out: list[dict[str, Any]] = []
    student_skills = {s.lower().strip() for s in payload.get("studentSkills", [])}

    for role in payload.get("targetRoles", [])[:5]:
        required = [s for s in role.get("coreSkills", []) if s]
        missing = [s for s in required if s.lower().strip() not in student_skills]
        coverage = ((len(required) - len(missing)) / len(required)) if required else 1.0

        # Overall readiness dominates; role-specific coverage adjusts it.
        role_score = round(score * 0.65 + coverage * 100 * 0.35, 2)
        out.append({
            "roleId": role.get("roleId"),
            "roleTitle": role.get("roleTitle", "Unnamed role"),
            "score": role_score,
            "band": _band_for(role_score, bands),
            "skillCoverage": round(coverage * 100, 1),
            "missingSkills": missing[:10],
        })
    return out


def _company_readiness(payload: dict[str, Any], score: float, bands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adjusts readiness per target company using eligibility and match score."""
    out: list[dict[str, Any]] = []
    profile = payload.get("profile") or {}
    cgpa = profile.get("cgpa")
    backlogs = int(profile.get("backlogs", 0) or 0)

    for company in payload.get("targetCompanies", [])[:5]:
        notes: list[str] = []
        company_score = score

        minimum_cgpa = company.get("minCgpa")
        if minimum_cgpa is not None:
            if cgpa is None:
                company_score -= 5
                notes.append(f"CGPA not recorded; this company requires at least {minimum_cgpa}.")
            elif cgpa < float(minimum_cgpa):
                company_score -= 20
                notes.append(f"Your CGPA of {cgpa} is below this company's stated minimum of {minimum_cgpa}.")

        max_backlogs = company.get("maxBacklogs")
        if max_backlogs is not None and backlogs > int(max_backlogs):
            company_score -= 15
            notes.append(f"This company allows at most {max_backlogs} backlog(s); you have {backlogs}.")

        match_score = company.get("matchScore")
        if match_score is not None:
            company_score = company_score * 0.7 + float(match_score) * 0.3
            notes.append(f"Your skill match against this company's roles is {round(float(match_score))}%.")

        company_score = round(max(0.0, min(100.0, company_score)), 2)
        out.append({
            "companyId": company.get("companyId"),
            "companyName": company.get("companyName", "Unnamed company"),
            "score": company_score,
            "band": _band_for(company_score, bands),
            "gapSummary": " ".join(notes) or "No eligibility issues detected against this company's stated criteria.",
        })
    return out


def _improvement_summary(delta: float | None, score: float, band: str) -> str:
    if delta is None:
        return f"This is your first readiness computation. Your starting score is {score}/100 ({band.replace('_', ' ').title()})."
    if delta > 2:
        return f"Your readiness improved by {delta} points since the last computation. Keep going."
    if delta < -2:
        return (
            f"Your readiness fell by {abs(delta)} points. This usually means recent scores were lower than "
            "your earlier ones, or some evidence has gone stale."
        )
    return f"Your readiness is stable at {score}/100. Completing a new activity will move it."


def derive_skill_gaps(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Consolidates skill gaps from job matching and weak components (§6.3)."""
    gaps: dict[str, dict[str, Any]] = {}
    student_skills = {s.lower().strip() for s in payload.get("studentSkills", [])}

    for role in payload.get("targetRoles", []):
        for skill in role.get("coreSkills", []):
            key = skill.lower().strip()
            if not key or key in student_skills:
                continue
            entry = gaps.setdefault(key, {
                "skill": skill,
                "category": "PROGRAMMING_LANGUAGE",
                "currentLevel": 0.0,
                "requiredLevel": 75.0,
                "gap": 75.0,
                "severity": "HIGH",
                "source": "ROLE_REQUIREMENT",
                "relatedRoles": [],
                "recommendedActions": [
                    f"Complete a focused tutorial on {skill}",
                    f"Build one project that uses {skill} end to end",
                    f"Add a resume bullet showing {skill} with a measurable result",
                ],
            })
            role_title = role.get("roleTitle")
            if role_title and role_title not in entry["relatedRoles"]:
                entry["relatedRoles"].append(role_title)

    # A skill required by several target roles is more urgent than one required
    # by a single role.
    for entry in gaps.values():
        if len(entry["relatedRoles"]) >= 2:
            entry["severity"] = "CRITICAL"
            entry["requiredLevel"] = 80.0
            entry["gap"] = 80.0

    for skill in payload.get("jobMatchMissingSkills", []):
        key = skill.lower().strip()
        if key and key not in gaps and key not in student_skills:
            gaps[key] = {
                "skill": skill,
                "category": "PROGRAMMING_LANGUAGE",
                "currentLevel": 0.0,
                "requiredLevel": 70.0,
                "gap": 70.0,
                "severity": "MEDIUM",
                "source": "JOB_MATCH",
                "relatedRoles": [],
                "recommendedActions": [f"Learn the fundamentals of {skill}"],
            }

    severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    return sorted(gaps.values(), key=lambda g: (severity_order.get(g["severity"], 9), -g["gap"]))[:20]
