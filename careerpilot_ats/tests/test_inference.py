"""Inference safety tests (§20, §21, §22). CPU only: generators are faked.

Each test pins one guarantee: the model's output is never trusted, a failure
never reaches the caller, and a hallucinated skill is caught and counted.
"""
import json
import math
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT.parent / "ai-service")]

from ats_pipeline.inference import analyze, extract_json, parse_and_validate  # noqa: E402
from ats_pipeline.scoring import final_score  # noqa: E402

RESUME = "Skills\nPython, JavaScript\nExperience\nBuilt web apps in JavaScript and Python."
JD = "We need Python, Java, AWS and Docker."

JM_COMPS = {"requiredSkillMatch": 25, "experienceRelevance": 40, "projectRelevance": 30,
            "keywordCoverage": 35, "educationEligibility": 70, "structure": 60, "formatting": 80}
GEN_COMPS = {"structure": 70, "sectionCompleteness": 60, "skills": 55, "experience": 40,
             "projects": 20, "achievements": 10, "keywords": 50, "formatting": 80}


def jm(**over):
    base = {"mode": "JOB_MATCH_ATS", "componentScores": dict(JM_COMPS), "atsScore": 0,
            "matchedSkills": ["Python"], "missingSkills": ["Java", "AWS", "Docker"],
            "strengths": [], "weaknesses": [], "recommendations": [], "evidence": []}
    base.update(over)
    return base


def gen_fake(*outputs, delay=0.0):
    calls = iter(outputs)

    def g(messages):
        if delay:
            time.sleep(delay)
        out = next(calls)
        if isinstance(out, Exception):
            raise out
        return out
    return g


# ------------------------------------------------------------ §20 hallucination
def test_hallucinated_skills_are_caught_counted_and_corrected():
    lie = jm(matchedSkills=["Python", "Java", "AWS", "Docker"], missingSkills=[])
    out = parse_and_validate("JOB_MATCH_ATS", json.dumps(lie), RESUME, JD)
    assert out.ok
    assert out.result["matchedSkills"] == ["Python"]
    assert set(out.result["missingSkills"]) == {"Java", "AWS", "Docker"}
    assert set(out.grounding["hallucinated_matched"]) == {"Java", "AWS", "Docker"}


def test_java_is_not_matched_by_javascript():
    out = parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(matchedSkills=["Java"], missingSkills=[])), RESUME, JD)
    assert "Java" not in out.result["matchedSkills"]
    assert out.grounding["hallucinated_matched"] == ["Java"]


def test_missing_skill_the_jd_never_asked_for_is_removed():
    out = parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(missingSkills=["Java", "Kubernetes"])), RESUME, JD)
    assert "Kubernetes" not in out.result["missingSkills"]
    assert out.grounding["missing_not_in_jd"] == ["Kubernetes"]


def test_a_skill_can_never_be_both_matched_and_missing():
    out = parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(missingSkills=["Python", "Java"])), RESUME, JD)
    assert not set(out.result["matchedSkills"]) & set(out.result["missingSkills"])


# -------------------------------------------------------- §11 score authority
def test_model_ats_score_is_discarded_and_recomputed():
    out = parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(atsScore=99)), RESUME, JD)
    assert out.model_ats_score == 99
    assert out.result["atsScore"] == final_score("JOB_MATCH_ATS", JM_COMPS)
    assert out.result["atsScore"] != 99


# --------------------------------------------------------- §21 JSON handling
def test_json_inside_markdown_fence_is_extracted():
    raw = "Sure!\n```json\n" + json.dumps(jm()) + "\n```\nHope that helps."
    assert parse_and_validate("JOB_MATCH_ATS", raw, RESUME, JD).ok


def test_brace_inside_a_string_does_not_end_the_object():
    obj = jm(evidence=['Resume says "use {braces} carefully"'])
    assert extract_json("noise " + json.dumps(obj) + " trailing")["evidence"] == obj["evidence"]


@pytest.mark.parametrize("raw,why", [
    ("", "empty"),
    ("I think the resume is good.", "no JSON"),
    ('{"mode": "JOB_MATCH_ATS", "componentScores": {', "truncated"),
])
def test_malformed_output_is_rejected(raw, why):
    assert not parse_and_validate("JOB_MATCH_ATS", raw, RESUME, JD).ok, why


@pytest.mark.parametrize("bad", [-5, 101, float("nan"), float("inf")])
def test_out_of_range_or_non_finite_component_is_rejected(bad):
    comps = dict(JM_COMPS, requiredSkillMatch=bad)
    raw = json.dumps(jm(componentScores=comps)).replace("NaN", "NaN")
    assert not parse_and_validate("JOB_MATCH_ATS", raw, RESUME, JD).ok


def test_missing_component_is_rejected():
    comps = {k: v for k, v in JM_COMPS.items() if k != "formatting"}
    assert not parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(componentScores=comps)), RESUME, JD).ok


def test_uncontrolled_extra_field_is_rejected():
    assert not parse_and_validate("JOB_MATCH_ATS", json.dumps(jm(hiddenPersonalityScore=80)), RESUME, JD).ok


def test_mode_mismatch_is_rejected():
    general = {"mode": "GENERAL_ATS", "componentScores": GEN_COMPS, "atsScore": 0}
    assert not parse_and_validate("JOB_MATCH_ATS", json.dumps(general), RESUME, JD).ok


# ------------------------------------------------- §21 retry, §22 fallback
def test_invalid_then_valid_succeeds_on_constrained_retry():
    out = analyze("JOB_MATCH_ATS", RESUME, JD, gen_fake("not json at all", json.dumps(jm())))
    assert out["inference"]["provider"] == "fine-tuned"
    assert out["inference"]["attempts"] == 2
    assert out["inference"]["degraded"] is False


def test_invalid_twice_falls_back_to_deterministic_engine():
    out = analyze("JOB_MATCH_ATS", RESUME, JD, gen_fake("garbage", "still garbage"))
    assert out["inference"]["degraded"] is True
    assert out["inference"]["provider"] == "deterministic"
    assert out["result"]["mode"] == "JOB_MATCH_ATS"
    assert out["result"]["matchedSkills"] == ["Python"]          # the engine answers correctly


def test_timeout_falls_back_without_retrying():
    out = analyze("GENERAL_ATS", RESUME, "", gen_fake("{}", delay=2.0), timeout_s=0.3)
    assert out["inference"]["degraded"] is True
    assert "timeout" in out["inference"]["reason"]
    assert out["inference"]["attempts"] == 1


def test_generator_crash_falls_back():
    out = analyze("GENERAL_ATS", RESUME, "", gen_fake(RuntimeError("CUDA out of memory")))
    assert out["inference"]["degraded"] is True
    assert "out of memory" in out["inference"]["reason"]


def test_unloaded_model_uses_deterministic_engine():
    out = analyze("GENERAL_ATS", RESUME, "", generator=None)
    assert out["inference"] == {**out["inference"], "degraded": True, "provider": "deterministic"}
    assert math.isfinite(out["result"]["atsScore"])
