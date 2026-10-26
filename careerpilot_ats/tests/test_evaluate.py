"""Evaluator correctness (§17). CPU only; needs the built dataset.

The evaluator is itself code that can be wrong. These tests pin its behaviour
at the extremes, where the right answer is known exactly:
  * an ORACLE that emits the target JSON verbatim must score perfectly;
  * GARBAGE output must score 0% JSON validity and never count as a score;
  * a model that hallucinates skills must have its hallucination rate measured.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import ats_pipeline  # noqa: E402,F401  (puts ai-service on sys.path)
from ats_pipeline.evaluate import evaluate, llm_predictions, load_jsonl  # noqa: E402

TEST = ROOT / "dataset" / "ats_test.jsonl"
pytestmark = pytest.mark.skipif(not TEST.exists(), reason="run ats_pipeline.build_dataset first")


@pytest.fixture(scope="module")
def records():
    # Both modes explicitly: the file is ordered by mode, so a plain [:60]
    # slice silently contained no JOB_MATCH records at all.
    recs = load_jsonl(TEST)
    general = [r for r in recs if r["mode"] == "GENERAL_ATS"][:30]
    job = [r for r in recs if r["mode"] == "JOB_MATCH_ATS"][:30]
    assert len(general) == 30 and len(job) == 30
    return general + job


def _write(tmp_path, name, rows):
    p = tmp_path / name
    p.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return p


def test_oracle_predictions_score_perfectly(records, tmp_path):
    rows = [{"id": r["id"], "raw_output": r["messages"][-1]["content"]} for r in records]
    by_id = {r["id"]: r for r in records}
    preds, meta = llm_predictions(_write(tmp_path, "oracle.jsonl", rows), by_id)
    assert meta["json_validity_rate"] == 1.0
    assert meta["hallucination_rate"] == 0.0
    report = evaluate(records, {"oracle": preds}, {"oracle": meta}, {})
    for mode in ("GENERAL_ATS", "JOB_MATCH_ATS"):
        tf = report["systems"]["oracle"][mode]["teacher_fidelity"]
        if isinstance(tf, dict) and tf.get("n", 0) >= 3:
            assert tf["MAE"] == pytest.approx(0.0, abs=1e-9), mode
            assert tf["RMSE"] == pytest.approx(0.0, abs=1e-9), mode
    sk = report["systems"]["oracle"]["JOB_MATCH_ATS"]["skill_match_vs_deterministic_reference"]
    if sk and (sk["tp"] + sk["fn"]):
        assert sk["F1"] == pytest.approx(1.0)


def test_garbage_output_is_invalid_and_never_scored(records, tmp_path):
    rows = [{"id": r["id"], "raw_output": "I'm sorry, I can't analyse this resume."} for r in records]
    preds, meta = llm_predictions(_write(tmp_path, "garbage.jsonl", rows), {r["id"]: r for r in records})
    assert meta["json_validity_rate"] == 0.0
    assert all(p["atsScore"] is None for p in preds)
    report = evaluate(records, {"garbage": preds}, {"garbage": meta}, {})
    for mode in ("GENERAL_ATS", "JOB_MATCH_ATS"):
        assert report["systems"]["garbage"][mode]["n_scored"] == 0


def test_hallucinated_skills_are_measured_not_hidden(records, tmp_path):
    jm = [r for r in records if r["mode"] == "JOB_MATCH_ATS"][:10]
    rows = []
    for r in jm:
        t = json.loads(r["messages"][-1]["content"])
        t["matchedSkills"] = t["matchedSkills"] + ["Quantum Blockchain Engineering"]   # never in any resume
        rows.append({"id": r["id"], "raw_output": json.dumps(t)})
    _, meta = llm_predictions(_write(tmp_path, "halluc.jsonl", rows), {r["id"]: r for r in jm})
    assert meta["hallucinated_skill_claims"] == len(jm)
    assert meta["hallucination_rate"] > 0


def test_human_agreement_is_reported_unavailable_not_fabricated(records):
    from ats_pipeline.evaluate import deterministic_predictions
    report = evaluate(records, deterministic_predictions(records[:10]), {}, human={})
    m = report["systems"]["deterministic_production"]["GENERAL_ATS"]
    assert isinstance(m["human_agreement"], str) and "NOT AVAILABLE" in m["human_agreement"]
