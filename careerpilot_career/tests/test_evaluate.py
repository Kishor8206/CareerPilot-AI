"""The evaluator is code that can be wrong, so it is pinned at inputs whose
correct scores are known in advance. CPU only."""
import copy
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "training"))

import common  # noqa: E402,F401
from evaluate import human_sheet, score  # noqa: E402
from train_utils import load_split  # noqa: E402

FULL = ("H", "N", "O", "P", "Q", "T", "W")


@pytest.fixture(scope="module")
def sample():
    test = load_split("test")
    seen = [r for r in test if not r["held_out_role"] and r["task_code"] in FULL][:25]
    held = [r for r in test if r["held_out_role"] and r["task_code"] in FULL][:25]
    assert len(seen) == 25 and len(held) == 25
    return seen + held


def write(tmp_path, name, rows):
    p = tmp_path / f"{name}.jsonl"
    p.write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
    return f"{name}={p}"


def test_oracle_scores_perfectly_on_seen_and_held_out_roles(sample, tmp_path):
    spec = write(tmp_path, "oracle", [{"id": r["id"], "raw_output": r["messages"][2]["content"]} for r in sample])
    rep = score([spec], tmp_path)["systems"]["oracle"]
    for bucket in ("all", "in_distribution", "held_out_roles"):
        m = rep[bucket]
        assert m["1_json_validity"] == m["2_schema_compliance"] == m["fully_valid_without_repair"] == 1.0, bucket
        assert m["3_skill_gap_f1"] == m["4_priority_agreement"] == 1.0
        assert m["5_prerequisite_correctness"] == m["6_roadmap_ordering"] == m["9_study_plan_feasibility"] == 1.0
        assert m["10_resource_id_validity"] == 1.0 and m["11_resource_hallucination"] == 0.0
        assert m["12_contradiction_rate"] == m["13_duplicate_rate"] == 0.0
    assert rep["in_distribution"]["n"] == rep["held_out_roles"]["n"] == 25


def test_garbage_scores_zero_and_is_never_counted_as_valid(sample, tmp_path):
    spec = write(tmp_path, "garbage", [{"id": r["id"], "raw_output": "Here is a great roadmap for you!"} for r in sample])
    m = score([spec], tmp_path)["systems"]["garbage"]["all"]
    assert m["1_json_validity"] == 0.0 and m["fully_valid_without_repair"] == 0.0


def test_each_kind_of_error_moves_its_own_metric(sample, tmp_path):
    rows = []
    for r in sample:
        plan = json.loads(r["messages"][2]["content"])
        plan["resource_ids"] = plan["resource_ids"] + ["yt_invented_000"]              # hallucinated resource
        if plan["study_plan"]:
            plan["study_plan"][0]["tasks"] = ["Learn everything (500h)"]                 # impossible week
        if len(plan["roadmap"]) > 1:
            plan["roadmap"] = list(reversed(plan["roadmap"]))                            # prerequisites after dependents
        for g in plan["skill_gap"][:1]:
            g["priority"] = "LOW" if g["priority"] != "LOW" else "HIGH"                  # wrong priority
        rows.append({"id": r["id"], "raw_output": json.dumps(plan)})
    m = score([write(tmp_path, "broken", rows)], tmp_path)["systems"]["broken"]["all"]
    assert m["1_json_validity"] == 1.0 and m["2_schema_compliance"] == 1.0           # well-formed, but wrong
    assert m["10_resource_id_validity"] == 0.0 and m["11_resource_hallucination"] > 0
    assert m["9_study_plan_feasibility"] < 1.0 and m["4_priority_agreement"] < 1.0
    assert m["5_prerequisite_correctness"] < 1.0 and m["12_contradiction_rate"] > 0
    assert m["fully_valid_without_repair"] == 0.0


def test_human_sheet_has_empty_score_cells(sample, tmp_path):
    import csv
    spec = write(tmp_path, "ft", [{"id": r["id"], "raw_output": r["messages"][2]["content"]} for r in sample])
    human_sheet(spec, tmp_path, 10)
    rows = list(csv.DictReader(open(tmp_path / "human_evaluation.csv", encoding="utf-8")))
    assert len(rows) == 10
    scored = [c for c in rows[0] if c.endswith("_1to5")]
    assert len(scored) == 7 and all(row[c] == "" for row in rows for c in scored)      # nothing pre-filled
