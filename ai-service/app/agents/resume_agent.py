"""Resume Intelligence Agent (§5.1, §8).

Responsibility: turn an uploaded resume into structured data and an explainable
ATS-oriented score. Deterministic NLP does the extraction and scoring; the LLM
is used only to phrase job-specific advice, so a provider outage degrades the
wording, never the score.
"""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any

from pydantic import Field, field_validator

from app.agents.base import BaseAgent
from app.core.config import settings
from app.core.errors import ResumeParseError
from app.nlp.resume_parser import parse_resume
from app.nlp.text_extraction import extract_text
from app.schemas.common import AtsBreakdownItem, LooseModel, ParsedResume, StrictModel
from app.services.ats import DISCLAIMER, ENGINE_VERSION, keyword_match, score_resume
from app.services.llm import LlmMessage, get_llm

RESUME_ADVICE_PROMPT = """[[TASK:resume.recommendations]]
You are a placement-office resume reviewer for engineering students in India.
Given a resume's detected skills and the keywords missing against a target job
description, write specific, actionable resume advice.

RULES:
- Be concrete. "Add a bullet showing X producing Y" beats "improve your resume".
- Never tell the student to list a skill they do not have. Advise them to build it.
- Maximum 6 recommendations.

Respond with JSON: {"recommendations": string[]}
"""

MODEL_DISCLAIMER = (
    "Component scores were predicted by a fine-tuned language model trained on weak (rule-derived) labels, "
    "then validated and combined into the final score by fixed, published weights."
)


class ResumeAnalyzeInput(LooseModel):
    """Either `fileBase64` (+ mimeType) or pre-extracted `text` must be supplied."""

    fileBase64: str | None = None
    mimeType: str | None = None
    filename: str | None = ""
    text: str | None = None
    jobDescriptionText: str | None = None
    jobKeywords: list[str] = Field(default_factory=list)
    roleTitle: str | None = None
    companyName: str | None = None
    studentId: str | None = None

    @field_validator("fileBase64")
    @classmethod
    def _strip_data_url(cls, value: str | None) -> str | None:
        # Browsers send `data:application/pdf;base64,...`; accept either form.
        if value and value.startswith("data:"):
            return value.split(",", 1)[-1]
        return value


class ResumeAnalyzeOutput(LooseModel):
    atsScore: float
    parsed: ParsedResume
    breakdown: list[AtsBreakdownItem]
    matchedKeywords: list[str] = Field(default_factory=list)
    missingKeywords: list[str] = Field(default_factory=list)
    keywordCoverage: float = 0.0
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    formattingRecommendations: list[str] = Field(default_factory=list)
    jobSpecificRecommendations: list[str] = Field(default_factory=list)
    extractedTextLength: int = 0
    engineVersion: str = ENGINE_VERSION
    disclaimer: str = DISCLAIMER
    # Additive, optional fields populated only when the fine-tuned ATS model is
    # enabled (ATS_MODEL_PROVIDER != none). Existing consumers are unaffected.
    jobMatchScore: float | None = None
    jobMatchBreakdown: list[AtsBreakdownItem] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    modelInfo: dict[str, Any] | None = None


