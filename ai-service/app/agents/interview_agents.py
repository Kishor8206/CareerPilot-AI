"""Interview agents (§5.4-5.6, §11, §12).

Three agents share one implementation because they differ only in the question
domain and the weighting of the final score:

  TechnicalInterviewAgent   - correctness and depth dominate
  HrInterviewAgent          - communication and structure dominate
  BehavioralInterviewAgent  - structure (STAR) and evidence dominate

Adaptive selection (§11)
------------------------
`generate` biases the next question using the candidate's weakest measured
areas and the skills actually on their resume, and adjusts difficulty from the
running answer scores. The adaptation decision is returned in `difficultyReason`
so the behaviour is inspectable rather than mysterious.

Evaluation ethics (§12)
-----------------------
Scoring uses answer content plus objective delivery signals only - word count,
filler-word rate, structural markers, hedging language. There is no inference of
emotion, personality, or any protected characteristic, and no facial analysis.
"""
from __future__ import annotations

import json
import re
from typing import Any, ClassVar

from pydantic import Field

from app.agents.base import BaseAgent
from app.rag.pipeline import retrieve
from app.schemas.common import Difficulty, InterviewMode, LooseModel, RagSource
from app.services.llm import LlmMessage, get_llm

EVALUATION_DISCLAIMER = (
    "This evaluation is produced by an AI prototype from the text of your answer. It measures content "
    "coverage and objective delivery signals only. It does not assess personality, emotion or confidence "
    "as a psychological trait, and it is not a hiring decision."
)

GENERATE_PROMPT = """[[TASK:interview.generate]]
You are an experienced technical interviewer conducting a campus placement interview in India.

Generate exactly ONE next question.

RULES:
- Ask one question only. Do not number it or add commentary.
- Ground company-specific questions ONLY in the CONTEXT provided. If there is no context about the
  company, ask a role-relevant question instead - never invent a company's process or policy.
- If the candidate's resume lists a technology, prefer a question that probes it concretely.
- Match the requested difficulty.
- Do not repeat any question in `askedQuestions`.

Respond with JSON:
{"question": string, "category": string, "topic": string, "difficulty": "EASY"|"MEDIUM"|"HARD",
 "expectedPoints": string[], "rationale": string}
"""

EVALUATE_PROMPT = """[[TASK:interview.evaluate]]
You are evaluating a single interview answer for a placement-preparation platform.

SCORING RULES (each 0-100):
- relevance: did the answer address the question actually asked?
- correctness: is the technical or factual content accurate?
- completeness: how many of the expected points were covered?
- communication: clarity, coherence and appropriate length.
- structure: was there a logical order, with an example where warranted?

STRICT ETHICAL CONSTRAINTS:
- Judge the ANSWER TEXT ONLY.
- Never infer personality, emotion, confidence as a trait, or any protected characteristic.
- Never comment on accent, dialect or fluency as a proxy for ability.
- Feedback must be explainable and specific: say what was missing, not merely that it was weak.

Respond with JSON:
{"relevance": number, "correctness": number, "completeness": number, "communication": number,
 "structure": number, "overall": number, "strengths": string[], "improvements": string[],
 "explanation": string, "missedPoints": string[],
 "deliverySignals": {"wordCount": number, "fillerWordRate": number,
   "responseLengthVerdict": "TOO_SHORT"|"APPROPRIATE"|"TOO_LONG", "clarityScore": number}}
"""

FILLER_WORDS = ["um", "uh", "er", "ah", "like", "basically", "actually", "literally",
                "you know", "i mean", "sort of", "kind of"]

HEDGES = ["i think maybe", "i guess", "not sure but", "probably", "i might be wrong",
          "i don't really know", "something like that"]


def delivery_signals(text: str) -> dict[str, Any]:
    """Objective, measurable delivery metrics. No affective inference (§12)."""
    words = [w for w in re.split(r"\s+", text.strip()) if w]
    word_count = len(words)
    lower = f" {text.lower()} "

    filler_count = sum(len(re.findall(rf"\b{re.escape(f)}\b", lower)) for f in FILLER_WORDS)
    filler_rate = round(filler_count / word_count, 4) if word_count else 0.0
    hedge_count = sum(1 for h in HEDGES if h in lower)

    if word_count < 40:
        verdict = "TOO_SHORT"
    elif word_count <= 260:
        verdict = "APPROPRIATE"
    else:
        verdict = "TOO_LONG"

    clarity = max(0.0, min(100.0, 100 - filler_rate * 600 - hedge_count * 6))

    return {
        "wordCount": word_count,
        "fillerWordCount": filler_count,
        "fillerWordRate": filler_rate,
        "hedgeCount": hedge_count,
        "responseLengthVerdict": verdict,
        "clarityScore": round(clarity, 1),
    }


