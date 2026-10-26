"""Train and evaluate the CareerPilot skill recommender. CPU only, about a minute.

    python careerpilot_skills/train_skill_recommender.py

TASK
    Given the skills a person already has, rank the skills they are most likely
    missing ("next skill" prediction). The career roadmap uses the ranking to
    suggest what to learn next.

DATA — real, and deliberately not the obvious choice
    Skill sets ("baskets") are extracted with CareerPilot's skill taxonomy from
    the real job descriptions and resumes in the two job-fit datasets.

    The 4,817 structured resumes in datasetmaster/resumes were tested and
    REJECTED: beyond the one skill implied by the job title, their skills are
    statistically independent of each other (Django-Python lift 1.06, Java-Spring
    1.02, where 1.00 means "unrelated"). They were generated at random, so a
    model trained on them would learn noise. In the data used here the same
    pairs have lift 4.3 and 2.5, and Docker-Kubernetes 12.

METHOD
    Three models, all fitted on the training baskets only:
      popularity   recommend the most common skills (the baseline to beat)
      itemknn      item-item cosine similarity on co-occurrence, with shrinkage
      ppmi_svd     skill embeddings from a truncated SVD of the PPMI matrix
    Hyperparameters are chosen on the validation baskets. The test baskets are
    used once, for the reported numbers.

EVALUATION — leave one out
    For every test basket and every skill in it: hide that skill, rank all
    skills the basket does not contain, and record where the hidden skill
    lands. Reported: Recall@k and MRR, with a paired bootstrap confidence
    interval for the gain over the popularity baseline.

LEAKAGE CONTROL
    Source texts are clustered as near-duplicates and split by cluster, and any
    validation/test basket identical to a training basket is removed.
"""
from __future__ import annotations

import glob
import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(REPO / "careerpilot_ats"), str(REPO / "ai-service")]

import ats_pipeline  # noqa: E402,F401
from app.ml.skill_recommender import ARTIFACT_NAME, MODEL_VERSION, SkillRecommender  # noqa: E402
from app.nlp.skills_taxonomy import extract_skills  # noqa: E402
from ats_pipeline.build_dataset import near_dup_clusters  # noqa: E402
from ats_pipeline.normalize import clean_text, normalise_resume  # noqa: E402

RAW = REPO / "careerpilot_ats" / "raw"
OUT = REPO / "ai-service" / "artifacts"
REPORT = Path(__file__).resolve().parent / "skill_recommender_report.json"
SEED = 42
MIN_BASKET = 3          # a basket needs at least this many skills
MIN_SKILL_TRAIN = 5     # a skill must appear in this many training baskets to be recommendable
KS = (1, 3, 5, 10)


# ------------------------------------------------------------------- data
def load_baskets() -> list[dict]:
    med = pd.concat([pd.read_parquet(p) for p in sorted(glob.glob(str(RAW / "med2425__resume-job-fit-merged-v1/data/*.parquet")))])
    nbk = pd.concat([pd.read_csv(RAW / f"0xnbk__resume-ats-score-v1-en/{s}.csv") for s in ("train", "validation")])
    parts = nbk.text.str.split(r"\sSEP\s", n=1, regex=True)
    docs = [("jd", clean_text(t)) for t in sorted(set(med.jd) | set(parts.str[1]))]
    docs += [("resume", normalise_resume(clean_text(t))) for t in sorted(set(med.resume) | set(parts.str[0]))]

    clusters = near_dup_clusters([text for _, text in docs])
    out = []
    for (kind, text), cluster in zip(docs, clusters):
        skills = frozenset(s.name for s in extract_skills(text))
        if len(skills) >= MIN_BASKET:
            out.append({"kind": kind, "cluster": int(cluster), "skills": skills})
    return out


