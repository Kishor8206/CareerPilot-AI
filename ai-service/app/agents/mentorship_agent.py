"""Alumni Mentorship Agent (§5.10, §18) and Analytics Agent (§5.11).

MentorshipAgent  - ranks verified alumni against a student's needs and turns
                   structured alumni feedback into APIE-consumable signals.
AnalyticsAgent   - aggregates cohort statistics for the placement officer.

Both are deterministic. Mentor ranking and institutional analytics must be
explainable and reproducible; a language model in that path would make the
result unauditable for no benefit.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from pydantic import Field

from app.agents.base import BaseAgent
from app.nlp.skills_taxonomy import normalise
from app.schemas.common import LooseModel

# Mentor-matching weights. Company match dominates because company-specific
# insight is the thing a student cannot get anywhere else in the platform.
MATCH_WEIGHTS = {
    "company": 0.35,
    "role": 0.20,
    "skills": 0.20,
    "gapCoverage": 0.15,
    "rating": 0.05,
    "availability": 0.05,
}


class AlumniCandidate(LooseModel):
    alumniId: str
    fullName: str = ""
    company: str = ""
    designation: str = ""
    domain: str = ""
    expertise: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    experienceYears: float = 0
    averageRating: float = 0
    sessionsConducted: int = 0
    acceptingMentees: bool = True
    availabilitySlots: int = 0
    department: str | None = None


class MentorMatchInput(LooseModel):
    studentSkills: list[str] = Field(default_factory=list)
    skillGaps: list[str] = Field(default_factory=list)
    targetCompanies: list[str] = Field(default_factory=list)
    targetRoles: list[str] = Field(default_factory=list)
    department: str | None = None
    weakComponents: list[str] = Field(default_factory=list)
    candidates: list[AlumniCandidate] = Field(default_factory=list)
    limit: int = 10


class MentorMatch(LooseModel):
    alumniId: str
    fullName: str = ""
    company: str = ""
    designation: str = ""
    matchScore: float = 0
    reasons: list[str] = Field(default_factory=list)
    coveredGaps: list[str] = Field(default_factory=list)
    suggestedTopics: list[str] = Field(default_factory=list)


class MentorMatchOutput(LooseModel):
    matches: list[MentorMatch] = Field(default_factory=list)
    note: str = ""


class AlumniMentorshipAgent(BaseAgent[MentorMatchInput, MentorMatchOutput]):
    name = "ALUMNI_MENTORSHIP"
    responsibility = (
        "Rank verified alumni mentors against a student's target companies, roles and skill gaps, and "
        "explain why each mentor was matched."
    )
    InputModel = MentorMatchInput
    OutputModel = MentorMatchOutput

    async def handle(self, payload: MentorMatchInput) -> tuple[dict[str, Any], dict[str, Any]]:
        target_companies = {c.lower().strip() for c in payload.targetCompanies if c}
        target_roles = {r.lower().strip() for r in payload.targetRoles if r}
        gap_keys = {normalise(g) for g in payload.skillGaps if g}

        matches: list[dict[str, Any]] = []

        for candidate in payload.candidates:
            reasons: list[str] = []
            scores: dict[str, float] = {}

            company_key = candidate.company.lower().strip()
            scores["company"] = 1.0 if company_key in target_companies else 0.0
            if scores["company"]:
                reasons.append(f"Currently works at {candidate.company}, one of your target companies.")

            designation_key = candidate.designation.lower()
            role_hit = any(role in designation_key or designation_key in role for role in target_roles if role)
            scores["role"] = 1.0 if role_hit else 0.0
            if role_hit:
                reasons.append(f"Holds a {candidate.designation} role, matching your target role.")

            mentor_skills = {normalise(s) for s in [*candidate.skills, *candidate.expertise] if s}
            student_keys = {normalise(s) for s in payload.studentSkills if s}
            overlap = mentor_skills & student_keys
            scores["skills"] = min(1.0, len(overlap) / 5) if mentor_skills else 0.0
            if overlap:
                reasons.append(f"Shares {len(overlap)} technology area(s) with your profile.")

            covered = gap_keys & mentor_skills
            scores["gapCoverage"] = min(1.0, len(covered) / 3) if gap_keys else 0.0
            covered_display = [g for g in payload.skillGaps if normalise(g) in covered]
            if covered_display:
                reasons.append(f"Can advise on your open skill gaps: {', '.join(covered_display[:3])}.")

            # An unrated mentor scores 0 here rather than being penalised as bad;
            # rating carries only 5% of the weight for exactly this reason.
            scores["rating"] = min(1.0, candidate.averageRating / 5) if candidate.sessionsConducted > 0 else 0.0
            if candidate.averageRating >= 4:
                reasons.append(f"Rated {candidate.averageRating}/5 across {candidate.sessionsConducted} session(s).")

            scores["availability"] = 1.0 if (candidate.acceptingMentees and candidate.availabilitySlots > 0) else 0.0
            if not candidate.acceptingMentees:
                reasons.append("Not currently accepting new mentees.")

            match_score = round(sum(scores[k] * w for k, w in MATCH_WEIGHTS.items()) * 100, 2)

            if candidate.department and payload.department and candidate.department == payload.department:
                match_score = min(100.0, match_score + 4)
                reasons.append(f"Graduated from your department ({candidate.department}).")

            if not reasons:
                reasons.append(
                    f"Experienced {candidate.designation or 'professional'} in {candidate.domain or 'the industry'} "
                    "who can give general placement guidance."
                )

            matches.append({
                "alumniId": candidate.alumniId,
                "fullName": candidate.fullName,
                "company": candidate.company,
                "designation": candidate.designation,
                "matchScore": match_score,
                "reasons": reasons[:4],
                "coveredGaps": covered_display[:5],
                "suggestedTopics": self._topics(candidate, payload, covered_display),
            })

        matches.sort(key=lambda m: -m["matchScore"])
        top = matches[: max(1, payload.limit)]

        note = (
            "Only alumni whose employment has been verified by an administrator appear here."
            if top
            else "No verified alumni currently match your targets. Try widening your target companies or roles."
        )

        return ({"matches": top, "note": note}, {"provider": "internal"})

    def _topics(self, candidate: AlumniCandidate, payload: MentorMatchInput, covered: list[str]) -> list[str]:
        topics: list[str] = []
        if candidate.company and candidate.company.lower().strip() in {c.lower().strip() for c in payload.targetCompanies}:
            topics.append(f"{candidate.company}'s interview process and what they actually look for")
        if covered:
            topics.append(f"How {covered[0]} is used in real production work")
        if "coding" in payload.weakComponents:
            topics.append("A live coding round with feedback on your problem-solving approach")
        if "communication" in payload.weakComponents or "hr" in payload.weakComponents:
            topics.append("Answer structure and communication in interviews")
        if not topics:
            topics.append("A general mock interview with structured written feedback")
        return topics[:4]


class FeedbackIngestInput(LooseModel):
    """Structured alumni feedback, translated for APIE consumption (§19)."""

    technicalKnowledge: float = 0
    communication: float = 0
    problemSolving: float = 0
    confidence: float = 0
    roleSuitability: float = 0
    recommendation: str = "BORDERLINE"
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    comments: str = ""


class FeedbackIngestOutput(LooseModel):
    overallScore: float = 0
    technicalSignal: float = 0
    communicationSignal: float = 0
    apieDelta: float = 0
    derivedSkillGaps: list[str] = Field(default_factory=list)
    summary: str = ""


class AlumniFeedbackIngestAgent(BaseAgent[FeedbackIngestInput, FeedbackIngestOutput]):
    """Converts human feedback into the signals APIE weights (§43 human-in-the-loop)."""

    name = "ALUMNI_FEEDBACK_INGEST"
    responsibility = "Translate structured alumni mock-interview feedback into APIE-consumable scores and gaps."
    InputModel = FeedbackIngestInput
    OutputModel = FeedbackIngestOutput

    RECOMMENDATION_DELTA = {"STRONG_HIRE": 4.0, "HIRE": 2.0, "BORDERLINE": 0.0, "NEEDS_WORK": -2.0}

    async def handle(self, payload: FeedbackIngestInput) -> tuple[dict[str, Any], dict[str, Any]]:
        dimensions = [
            payload.technicalKnowledge, payload.communication, payload.problemSolving,
            payload.confidence, payload.roleSuitability,
        ]
        # Each dimension is 0-10; roll up to 0-100.
        overall = round(sum(dimensions) / (len(dimensions) * 10) * 100, 1)

        technical = round((payload.technicalKnowledge + payload.problemSolving) / 20 * 100, 1)
        communication = round((payload.communication + payload.confidence) / 20 * 100, 1)

        base_delta = (overall - 60) / 40 * 4.0
        delta = round(max(-4.0, min(4.0, base_delta + self.RECOMMENDATION_DELTA.get(payload.recommendation, 0.0) * 0.25)), 2)

        # An improvement note that names a known technology becomes a tracked gap.
        from app.nlp.skills_taxonomy import extract_skills

        derived = sorted({s.name for note in payload.improvements for s in extract_skills(note)})

        return (
            {
                "overallScore": overall,
                "technicalSignal": technical,
                "communicationSignal": communication,
                "apieDelta": delta,
                "derivedSkillGaps": derived[:8],
                "summary": (
                    f"A verified alumnus rated this mock interview {overall}/100 with a recommendation of "
                    f"{payload.recommendation.replace('_', ' ').lower()}. This adjusts the readiness score by "
                    f"{delta:+.2f} points."
                ),
            },
            {"provider": "internal"},
        )


class AnalyticsInput(LooseModel):
    """Pre-aggregated rows supplied by the Node gateway; no database access here."""

    students: list[dict[str, Any]] = Field(default_factory=list)
    skillGaps: list[dict[str, Any]] = Field(default_factory=list)
    groupBy: str = "department"


class AnalyticsOutput(LooseModel):
    insights: list[str] = Field(default_factory=list)
    riskCohort: list[dict[str, Any]] = Field(default_factory=list)
    commonGaps: list[dict[str, Any]] = Field(default_factory=list)
    groupComparison: list[dict[str, Any]] = Field(default_factory=list)
    recommendedInterventions: list[dict[str, Any]] = Field(default_factory=list)


class AnalyticsAgent(BaseAgent[AnalyticsInput, AnalyticsOutput]):
    name = "ANALYTICS"
    responsibility = (
        "Aggregate cohort readiness data into institutional insights, identify the at-risk cohort and "
        "recommend interventions for the placement office."
    )
    InputModel = AnalyticsInput
    OutputModel = AnalyticsOutput

    async def handle(self, payload: AnalyticsInput) -> tuple[dict[str, Any], dict[str, Any]]:
        students = payload.students
        if not students:
            return (
                {
                    "insights": ["No student records matched the selected filters."],
                    "riskCohort": [], "commonGaps": [], "groupComparison": [], "recommendedInterventions": [],
                },
                {"provider": "internal"},
            )

        scored = [s for s in students if s.get("prs") is not None]
        total = len(students)
        average = round(sum(float(s["prs"]) for s in scored) / len(scored), 1) if scored else 0.0

        at_risk = [s for s in scored if float(s["prs"]) < 40]
        ready = [s for s in scored if float(s["prs"]) >= 60]
        unmeasured = total - len(scored)

        insights = [
            f"{total} student(s) matched the selected filters; {len(scored)} have a computed readiness score.",
            f"Average Placement Readiness Score is {average}/100.",
            f"{len(ready)} student(s) ({round(len(ready) / total * 100, 1)}%) are placement-ready or better.",
            f"{len(at_risk)} student(s) ({round(len(at_risk) / total * 100, 1)}%) are in the at-risk band.",
        ]
        if unmeasured:
            insights.append(
                f"{unmeasured} student(s) have no readiness score yet - they have not completed enough "
                "activities to be assessed. This is itself an engagement risk."
            )

        # Group comparison.
        groups: dict[str, list[float]] = {}
        for student in scored:
            key = str(student.get(payload.groupBy) or "Unspecified")
            groups.setdefault(key, []).append(float(student["prs"]))

        comparison = sorted(
            (
                {
                    "group": name,
                    "students": len(values),
                    "averagePrs": round(sum(values) / len(values), 1),
                    "readyPercentage": round(sum(1 for v in values if v >= 60) / len(values) * 100, 1),
                }
                for name, values in groups.items()
            ),
            key=lambda g: -g["averagePrs"],
        )

        if len(comparison) >= 2:
            best, worst = comparison[0], comparison[-1]
            insights.append(
                f"{best['group']} leads at {best['averagePrs']}/100 while {worst['group']} trails at "
                f"{worst['averagePrs']}/100 - a {round(best['averagePrs'] - worst['averagePrs'], 1)}-point spread."
            )

        # Common gaps across the cohort.
        gap_counter = Counter()
        gap_totals: dict[str, list[float]] = {}
        for gap in payload.skillGaps:
            skill = gap.get("skill")
            if not skill:
                continue
            gap_counter[skill] += 1
            gap_totals.setdefault(skill, []).append(float(gap.get("gap", 0) or 0))

        common_gaps = [
            {
                "skill": skill,
                "count": count,
                "affectedPercentage": round(count / total * 100, 1),
                "averageGap": round(sum(gap_totals[skill]) / len(gap_totals[skill]), 1),
            }
            for skill, count in gap_counter.most_common(10)
        ]
        if common_gaps:
            top = common_gaps[0]
            insights.append(
                f"'{top['skill']}' is the most widespread gap, affecting {top['count']} student(s) "
                f"({top['affectedPercentage']}% of this cohort)."
            )

        risk_cohort = sorted(
            (
                {
                    "studentId": s.get("studentId"),
                    "fullName": s.get("fullName"),
                    "department": s.get("department"),
                    "prs": s.get("prs"),
                    "reason": self._risk_reason(s),
                }
                for s in at_risk
            ),
            key=lambda s: float(s["prs"] or 0),
        )[:50]

        return (
            {
                "insights": insights,
                "riskCohort": risk_cohort,
                "commonGaps": common_gaps,
                "groupComparison": comparison,
                "recommendedInterventions": self._interventions(common_gaps, at_risk, unmeasured, total),
            },
            {"provider": "internal"},
        )

    def _risk_reason(self, student: dict[str, Any]) -> str:
        parts: list[str] = []
        for key, label in (("codingScore", "coding"), ("interviewScore", "interview"), ("atsScore", "resume")):
            value = student.get(key)
            if value is not None and float(value) < 40:
                parts.append(f"{label} {round(float(value))}/100")
        gap_count = student.get("skillGapCount")
        if gap_count and int(gap_count) > 5:
            parts.append(f"{gap_count} open skill gaps")
        return ("Low scores in: " + ", ".join(parts)) if parts else "Overall readiness below the at-risk threshold."

    def _interventions(
        self, common_gaps: list[dict[str, Any]], at_risk: list[dict[str, Any]], unmeasured: int, total: int
    ) -> list[dict[str, Any]]:
        interventions: list[dict[str, Any]] = []

        for gap in common_gaps[:3]:
            if gap["affectedPercentage"] < 20:
                continue
            interventions.append({
                "title": f"Run a cohort workshop on {gap['skill']}",
                "rationale": (
                    f"{gap['count']} student(s) ({gap['affectedPercentage']}%) share this gap. A single "
                    "workshop is far more efficient than individual remediation at this scale."
                ),
                "priority": "HIGH" if gap["affectedPercentage"] > 40 else "MEDIUM",
                "affectedStudents": gap["count"],
            })

        if at_risk and len(at_risk) / max(1, total) > 0.15:
            interventions.append({
                "title": "Schedule targeted mentoring for the at-risk cohort",
                "rationale": (
                    f"{len(at_risk)} student(s) are below the at-risk threshold. Pairing them with verified "
                    "alumni mentors adds the human feedback loop that automated practice cannot provide."
                ),
                "priority": "CRITICAL" if len(at_risk) / total > 0.3 else "HIGH",
                "affectedStudents": len(at_risk),
            })

        if unmeasured and unmeasured / max(1, total) > 0.2:
            interventions.append({
                "title": "Drive engagement among students with no readiness score",
                "rationale": (
                    f"{unmeasured} student(s) have not completed enough activities to be assessed at all. "
                    "Non-engagement is an earlier and stronger warning signal than a low score."
                ),
                "priority": "HIGH",
                "affectedStudents": unmeasured,
            })

        return interventions