class InterviewGenerateInput(LooseModel):
    sessionId: str = ""
    mode: InterviewMode = "TECHNICAL"
    index: int = 0
    difficulty: Difficulty = "MEDIUM"
    plannedQuestions: int = 8
    companyName: str | None = None
    companyId: str | None = None
    roleTitle: str | None = None
    roleId: str | None = None
    skills: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    topicFocus: list[str] = Field(default_factory=list)
    askedQuestions: list[str] = Field(default_factory=list)
    # Previous answer scores; the running mean drives difficulty adaptation.
    recentScores: list[float] = Field(default_factory=list)
    weakComponents: list[str] = Field(default_factory=list)


class InterviewQuestionOutput(LooseModel):
    question: str
    category: str = "TECHNICAL"
    topic: str = "general"
    difficulty: Difficulty = "MEDIUM"
    expectedPoints: list[str] = Field(default_factory=list)
    rationale: str = ""
    difficultyReason: str = ""
    sources: list[RagSource] = Field(default_factory=list)


class InterviewEvaluateInput(LooseModel):
    question: str
    answer: str
    expectedPoints: list[str] = Field(default_factory=list)
    mode: InterviewMode = "TECHNICAL"
    difficulty: Difficulty = "MEDIUM"
    topic: str = "general"
    durationSeconds: int = 0
    inputMode: str = "TEXT"


class DeliverySignalsOut(LooseModel):
    wordCount: int = 0
    fillerWordRate: float = 0.0
    responseLengthVerdict: str = "APPROPRIATE"
    clarityScore: float = 0.0


class InterviewEvaluationOutput(LooseModel):
    relevance: float = 0
    correctness: float = 0
    completeness: float = 0
    communication: float = 0
    structure: float = 0
    overall: float = 0
    strengths: list[str] = Field(default_factory=list)
    improvements: list[str] = Field(default_factory=list)
    explanation: str = ""
    missedPoints: list[str] = Field(default_factory=list)
    deliverySignals: DeliverySignalsOut = Field(default_factory=DeliverySignalsOut)
    disclaimer: str = EVALUATION_DISCLAIMER


