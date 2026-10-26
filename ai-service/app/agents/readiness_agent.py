"""Placement Readiness Agent (§5.9) and Career Recommendation Agent (§5.8).

The readiness agent runs APIE, then augments it with the ML classifier where a
trained model exists. The two are kept deliberately separate:

  * APIE's weighted score is the AUTHORITATIVE Placement Readiness Score. It is
    explainable line by line, which matters when a student asks why they scored
    what they did.
  * The ML prediction is a SECOND OPINION shown alongside it, with its own
    confidence and provenance.

When the two disagree, both are shown rather than silently reconciled - the
disagreement is itself informative.
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import Field

from app.agents.base import BaseAgent
from app.core.errors import ModelNotTrainedError
from app.ml import predict as ml_predict
from app.schemas.common import LooseModel, Recommendation, SkillGap
from app.services import apie
from app.services.llm import LlmMessage, get_llm

RECOMMENDATION_PROMPT = """[[TASK:recommendation.generate]]
You are a placement mentor advising an engineering student in India.

Given the student's readiness breakdown and skill gaps, produce prioritised, ACTIONABLE recommendations.

RULES:
- Every recommendation must name a concrete next action, not a general aspiration.
- Prioritise by impact on the readiness score: highest-weighted weak components first.
- Set actionRoute to one of: /resume /coding /assessments /interview /career /alumni /job-matching /profile
- Be encouraging but honest. Do not inflate a weak profile.
- Maximum 8 recommendations.

Respond with JSON:
{"recommendations": [{"title": string, "description": string,
  "category": "SKILL"|"ASSESSMENT"|"INTERVIEW"|"RESUME"|"MENTORSHIP"|"PROJECT"|"COMMUNICATION",
  "priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "estimatedHours": number,
  "actionRoute": string, "actionLabel": string, "rationale": string,
  "resources": [{"title": string, "url": string, "type": string}]}]}
