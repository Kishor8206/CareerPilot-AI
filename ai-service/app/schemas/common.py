"""Shared Pydantic models mirroring shared/src/types.ts.

Keeping these aligned with the TypeScript definitions is what lets the Node
gateway pass payloads straight through without translation.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Difficulty = Literal["EASY", "MEDIUM", "HARD"]
InterviewMode = Literal["TECHNICAL", "HR", "BEHAVIORAL", "COMPANY_SPECIFIC", "ROLE_SPECIFIC", "RESUME_BASED"]
ReadinessBand = Literal["AT_RISK", "NEEDS_IMPROVEMENT", "PLACEMENT_READY", "HIGHLY_READY"]
GapSeverity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
SkillCategory = Literal[
    "PROGRAMMING_LANGUAGE", "FRAMEWORK", "TOOL", "DATABASE", "CLOUD",
    "CS_FUNDAMENTAL", "SOFT_SKILL", "DOMAIN",
]
DataProvenance = Literal["DEMO", "SYNTHETIC", "REAL"]


class StrictModel(BaseModel):
    """Rejects unknown fields so a schema drift between services fails loudly."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class LooseModel(BaseModel):
    """Tolerates extra fields, for payloads the gateway may extend."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class EducationEntry(LooseModel):
    degree: str = ""
    institution: str = ""
    fieldOfStudy: str | None = None
    startYear: int | None = None
    endYear: int | None = None
    cgpa: float | None = None
    percentage: float | None = None


class ProjectEntry(LooseModel):
    title: str = ""
    description: str | None = None
    technologies: list[str] = Field(default_factory=list)
    link: str | None = None
    durationMonths: int | None = None


class ExperienceEntry(LooseModel):
    company: str = ""
    role: str = ""
    type: str | None = "INTERNSHIP"
    startDate: str | None = None
    endDate: str | None = None
    description: str | None = None
    durationMonths: int | None = 0


class CertificationEntry(LooseModel):
    name: str = ""
    issuer: str | None = None
    issuedOn: str | None = None
    credentialId: str | None = None
    link: str | None = None


class ParsedResume(LooseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    links: list[str] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    programmingLanguages: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    databases: list[str] = Field(default_factory=list)
    cloud: list[str] = Field(default_factory=list)
    fundamentals: list[str] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    internships: list[ExperienceEntry] = Field(default_factory=list)
    experience: list[ExperienceEntry] = Field(default_factory=list)
    certifications: list[CertificationEntry] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    totalExperienceMonths: int = 0
    sections: dict[str, str] = Field(default_factory=dict)
    detectedSectionNames: list[str] = Field(default_factory=list)
    wordCount: int = 0
    cgpa: float | None = None


class AtsBreakdownItem(LooseModel):
    criterion: str
    score: float
    maxScore: float
    weight: float
    detail: str = ""


class RagSource(LooseModel):
    documentId: str
    title: str
    chunkIndex: int
    score: float
    snippet: str | None = None
    category: str = "UNKNOWN"


class SkillGap(LooseModel):
    skill: str
    category: SkillCategory = "PROGRAMMING_LANGUAGE"
    currentLevel: float = 0
    requiredLevel: float = 70
    gap: float = 0
    severity: GapSeverity = "MEDIUM"
    source: str = "RESUME_MATCH"
    relatedRoles: list[str] = Field(default_factory=list)
    recommendedActions: list[str] = Field(default_factory=list)


class Recommendation(LooseModel):
    title: str
    description: str = ""
    category: Literal["SKILL", "ASSESSMENT", "INTERVIEW", "RESUME", "MENTORSHIP", "PROJECT", "COMMUNICATION"] = "SKILL"
    priority: GapSeverity = "MEDIUM"
    estimatedHours: float = 4
    actionRoute: str | None = None
    actionLabel: str | None = None
    rationale: str = ""
    resources: list[dict[str, Any]] = Field(default_factory=list)
