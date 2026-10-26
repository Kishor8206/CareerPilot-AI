"""Evaluation (§17, §18). Every number printed here is measured, never assumed.

Three axes, reported separately because they answer different questions:

  1. TEACHER FIDELITY — score vs the WEAK LABEL. How faithfully a system
     reproduces the CareerPilot rubric. The weak labeller itself would score
     perfectly here *by construction*, so it is excluded as "the teacher";
     comparing against it would be circular.

  2. EXTERNAL VALIDITY — score vs the dataset's 3-class FIT LABEL (JOB_MATCH).
     No system sees this label at test time; each must infer fit from the
     resume and JD alone. This is the closest thing to the research question.

  3. HUMAN AGREEMENT — score vs human_ats_score from the review CSV. Reported
     as NOT AVAILABLE until a human has filled it in. Never fabricated.

Systems:
  deterministic_production  existing CareerPilot engine as deployed today
                            (GENERAL: score_resume atsScore; JOB_MATCH: keywordCoverage)
  deterministic_heuristic   the rubric's components with NO dataset-label anchoring
  <llm name>                any predictions file (base Qwen, fine-tuned Qwen...)

    python -m ats_pipeline.evaluate                       # deterministic systems only (CPU)
    python -m ats_pipeline.evaluate --pred base=evaluation/pred_base.jsonl --pred ft=evaluation/pred_ft.jsonl
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import pearsonr, spearmanr

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "ai-service"))

from ats_pipeline.inference import parse_and_validate  # noqa: E402
from ats_pipeline.labels import analyse_resume, job_match_components  # noqa: E402

FIT_RANK = {"No Fit": 0, "Potential Fit": 1, "Good Fit": 2}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]


# ------------------------------------------------------------------ metrics
def regression(pred: list[float], ref: list[float]) -> dict[str, Any]:
    p, r = np.asarray(pred, float), np.asarray(ref, float)
    if len(p) < 3:
        return {"n": len(p), "note": "too few paired values"}
    out = {"n": int(len(p)), "MAE": float(np.mean(np.abs(p - r))), "RMSE": float(np.sqrt(np.mean((p - r) ** 2)))}
    # ptp, not std: a constant float array can have std ~1e-15 rather than 0.
    const = np.ptp(p) == 0 or np.ptp(r) == 0
    out["Pearson"] = None if const else float(pearsonr(p, r)[0])
    out["Spearman"] = None if const else float(spearmanr(p, r)[0])
    return out


def ordinal(pred: list[float], fit: list[int]) -> dict[str, Any]:
    p, f = np.asarray(pred, float), np.asarray(fit, int)
    if len(p) < 3 or np.ptp(p) == 0:
        return {"n": int(len(p)), "Spearman_vs_fit": None}
    rho, pv = spearmanr(p, f)
    means = {k: float(p[f == v].mean()) for k, v in FIT_RANK.items() if (f == v).any()}
    return {"n": int(len(p)), "Spearman_vs_fit": float(rho), "p_value": float(pv), "mean_score_by_fit": means}


def skill_prf(pred: list[list[str]], ref: list[list[str]]) -> dict[str, float]:
    tp = fp = fn = 0
    for ps, rs in zip(pred, ref):
        a, b = {s.lower() for s in ps}, {s.lower() for s in rs}
        tp, fp, fn = tp + len(a & b), fp + len(a - b), fn + len(b - a)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": prec, "recall": rec, "F1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0,
            "tp": tp, "fp": fp, "fn": fn}


# ------------------------------------------------------ deterministic systems
def deterministic_predictions(records: list[dict[str, Any]],
                              train_means: dict[str, float] | None = None) -> dict[str, list[dict[str, Any]]]:
    """Deterministic systems. They carry NO matchedSkills: their skill lists are
    the reference the skill metrics are computed against, so scoring them would
    be circular (a guaranteed, meaningless F1 of 1.0)."""
    from app.services.ats import keyword_match

    prod, heur, const = [], [], []
    for r in records:
        sig = analyse_resume(r["resume"])
        if train_means:
            # Trivial floor: predict the training mean. Any model's MAE is read against this.
            const.append({"id": r["id"], "atsScore": train_means[r["mode"]]})
        if r["mode"] == "GENERAL_ATS":
            prod.append({"id": r["id"], "atsScore": sig["ats"]["atsScore"]})
            heur.append({"id": r["id"], "atsScore": None})       # identical to the teacher: excluded
        else:
            _, meta = job_match_components(sig, r["job_description"], fit_label=None)
            jd_sk = meta["jd_skills"]
            cov = keyword_match(sig["parsed"], r["resume"], jd_sk)["keywordCoverage"] if jd_sk else None
            prod.append({"id": r["id"], "atsScore": cov})
            heur.append({"id": r["id"], "atsScore": meta["heuristic_score"]})
    systems = {"deterministic_production": prod, "deterministic_heuristic": heur}
    if train_means:
        systems = {"constant_train_mean": const, **systems}
    return systems


def llm_predictions(path: Path, records_by_id: dict[str, dict]) -> tuple[list[dict], dict[str, Any]]:
    """Raw generations are re-validated HERE, with the production validator,
    so JSON validity and hallucination are measured exactly as served."""
    preds, invalid, halluc, claimed = [], 0, 0, 0
    reasons: dict[str, int] = defaultdict(int)
    rows = load_jsonl(path)
    for row in rows:
        rec = records_by_id.get(row["id"])
        if rec is None:
            continue
        out = parse_and_validate(rec["mode"], row["raw_output"], rec["resume"], rec["job_description"])
        if not out.ok:
            invalid += 1
            reasons[(out.error or "invalid").split(":")[0]] += 1
            preds.append({"id": row["id"], "atsScore": None, "valid": False})
            continue
        h = out.grounding.get("hallucinated_matched", [])
        halluc += len(h)
        claimed += len(out.result.get("matchedSkills", [])) + len(h)
        preds.append({"id": row["id"], "atsScore": out.result["atsScore"], "valid": True,
                      "matchedSkills": out.result.get("matchedSkills", []),
                      "components": out.result["componentScores"]})
    n = len(preds)
    return preds, {"n": n, "json_validity_rate": (n - invalid) / n if n else None,
                   "invalid_reasons": dict(reasons),
                   "hallucinated_skill_claims": halluc,
                   "hallucination_rate": halluc / claimed if claimed else 0.0}


# ------------------------------------------------------------------- report
def evaluate(records: list[dict[str, Any]], systems: dict[str, list[dict]],
             llm_meta: dict[str, dict], human: dict[str, float]) -> dict[str, Any]:
    by_id = {r["id"]: r for r in records}
    report: dict[str, Any] = {"n_test": len(records), "systems": {}}
    for name, preds in systems.items():
        sysrep: dict[str, Any] = {}
        for mode in ("GENERAL_ATS", "JOB_MATCH_ATS"):
            rows = [(p, by_id[p["id"]]) for p in preds if by_id[p["id"]]["mode"] == mode]
            ok = [(p, r) for p, r in rows if p.get("atsScore") is not None and math.isfinite(p["atsScore"])]
            m: dict[str, Any] = {"n_scored": len(ok), "n_total": len(rows)}
            if ok and not (name == "deterministic_heuristic" and mode == "GENERAL_ATS"):
                m["teacher_fidelity"] = regression([p["atsScore"] for p, _ in ok],
                                                   [r["target"]["atsScore"] for _, r in ok])
            else:
                m["teacher_fidelity"] = "N/A (this system IS the weak-label teacher; comparison is circular)"
            if mode == "JOB_MATCH_ATS":
                fit = [(p["atsScore"], FIT_RANK[r["fit_label"]]) for p, r in ok if r.get("fit_label") in FIT_RANK]
                m["external_validity"] = ordinal([a for a, _ in fit], [b for _, b in fit]) if fit else None
                sk = [(p["matchedSkills"], r["target"]["matchedSkills"]) for p, r in ok if "matchedSkills" in p]
                m["skill_match_vs_deterministic_reference"] = (
                    skill_prf([a for a, _ in sk], [b for _, b in sk]) if sk else None)
            hs = [(p["atsScore"], human[p["id"]]) for p, _ in ok if p["id"] in human]
            m["human_agreement"] = regression(*zip(*hs)) if len(hs) >= 3 else \
                "NOT AVAILABLE — no human_ats_score has been entered in human_review.csv"
            sysrep[mode] = m
        if name in llm_meta:
            sysrep["structured_output"] = llm_meta[name]
        report["systems"][name] = sysrep
    return report


def table(report: dict[str, Any]) -> str:
    """The §17 table. A blank cell means not measured — never zero."""
    def f(x, pct=False):
        if x is None or isinstance(x, str):
            return "—"
        return f"{100 * x:.1f}%" if pct else f"{x:.3f}" if abs(x) < 10 else f"{x:.2f}"

    lines = ["| Model | Mode | MAE | RMSE | Pearson | Spearman | Spearman vs fit label | JSON Validity | Skill F1 | Hallucination |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for name, s in report["systems"].items():
        so = s.get("structured_output", {})
        for mode in ("GENERAL_ATS", "JOB_MATCH_ATS"):
            m = s[mode]
            tf = m["teacher_fidelity"] if isinstance(m["teacher_fidelity"], dict) else {}
            ev = m.get("external_validity") or {}
            sk = m.get("skill_match_vs_deterministic_reference") or {}
            lines.append(f"| {name} | {mode} | {f(tf.get('MAE'))} | {f(tf.get('RMSE'))} | {f(tf.get('Pearson'))} | "
                         f"{f(tf.get('Spearman'))} | {f(ev.get('Spearman_vs_fit'))} | "
                         f"{f(so.get('json_validity_rate'), True) if so else 'n/a (deterministic)'} | "
                         f"{f(sk.get('F1'))} | {f(so.get('hallucination_rate'), True) if so else 'n/a'} |")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test")
    ap.add_argument("--pred", action="append", default=[], help="name=path/to/predictions.jsonl")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    records = load_jsonl(ROOT / "dataset" / f"ats_{args.split}.jsonl")
    if args.limit:
        records = records[: args.limit]
    by_id = {r["id"]: r for r in records}

    human: dict[str, float] = {}
    hr = ROOT / "dataset" / "human_review.csv"
    if hr.exists():
        import csv
        for row in csv.DictReader(open(hr, encoding="utf-8")):
            if row.get("human_ats_score", "").strip():
                human[row["review_id"]] = float(row["human_ats_score"])

    print(f"evaluating {len(records)} {args.split} records | human labels available: {len(human)}")
    train = load_jsonl(ROOT / "dataset" / "ats_train.jsonl")
    train_means = {m: float(np.mean([r["target"]["atsScore"] for r in train if r["mode"] == m]))
                   for m in ("GENERAL_ATS", "JOB_MATCH_ATS")}
    systems = deterministic_predictions(records, train_means)
    llm_meta = {}
    for spec in args.pred:
        name, path = spec.split("=", 1)
        systems[name], llm_meta[name] = llm_predictions(Path(path), by_id)

    report = evaluate(records, systems, llm_meta, human)
    (ROOT / "evaluation").mkdir(exist_ok=True)
    json.dump(report, open(ROOT / "evaluation" / "metrics.json", "w"), indent=2)
    md = table(report)
    (ROOT / "evaluation" / "metrics_table.md").write_text(md, encoding="utf-8")
    print("\n" + md)
    print("\nfull report -> evaluation/metrics.json")


if __name__ == "__main__":
    main()
