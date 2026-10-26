"""Career roadmap service: model output is validated, repaired, retried or replaced.

No GPU: the generator is faked. Each test pins one guarantee about what can
and cannot reach a user.
"""
from __future__ import annotations

import asyncio
import copy
import json
import re

import pytest

from app.career import model_service
from app.career.planner import build_plan
from app.career.roadmap_service import ats_to_career_request, generate_plan
from app.career.schemas import CareerPlan
from app.career.validation import extract_json
from app.core.config import settings

REQUEST = {
    "target_role": "Full Stack Developer",
    "current_skills": [{"skill": "JavaScript", "level": "intermediate"}, {"skill": "React", "level": "beginner"}],
    "user_profile": {"available_hours_per_day": 2, "available_days_per_week": 6},
}
REFERENCE = build_plan(REQUEST)["plan"]


class Fake:
    name = "fake"

    def __init__(self, *outputs, delay=0.0):
        self.outputs, self.delay, self.calls = list(outputs), delay, 0

    async def generate(self, messages):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        out = self.outputs[min(self.calls - 1, len(self.outputs) - 1)]
        if isinstance(out, Exception):
            raise out
        return out if isinstance(out, str) else json.dumps(out)


@pytest.fixture
def use_model(monkeypatch):
    def _use(*outputs, **kw):
        fake = Fake(*outputs, **kw)
        monkeypatch.setattr(settings, "career_model_provider", "openai_compatible")
        monkeypatch.setattr(model_service, "_generator", fake)
        monkeypatch.setattr(model_service, "_load_error", None)
        return fake
    yield _use
    model_service.reset_career_model()


def hours(week):
    return sum(float(h) for t in week["tasks"] for h in re.findall(r"\(([\d.]+)h\)", t))


def mutated(**changes):
    plan = copy.deepcopy(REFERENCE)
    plan.update(changes)
    return plan


@pytest.mark.asyncio
async def test_disabled_model_uses_the_deterministic_planner():
    assert settings.career_model_provider == "none"
    out = await generate_plan(REQUEST)
    assert out["inference"]["provider"] == "deterministic" and out["inference"]["degraded"] is False
    assert out["plan"] == REFERENCE
    CareerPlan.model_validate(out["plan"])


@pytest.mark.asyncio
async def test_a_correct_model_answer_is_used_without_repair(use_model):
    fake = use_model(mutated(readiness_summary="A model-written summary."))
    out = await generate_plan(REQUEST)
    assert out["inference"] == {**out["inference"], "provider": "fake", "attempts": 1, "repairs": [], "degraded": False}
    assert out["plan"]["readiness_summary"] == "A model-written summary."
    assert fake.calls == 1


@pytest.mark.asyncio
async def test_thinking_block_and_code_fence_are_tolerated(use_model):
    use_model("<think>let me plan</think>\n```json\n" + json.dumps(REFERENCE) + "\n```")
    out = await generate_plan(REQUEST)
    assert out["inference"]["provider"] == "fake"
    assert extract_json("<think>{not json}</think>{\"a\": 1}") == {"a": 1}


@pytest.mark.asyncio
async def test_an_overloaded_week_is_replaced_by_the_real_schedule(use_model):
    bad = copy.deepcopy(REFERENCE["study_plan"])
    bad[0]["tasks"] = ["Learn everything (40h)"]                       # only 12h are available
    use_model(mutated(study_plan=bad))
    out = await generate_plan(REQUEST)
    assert all(hours(w) <= 12.11 for w in out["plan"]["study_plan"])
    assert any("study_plan" in r for r in out["inference"]["repairs"])
    assert "week_overload" in out["inference"]["model_errors_before_repair"]


@pytest.mark.asyncio
async def test_hallucinated_resources_and_urls_never_reach_the_user(use_model):
    use_model(mutated(resource_ids=[*REFERENCE["resource_ids"][:2], "yt_made_up_123", "https://evil.example/course"]))
    out = await generate_plan(REQUEST)
    assert out["plan"]["resource_ids"] == REFERENCE["resource_ids"][:2]
    assert "evil.example" not in json.dumps(out)
    assert all(r["verification_status"] in ("verified", "reachable") for r in out["resources"])
    assert any("resource_ids" in r for r in out["inference"]["repairs"])


