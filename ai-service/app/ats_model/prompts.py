"""Prompt construction: the single source of truth for training AND inference.

If training and serving built prompts differently, the model would be asked
at inference time for something it was never trained on. Both import from
here, so they cannot drift.
"""
from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = (
    "You are CareerPilot ATS Analyzer. Analyse the resume (and job description, if given) and "
    "return ONLY a JSON object matching the requested mode's schema.\n"
    "Rules:\n"
    "- Use ONLY information present in the resume and job description. Never invent skills, "
    "companies, experience, degrees, certifications, projects or achievements.\n"
    "- Component scores are numbers from 0 to 100.\n"
    "- matchedSkills: job skills the resume evidences. missingSkills: job skills it does not. "
    "A skill that is missing must never appear as matched.\n"
    "- Evidence must quote or directly reflect the resume text.\n"
    "- Output JSON only: no markdown, no commentary."
)

GENERAL_KEYS = ["structure", "sectionCompleteness", "skills", "experience",
                "projects", "achievements", "keywords", "formatting"]
JOB_MATCH_KEYS = ["requiredSkillMatch", "experienceRelevance", "projectRelevance",
                  "keywordCoverage", "educationEligibility", "structure", "formatting"]


def user_prompt(mode: str, resume: str, job_description: str = "") -> str:
    if mode == "GENERAL_ATS":
        return f"Mode: GENERAL_ATS\n\nResume:\n{resume}"
    if mode == "JOB_MATCH_ATS":
        return f"Mode: JOB_MATCH_ATS\n\nResume:\n{resume}\n\nJob Description:\n{job_description}"
    raise ValueError(f"unknown mode: {mode}")


def target_json(target: dict[str, Any]) -> str:
    """Compact, key-ordered JSON: fewer tokens to learn, deterministic ordering."""
    return json.dumps(target, ensure_ascii=False, separators=(",", ":"))


def chat_messages(mode: str, resume: str, job_description: str,
                  target: dict[str, Any] | None = None) -> list[dict[str, str]]:
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt(mode, resume, job_description)},
    ]
    if target is not None:
        msgs.append({"role": "assistant", "content": target_json(target)})
    return msgs