class _InterviewAgentBase(BaseAgent[InterviewGenerateInput, InterviewQuestionOutput]):
    """Shared question-generation logic for all three interview agents."""

    #: Component weights used when rolling the five dimensions into `overall`.
    score_weights: ClassVar[dict[str, float]] = {
        "relevance": 0.25, "correctness": 0.30, "completeness": 0.20,
        "communication": 0.15, "structure": 0.10,
    }
    default_mode: ClassVar[str] = "TECHNICAL"

    InputModel = InterviewGenerateInput
    OutputModel = InterviewQuestionOutput

    def _adapt_difficulty(self, payload: InterviewGenerateInput) -> tuple[str, str]:
        """Adjusts difficulty from the running answer scores (§11).

        Waits for two answers before adapting: a single weak or strong answer is
        too noisy a signal to move the whole interview on.
        """
        scores = payload.recentScores[-3:]
        current = payload.difficulty

        if len(scores) < 2:
            return current, "Holding the starting difficulty until at least two answers have been scored."

        average = sum(scores) / len(scores)
        order = ["EASY", "MEDIUM", "HARD"]
        position = order.index(current) if current in order else 1

        if average >= 78 and position < 2:
            return order[position + 1], (
                f"Recent answers averaged {round(average)}/100, so difficulty was increased to keep the session challenging."
            )
        if average <= 42 and position > 0:
            return order[position - 1], (
                f"Recent answers averaged {round(average)}/100, so difficulty was reduced to rebuild fundamentals first."
            )
        return current, f"Recent answers averaged {round(average)}/100, which is well matched to {current.lower()} difficulty."

    def _focus_topics(self, payload: InterviewGenerateInput) -> list[str]:
        """Weak measured components steer the question mix (§11)."""
        mapping = {
            "coding": ["dsa", "algorithms"],
            "technical": ["dbms", "os", "oop"],
            "communication": ["behavioral"],
            "hr": ["hr"],
            "aptitude": ["dsa"],
        }
        focus = list(payload.topicFocus)
        for component in payload.weakComponents:
            focus.extend(mapping.get(component.lower(), []))
        return list(dict.fromkeys(focus))

    async def _retrieve_context(self, payload: InterviewGenerateInput) -> list[dict[str, Any]]:
        """Company/role grounding for COMPANY_SPECIFIC and ROLE_SPECIFIC modes."""
        if payload.mode not in {"COMPANY_SPECIFIC", "ROLE_SPECIFIC"} and not payload.companyName:
            return []

        query_parts = [payload.companyName or "", payload.roleTitle or "", "interview process technical rounds"]
        filters: dict[str, Any] = {"category": ["COMPANY_PROFILE", "INTERVIEW_PREP", "ROLE_REQUIREMENTS", "JOB_DESCRIPTION"]}
        if payload.companyId:
            filters["companyId"] = payload.companyId

        hits = retrieve(" ".join(p for p in query_parts if p), top_k=4, filters=filters)
        return [
            {
                "documentId": h.document_id,
                "title": h.metadata.get("title", "Untitled"),
                "chunkIndex": h.chunk_index,
                "score": round(h.score, 4),
                "snippet": h.text[:280],
                "category": h.metadata.get("category", "UNKNOWN"),
                "text": h.text,
            }
            for h in hits
        ]

    async def handle(self, payload: InterviewGenerateInput) -> tuple[dict[str, Any], dict[str, Any]]:
        difficulty, difficulty_reason = self._adapt_difficulty(payload)
        focus = self._focus_topics(payload)
        context = await self._retrieve_context(payload)

        llm_context = {
            "sessionId": payload.sessionId,
            "mode": payload.mode,
            "index": payload.index,
            "difficulty": difficulty,
            "companyName": payload.companyName,
            "roleTitle": payload.roleTitle,
            "skills": payload.skills[:20],
            "projects": payload.projects[:5],
            "topicFocus": focus,
            "askedQuestions": payload.askedQuestions[-10:],
            "weakComponents": payload.weakComponents,
        }

        context_block = ""
        if context:
            context_block = "\nCONTEXT (verified knowledge base):\n" + "\n".join(
                f"[{i + 1}] {c['text'][:600]}" for i, c in enumerate(context)
            )
        elif payload.companyName:
            context_block = (
                f"\nCONTEXT: none available for {payload.companyName}. "
                "Do NOT state anything specific about this company's hiring process. "
                "Ask a role-relevant question instead."
            )

        user_prompt = (
            f"Generate question {payload.index + 1} of {payload.plannedQuestions} "
            f"for a {payload.mode} interview at {difficulty} difficulty."
            f"{context_block}\n\n```json\n{json.dumps(llm_context)}\n```"
        )

        data, result = await get_llm().complete_json(
            [LlmMessage("system", GENERATE_PROMPT), LlmMessage("user", user_prompt)],
            temperature=0.6,
        )

        return (
            {
                "question": str(data.get("question", "")).strip() or "Tell me about a project you are proud of and the hardest problem you solved in it.",
                "category": data.get("category", payload.mode),
                "topic": data.get("topic", "general"),
                "difficulty": data.get("difficulty", difficulty),
                "expectedPoints": [str(p) for p in data.get("expectedPoints", [])][:8],
                "rationale": data.get("rationale", ""),
                "difficultyReason": difficulty_reason,
                "sources": [{k: v for k, v in c.items() if k != "text"} for c in context],
            },
            {
                "provider": result.provider,
                "model": result.model,
                "tokensPrompt": result.prompt_tokens,
                "tokensCompletion": result.completion_tokens,
                "ragSourceCount": len(context),
                "degraded": result.degraded,
                "notice": result.notice,
            },
        )


class TechnicalInterviewAgent(_InterviewAgentBase):
    name = "TECHNICAL_INTERVIEW"
    responsibility = "Generate adaptive technical interview questions grounded in the candidate's resume and target role."
    default_mode = "TECHNICAL"
    score_weights = {"relevance": 0.20, "correctness": 0.35, "completeness": 0.25,
                     "communication": 0.12, "structure": 0.08}


class HrInterviewAgent(_InterviewAgentBase):
    name = "HR_INTERVIEW"
    responsibility = "Generate HR-round questions covering motivation, self-assessment and organisational fit."
    default_mode = "HR"
    score_weights = {"relevance": 0.25, "correctness": 0.15, "completeness": 0.20,
                     "communication": 0.25, "structure": 0.15}


class BehavioralInterviewAgent(_InterviewAgentBase):
    name = "BEHAVIORAL_INTERVIEW"
    responsibility = "Generate behavioural (STAR-format) questions probing teamwork, conflict and resilience."
    default_mode = "BEHAVIORAL"
    score_weights = {"relevance": 0.20, "correctness": 0.15, "completeness": 0.20,
                     "communication": 0.20, "structure": 0.25}


