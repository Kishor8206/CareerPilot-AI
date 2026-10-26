"""Strict output schemas (§10, §21).

`extra="forbid"` rejects uncontrolled fields; component ranges reject negative,
>100 and non-finite values. A model output that fails here is never silently
accepted — the caller falls back to the deterministic engine.
"""
from __future__ import annotations

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Score = Field(ge=0, le=100)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _FiniteScores(_Strict):
    @field_validator("*", mode="before")
    @classmethod
    def _finite(cls, v):
        if isinstance(v, (int, float)) and not math.isfinite(v):
            raise ValueError("score must be finite")
        return v


class GeneralComponents(_FiniteScores):
    structure: float = Score
    sectionCompleteness: float = Score
    skills: float = Score
    experience: float = Score
    projects: float = Score
    achievements: float = Score
    keywords: float = Score
    formatting: float = Score


class JobMatchComponents(_FiniteScores):
    requiredSkillMatch: float = Score
    experienceRelevance: float = Score
    projectRelevance: float = Score
    keywordCoverage: float = Score
    educationEligibility: float = Score
    structure: float = Score
    formatting: float = Score


_TextList = Field(default_factory=list, max_length=12)


class GeneralATSOutput(_Strict):
    mode: Literal["GENERAL_ATS"]
    componentScores: GeneralComponents
    atsScore: float = Score
    strengths: list[str] = _TextList
    weaknesses: list[str] = _TextList
    recommendations: list[str] = _TextList
    evidence: list[str] = _TextList


class JobMatchATSOutput(_Strict):
    mode: Literal["JOB_MATCH_ATS"]
    componentScores: JobMatchComponents
    atsScore: float = Score
    matchedSkills: list[str] = Field(default_factory=list, max_length=60)
    missingSkills: list[str] = Field(default_factory=list, max_length=60)
    strengths: list[str] = _TextList
    weaknesses: list[str] = _TextList
    recommendations: list[str] = _TextList
    evidence: list[str] = _TextList


SCHEMAS = {"GENERAL_ATS": GeneralATSOutput, "JOB_MATCH_ATS": JobMatchATSOutput}