def split(baskets: list[dict]) -> dict[str, list[dict]]:
    clusters = sorted({b["cluster"] for b in baskets})
    random.Random(SEED).shuffle(clusters)
    n = len(clusters)
    where = {c: ("train" if i < 0.70 * n else "validation" if i < 0.85 * n else "test") for i, c in enumerate(clusters)}
    parts: dict[str, list[dict]] = {"train": [], "validation": [], "test": []}
    seen: dict[str, set] = {k: set() for k in parts}
    for b in baskets:
        s = where[b["cluster"]]
        if b["skills"] not in seen[s]:                  # one copy of each distinct basket per split
            seen[s].add(b["skills"])
            parts[s].append(b)
    for s in ("validation", "test"):                    # no basket shared with training
        parts[s] = [b for b in parts[s] if b["skills"] not in seen["train"]]
    parts["test"] = [b for b in parts["test"] if b["skills"] not in seen["validation"]]
    return parts


# ------------------------------------------------------------- evaluation
def ranks(model: SkillRecommender, baskets: list[dict]) -> list[tuple[int, int]]:
    """(basket index, 1-based rank of the hidden skill) for every hideable skill."""
    out = []
    for i, b in enumerate(baskets):
        known = [s for s in b["skills"] if s in model.index]
        if len(known) < 2:
            continue
        for hidden in known:
            owned = [s for s in known if s != hidden]
            scores = model.score(owned)
            scores[[model.index[s] for s in owned]] = -np.inf
            rank = int((scores > scores[model.index[hidden]]).sum()) + 1
            out.append((i, rank))
    return out


def metrics(rank_list: list[tuple[int, int]]) -> dict:
    r = np.array([x for _, x in rank_list], dtype=float)
    if not len(r):
        return {"n": 0}
    return {"n": int(len(r)), "MRR": float((1 / r).mean()), **{f"Recall@{k}": float((r <= k).mean()) for k in KS}}


def paired_bootstrap(a: list[tuple[int, int]], b: list[tuple[int, int]], k: int = 5, rounds: int = 2000) -> dict:
    """95% CI for Recall@k(a) - Recall@k(b), resampling BASKETS (hidden skills
    from one basket are not independent, so they are resampled together)."""
    rng = np.random.default_rng(SEED)
    ids = sorted({i for i, _ in a})
    hit_a = {i: [] for i in ids}
    hit_b = {i: [] for i in ids}
    for i, r in a:
        hit_a[i].append(r <= k)
    for i, r in b:
        hit_b[i].append(r <= k)
    sa = np.array([sum(hit_a[i]) for i in ids]); sb = np.array([sum(hit_b[i]) for i in ids])
    n = np.array([len(hit_a[i]) for i in ids])
    diffs = []
    for _ in range(rounds):
        pick = rng.integers(0, len(ids), len(ids))
        diffs.append((sa[pick].sum() - sb[pick].sum()) / n[pick].sum())
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {"metric": f"Recall@{k} difference", "point": float((sa.sum() - sb.sum()) / n.sum()),
            "ci95": [float(lo), float(hi)], "baskets": len(ids), "rounds": rounds}


