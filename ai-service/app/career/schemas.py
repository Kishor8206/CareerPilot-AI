"""Canonical career-plan output schema (strict).

`extra="forbid"` rejects any field the model invents. Resource IDs are plain
strings here; whether each ID actually exists is checked against the catalogue
by the validator, because that depends on runtime data, not on shape.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Level = Literal["none", "beginner", "intermediate", "advanced"]
Priority = Literal["HIGH", "MEDIUM", "LOW"]
Difficulty = Literal["beginner", "intermediate", "advanced"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkillGapItem(_Strict):
    skill: str = Field(min_length=1)
    current_level: Level
    required_level: Level
    priority: Priority
    reason: str = Field(min_length=1)


class RoadmapPhase(_Strict):
    phase: str = Field(min_length=1)
    skills: list[str]
    objectives: list[str]
    estimated_hours: float = Field(ge=0, le=5000)
    prerequisites: list[str]
    completion_criteria: list[str]


class StudyWeek(_Strict):
    week: int = Field(ge=1, le=104)
    tasks: list[str]


class ProjectItem(_Strict):
    title: str = Field(min_length=1)
    skills: list[str]
    difficulty: Difficulty
    reason: str = Field(min_length=1)


class CareerPlan(_Strict):
    target_role: str = Field(min_length=1)
    readiness_summary: str
    skill_gap: list[SkillGapItem] = Field(default_factory=list)
    roadmap: list[RoadmapPhase] = Field(default_factory=list)
    study_plan: list[StudyWeek] = Field(default_factory=list)
    projects: list[ProjectItem] = Field(default_factory=list)
    interview_preparation: list[str] = Field(default_factory=list)
    resource_ids: list[str] = Field(default_factory=list)
