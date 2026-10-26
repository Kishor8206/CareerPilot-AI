"""Validate generated examples, report statistics, and show samples.  ->  data/validated/career_sft.jsonl

    python training/validate_dataset.py
    python training/validate_dataset.py --samples 3

Every example is checked independently of the generator, using only what is
stored in the record:
  * conversation shape (system, user, assistant) and non-empty content;
  * the assistant message parses as JSON and round-trips;
  * the plan passes app.career.validation.validate_plan against the record's
    own facts — schema, known skills and role, no already-met skill
    recommended, prerequisite order, weekly-hours feasibility, resource and
    project IDs that were actually offered, no URLs, no duplicates;
  * token length within the training limit, measured with the real tokenizer;
  * exact-duplicate prompts and contradictory examples (same prompt, different answer).

Invalid examples are REJECTED and counted by reason. If more than 2% are
rejected the script exits non-zero: do not train on a dataset that fails here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
from collections import Counter, defaultdict

from common import DATASET_VERSION, GENERATED, KNOWLEDGE, VALIDATED, write_json

from app.career.knowledge import get_knowledge
from app.career.prompts import SYSTEM_PROMPT, render
from app.career.validation import validate_plan

BASE_MODEL = "Qwen/Qwen3-1.7B"
MAX_TOKENS = 4096
MAX_REJECT_RATE = 0.02


def tokenizer():
    from transformers import AutoTokenizer
    local = KNOWLEDGE / "tokenizer"
    if local.exists():
        return AutoTokenizer.from_pretrained(str(local))
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    tok.save_pretrained(str(local))
    return tok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=2)
    args = ap.parse_args()
    kb, tok = get_knowledge(), tokenizer()
    records = [json.loads(line) for line in open(GENERATED / "career_sft.jsonl", encoding="utf-8")]

    valid, rejects, lengths = [], Counter(), []
    reject_examples: dict[str, str] = {}
    answers: dict[str, set[str]] = defaultdict(set)
    seen_prompts: set[str] = set()

    def reject(reason: str, detail: str) -> None:
        rejects[reason] += 1
        reject_examples.setdefault(reason, detail[:200])

    for r in records:
        m = r.get("messages") or []
        if [x.get("role") for x in m] != ["system", "user", "assistant"] or not all(x.get("content", "").strip() for x in m):
            reject("malformed_conversation", r.get("id", "?")); continue
        if m[0]["content"] != SYSTEM_PROMPT:
            reject("wrong_system_prompt", r["id"]); continue
        try:
            plan = json.loads(m[2]["content"])
        except json.JSONDecodeError as exc:
            reject("json", f"{r['id']}: {exc}"); continue
        if json.dumps(plan, ensure_ascii=False, separators=(",", ":")) != m[2]["content"]:
            reject("json_not_canonical", r["id"]); continue

        f = r["facts"]
        facts = {**f, "met": set(f["met"]), "resource_ids": set(f["resource_ids"]),
                 "project_titles": set(f["project_titles"]), "sections": set(f["sections"])}
        errors = validate_plan(plan, facts, kb)
        if errors:
            reject(errors[0][0], f"{r['id']} [{r['task_code']}]: {errors[0][1]}"); continue

        digest = hashlib.sha256(m[1]["content"].encode()).hexdigest()
        answers[digest].add(m[2]["content"])
        if digest in seen_prompts:
            reject("duplicate_prompt", r["id"]); continue
        seen_prompts.add(digest)

        n = len(render(tok, m, add_generation_prompt=False, tokenize=True))
        if n > MAX_TOKENS:
            reject("too_long", f"{r['id']}: {n} tokens"); continue
        r["n_tokens"] = n
        r["n_prompt_tokens"] = len(render(tok, m[:2], add_generation_prompt=True, tokenize=True))
        lengths.append(n)
        valid.append(r)

    contradictory = sum(1 for v in answers.values() if len(v) > 1)
    rate = 1 - len(valid) / max(1, len(records))

    VALIDATED.mkdir(parents=True, exist_ok=True)
    with open(VALIDATED / "career_sft.jsonl", "w", encoding="utf-8") as fh:
        for r in valid:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    out_tokens = [r["n_tokens"] - r["n_prompt_tokens"] for r in valid]
    report = {
        "dataset_version": DATASET_VERSION, "validated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "generated": len(records), "valid": len(valid), "rejected": len(records) - len(valid),
        "reject_rate": round(rate, 4), "rejects_by_reason": dict(rejects), "reject_examples": reject_examples,
        "contradictory_prompts": contradictory, "max_tokens": MAX_TOKENS,
        "tokens": {"mean": round(statistics.mean(lengths)), "median": round(statistics.median(lengths)),
                   "p95": sorted(lengths)[int(0.95 * len(lengths))], "max": max(lengths)} if lengths else {},
        "output_tokens": {"mean": round(statistics.mean(out_tokens)), "max": max(out_tokens)} if out_tokens else {},
        "by_task": dict(sorted(Counter(r["task_code"] for r in valid).items())),
        "by_role": dict(sorted(Counter(r["role"] for r in valid).items())),
        "by_archetype": dict(Counter(r["archetype"] for r in valid)),
        "distinct_learner_profiles": len({r["profile_key"] for r in valid}),
    }
    write_json(VALIDATED / "validation_report.json", report)

    print(f"generated {len(records)} | valid {len(valid)} | rejected {report['rejected']} ({rate:.2%})")
    if rejects:
        print("rejects by reason:", dict(rejects))
        for reason, detail in reject_examples.items():
            print(f"   e.g. {reason}: {detail}")
    print(f"contradictory prompts (same prompt, different answer): {contradictory}")
    print(f"tokens: {report['tokens']} | output tokens: {report['output_tokens']} | limit {MAX_TOKENS}")
    print(f"tasks: {len(report['by_task'])} | roles: {len(report['by_role'])} | archetypes: {report['by_archetype']}")
    print(f"distinct learner profiles: {report['distinct_learner_profiles']}")

    for r in valid[: args.samples]:
        print("\n" + "=" * 100 + f"\nSAMPLE {r['id']}  task={r['task_code']} ({r['task']})  tokens={r['n_tokens']}")
        print("--- USER ---\n" + r["messages"][1]["content"][:1500])
        print("--- ASSISTANT (first 900 chars) ---\n" + r["messages"][2]["content"][:900])

    if rate > MAX_REJECT_RATE or contradictory:
        print(f"\nDATASET FAILED VALIDATION (reject rate {rate:.2%} > {MAX_REJECT_RATE:.0%} or contradictions). Do not train.")
        sys.exit(1)


if __name__ == "__main__":
    main()
