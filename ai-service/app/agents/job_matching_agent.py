"""Job Matching Agent (§5.2, §9).

Responsibility: score a candidate against a specific company/role opening and
produce the matching skills, the missing skills and a prioritised preparation
plan.

Scoring model (explainable by design):
    match = 0.55 * required-skill coverage
          + 0.20 * preferred-skill coverage
          + 0.15 * semantic similarity between the profile and the JD
          + 0.10 * eligibility/experience fit

Required-skill coverage dominates because that is what a recruiter filters on
first. Semantic similarity is a supporting signal, not the driver, so the score
never becomes an unexplainable embedding artefact.
"""
from __future__ import annotations

from typing import Any

from pydantic import Field

from app.agents.base import BaseAgent
from app.nlp.skills_taxonomy import canonicalise, normalise
from app.schemas.common import GapSeverity, LooseModel
from app.services.embeddings import cosine_similarity, embed_text

WEIGHTS = {"required": 0.55, "preferred": 0.20, "semantic": 0.15, "eligibility": 0.10}


class JobMatchInput(LooseModel):
    studentSkills: list[str] = Field(default_factory=list)
    studentProjects: list[str] = Field(default_factory=list)
    studentSummary: str = ""
    cgpa: float | None = None
    backlogs: int = 0
    totalExperienceMonths: int = 0
    department: str | None = None

    jobDescriptionId: str | None = None
    companyName: str = ""
    roleTitle: str = ""
    descriptionText: str = ""
    requiredSkills: list[str] = Field(default_factory=list)
    preferredSkills: list[str] = Field(default_factory=list)
    minCgpa: float | None = None
    maxBacklogs: int | None = None
    allowedDepartments: list[str] = Field(default_factory=list)


class PreparationPlanItem(LooseModel):
    focus: str
    reason: str
    priority: GapSeverity = "MEDIUM"
    estimatedHours: float = 8
    resources: list[str] = Field(default_factory=list)


class JobMatchOutput(LooseModel):
    jobDescriptionId: str | None = None
    companyName: str = ""
    roleTitle: str = ""
    matchScore: float
    requiredCoverage: float
    preferredCoverage: float
    semanticSimilarity: float
    eligibilityScore: float
    eligible: bool = True
    eligibilityNotes: list[str] = Field(default_factory=list)
    matchingSkills: list[str] = Field(default_factory=list)
    missingSkills: list[str] = Field(default_factory=list)
    recommendedSkills: list[str] = Field(default_factory=list)
    verdict: str = ""
    preparationPlan: list[PreparationPlanItem] = Field(default_factory=list)


def _canonical_set(skills: list[str]) -> dict[str, str]:
    """Maps normalised key -> display name, collapsing aliases."""
    out: dict[str, str] = {}
    for skill in skills:
        if not skill or not skill.strip():
            continue
        canonical = canonicalise(skill)
        name = canonical.name if canonical else skill.strip()
        out[normalise(name)] = name
    return out


def _severity_for(coverage_gap: float, is_required: bool) -> GapSeverity:
    if is_required and coverage_gap >= 0.5:
        return "CRITICAL"
    if is_required:
        return "HIGH"
    return "MEDIUM" if coverage_gap >= 0.4 else "LOW"