@pytest.mark.asyncio
async def test_wrong_priority_and_an_already_known_skill_are_corrected(use_model):
    gaps = copy.deepcopy(REFERENCE["skill_gap"])
    gaps[0]["priority"] = "LOW" if gaps[0]["priority"] != "LOW" else "HIGH"
    gaps.append({"skill": "JavaScript", "current_level": "none", "required_level": "beginner", "priority": "HIGH",
                 "reason": "Learn JavaScript basics."})                # the user already has it
    use_model(mutated(skill_gap=gaps))
    out = await generate_plan(REQUEST)
    assert [g["priority"] for g in out["plan"]["skill_gap"]] == [g["priority"] for g in REFERENCE["skill_gap"]]
    assert "JavaScript" not in [g["skill"] for g in out["plan"]["skill_gap"]]


@pytest.mark.asyncio
async def test_a_skill_before_its_prerequisite_is_reordered(use_model):
    use_model(mutated(roadmap=list(reversed(copy.deepcopy(REFERENCE["roadmap"])))))
    out = await generate_plan(REQUEST)
    assert out["plan"]["roadmap"] == REFERENCE["roadmap"]
    assert "prerequisite_order" in out["inference"]["model_errors_before_repair"]


@pytest.mark.asyncio
async def test_invalid_json_is_retried_once_then_succeeds(use_model):
    fake = use_model("Sure! Here is your roadmap...", REFERENCE)
    out = await generate_plan(REQUEST)
    assert fake.calls == 2 and out["inference"]["attempts"] == 2 and out["inference"]["provider"] == "fake"


@pytest.mark.asyncio
async def test_invalid_twice_falls_back_and_says_so(use_model):
    fake = use_model("garbage", "{still not valid")
    out = await generate_plan(REQUEST)
    assert fake.calls == 2
    assert out["inference"]["provider"] == "deterministic" and out["inference"]["degraded"] is True
    assert out["plan"] == REFERENCE


@pytest.mark.asyncio
async def test_timeout_and_crash_fall_back(use_model, monkeypatch):
    monkeypatch.setattr(settings, "career_model_timeout_s", 0.2)
    use_model(REFERENCE, delay=1.5)
    out = await generate_plan(REQUEST)
    assert out["inference"]["degraded"] is True and "timeout" in out["inference"]["errors"][0]
    use_model(RuntimeError("CUDA out of memory"))
    out = await generate_plan(REQUEST)
    assert out["inference"]["degraded"] is True and out["plan"] == REFERENCE


@pytest.mark.asyncio
async def test_misconfigured_provider_degrades_instead_of_failing(monkeypatch):
    monkeypatch.setattr(settings, "career_model_provider", "local")
    monkeypatch.setattr(settings, "career_model_adapter_path", "")
    model_service.reset_career_model()
    try:
        out = await generate_plan(REQUEST)
        assert out["inference"]["degraded"] is True
        assert "CAREER_MODEL_ADAPTER_PATH" in out["inference"]["errors"][0]
    finally:
        model_service.reset_career_model()


@pytest.mark.asyncio
async def test_response_carries_resolved_resources_and_a_feasible_daily_plan():
    out = await generate_plan(REQUEST)
    assert {r["resource_id"] for r in out["resources"]} == set(out["plan"]["resource_ids"])
    assert all("allowed_domains" not in r and "verification_detail" not in r for r in out["resources"])
    for week in out["daily_plan"]:
        for day in week["days"]:
            assert sum(float(h) for t in day["tasks"] for h in re.findall(r"\(([\d.]+)h\)", t)) <= 2.01


def test_ats_output_becomes_career_input_without_sharing_anything_else():
    ats = {"atsScore": 62, "parsed": {"skills": ["JavaScript", "HTML"]}, "matchedKeywords": ["JavaScript"],
           "missingKeywords": ["React", "Node.js", "SQL"]}
    request = ats_to_career_request(ats, "Full Stack Developer", {"available_hours_per_day": 2})
    assert request["ats_context"] == {"matched_skills": ["JavaScript"], "missing_skills": ["React", "Node.js", "SQL"], "ats_score": 62}
    plan = build_plan(request)
    flagged = {g["skill"] for g in plan["context"]["kept_gaps"] if g["ats_flagged"]}
    assert {"React", "Node.js", "SQL"} <= flagged


def test_the_career_model_never_touches_the_ats_model():
    import pathlib
    source = "".join(p.read_text(encoding="utf-8") for p in pathlib.Path(model_service.__file__).parent.glob("*.py"))
    assert "ats_model" not in source.replace("app/ats_model", "").replace("(app/ats_model)", "")
    assert settings.career_model_base != settings.ats_model_base
