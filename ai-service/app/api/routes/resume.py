"""Resume analysis endpoints (§33): /ai/resume/analyze, /ai/resume/match, /ai/resume/extract-text."""
from __future__ import annotations

import base64
import binascii
from typing import Any

from fastapi import APIRouter, Body

from app.agents.orchestrator import run_agent, run_workflow
from app.core.errors import ResumeParseError, success_response
from app.nlp.skills_taxonomy import extract_skills
from app.nlp.text_extraction import extract_text

router = APIRouter(prefix="/ai/resume", tags=["resume"])


@router.post("/analyze")
async def analyze_resume(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Parses a resume and returns structured data plus an explainable ATS score."""
    result = await run_agent("RESUME_INTELLIGENCE", payload)
    return success_response(result["data"], result["meta"])


@router.post("/extract-text")
async def extract_document_text(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Extracts plain text from an uploaded job-description file (PDF, DOCX or TXT).

    Nothing is stored. The skills recognised in the text are returned too, so the
    caller can tell the user up front whether a comparison will be meaningful.
    """
    try:
        data = base64.b64decode(str(payload.get("fileBase64") or ""), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ResumeParseError("The uploaded file could not be decoded.") from exc

    try:
        text = extract_text(data, str(payload.get("mimeType") or ""), str(payload.get("filename") or ""))
    except ResumeParseError as exc:
        # The extractor's wording is about resumes; this file is a job description.
        raise ResumeParseError(
            "Too little text could be read from this file. If it is a scanned image, paste the job description as text instead."
        ) from exc

    skills = sorted({s.name for s in extract_skills(text)})
    return success_response({"text": text, "characters": len(text), "recognisedSkills": skills}, {"provider": "internal"})


@router.post("/match")
async def match_resume(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Resume analysis and job matching in a single call.

    Accepts either the workflow shape `{resume: {...}, job: {...}}` or a flat
    job-matching payload, so the gateway can use whichever it already has.
    """
    if "resume" in payload and "job" in payload:
        result = await run_workflow("RESUME_TO_MATCH", payload)
        return success_response(result, {"workflow": "RESUME_TO_MATCH"})

    result = await run_agent("JOB_MATCHING", payload)
    return success_response(result["data"], result["meta"])