class InterviewEvaluationAgent(BaseAgent[InterviewEvaluateInput, InterviewEvaluationOutput]):
    """Scores a single answer. Shared by all three interview modes."""

    name = "INTERVIEW_EVALUATION"
    responsibility = (
        "Evaluate one interview answer on content and objective delivery signals, and return explainable, "
        "non-discriminatory feedback."
    )
    InputModel = InterviewEvaluateInput
    OutputModel = InterviewEvaluationOutput

    MODE_WEIGHTS: ClassVar[dict[str, dict[str, float]]] = {
        "TECHNICAL": TechnicalInterviewAgent.score_weights,
        "COMPANY_SPECIFIC": TechnicalInterviewAgent.score_weights,
        "ROLE_SPECIFIC": TechnicalInterviewAgent.score_weights,
        "RESUME_BASED": TechnicalInterviewAgent.score_weights,
        "HR": HrInterviewAgent.score_weights,
        "BEHAVIORAL": BehavioralInterviewAgent.score_weights,
    }

    async def handle(self, payload: InterviewEvaluateInput) -> tuple[dict[str, Any], dict[str, Any]]:
        signals = delivery_signals(payload.answer)

        # An empty or near-empty answer is scored deterministically; sending it
        # to a model wastes a call and invites a charitable hallucinated score.
        if signals["wordCount"] < 5:
            return (
                {
                    "relevance": 0, "correctness": 0, "completeness": 0,
                    "communication": 0, "structure": 0, "overall": 0,
                    "strengths": [],
                    "improvements": [
                        "No substantive answer was recorded. Even when unsure, state what you do know and "
                        "how you would find the rest - interviewers score reasoning, not just recall."
                    ],
                    "explanation": f"The response contained {signals['wordCount']} word(s), which is too short to evaluate.",
                    "missedPoints": payload.expectedPoints,
                    "deliverySignals": {
                        "wordCount": signals["wordCount"],
                        "fillerWordRate": signals["fillerWordRate"],
                        "responseLengthVerdict": "TOO_SHORT",
                        "clarityScore": 0.0,
                    },
                    "disclaimer": EVALUATION_DISCLAIMER,
                },
                {"provider": "internal"},
            )

        context = {
            "question": payload.question,
            "answer": payload.answer,
            "expectedPoints": payload.expectedPoints,
            "mode": payload.mode,
            "difficulty": payload.difficulty,
            "measuredDeliverySignals": signals,
        }
        user_prompt = (
            f"QUESTION:\n{payload.question}\n\nCANDIDATE ANSWER:\n{payload.answer}\n\n"
            f"EXPECTED POINTS:\n- " + "\n- ".join(payload.expectedPoints or ["(none supplied)"]) + "\n\n"
            f"```json\n{json.dumps(context)}\n```"
        )

        data, result = await get_llm().complete_json(
            [LlmMessage("system", EVALUATE_PROMPT), LlmMessage("user", user_prompt)],
            temperature=0.15,
        )

        weights = self.MODE_WEIGHTS.get(payload.mode, TechnicalInterviewAgent.score_weights)
        dimensions = {
            key: max(0.0, min(100.0, float(data.get(key, 0) or 0)))
            for key in ("relevance", "correctness", "completeness", "communication", "structure")
        }
        # The overall score is recomputed here rather than trusted from the
        # model, so the weighting stays consistent and auditable.
        overall = round(sum(dimensions[k] * w for k, w in weights.items()), 1)

        return (
            {
                **dimensions,
                "overall": overall,
                "strengths": [str(s) for s in data.get("strengths", [])][:6],
                "improvements": [str(s) for s in data.get("improvements", [])][:6],
                "explanation": str(data.get("explanation", "")),
                "missedPoints": [str(s) for s in data.get("missedPoints", [])][:6],
                # Delivery signals are always the measured values, never the
                # model's estimate of them.
                "deliverySignals": {
                    "wordCount": signals["wordCount"],
                    "fillerWordRate": signals["fillerWordRate"],
                    "responseLengthVerdict": signals["responseLengthVerdict"],
                    "clarityScore": signals["clarityScore"],
                },
                "disclaimer": EVALUATION_DISCLAIMER,
            },
            {
                "provider": result.provider,
                "model": result.model,
                "tokensPrompt": result.prompt_tokens,
                "tokensCompletion": result.completion_tokens,
                "degraded": result.degraded,
                "notice": result.notice,
            },
        )
