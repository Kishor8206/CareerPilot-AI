"""Evaluate the career model. Never from training loss alone.

    python training/evaluate.py generate --adapter <run>/final --out <run>/evaluation   # GPU
    python training/evaluate.py score --pred finetuned=<...>/pred_finetuned.jsonl --pred base=<...>/pred_base.jsonl
    python training/evaluate.py human-sheet --pred finetuned=<...>/pred_finetuned.jsonl

`generate` writes raw model outputs for the fine-tuned model AND the base model
(the same weights with the adapter disabled), so the comparison isolates what
fine-tuning changed. `score` runs on CPU and re-validates every raw output
with the production validator, so the model is measured exactly as it would be
served — before any repair.

The 13 metrics (each is a rate over evaluated examples unless noted)
   1 json_validity            output parses as a JSON object
   2 schema_compliance        passes the strict schema
   3 skill_gap_f1             gap skills vs the reference (micro F1), where skill_gap was requested
   4 priority_agreement       priority label equals the skill-gap service's, over shared skills
   5 prerequisite_correctness no skill placed before its prerequisite
   6 roadmap_ordering         roadmap covers every gap, each exactly once, in a valid order
   7 role_alignment           target_role is the requested role
   8 personalisation          recommends no skill the learner already has, and levels match the profile
   9 study_plan_feasibility   no week over the learner's hours, weeks consecutive and within the limit
  10 resource_id_validity     every resource ID was one of those offered
  11 resource_hallucination   share of all emitted resource IDs that were NOT offered (lower is better)
  12 contradiction_rate       plans contradicting the supplied facts (lower is better)
  13 duplicate_rate           plans repeating a skill or resource (lower is better)
Plus fully_valid: passes every check with no repair needed.

Results are reported separately for in-distribution roles and for the two
roles held out of training, which is the test of "a new role needs no retraining".

What these metrics do NOT show: whether the advice is good careers advice.
The reference is the deterministic planner, so they measure faithfulness to
it and to the supplied facts. Quality needs the human review sheet.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from common import DATA, MODELS
from train_utils import load_split

from app.career.knowledge import get_knowledge
from app.career.validation import extract_json, validate_plan

PERSONALISATION = {"recommends_met_skill", "gap_mismatch", "skill_not_in_gaps", "level"}
FEASIBILITY = {"week_overload", "week_sequence", "too_many_weeks"}
CONTRADICTION = {"recommends_met_skill", "gap_mismatch", "priority_mismatch", "prerequisite_order", "role", "week_overload"}
ORDERING = {"prerequisite_order", "phase_coverage", "duplicate", "unknown_skill", "skill_not_in_gaps", "recommends_met_skill"}


def facts_of(record: dict) -> dict:
    f = record["facts"]
    return {**f, "met": set(f["met"]), "resource_ids": set(f["resource_ids"]),
            "project_titles": set(f["project_titles"]), "sections": set(f["sections"])}


def score_one(record: dict, raw: str, kb) -> dict:
    """Per-example outcomes for every metric (None = not applicable to this task)."""
    facts, reference = facts_of(record), json.loads(record["messages"][2]["content"])
    out: dict = {"json": False, "schema": False}
    try:
        plan = extract_json(raw)
        out["json"] = True
    except (ValueError, TypeError):
        return out
    errors = validate_plan(plan, facts, kb)
    codes = {c for c, _ in errors}
    out["schema"] = "schema" not in codes
    if not out["schema"]:
        return out
    sections = facts["sections"]
    out["fully_valid"] = not errors
    out["role"] = "role" not in codes
    out["prerequisite"] = "prerequisite_order" not in codes
    out["personalisation"] = not (codes & PERSONALISATION)
    out["contradiction"] = bool(codes & CONTRADICTION)
    out["duplicate"] = "duplicate" in codes
    if "roadmap" in sections:
        out["ordering"] = not (codes & ORDERING) and bool(plan.get("roadmap")) == bool(reference["roadmap"])
    if "study_plan" in sections:
        out["feasible"] = not (codes & FEASIBILITY) and bool(plan.get("study_plan")) == bool(reference["study_plan"])
    if "resource_ids" in sections:
        ids = plan.get("resource_ids") or []
        out["resource_valid"] = "unknown_resource" not in codes
        out["resource_counts"] = (sum(1 for r in ids if r not in facts["resource_ids"]), len(ids))
    if "skill_gap" in sections:
        got = {g["skill"] for g in plan.get("skill_gap") or []}
        want = {g["skill"] for g in reference["skill_gap"]}
        out["gap_counts"] = (len(got & want), len(got - want), len(want - got))
        ref_priority = {g["skill"]: g["priority"] for g in reference["skill_gap"]}
        shared = [g for g in plan.get("skill_gap") or [] if g["skill"] in ref_priority]
        out["priority_counts"] = (sum(1 for g in shared if g["priority"] == ref_priority[g["skill"]]), len(shared))
    out["error_codes"] = sorted(codes)
    return out


def aggregate(rows: list[dict]) -> dict:
    n = len(rows)
    if not n:
        return {"n": 0}

    def rate(key: str, among=None):
        vals = [r[key] for r in (among if among is not None else rows) if key in r]
        return round(sum(vals) / len(vals), 4) if vals else None

    valid = [r for r in rows if r.get("schema")]
    tp = sum(r["gap_counts"][0] for r in rows if "gap_counts" in r)
    fp = sum(r["gap_counts"][1] for r in rows if "gap_counts" in r)
    fn = sum(r["gap_counts"][2] for r in rows if "gap_counts" in r)
    prec, rec = (tp / (tp + fp) if tp + fp else None), (tp / (tp + fn) if tp + fn else None)
    pr = [r["priority_counts"] for r in rows if "priority_counts" in r]
    rc = [r["resource_counts"] for r in rows if "resource_counts" in r]
    codes = Counter(c for r in rows for c in r.get("error_codes", []))
    return {
        "n": n,
        "1_json_validity": rate("json"), "2_schema_compliance": rate("schema"),
        "3_skill_gap_f1": round(2 * prec * rec / (prec + rec), 4) if prec and rec else (0.0 if tp + fp + fn else None),
        "4_priority_agreement": round(sum(a for a, _ in pr) / sum(b for _, b in pr), 4) if sum(b for _, b in pr) else None,
        "5_prerequisite_correctness": rate("prerequisite", valid), "6_roadmap_ordering": rate("ordering", valid),
        "7_role_alignment": rate("role", valid), "8_personalisation": rate("personalisation", valid),
        "9_study_plan_feasibility": rate("feasible", valid), "10_resource_id_validity": rate("resource_valid", valid),
        "11_resource_hallucination": round(sum(a for a, _ in rc) / sum(b for _, b in rc), 4) if sum(b for _, b in rc) else None,
        "12_contradiction_rate": rate("contradiction", valid), "13_duplicate_rate": rate("duplicate", valid),
        "fully_valid_without_repair": round(sum(1 for r in rows if r.get("fully_valid")) / n, 4),
        "error_codes": dict(codes.most_common(10)),
    }


def score(pred_specs: list[str], out_dir: Path) -> dict:
    kb = get_knowledge()
    test = {r["id"]: r for r in load_split("test")}
    report: dict = {"evaluated": time.strftime("%Y-%m-%d %H:%M:%S"), "systems": {}}
    for spec in pred_specs:
        name, path = spec.split("=", 1)
        buckets: dict[str, list] = defaultdict(list)
        for line in open(path, encoding="utf-8"):
            row = json.loads(line)
            rec = test.get(row["id"])
            if rec is None:
                continue
            s = score_one(rec, row["raw_output"], kb)
            buckets["all"].append(s)
            buckets["held_out_roles" if rec.get("held_out_role") else "in_distribution"].append(s)
        report["systems"][name] = {k: aggregate(v) for k, v in buckets.items()}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "evaluation_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    keys = ["n", "1_json_validity", "2_schema_compliance", "3_skill_gap_f1", "4_priority_agreement", "5_prerequisite_correctness",
            "6_roadmap_ordering", "7_role_alignment", "8_personalisation", "9_study_plan_feasibility", "10_resource_id_validity",
            "11_resource_hallucination", "12_contradiction_rate", "13_duplicate_rate", "fully_valid_without_repair"]
    lines = ["| Metric | " + " | ".join(f"{n} ({b})" for n in report["systems"] for b in report["systems"][n]) + " |",
             "|---|" + "---|" * sum(len(v) for v in report["systems"].values())]
    for k in keys:
        cells = []
        for n in report["systems"]:
            for b in report["systems"][n]:
                v = report["systems"][n][b].get(k)
                cells.append("—" if v is None else str(v))
        lines.append(f"| {k} | " + " | ".join(cells) + " |")
    table = "\n".join(lines)
    (out_dir / "evaluation_table.md").write_text(table, encoding="utf-8")
    print(table)
    return report


def generate(adapter: str, out_dir: Path, limit: int, max_new_tokens: int) -> None:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    from app.career.prompts import render

    if not torch.cuda.is_available():
        sys.exit("No CUDA GPU. Run `generate` in Colab; `score` runs anywhere.")
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    tok = AutoTokenizer.from_pretrained(adapter)
    tok.padding_side = "left"
    base = AutoModelForCausalLM.from_pretrained(
        "Qwen/Qwen3-1.7B", device_map={"": 0}, torch_dtype=dtype,
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dtype))
    model = PeftModel.from_pretrained(base, adapter).eval()

    test = load_split("test")
    # Shortest outputs first within each bucket keeps generation affordable; n is always reported.
    held = [r for r in test if r.get("held_out_role")][: limit // 2] if limit else [r for r in test if r.get("held_out_role")]
    seen = [r for r in test if not r.get("held_out_role")][: limit - len(held)] if limit else [r for r in test if not r.get("held_out_role")]
    subset = seen + held
    out_dir.mkdir(parents=True, exist_ok=True)

    def run(tag: str) -> None:
        path = out_dir / f"pred_{tag}.jsonl"
        done = {json.loads(l)["id"] for l in open(path, encoding="utf-8")} if path.exists() else set()
        todo = [r for r in subset if r["id"] not in done]
        with open(path, "a", encoding="utf-8") as f:            # appends: resumable after a disconnect
            for i in range(0, len(todo), 4):
                chunk = todo[i:i + 4]
                texts = [render(tok, r["messages"][:2], add_generation_prompt=True) for r in chunk]
                enc = tok(texts, return_tensors="pt", padding=True, add_special_tokens=False).to(model.device)
                with torch.no_grad():
                    out = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False,
                                         pad_token_id=tok.pad_token_id, eos_token_id=tok.eos_token_id)
                for r, o in zip(chunk, out):
                    f.write(json.dumps({"id": r["id"], "task_code": r["task_code"],
                                        "raw_output": tok.decode(o[enc["input_ids"].shape[1]:], skip_special_tokens=True)}) + "\n")
                f.flush()
                print(f"{tag}: {min(i + 4, len(todo))}/{len(todo)}", end="\r")
        print(f"\n{tag}: wrote {path}")

    run("finetuned")
    with model.disable_adapter():
        run("base")


def human_sheet(pred_spec: str, out_dir: Path, n: int) -> None:
    """A review sheet with EMPTY score columns. No human rating is ever pre-filled."""
    name, path = pred_spec.split("=", 1)
    test = {r["id"]: r for r in load_split("test")}
    rows = [json.loads(l) for l in open(path, encoding="utf-8")]
    full = [r for r in rows if test.get(r["id"], {}).get("task_code") in ("H", "N", "O", "P", "Q", "S", "T", "W", "AB")][:n]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "human_evaluation.csv"
    criteria = ["career_relevance", "skill_gap_quality", "roadmap_quality", "personalisation", "practicality",
                "resource_relevance", "reasoning_consistency"]
    with open(target, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["review_id", "system", "task", "request_and_knowledge", "model_output", *[f"{c}_1to5" for c in criteria], "reviewer", "notes"])
        for r in full:
            rec = test[r["id"]]
            w.writerow([r["id"], name, rec["task"], rec["messages"][1]["content"], r["raw_output"], *[""] * len(criteria), "", ""])
    print(f"wrote {target}: {len(full)} samples, {len(criteria)} criteria scored 1-5, all score cells empty")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate"); g.add_argument("--adapter", required=True); g.add_argument("--out", default=str(MODELS / "evaluation"))
    g.add_argument("--limit", type=int, default=200); g.add_argument("--max-new-tokens", type=int, default=3000)
    s = sub.add_parser("score"); s.add_argument("--pred", action="append", required=True); s.add_argument("--out", default=str(MODELS / "evaluation"))
    h = sub.add_parser("human-sheet"); h.add_argument("--pred", required=True); h.add_argument("--out", default=str(MODELS / "evaluation"))
    h.add_argument("--n", type=int, default=30)
    args = ap.parse_args()
    if args.cmd == "generate":
        generate(args.adapter, Path(args.out), args.limit, args.max_new_tokens)
    elif args.cmd == "score":
        score(args.pred, Path(args.out))
    else:
        human_sheet(args.pred, Path(args.out), args.n)


if __name__ == "__main__":
    main()
