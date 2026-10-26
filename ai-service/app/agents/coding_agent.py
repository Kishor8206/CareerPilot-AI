"""Coding Assessment Agent (§5.3, §16).

Responsibility: review a code submission and score it.

IMPORTANT: this agent never executes code. Execution happens in the Node
gateway's sandboxed execution abstraction, and its results are passed in. This
agent reasons about correctness evidence (test results), complexity and
readability only - which is precisely why it is safe for it to accept arbitrary
student source as input.
"""
from __future__ import annotations

import json
from typing import Any

from pydantic import Field

from app.agents.base import BaseAgent
from app.schemas.common import Difficulty, LooseModel

CODE_REVIEW_PROMPT = """[[TASK:code.review]]
You are reviewing a student's code submission for a placement practice platform.

RULES:
- You did NOT run this code. Functional correctness is established by the supplied test results only.
- Estimate time and space complexity, and state your confidence honestly.
- Give specific, actionable suggestions tied to lines or constructs you can see.
- Be constructive. The reader is a student preparing for interviews.

Respond with JSON:
{"correctnessNotes": string[], "complexityEstimate": {"time": string, "space": string, "confidence": number},
 "readabilityScore": number, "suggestions": string[], "detectedPatterns": string[]}
"""

REVIEW_DISCLAIMER = (
    "This review is static analysis of your source code. It did not execute your program - "
    "the pass/fail result comes from the sandboxed test run."
)


class CodeReviewInput(LooseModel):
    code: str
    language: str = "python"
    problemTitle: str = ""
    problemStatement: str = ""
    difficulty: Difficulty = "EASY"
    topics: list[str] = Field(default_factory=list)
    # Execution results supplied by the Node sandbox.
    passedCount: int = 0
    totalCount: int = 0
    executionStatus: str = "UNKNOWN"
    totalExecutionTimeMs: int = 0
    peakMemoryKb: int = 0


class ComplexityEstimate(LooseModel):
    time: str = "unknown"
    space: str = "unknown"
    confidence: float = 0.5


class CodeReviewOutput(LooseModel):
    score: float = 0
    correctnessScore: float = 0
    efficiencyScore: float = 0
    readabilityScore: float = 0
    correctnessNotes: list[str] = Field(default_factory=list)
    complexityEstimate: ComplexityEstimate = Field(default_factory=ComplexityEstimate)
    suggestions: list[str] = Field(default_factory=list)
    detectedPatterns: list[str] = Field(default_factory=list)
    verdict: str = ""
    disclaimer: str = REVIEW_DISCLAIMER


# Efficiency credit by estimated complexity class. Deliberately coarse: a
# static estimate does not justify fine-grained scoring.
COMPLEXITY_SCORE = {
    "O(1)": 100.0, "O(log n)": 95.0, "O(n)": 88.0, "O(n log n)": 80.0,
    "O(n^2)": 55.0, "O(n^3)": 30.0, "O(2^n)": 15.0, "O(n!)": 5.0,
}


class CodingAssessmentAgent(BaseAgent[CodeReviewInput, CodeReviewOutput]):
    name = "CODING_ASSESSMENT"
    responsibility = (
        "Review a code submission for complexity and readability, combine that with sandboxed test "
        "results, and produce an overall coding score with actionable feedback."
    )
    InputModel = CodeReviewInput
    OutputModel = CodeReviewOutput

    async def handle(self, payload: CodeReviewInput) -> tuple[dict[str, Any], dict[str, Any]]:
        # Correctness is evidence-based: it comes from the sandbox, not the model.
        correctness = (payload.passedCount / payload.totalCount * 100) if payload.totalCount else 0.0
        if payload.executionStatus == "COMPILATION_ERROR":
            correctness = 0.0

        context = {
            "code": payload.code[:8000],
            "language": payload.language,
            "problemTitle": payload.problemTitle,
            "difficulty": payload.difficulty,
            "passedCount": payload.passedCount,
            "totalCount": payload.totalCount,
            "executionStatus": payload.executionStatus,
        }
        user_prompt = (
            f"PROBLEM: {payload.problemTitle}\n{payload.problemStatement[:1500]}\n\n"
            f"LANGUAGE: {payload.language}\n"
            f"TEST RESULTS: {payload.passedCount}/{payload.totalCount} passed (status: {payload.executionStatus})\n\n"
            f"SUBMITTED CODE:\n```{payload.language}\n{payload.code[:8000]}\n```\n\n"
            f"```json\n{json.dumps(context)}\n```"
        )

        data, result = await get_llm_json(user_prompt)

        complexity = data.get("complexityEstimate", {}) or {}
        time_complexity = str(complexity.get("time", "unknown"))
        efficiency = COMPLEXITY_SCORE.get(time_complexity, 60.0)
        readability = max(0.0, min(100.0, float(data.get("readabilityScore", 70) or 70)))

        # Correctness dominates: elegant code that fails the tests is still wrong.
        score = round(correctness * 0.60 + efficiency * 0.25 + readability * 0.15, 1)

        return (
            {
                "score": score,
                "correctnessScore": round(correctness, 1),
                "efficiencyScore": round(efficiency, 1),
                "readabilityScore": round(readability, 1),
                "correctnessNotes": [str(n) for n in data.get("correctnessNotes", [])][:6],
                "complexityEstimate": {
                    "time": time_complexity,
                    "space": str(complexity.get("space", "unknown")),
                    "confidence": max(0.0, min(1.0, float(complexity.get("confidence", 0.5) or 0.5))),
                },
                "suggestions": [str(s) for s in data.get("suggestions", [])][:8],
                "detectedPatterns": [str(p) for p in data.get("detectedPatterns", [])][:8],
                "verdict": self._verdict(correctness, payload),
                "disclaimer": REVIEW_DISCLAIMER,
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

    def _verdict(self, correctness: float, payload: CodeReviewInput) -> str:
        if payload.executionStatus == "COMPILATION_ERROR":
            return "Your submission did not compile. Fix the syntax errors reported by the runner and resubmit."
        if payload.totalCount == 0:
            return "No test cases were run against this submission."
        if correctness == 100:
            return (
                f"All {payload.totalCount} test cases passed. Next, make sure you can state the time and "
                "space complexity aloud - interviewers ask immediately after you finish coding."
            )
        if correctness >= 60:
            return (
                f"{payload.passedCount} of {payload.totalCount} test cases passed. The core logic works; "
                "the failures are most likely edge cases such as empty input, single elements or duplicates."
            )
        if correctness > 0:
            return (
                f"Only {payload.passedCount} of {payload.totalCount} test cases passed. Re-read the problem "
                "statement and trace your logic against the sample input by hand."
            )
        return (
            "No test cases passed. Check your input parsing and output format first - these account for most "
            "zero-score submissions even when the algorithm is right."
        )


async def get_llm_json(user_prompt: str):
    """Small indirection kept so the prompt constant stays next to the agent."""
    from app.services.llm import LlmMessage, get_llm

    return await get_llm().complete_json(
        [LlmMessage("system", CODE_REVIEW_PROMPT), LlmMessage("user", user_prompt)],
        temperature=0.2,
    )