class JobMatchingAgent(BaseAgent[JobMatchInput, JobMatchOutput]):
    name = "JOB_MATCHING"
    responsibility = (
        "Score a student's profile against a specific company and role, identify matching and missing "
        "skills, check eligibility, and produce a prioritised preparation plan."
    )
    InputModel = JobMatchInput
    OutputModel = JobMatchOutput

    async def handle(self, payload: JobMatchInput) -> tuple[dict[str, Any], dict[str, Any]]:
        student = _canonical_set(payload.studentSkills)
        required = _canonical_set(payload.requiredSkills)
        preferred = _canonical_set(payload.preferredSkills)

        matched_required = [required[k] for k in required if k in student]
        missing_required = [required[k] for k in required if k not in student]
        matched_preferred = [preferred[k] for k in preferred if k in student]
        missing_preferred = [preferred[k] for k in preferred if k not in student and k not in required]

        required_coverage = (len(matched_required) / len(required)) if required else 1.0
        preferred_coverage = (len(matched_preferred) / len(preferred)) if preferred else 1.0

        semantic = self._semantic_similarity(payload)
        eligibility_score, eligible, notes = self._eligibility(payload)

        match_score = round(
            (
                required_coverage * WEIGHTS["required"]
                + preferred_coverage * WEIGHTS["preferred"]
                + semantic * WEIGHTS["semantic"]
                + eligibility_score * WEIGHTS["eligibility"]
            )
            * 100,
            2,
        )

        plan = self._preparation_plan(missing_required, missing_preferred, required_coverage, payload)
        verdict = self._verdict(match_score, eligible, len(missing_required), payload)

        return (
            {
                "jobDescriptionId": payload.jobDescriptionId,
                "companyName": payload.companyName,
                "roleTitle": payload.roleTitle,
                "matchScore": match_score,
                "requiredCoverage": round(required_coverage * 100, 2),
                "preferredCoverage": round(preferred_coverage * 100, 2),
                "semanticSimilarity": round(semantic * 100, 2),
                "eligibilityScore": round(eligibility_score * 100, 2),
                "eligible": eligible,
                "eligibilityNotes": notes,
                "matchingSkills": sorted(matched_required + matched_preferred),
                "missingSkills": sorted(missing_required),
                "recommendedSkills": sorted(missing_preferred)[:10],
                "verdict": verdict,
                "preparationPlan": plan,
            },
            {"provider": "internal"},
        )

    def _semantic_similarity(self, payload: JobMatchInput) -> float:
        """Cosine similarity between the candidate profile and the JD text."""
        profile = " ".join(
            filter(None, [payload.studentSummary, " ".join(payload.studentSkills), " ".join(payload.studentProjects)])
        ).strip()
        jd = " ".join(
            filter(None, [payload.descriptionText, " ".join(payload.requiredSkills), " ".join(payload.preferredSkills)])
        ).strip()

        if not profile or not jd:
            return 0.0
        # Cosine on these embeddings is in [-1, 1]; clamp so a negative value
        # cannot pull the composite score below zero.
        return max(0.0, min(1.0, cosine_similarity(embed_text(profile), embed_text(jd))))

    def _eligibility(self, payload: JobMatchInput) -> tuple[float, bool, list[str]]:
        """Hard eligibility gates recruiters apply before looking at skills."""
        score = 1.0
        eligible = True
        notes: list[str] = []

        if payload.minCgpa is not None:
            if payload.cgpa is None:
                score -= 0.3
                notes.append(
                    f"This role requires a minimum CGPA of {payload.minCgpa}, but no CGPA is recorded on your profile. "
                    "Add it so eligibility can be checked."
                )
            elif payload.cgpa < payload.minCgpa:
                score -= 0.6
                eligible = False
                notes.append(
                    f"Your CGPA of {payload.cgpa} is below the stated minimum of {payload.minCgpa} for this role."
                )
            else:
                notes.append(f"CGPA requirement met ({payload.cgpa} ≥ {payload.minCgpa}).")

        if payload.maxBacklogs is not None and payload.backlogs > payload.maxBacklogs:
            score -= 0.4
            eligible = False
            notes.append(
                f"This role allows at most {payload.maxBacklogs} backlog(s); your profile records {payload.backlogs}."
            )

        if payload.allowedDepartments and payload.department:
            permitted = {d.lower().strip() for d in payload.allowedDepartments}
            if payload.department.lower().strip() not in permitted:
                score -= 0.5
                eligible = False
                notes.append(
                    f"This role is open to {', '.join(payload.allowedDepartments)}; your department is {payload.department}."
                )

        if payload.totalExperienceMonths >= 3:
            score = min(1.0, score + 0.1)
            notes.append(f"{payload.totalExperienceMonths} month(s) of internship/work experience strengthens your profile.")

        return max(0.0, score), eligible, notes

    def _preparation_plan(
        self,
        missing_required: list[str],
        missing_preferred: list[str],
        required_coverage: float,
        payload: JobMatchInput,
    ) -> list[dict[str, Any]]:
        gap = 1.0 - required_coverage
        plan: list[dict[str, Any]] = []

        for skill in missing_required[:5]:
            plan.append({
                "focus": skill,
                "reason": (
                    f"{skill} is a stated requirement for the {payload.roleTitle or 'role'} position"
                    f"{' at ' + payload.companyName if payload.companyName else ''} and is not evidenced in your profile."
                ),
                "priority": _severity_for(gap, is_required=True),
                "estimatedHours": 16 if gap >= 0.5 else 10,
                "resources": [
                    f"Official {skill} documentation",
                    f"Build one small project that uses {skill} end to end",
                    f"Add a resume bullet showing {skill} producing a measurable result",
                ],
            })

        for skill in missing_preferred[:3]:
            plan.append({
                "focus": skill,
                "reason": f"{skill} is listed as preferred and would differentiate you from other candidates.",
                "priority": _severity_for(gap, is_required=False),
                "estimatedHours": 6,
                "resources": [f"Introductory {skill} tutorial", f"One practice exercise using {skill}"],
            })

        if payload.companyName:
            plan.append({
                "focus": f"{payload.companyName} interview pattern",
                "reason": (
                    f"Preparation is far more effective when targeted at {payload.companyName}'s actual "
                    "hiring rounds rather than generic practice."
                ),
                "priority": "MEDIUM",
                "estimatedHours": 4,
                "resources": [
                    f"Review {payload.companyName}'s recruitment rounds on the Companies page",
                    f"Run a company-specific mock interview for {payload.companyName}",
                ],
            })

        return plan

    def _verdict(self, score: float, eligible: bool, missing_count: int, payload: JobMatchInput) -> str:
        role = payload.roleTitle or "this role"
        company = f" at {payload.companyName}" if payload.companyName else ""

        if not eligible:
            return (
                f"You do not currently meet the stated eligibility criteria for {role}{company}. "
                "Review the eligibility notes - some criteria (such as a missing CGPA on your profile) "
                "can be resolved immediately."
            )
        if score >= 80:
            return f"Strong match for {role}{company}. Your profile covers almost all stated requirements - focus on interview practice."
        if score >= 60:
            return (
                f"Good match for {role}{company}. Closing {missing_count} skill gap(s) would move you into "
                "the strongest applicant band."
            )
        if score >= 40:
            return (
                f"Moderate match for {role}{company}. {missing_count} required skill(s) are missing; "
                "work through the preparation plan before applying."
            )
        return (
            f"Limited match for {role}{company} at present. {missing_count} required skill(s) are missing. "
            "Consider roles closer to your current profile while you close these gaps."
        )