# ------------------------------------------------------------------- main
def main() -> None:
    t0 = time.time()
    baskets = load_baskets()
    parts = split(baskets)
    train = [b["skills"] for b in parts["train"]]
    counts = Counter(s for b in train for s in b)
    vocab = sorted(s for s, c in counts.items() if c >= MIN_SKILL_TRAIN)
    print(f"baskets: {len(baskets)} from near-dup-clustered texts -> "
          + " | ".join(f"{k} {len(v)}" for k, v in parts.items()))
    print(f"vocabulary: {len(vocab)} skills (in >= {MIN_SKILL_TRAIN} training baskets) of {len(counts)} seen")
    jd_train = [b["skills"] for b in parts["train"] if b["kind"] == "jd"]

    def fit(kind: str, **hp) -> SkillRecommender:
        return SkillRecommender.fit(train, vocab, kind=kind, jd_baskets=jd_train, **hp)

    # ---- model selection on validation ---------------------------------
    grid = [("popularity", {})]
    grid += [("itemknn", {"shrinkage": s, "popularity_penalty": a})
             for s in (0, 2, 5, 10) for a in (0.0, 0.25, 0.5, 0.75)]
    grid += [("ppmi_svd", {"dim": d}) for d in (8, 16, 24, 32)]
    selection = []
    for kind, hp in grid:
        m = metrics(ranks(fit(kind, **hp), parts["validation"]))
        selection.append({"model": kind, "hyperparameters": hp, **m})
        print(f"  val  {kind:<11}{str(hp):<20} MRR {m['MRR']:.3f}  R@5 {m['Recall@5']:.3f}")
    best = {}
    for row in selection:
        if row["model"] not in best or row["MRR"] > best[row["model"]]["MRR"]:
            best[row["model"]] = row
    winner = max((r for r in best.values() if r["model"] != "popularity"), key=lambda r: r["MRR"])

    # ---- one test evaluation per model family --------------------------
    test_rows, test_ranks = [], {}
    for kind, row in best.items():
        model = fit(kind, **row["hyperparameters"])
        test_ranks[kind] = ranks(model, parts["test"])
        by_kind = {k: metrics(ranks(model, [b for b in parts["test"] if b["kind"] == k])) for k in ("jd", "resume")}
        test_rows.append({"model": kind, "hyperparameters": row["hyperparameters"],
                          **metrics(test_ranks[kind]), "by_source": by_kind})
    boot = paired_bootstrap(test_ranks[winner["model"]], test_ranks["popularity"])

    print("\nTEST (used once)")
    print("| Model | Hyperparameters | n | MRR | Recall@1 | Recall@3 | Recall@5 | Recall@10 |")
    print("|---|---|---|---|---|---|---|---|")
    for r in test_rows:
        print(f"| {r['model']} | {r['hyperparameters'] or '-'} | {r['n']} | {r['MRR']:.3f} | {r['Recall@1']:.3f} | "
              f"{r['Recall@3']:.3f} | {r['Recall@5']:.3f} | {r['Recall@10']:.3f} |")
    print(f"\n{winner['model']} vs popularity, Recall@5 gain: {boot['point']:+.3f} "
          f"(95% CI {boot['ci95'][0]:+.3f} to {boot['ci95'][1]:+.3f}, paired bootstrap over {boot['baskets']} baskets)")
    random_r5 = 5 / (len(vocab) - 1)
    print(f"random guessing would give Recall@5 of about {random_r5:.3f}")

    # ---- save exactly the model that was evaluated ----------------------
    final = fit(winner["model"], **winner["hyperparameters"])
    report = {
        "modelVersion": MODEL_VERSION, "trainedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "task": "next-skill prediction (leave-one-out)", "selected": winner["model"],
        "hyperparameters": winner["hyperparameters"],
        "data": {"provenance": "REAL", "sources": ["med2425/resume-job-fit-merged-v1 (licence not declared)",
                                                    "0xnbk/resume-ats-score-v1-en (Apache-2.0)"],
                 "rejectedSource": "datasetmaster/resumes: skills are statistically independent (synthetic)",
                 "baskets": {k: len(v) for k, v in parts.items()},
                 "bySource": {k: dict(Counter(b["kind"] for b in v)) for k, v in parts.items()},
                 "vocabulary": len(vocab), "minBasket": MIN_BASKET, "minSkillTrain": MIN_SKILL_TRAIN},
        "validationSelection": selection, "test": test_rows, "gainOverPopularity": boot,
        "randomRecallAt5": random_r5, "seed": SEED,
        "note": "The saved model is the one evaluated on the test split (fitted on training baskets only).",
    }
    OUT.mkdir(parents=True, exist_ok=True)
    final.save(OUT / ARTIFACT_NAME, metrics={k: report[k] for k in ("modelVersion", "trainedAt", "selected",
                                                                     "hyperparameters", "data", "test",
                                                                     "gainOverPopularity")})
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nsaved {OUT / ARTIFACT_NAME} and {REPORT.name} in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