"""


class ComponentEvidence(LooseModel):
    value: float | None = None
    evidenceCount: int = 0
    lastUpdated: str | None = None


class ReadinessProfile(LooseModel):
    cgpa: float | None = None
    backlogs: int = 0
    projectCount: int = 0
    certificationCount: int = 0
    internshipMonths: float = 0
    alumniFeedbackScore: float | None = None
    assessmentsTaken: int = 0
    interviewsTaken: int = 0


class TargetRole(LooseModel):
    roleId: str | None = None
    roleTitle: str = ""
    coreSkills: list[str] = Field(default_factory=list)


class TargetCompany(LooseModel):
    companyId: str | None = None
    companyName: str = ""
    minCgpa: float | None = None
    maxBacklogs: int | None = None
    matchScore: float | None = None


class ReadinessInput(LooseModel):
    studentId: str = ""
    components: dict[str, ComponentEvidence] = Field(default_factory=dict)
    profile: ReadinessProfile = Field(default_factory=ReadinessProfile)
    studentSkills: list[str] = Field(default_factory=list)
    targetRoles: list[TargetRole] = Field(default_factory=list)
    targetCompanies: list[TargetCompany] = Field(default_factory=list)
    jobMatchMissingSkills: list[str] = Field(default_factory=list)
    previousScore: float | None = None
    # Runtime configuration supplied by the Node gateway (§45 rule 17).
    weights: dict[str, float] | None = None
    modifiers: dict[str, Any] | None = None
    bands: list[dict[str, Any]] | None = None
    reassessmentDays: float = 30
    weightsVersion: str = "1.0.0"
    includeMlPrediction: bool = True
    includeRecommendations: bool = True


class MlPrediction(LooseModel):
    band: str
    score: float
    confidence: float
    classProbabilities: dict[str, float] = Field(default_factory=dict)
    featureContributions: list[dict[str, Any]] = Field(default_factory=list)
    modelVersion: str = "unknown"
    algorithm: str = "unknown"
    trainedOn: str = "SYNTHETIC"
    trainedAt: str | None = None
    testAccuracy: float | None = None
    disclaimer: str = ""
    featureContributionNote: str = ""


class ReadinessOutput(LooseModel):
    score: float
    band: str
    baseScore: float = 0
    components: list[dict[str, Any]] = Field(default_factory=list)
    modifiers: list[dict[str, Any]] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    skillGaps: list[SkillGap] = Field(default_factory=list)
    targetRoleReadiness: list[dict[str, Any]] = Field(default_factory=list)
    targetCompanyReadiness: list[dict[str, Any]] = Field(default_factory=list)
    reassessmentSuggestions: list[dict[str, Any]] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    mlPrediction: MlPrediction | None = None
    mlUnavailableReason: str | None = None
    agreementNote: str | None = None
    previousScore: float | None = None
    delta: float | None = None
    improvementSummary: str = ""
    evidenceCoverage: float = 0
    weightsSnapshot: dict[str, float] = Field(default_factory=dict)
    weightsVersion: str = "1.0.0"
    modelDisclaimer: str = apie.MODEL_DISCLAIMER
    computedAt: str = ""


class PlacementReadinessAgent(BaseAgent[ReadinessInput, ReadinessOutput]):
    name = "PLACEMENT_READINESS"
    responsibility = (
        "Run the Adaptive Placement Intelligence Engine to produce an explainable Placement Readiness "
        "Score, skill gaps, target readiness and reassessment triggers, augmented by an ML second opinion."
    )
    InputModel = ReadinessInput
    OutputModel = ReadinessOutput

    async def handle(self, payload: ReadinessInput) -> tuple[dict[str, Any], dict[str, Any]]:
        apie_payload = payload.model_dump()
        result = apie.compute_readiness(apie_payload)
        gaps = apie.derive_skill_gaps(apie_payload)

        meta: dict[str, Any] = {"provider": "internal"}

        ml_prediction: dict[str, Any] | None = None
        ml_unavailable: str | None = None
        agreement_note: str | None = None

        if payload.includeMlPrediction:
            try:
                ml_prediction = ml_predict.predict(self._ml_features(payload, result))
                agreement_note = self._agreement(result["band"], ml_prediction["band"])
            except ModelNotTrainedError as exc:
                # Never fabricate a prediction; say plainly that none exists.
                ml_unavailable = str(exc)
                self.log.info("ML prediction skipped - model not trained")
            except Exception as exc:
                ml_unavailable = f"The readiness model could not produce a prediction: {exc}"
                self.log.warning("ML prediction failed", extra={"reason": str(exc)})

        recommendations: list[dict[str, Any]] = []
        if payload.includeRecommendations:
            recommendations, rec_meta = await self._recommend(payload, result, gaps)
            meta.update(rec_meta)

        return (
            {
                **result,
                "skillGaps": gaps,
                "recommendations": recommendations,
                "mlPrediction": ml_prediction,
                "mlUnavailableReason": ml_unavailable,
                "agreementNote": agreement_note,
            },
            meta,
        )

    def _ml_features(self, payload: ReadinessInput, result: dict[str, Any]) -> dict[str, Any]:
        """Maps APIE's normalised components onto the model's feature names."""
        by_key = {c["key"]: c for c in result["components"]}

        def component(key: str) -> float:
            entry = by_key.get(key) or {}
            return float(entry.get("raw") or 0.0)

        return {
            "atsScore": component("resume"),
            "codingScore": component("coding"),
            "technicalScore": component("technical"),
            "hrScore": component("hr"),
            "communicationScore": component("communication"),
            "aptitudeScore": component("aptitude"),
            "academicScore": component("academic"),
            "projectCount": payload.profile.projectCount,
            "certificationCount": payload.profile.certificationCount,
            "internshipMonths": payload.profile.internshipMonths,
            "alumniFeedbackScore": payload.profile.alumniFeedbackScore or 0.0,
            "skillGapCount": len(payload.jobMatchMissingSkills),
            "assessmentsTaken": payload.profile.assessmentsTaken,
            "interviewsTaken": payload.profile.interviewsTaken,
        }

    def _agreement(self, apie_band: str, ml_band: str) -> str:
        order = ["AT_RISK", "NEEDS_IMPROVEMENT", "PLACEMENT_READY", "HIGHLY_READY"]
        try:
            distance = abs(order.index(apie_band) - order.index(ml_band))
        except ValueError:
            return "The two models produced bands that could not be compared."

        if distance == 0:
            return "The weighted APIE score and the ML classifier agree on your readiness band."
        if distance == 1:
            return (
                f"APIE places you in {apie_band.replace('_', ' ').title()} while the ML model predicts "
                f"{ml_band.replace('_', ' ').title()}. You are near a band boundary - a single strong result "
                "could move you up."
            )
        return (
            f"APIE and the ML model disagree noticeably (APIE: {apie_band.replace('_', ' ').title()}, "
            f"ML: {ml_band.replace('_', ' ').title()}). This usually means your profile is unusual compared "
            "with the model's training distribution. Treat the APIE breakdown, which is fully explainable, "
            "as authoritative."
        )

    async def _recommend(
        self, payload: ReadinessInput, result: dict[str, Any], gaps: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        context = {
            "band": result["band"],
            "score": result["score"],
            "components": {c["key"]: c["normalized"] for c in result["components"]},
            "skillGaps": [{"skill": g["skill"], "severity": g["severity"]} for g in gaps[:8]],
            "targetRoles": [r.roleTitle for r in payload.targetRoles],
            "targetCompanies": [c.companyName for c in payload.targetCompanies],
            "weaknesses": result["weaknesses"],
        }
        user_prompt = (
            f"Student readiness: {result['score']}/100 ({result['band']}).\n"
            f"Weakest areas: {', '.join(result['weaknesses'][:3]) or 'none recorded'}\n\n"
            f"```json\n{json.dumps(context)}\n```"
        )

        try:
            data, llm_result = await get_llm().complete_json(
                [LlmMessage("system", RECOMMENDATION_PROMPT), LlmMessage("user", user_prompt)],
                temperature=0.35,
            )
            recommendations = [r for r in data.get("recommendations", []) if isinstance(r, dict)][:8]
            return recommendations, {
                "provider": llm_result.provider,
                "model": llm_result.model,
                "tokensPrompt": llm_result.prompt_tokens,
                "tokensCompletion": llm_result.completion_tokens,
                "degraded": llm_result.degraded,
                "notice": llm_result.notice,
            }
        except Exception as exc:
            self.log.warning("Recommendation generation failed; using the rule-based fallback.",
                             extra={"reason": str(exc)})
            return self._fallback_recommendations(result, gaps), {
                "provider": "internal",
                "degraded": True,
                "notice": "AI recommendation generation was unavailable; rule-based recommendations were used.",
            }

    def _fallback_recommendations(
        self, result: dict[str, Any], gaps: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Deterministic recommendations derived directly from the weakest components.

        This keeps the dashboard functional during an AI outage,
        which matters because those are the screens a student uses daily.
        """
        recommendations: list[dict[str, Any]] = []

        weakest = sorted(
            (c for c in result["components"] if c["normalized"] < 70),
            # Weight x shortfall = points recoverable. Highest first.
            key=lambda c: -(c["weight"] * (70 - c["normalized"])),
        )

        for component in weakest[:4]:
            route, label = apie.COMPONENT_ROUTES.get(component["key"], ("/dashboard", "Open your dashboard"))
            shortfall = 70 - component["normalized"]
            priority = "CRITICAL" if component["normalized"] < 35 else "HIGH" if component["normalized"] < 55 else "MEDIUM"
            recommendations.append({
                "title": label,
                "description": (
                    f"Your {component['label']} score is {component['normalized']}/100. Raising it to 70 would add "
                    f"roughly {round(component['weight'] * shortfall, 1)} points to your readiness score."
                ),
                "category": "ASSESSMENT" if component["key"] in {"coding", "aptitude"} else "INTERVIEW",
                "priority": priority,
                "estimatedHours": 8 if priority in {"CRITICAL", "HIGH"} else 4,
                "actionRoute": route,
                "actionLabel": label,
                "rationale": (
                    f"{component['label']} carries {int(component['weight'] * 100)}% of your readiness score and "
                    "is currently one of your largest recoverable gaps."
                ),
                "resources": [],
            })

        for gap in gaps[:3]:
            recommendations.append({
                "title": f"Build {gap['skill']}",
                "description": f"{gap['skill']} is required by your target roles but is not evidenced in your profile.",
                "category": "SKILL",
                "priority": gap["severity"],
                "estimatedHours": 12 if gap["severity"] in {"CRITICAL", "HIGH"} else 6,
                "actionRoute": "/job-matching",
                "actionLabel": "See where this skill is required",
                "rationale": f"Detected as a {gap['severity'].lower()}-severity gap against your target roles.",
                "resources": [{"title": f"Build a project using {gap['skill']}", "type": "PROJECT"}],
            })

        return recommendations[:8]