class ResumeIntelligenceAgent(BaseAgent[ResumeAnalyzeInput, ResumeAnalyzeOutput]):
    name = "RESUME_INTELLIGENCE"
    responsibility = (
        "Parse a resume into structured fields and produce an explainable ATS-oriented score "
        "with keyword coverage against a target job description."
    )
    InputModel = ResumeAnalyzeInput
    OutputModel = ResumeAnalyzeOutput

    async def handle(self, payload: ResumeAnalyzeInput) -> tuple[dict[str, Any], dict[str, Any]]:
        text = await self._resolve_text(payload)

        parsed = parse_resume(text)
        ats = score_resume(parsed, text)

        # Keyword set: explicit JD keywords first, else derived from the JD text.
        keywords = list(payload.jobKeywords)
        if not keywords and payload.jobDescriptionText:
            from app.nlp.skills_taxonomy import extract_skills

            keywords = [s.name for s in extract_skills(payload.jobDescriptionText)]

        match = keyword_match(parsed, text, keywords) if keywords else {
            "matchedKeywords": [], "missingKeywords": [], "keywordCoverage": 0.0
        }

        output: dict[str, Any] = {
            "atsScore": ats["atsScore"],
            "parsed": parsed,
            "breakdown": ats["breakdown"],
            "matchedKeywords": match["matchedKeywords"],
            "missingKeywords": match["missingKeywords"],
            "keywordCoverage": match["keywordCoverage"],
            "strengths": ats["strengths"],
            "weaknesses": ats["weaknesses"],
            "formattingRecommendations": ats["formattingRecommendations"],
            "jobSpecificRecommendations": [],
            "extractedTextLength": len(text),
            "engineVersion": ats["engineVersion"],
            "disclaimer": ats["disclaimer"],
        }
        meta: dict[str, Any] = {"provider": "internal"}

        # The deterministic result above is always computed: it is the baseline,
        # the fallback, and the source of exact facts (matched/missing keywords).
        job_advice_from_model = await self._apply_ats_model(output, text, payload.jobDescriptionText or "")

        if match["missingKeywords"] and not job_advice_from_model:
            output["jobSpecificRecommendations"], llm_meta = await self._advise(match["missingKeywords"], payload)
            meta.update(llm_meta)

        return output, meta

    async def _apply_ats_model(self, output: dict[str, Any], text: str, jd: str) -> bool:
        """Overlay the fine-tuned model's judgement on the deterministic result.

        Division of labour — facts from extraction, judgement from the model,
        arithmetic from Python:
          * matched/missing keywords and coverage stay deterministic (exact facts);
          * component scores, strengths, weaknesses, advice and evidence come
            from the model, after strict validation and grounding;
          * every score is computed here from fixed weights, never by the model.
        Each mode fails independently. Returns True if the model supplied
        job-specific advice. With the model disabled this is a no-op.
        """
        from app.ats_model.service import MODEL_VERSION, ATSModelUnavailable, get_generator, run_model

        if get_generator() is None and settings.ats_model_provider.lower() in ("", "none"):
            return False

        from app.ats_model.normalize import JD_MAX_CHARS, RESUME_MAX_CHARS, clip, normalise_jd, normalise_resume
        from app.ats_model.scoring import GENERAL_WEIGHTS, JOB_MATCH_WEIGHTS

        resume = clip(normalise_resume(text), RESUME_MAX_CHARS)
        info: dict[str, Any] = {
            "modelProvider": settings.ats_model_provider, "modelName": settings.ats_model_name,
            "modelVersion": MODEL_VERSION, "baselineAtsScore": output["atsScore"],
            "inferenceMode": {}, "degraded": False, "reasons": {}, "hallucinationsCorrected": [],
        }

        def as_breakdown(components: dict[str, float], weights: dict[str, float]) -> list[dict[str, Any]]:
            return [{"criterion": re.sub(r"(?<!^)([A-Z])", r" \1", k).title(), "score": round(v * weights[k], 2),
                     "maxScore": round(weights[k] * 100, 2), "weight": weights[k],
                     "detail": f"Model component score {v:.0f}/100"} for k, v in components.items()]

        try:
            general = await run_model("GENERAL_ATS", resume)
            g = general["result"]
            output.update(atsScore=g["atsScore"], breakdown=as_breakdown(g["componentScores"], GENERAL_WEIGHTS),
                          strengths=g["strengths"], weaknesses=g["weaknesses"],
                          formattingRecommendations=g["recommendations"], evidence=list(g["evidence"]),
                          engineVersion=f"{output['engineVersion']}+{MODEL_VERSION}",
                          disclaimer=output["disclaimer"] + " " + MODEL_DISCLAIMER)
            info["inferenceMode"]["GENERAL_ATS"] = {"provider": general["provider"], "attempts": general["attempts"],
                                                   "latencyMs": general["latencyMs"]}
        except ATSModelUnavailable as exc:
            info["degraded"] = True
            info["reasons"]["GENERAL_ATS"] = exc.reason
            info["inferenceMode"]["GENERAL_ATS"] = {"provider": "deterministic"}

        advised = False
        if jd.strip():
            try:
                job = await run_model("JOB_MATCH_ATS", resume, clip(normalise_jd(jd), JD_MAX_CHARS))
                j = job["result"]
                output.update(jobMatchScore=j["atsScore"],
                              jobMatchBreakdown=as_breakdown(j["componentScores"], JOB_MATCH_WEIGHTS),
                              jobSpecificRecommendations=j["recommendations"])
                output["evidence"] = [*output.get("evidence", []), *j["evidence"]][:12]
                info["hallucinationsCorrected"] = job["grounding"].get("hallucinated_matched", [])
                info["inferenceMode"]["JOB_MATCH_ATS"] = {"provider": job["provider"], "attempts": job["attempts"],
                                                         "latencyMs": job["latencyMs"]}
                advised = bool(j["recommendations"])
            except ATSModelUnavailable as exc:
                info["degraded"] = True
                info["reasons"]["JOB_MATCH_ATS"] = exc.reason
                info["inferenceMode"]["JOB_MATCH_ATS"] = {"provider": "deterministic"}

        output["modelInfo"] = info
        return advised

    async def _resolve_text(self, payload: ResumeAnalyzeInput) -> str:
        if payload.text and len(payload.text.strip()) >= 120:
            return payload.text.strip()

        if not payload.fileBase64:
            raise ResumeParseError(
                "No readable resume content was supplied. Provide the file or at least 120 characters of text."
            )

        try:
            data = base64.b64decode(payload.fileBase64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ResumeParseError("The uploaded file could not be decoded.") from exc

        return extract_text(data, payload.mimeType or "", payload.filename or "")

    async def _advise(
        self, missing: list[str], payload: ResumeAnalyzeInput
    ) -> tuple[list[str], dict[str, Any]]:
        """Generates job-specific advice; failure is non-fatal."""
        import json

        context = {
            "missingKeywords": missing[:12],
            "roleTitle": payload.roleTitle or "the target role",
            "companyName": payload.companyName,
        }
        user_prompt = (
            "Write resume recommendations for this candidate.\n"
            f"```json\n{json.dumps(context)}\n```"
        )

        try:
            data, result = await get_llm().complete_json(
                [LlmMessage("system", RESUME_ADVICE_PROMPT), LlmMessage("user", user_prompt)],
                temperature=0.2,
            )
            recommendations = [str(r) for r in data.get("recommendations", [])][:6]
            return recommendations, {
                "provider": result.provider,
                "model": result.model,
                "tokensPrompt": result.prompt_tokens,
                "tokensCompletion": result.completion_tokens,
                "degraded": result.degraded,
                "notice": result.notice,
            }
        except Exception as exc:
            self.log.warning("Job-specific advice unavailable; returning the rule-based fallback.",
                             extra={"reason": str(exc)})
            # The score and gaps still stand; only the phrasing is lost.
            return (
                [
                    f"Add demonstrable evidence of: {', '.join(missing[:6])}.",
                    "Show each missing skill inside a project bullet with a measurable result, "
                    "rather than adding it to a keyword list.",
                ],
                {"provider": "internal", "degraded": True,
                 "notice": "AI advice generation was unavailable; rule-based recommendations were used."},
            )
