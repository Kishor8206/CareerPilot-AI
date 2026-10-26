"""Fine-tuned ATS model integration (careerpilot_ats/). No GPU: generators are faked.

The guarantees pinned here:
  * disabled by default, and when disabled the response is exactly the
    deterministic engine's — the existing ATS system is untouched;
  * when enabled, the final score is computed in Python from the model's
    components, never taken from the model;
  * exact facts (matched/missing keywords) stay deterministic;
  * any model failure degrades to the deterministic result, and says so;
  * hallucinated skills are corrected and reported.
"""
from __future__ import annotations

import json

import pytest

RESUME = """Aarav Kumar
candidate@example.com | +1-555-0100

Summary
Backend engineer building Python services.

Experience
Software Engineer | Fintech Co | Jan 2021 - Present
- Built REST APIs in Python and Django serving 150,000 users
- Reduced latency by 40% with Redis caching

Education
B.Tech, Computer Science, NIT (2020)

Skills
Python, Django, Redis, PostgreSQL, Git
"""
JD = "Backend engineer. Requirements: Python, Django, AWS, Docker, Kubernetes."

GENERAL = {"mode": "GENERAL_ATS",
           "componentScores": {"structure": 80, "sectionCompleteness": 90, "skills": 70, "experience": 60,
                               "projects": 30, "achievements": 55, "keywords": 65, "formatting": 85},
           "atsScore": 99,  # deliberately wrong: must be ignored
           "strengths": ["Clear, parseable section structure"], "weaknesses": ["No projects section"],
           "recommendations": ["Add 2-3 projects."], "evidence": ["Skills found in resume: Python, Django"]}
JOB = {"mode": "JOB_MATCH_ATS",
       "componentScores": {"requiredSkillMatch": 40, "experienceRelevance": 60, "projectRelevance": 30,
                           "keywordCoverage": 50, "educationEligibility": 100, "structure": 80, "formatting": 85},
       "atsScore": 1,
       "matchedSkills": ["Python", "Django", "Kubernetes"],  # Kubernetes is NOT in the resume
       "missingSkills": ["AWS", "Docker"],
       "strengths": [], "weaknesses": [], "recommendations": ["Show AWS experience if you have it."],
       "evidence": ["Job requires: Python, Django, AWS, Docker, Kubernetes"]}


class FakeGenerator:
    name = "fake"

    def __init__(self, by_mode: dict[str, str | Exception]):
        self.by_mode = by_mode

    async def generate(self, messages):
        mode = "JOB_MATCH_ATS" if "Mode: JOB_MATCH_ATS" in messages[1]["content"] else "GENERAL_ATS"
        out = self.by_mode[mode]
        if isinstance(out, Exception):
            raise out
        return out


@pytest.fixture
def enable_model(monkeypatch):
    from app.ats_model import service
    from app.core.config import settings

    def _enable(by_mode):
        monkeypatch.setattr(settings, "ats_model_provider", "openai_compatible")
        monkeypatch.setattr(service, "_generator", FakeGenerator(by_mode))
        monkeypatch.setattr(service, "_load_error", None)
    yield _enable
    service.reset_ats_model()


async def analyse(**extra):
    from app.agents.orchestrator import run_agent
    return (await run_agent("RESUME_INTELLIGENCE", {"text": RESUME, **extra}))["data"]


@pytest.mark.asyncio
async def test_disabled_by_default_and_response_is_the_deterministic_engine():
    from app.core.config import settings
    from app.nlp.resume_parser import parse_resume
    from app.services.ats import score_resume

    assert settings.ats_model_provider == "none"
    data = await analyse()
    assert data["modelInfo"] is None
    assert data["atsScore"] == score_resume(parse_resume(RESUME), RESUME)["atsScore"]
    assert data["jobMatchScore"] is None and data["evidence"] == []


@pytest.mark.asyncio
async def test_enabled_score_is_computed_in_python_not_taken_from_the_model(enable_model):
    from app.ats_model.scoring import final_score

    enable_model({"GENERAL_ATS": json.dumps(GENERAL)})
    data = await analyse()
    expected = final_score("GENERAL_ATS", GENERAL["componentScores"])
    assert data["atsScore"] == expected != 99
    assert round(sum(b["score"] for b in data["breakdown"]), 2) == pytest.approx(expected, abs=0.05)
    assert len(data["breakdown"]) == 8
    assert data["modelInfo"]["degraded"] is False
    assert "careerpilot-ats-qwen3-4b-v1" in data["engineVersion"]
    assert data["modelInfo"]["baselineAtsScore"] != data["atsScore"]   # the baseline stays visible


@pytest.mark.asyncio
async def test_job_match_keywords_stay_deterministic_and_hallucination_is_reported(enable_model):
    enable_model({"GENERAL_ATS": json.dumps(GENERAL), "JOB_MATCH_ATS": json.dumps(JOB)})
    data = await analyse(jobDescriptionText=JD)
    assert "Kubernetes" not in data["matchedKeywords"]          # exact facts from extraction
    assert "Kubernetes" in data["missingKeywords"]
    assert data["modelInfo"]["hallucinationsCorrected"] == ["Kubernetes"]
    assert data["jobMatchScore"] is not None and data["jobMatchScore"] != 1
    assert data["jobSpecificRecommendations"] == JOB["recommendations"]


@pytest.mark.asyncio
async def test_malformed_output_degrades_to_the_deterministic_score(enable_model):
    from app.nlp.resume_parser import parse_resume
    from app.services.ats import score_resume

    enable_model({"GENERAL_ATS": "Sorry, I cannot help with that."})
    data = await analyse()
    assert data["atsScore"] == score_resume(parse_resume(RESUME), RESUME)["atsScore"]
    assert data["modelInfo"]["degraded"] is True
    assert "json" in data["modelInfo"]["reasons"]["GENERAL_ATS"]
    assert data["modelInfo"]["inferenceMode"]["GENERAL_ATS"]["provider"] == "deterministic"


@pytest.mark.asyncio
async def test_modes_fail_independently(enable_model):
    enable_model({"GENERAL_ATS": json.dumps(GENERAL), "JOB_MATCH_ATS": ConnectionError("gpu host down")})
    data = await analyse(jobDescriptionText=JD)
    assert data["modelInfo"]["inferenceMode"]["GENERAL_ATS"]["provider"] == "fake"
    assert "gpu host down" in data["modelInfo"]["reasons"]["JOB_MATCH_ATS"]
    assert data["jobMatchScore"] is None
    assert data["jobSpecificRecommendations"]                 # the existing advice path still answers


@pytest.mark.asyncio
async def test_unloadable_model_never_breaks_the_endpoint(monkeypatch):
    from app.ats_model import service
    from app.core.config import settings

    monkeypatch.setattr(settings, "ats_model_provider", "local")
    monkeypatch.setattr(settings, "ats_model_adapter_path", "")   # misconfigured
    service.reset_ats_model()
    try:
        data = await analyse()
        assert data["modelInfo"]["degraded"] is True
        assert "ATS_MODEL_ADAPTER_PATH" in data["modelInfo"]["reasons"]["GENERAL_ATS"]
    finally:
        service.reset_ats_model()
