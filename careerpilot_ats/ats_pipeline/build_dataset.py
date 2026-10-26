"""Build the unified CareerPilot ATS dataset (§4-§15). CPU only.

    python -m ats_pipeline.build_dataset            (run from careerpilot_ats/, ai-service on sys.path)

Order of operations matters, and two orderings are deliberate:
  * truncate BEFORE labelling: labels are computed on exactly the text the
    model will see, so no target can cite content the model was never shown
    (labelling the full text and training on a truncated one teaches
    hallucination directly);
  * dedupe BEFORE splitting, and split by near-duplicate CLUSTER, so the same
    resume can never sit in two splits.
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import random
import re
import sys
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]           # careerpilot_ats/
sys.path.insert(0, str(ROOT.parent / "ai-service"))  # the deterministic ATS engine

from ats_pipeline.labels import FIT_LABEL_LAMBDA, LABEL_VERSION, general_target, job_match_target  # noqa: E402
from ats_pipeline.normalize import clean_text, normalise_jd, normalise_resume  # noqa: E402
from ats_pipeline.prompts import chat_messages  # noqa: E402
from ats_pipeline.schemas import SCHEMAS  # noqa: E402
from ats_pipeline.scoring import GENERAL_WEIGHTS, JOB_MATCH_WEIGHTS, final_score  # noqa: E402

RAW, OUT, CFG = ROOT / "raw", ROOT / "dataset", ROOT / "config"
SEED = 42
DATASET_VERSION = "cp-ats-data-v1"

CONFIG = {
    "max_seq_len": 3072,          # T4-safe; see README §Context length
    "target_token_reserve": 700,  # generous ceiling for the assistant JSON
    "jd_token_cap": 700,
    # Examples per mode per split (~70/15/15 plus an isolated human-review set).
    "targets": {"train": 1225, "validation": 263, "test": 263, "human_review": 250},
    # Share of resume clusters per split. Generous for eval splits so each can
    # still meet its target after the JD hold-out constraint below.
    "cluster_split": {"train": 0.55, "validation": 0.15, "test": 0.15, "human_review": 0.15},
    # JD clusters reserved for evaluation: a test JOB_MATCH example never uses a
    # job description the model saw in training.
    "jd_eval_fraction": 0.35,
    "oversample": 1.06,           # absorbs the contradiction filter's ~3% drop
    "pairs_per_resume_cap": 3,    # stops one resume dominating JOB_MATCH
    "min_resume_words": 60, "min_jd_words": 30, "max_resume_chars": 25000, "min_alpha_ratio": 0.60,
    "near_dup_jaccard": 0.80,
}

SOURCES = {
    "datasetmaster/resumes": {"license": "MIT", "use": "GENERAL_ATS (rendered from structured JSON)"},
    "0xnbk/resume-ats-score-v1-en": {"license": "Apache-2.0", "use": "JOB_MATCH_ATS + GENERAL_ATS resumes",
                                     "note": "numeric ats_score DISCARDED: = class band + noise (see README)"},
    "med2425/resume-job-fit-merged-v1": {"license": "NOT DECLARED on the dataset card",
                                         "use": "JOB_MATCH_ATS + GENERAL_ATS resumes",
                                         "note": "labels are 100% source=generated_smart (synthetic)"},
}

# ------------------------------------------------------------------ PII scrub
_PLACEHOLDER = {None, "", "unknown", "not provided", "n/a", "na", "none", "null"}
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_URL = re.compile(r"\b(?:https?://)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com)/[^\s,;)]+", re.I)
_PHONE_CAND = re.compile(r"(?<![\w-])\+?\(?\d[\d\s().-]{8,}\d(?![\w-])")
_YEARS = re.compile(r"^\s*(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}\s*$")


def _is_phone(s: str) -> bool:
    digits = sum(c.isdigit() for c in s)
    return 10 <= digits <= 15 and not _YEARS.match(s)


def scrub_pii(text: str) -> str:
    """Redact contact identifiers with format-preserving placeholders.

    Placeholders (not deletion) keep the ATS-relevant fact that contact details
    exist, without carrying anyone's identity into the dataset or the model.
    The digit-count guard stops date ranges ("2019 - 2021") being eaten.
    """
    text = _EMAIL.sub("candidate@example.com", text)
    text = _URL.sub(lambda m: "linkedin.com/in/candidate" if "linkedin" in m.group(0).lower()
                    else "github.com/candidate", text)
    return _PHONE_CAND.sub(lambda m: "+1-555-0100" if _is_phone(m.group(0)) else m.group(0), text)


def _real(v: Any) -> bool:
    return not (v is None or (isinstance(v, str) and v.strip().lower() in _PLACEHOLDER))


# -------------------------------------------------- structured resume renderer
def render_structured(r: dict[str, Any]) -> str:
    """datasetmaster JSON -> resume text. Source name/email/phone/links are
    NEVER rendered; placeholders mark only that contact details existed."""
    lines: list[str] = []
    pi = r.get("personal_info") or {}
    if any(_real(pi.get(k)) for k in ("email", "phone")):
        lines += ["Candidate", "candidate@example.com | +1-555-0100"]
    loc = pi.get("location") or {}
    if isinstance(loc, dict) and _real(loc.get("city")):
        lines.append(", ".join(x for x in (loc.get("city"), loc.get("country")) if _real(x)))
    if _real(pi.get("summary")):
        lines += ["", "Summary", str(pi["summary"])]

    exp = [e for e in (r.get("experience") or []) if isinstance(e, dict) and _real(e.get("title"))]
    if exp:
        lines += ["", "Experience"]
        for e in exp:
            d = e.get("dates") or {}
            span = " - ".join(x for x in (d.get("start"), d.get("end")) if _real(x))
            company = e.get("company") if _real(e.get("company")) else ""
            lines.append(" | ".join(x for x in (e["title"], company, span) if x))
            resp = e.get("responsibilities") or []
            for item in (resp if isinstance(resp, list) else [resp]):
                if _real(item):
                    lines.append(f"- {item}")
            tech = ((e.get("technical_environment") or {}).get("technologies")) or []
            tech = [t for t in tech if _real(t)]
            if tech:
                lines.append("Technologies: " + ", ".join(map(str, tech)))

    proj = [p for p in (r.get("projects") or []) if isinstance(p, dict) and _real(p.get("name"))]
    if proj:
        lines += ["", "Projects"]
        for p in proj:
            lines.append(str(p["name"]))
            if _real(p.get("description")):
                lines.append(f"- {p['description']}")
            if _real(p.get("impact")):
                lines.append(f"- {p['impact']}")
            tech = [t for t in (p.get("technologies") or []) if _real(t)]
            if tech:
                lines.append("Technologies: " + ", ".join(map(str, tech)))

    edu = [e for e in (r.get("education") or []) if isinstance(e, dict)]
    edu_lines = []
    for e in edu:
        deg, inst = e.get("degree") or {}, e.get("institution") or {}
        parts = [x for x in (deg.get("level"), deg.get("field"), inst.get("name")) if _real(x)]
        dates = e.get("dates") or {}
        grad = dates.get("expected_graduation") or dates.get("end")
        if parts:
            edu_lines.append(", ".join(map(str, parts)) + (f" ({grad})" if _real(grad) else ""))
        gpa = (e.get("achievements") or {}).get("gpa")
        if _real(gpa):
            edu_lines.append(f"GPA: {gpa}")
    if edu_lines:
        lines += ["", "Education", *edu_lines]

    tech = ((r.get("skills") or {}).get("technical")) or {}
    names = [s.get("name") for group in tech.values() if isinstance(group, list)
             for s in group if isinstance(s, dict) and _real(s.get("name"))]
    if names:
        lines += ["", "Skills", ", ".join(dict.fromkeys(map(str, names)))]

    certs = r.get("certifications")
    if isinstance(certs, list):
        cl = [c.get("name") if isinstance(c, dict) else c for c in certs]
        cl = [c for c in cl if _real(c)]
        if cl:
            lines += ["", "Certifications", *map(str, cl)]
    return scrub_pii("\n".join(lines).strip())


# -------------------------------------------------------------- source loaders
def load_sources() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (resume_pool, pair_pool). Every record keeps its source."""
    resumes, pairs = [], []

    for line in open(RAW / "datasetmaster__resumes/master_resumes.jsonl", encoding="utf-8"):
        resumes.append({"source": "datasetmaster/resumes", "resume": render_structured(json.loads(line))})

    x = pd.concat([pd.read_csv(RAW / f"0xnbk__resume-ats-score-v1-en/{s}.csv") for s in ("train", "validation")])
    # Published metadata says "[SEP]"; the files actually use a bare " SEP ".
    sp = x.text.str.split(r"\sSEP\s", n=1, regex=True)
    for r, jd, lab in zip(sp.str[0], sp.str[1], x.original_label):
        pairs.append({"source": "0xnbk/resume-ats-score-v1-en", "resume": r, "jd": jd, "fit_label": lab})

    med = RAW / "med2425__resume-job-fit-merged-v1/data"
    m = pd.concat([pd.read_parquet(p) for p in sorted(med.glob("*.parquet"))], ignore_index=True)
    for r, jd, lab in zip(m.resume, m.jd, m.label):
        pairs.append({"source": "med2425/resume-job-fit-merged-v1", "resume": r, "jd": jd, "fit_label": lab})

    pair_df = pd.DataFrame(pairs)
    # Raw-text resumes from the fit datasets also feed GENERAL_ATS: they are the
    # messy-extraction cases the structured renderer can never produce.
    for src, g in pair_df.groupby("source"):
        for r in g.resume.drop_duplicates():
            resumes.append({"source": src, "resume": r})
    return pd.DataFrame(resumes), pair_df


# ---------------------------------------------------------- quality filtering
@lru_cache(maxsize=None)
def _quality_reason(text: str, min_words: int) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return "empty"
    if len(text.split()) < min_words:
        return "too_short"
    if len(text) > CONFIG["max_resume_chars"]:
        return "too_long"
    visible = [c for c in text if not c.isspace()]
    if not visible or sum(c.isalpha() for c in visible) / len(visible) < CONFIG["min_alpha_ratio"]:
        return "unusable_text"
    return None


# ------------------------------------------------------------- deduplication
@lru_cache(maxsize=None)
def _prep_resume(text: str) -> str:
    return normalise_resume(scrub_pii(clean_text(text)))


@lru_cache(maxsize=None)
def _prep_jd(text: str) -> str:
    return normalise_jd(scrub_pii(text))


@lru_cache(maxsize=None)
def _norm_hash(text: str) -> str:
    return hashlib.sha256(" ".join(re.findall(r"[a-z0-9]+", text.lower())).encode()).hexdigest()


def near_dup_clusters(texts: list[str], perms: int = 64, bands: int = 16) -> list[int]:
    """MinHash + LSH over word 5-shingles; candidate pairs verified by exact
    Jaccard. Returns a cluster id per text (union-find)."""
    rng = np.random.default_rng(SEED)
    prime = (1 << 61) - 1
    a = rng.integers(1, prime, perms, dtype=np.uint64)
    b = rng.integers(0, prime, perms, dtype=np.uint64)
    shingles, sigs = [], np.full((len(texts), perms), np.iinfo(np.uint64).max, dtype=np.uint64)
    for i, t in enumerate(texts):
        w = re.findall(r"[a-z0-9]+", t.lower())
        # zlib.crc32, not hash(): Python salts str hashes per process, which made
        # near-duplicate clustering differ between runs on identical input.
        sh = {zlib.crc32(" ".join(w[j:j + 5]).encode()) for j in range(max(1, len(w) - 4))}
        shingles.append(sh)
        if sh:
            arr = np.fromiter(sh, dtype=np.uint64)
            sigs[i] = ((np.outer(arr, a) + b) % prime).min(axis=0)
    parent = list(range(len(texts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    rows = perms // bands
    for band in range(bands):
        buckets: dict[bytes, list[int]] = defaultdict(list)
        for i in range(len(texts)):
            buckets[sigs[i, band * rows:(band + 1) * rows].tobytes()].append(i)
        for idx in buckets.values():
            for j in idx[1:]:
                x, y = idx[0], j
                if find(x) == find(y):
                    continue
                s1, s2 = shingles[x], shingles[y]
                if s1 and s2 and len(s1 & s2) / len(s1 | s2) >= CONFIG["near_dup_jaccard"]:
                    parent[find(y)] = find(x)
    return [find(i) for i in range(len(texts))]


# -------------------------------------------------- token-aware truncation
_TOK = None


def _tok():
    global _TOK
    if _TOK is None:
        from transformers import AutoTokenizer
        _TOK = AutoTokenizer.from_pretrained(str(CFG / "tokenizer"))
    return _TOK


def ntokens(text: str) -> int:
    return len(_tok()(text, add_special_tokens=False)["input_ids"])


def truncate_tokens(text: str, budget: int) -> tuple[str, bool]:
    """Section-aware truncation that NEVER drops the beginning.

    Each section keeps its heading and the head of its body, trimmed in
    proportion to its size, with an explicit "[...]" marker, so the model is
    told content was cut rather than led to believe the text ended there.
    """
    if ntokens(text) <= budget:
        return text, False
    blocks = re.split(r"\n(?=[A-Z][A-Za-z &/]{2,40}\n)", text)
    sizes = [ntokens(b) for b in blocks]
    scale = (budget - 8 * len(blocks)) / max(1, sum(sizes))
    out = []
    for block, size in zip(blocks, sizes):
        keep = max(24, int(size * scale))
        if size <= keep:
            out.append(block)
            continue
        ids = _tok()(block, add_special_tokens=False)["input_ids"][:keep]
        out.append(_tok().decode(ids).rstrip() + " [...]")
    joined = "\n".join(out)
    while ntokens(joined) > budget:                   # rounding safety net
        joined = joined[: int(len(joined) * 0.95)].rstrip() + " [...]"
    return joined, True


# ------------------------------------------------------------- labelling job
def _label_one(rec: dict[str, Any]) -> dict[str, Any]:
    try:
        if rec["mode"] == "GENERAL_ATS":
            rec["target"] = general_target(rec["resume"])
            rec["weak_meta"] = {}
        else:
            target, meta = job_match_target(rec["resume"], rec["job_description"], rec.get("fit_label"))
            rec["target"] = target
            rec["weak_meta"] = {"heuristic_score": meta["heuristic_score"], "jd_skill_count": len(meta["jd_skills"])}
        SCHEMAS[rec["mode"]].model_validate(rec["target"])
        rec["label_error"] = None
    except Exception as exc:  # recorded, never silently dropped
        rec["target"], rec["label_error"] = None, f"{type(exc).__name__}: {exc}"
    return rec


# ------------------------------------------------------------- splitting
def assign_splits(resume_clusters: list[int], jd_clusters: list[int]) -> tuple[dict[int, str], dict[int, str]]:
    """Assign every resume cluster to one split, and every JD cluster to
    `train` or `eval`, BEFORE any example is sampled.

    Two constraints then hold by construction:
      * a resume (or its near-duplicate) appears in exactly one split, across
        both modes;
      * a JOB_MATCH example in validation/test/human_review never uses a job
        description (or its near-duplicate) that appears in training.
    """
    rng = random.Random(SEED)
    rc = sorted(set(resume_clusters))
    rng.shuffle(rc)
    shares = CONFIG["cluster_split"]
    bounds, acc = [], 0.0
    for name, share in shares.items():
        acc += share
        bounds.append((acc, name))
    resume_split = {}
    for i, c in enumerate(rc):
        pos = (i + 0.5) / len(rc)
        resume_split[c] = next(name for bound, name in bounds if pos <= bound + 1e-12)

    jc = sorted(set(jd_clusters))
    rng.shuffle(jc)
    n_eval = round(len(jc) * CONFIG["jd_eval_fraction"])
    jd_group = {c: ("eval" if i < n_eval else "train") for i, c in enumerate(jc)}
    return resume_split, jd_group


def _sample_job_match(cands: pd.DataFrame, n: int) -> pd.DataFrame:
    """Label-aware cap, then label-balanced sampling up to n.

    At most one pair per (resume, fit label): a naive head(3) keeps mostly
    "No Fit" (75% of the data) and starves the upper range, while one pair per
    label gives the same resume with JDs of different fit — a contrastive
    signal that fit depends on the job, not only on resume quality."""
    cands = cands.sample(frac=1, random_state=SEED)
    cands = cands.groupby(["cluster", "fit_label"], group_keys=False).head(1)
    cands = cands.groupby("cluster", group_keys=False).head(CONFIG["pairs_per_resume_cap"])
    per_label = n // 3
    picked = pd.concat([g.head(per_label) for _, g in cands.groupby("fit_label")])
    if len(picked) < n:
        picked = pd.concat([picked, cands.drop(picked.index).head(n - len(picked))])
    return picked


# ------------------------------------------------------------------ pipeline
def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> None:
    random.seed(SEED)
    OUT.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"dataset_version": DATASET_VERSION, "label_version": LABEL_VERSION,
                              "config": CONFIG, "sources": SOURCES, "created": time.strftime("%Y-%m-%d %H:%M:%S")}

    log("STEP 4-5  load sources")
    resumes, pairs = load_sources()
    report["loaded"] = {"resume_pool": int(len(resumes)), "pair_pool": int(len(pairs)),
                        "by_source": {k: int(v) for k, v in pairs.source.value_counts().items()}}
    log(f"  resume pool {len(resumes):,} | pair pool {len(pairs):,}")

    log("STEP 6-7  clean + normalise + PII scrub")
    # Memoised: ~1,900 unique texts repeat across ~100k pairs.
    resumes["resume"] = resumes.resume.map(_prep_resume)
    pairs["resume"] = pairs.resume.map(_prep_resume)
    pairs["jd"] = pairs.jd.map(_prep_jd)

    log("        quality filter")
    resumes["reject"] = resumes.resume.map(lambda t: _quality_reason(t, CONFIG["min_resume_words"]))
    pairs["reject"] = [
        _quality_reason(r, CONFIG["min_resume_words"]) or
        (("jd_" + (_quality_reason(j, CONFIG["min_jd_words"]) or "")) if _quality_reason(j, CONFIG["min_jd_words"]) else None) or
        ("resume_equals_jd" if _norm_hash(r) == _norm_hash(j) else None) or
        (None if l in ("No Fit", "Potential Fit", "Good Fit") else "bad_label")
        for r, j, l in zip(pairs.resume, pairs.jd, pairs.fit_label)
    ]
    report["rejected"] = {"resumes": {k: int(v) for k, v in resumes.reject.value_counts().items()},
                          "pairs": {k: int(v) for k, v in pairs.reject.value_counts().items()}}
    resumes, pairs = resumes[resumes.reject.isna()].copy(), pairs[pairs.reject.isna()].copy()
    log(f"  kept resumes {len(resumes):,} | pairs {len(pairs):,} | rejects {report['rejected']}")

    log("STEP 8  deduplicate (exact, then near-duplicate clusters)")
    all_resumes = pd.concat([resumes.resume, pairs.resume]).drop_duplicates().tolist()
    before = len(resumes) + len(pairs)
    resumes["rhash"] = resumes.resume.map(_norm_hash)
    pairs["rhash"] = pairs.resume.map(_norm_hash)
    pairs["phash"] = [_norm_hash(r + "\x1f" + j) for r, j in zip(pairs.resume, pairs.jd)]
    exact_r = int(resumes.rhash.duplicated().sum())
    exact_p = int(pairs.phash.duplicated().sum())
    resumes = resumes.drop_duplicates("rhash")
    pairs = pairs.drop_duplicates("phash")
    uniq = sorted(set(resumes.resume) | set(pairs.resume))
    t0 = time.time()
    cid = dict(zip([_norm_hash(u) for u in uniq], near_dup_clusters(uniq)))
    resumes["cluster"] = resumes.rhash.map(cid)
    pairs["cluster"] = pairs.rhash.map(cid)
    n_clusters = len(set(cid.values()))
    near = len(uniq) - n_clusters
    resumes = resumes.drop_duplicates("cluster")      # one GENERAL example per near-dup cluster
    report["dedup"] = {"exact_resume_dups": exact_r, "exact_pair_dups": exact_p,
                       "unique_resumes": len(uniq), "near_dup_clusters": n_clusters,
                       "resumes_merged_as_near_dups": near, "seconds": round(time.time() - t0, 1),
                       "input_records": before}
    log(f"  exact dups: resumes {exact_r:,}, pairs {exact_p:,} | unique resumes {len(uniq):,} "
        f"-> {n_clusters:,} clusters ({near:,} near-dups merged)")

    log("STEP 11 (first)  assign resume + JD clusters to splits, then sample each split")
    jd_uniq = sorted(set(pairs.jd))
    jd_cid = dict(zip(jd_uniq, near_dup_clusters(jd_uniq)))
    pairs["jd_cluster"] = pairs.jd.map(jd_cid)
    resume_split, jd_group = assign_splits(list(resumes.cluster) + list(pairs.cluster), list(jd_cid.values()))
    resumes["split"] = resumes.cluster.map(resume_split)
    pairs["split"] = pairs.cluster.map(resume_split)
    pairs["jd_group"] = pairs.jd_cluster.map(jd_group)
    # A pair is usable only where its resume's split and its JD's group agree.
    usable = pairs[(pairs.split == "train") == (pairs.jd_group == "train")]
    report["jd_holdout"] = {"unique_jds": len(jd_uniq), "jd_clusters": len(set(jd_cid.values())),
                            "eval_jd_clusters": sum(v == "eval" for v in jd_group.values()),
                            "pairs_usable": int(len(usable)), "pairs_excluded_by_constraint": int(len(pairs) - len(usable))}
    log(f"  JDs {len(jd_uniq):,} -> {report['jd_holdout']['jd_clusters']:,} clusters "
        f"({report['jd_holdout']['eval_jd_clusters']:,} held out for evaluation) | usable pairs {len(usable):,}")

    records, shortfall = [], {}
    for split, target in CONFIG["targets"].items():
        want = round(target * CONFIG["oversample"])
        gpool = resumes[resumes.split == split]
        gen = gpool.sample(n=min(want, len(gpool)), random_state=SEED)
        jm = _sample_job_match(usable[usable.split == split], want)
        for _, r in gen.iterrows():
            records.append({"mode": "GENERAL_ATS", "source": r.source, "cluster": int(r.cluster), "split": split,
                            "resume": r.resume, "job_description": "", "fit_label": None, "jd_cluster": None})
        for _, r in jm.iterrows():
            records.append({"mode": "JOB_MATCH_ATS", "source": r.source, "cluster": int(r.cluster), "split": split,
                            "resume": r.resume, "job_description": r.jd, "fit_label": r.fit_label,
                            "jd_cluster": int(r.jd_cluster)})
        if len(gen) < want or len(jm) < want:
            shortfall[split] = {"GENERAL_ATS": [len(gen), want], "JOB_MATCH_ATS": [len(jm), want]}
        log(f"  {split:<13} GENERAL {len(gen):>5} | JOB_MATCH {len(jm):>5} {jm.fit_label.value_counts().to_dict()}")
    report["sampling_shortfall"] = shortfall

    log("STEP 14 prep  token-aware truncation (BEFORE labelling)")
    system_tokens = ntokens(chat_messages("GENERAL_ATS", "", "")[0]["content"]) + 40
    budget = CONFIG["max_seq_len"] - CONFIG["target_token_reserve"] - system_tokens
    trunc = Counter()
    for rec in records:
        if rec["mode"] == "JOB_MATCH_ATS":
            rec["job_description"], tj = truncate_tokens(rec["job_description"], CONFIG["jd_token_cap"])
            trunc["jd"] += tj
            room = budget - ntokens(rec["job_description"])
        else:
            room = budget
        rec["resume"], tr = truncate_tokens(rec["resume"], room)
        trunc["resume"] += tr
    report["truncation"] = {"input_budget_tokens": budget, "resumes_truncated": trunc["resume"],
                            "jds_truncated": trunc["jd"]}
    log(f"  input budget {budget} tokens | truncated resumes {trunc['resume']}, JDs {trunc['jd']}")

    log("STEP 9  weak labels (parallel)")
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=max(1, (os.cpu_count() or 2) - 1)) as ex:
        records = list(ex.map(_label_one, records, chunksize=16))
    errors = [r for r in records if r["label_error"]]
    records = [r for r in records if not r["label_error"]]
    log(f"  labelled {len(records):,} in {time.time() - t0:.0f}s | label errors {len(errors)}")

    log("        contradiction filter (JOB_MATCH): evidence vs dataset label")
    dropped = Counter()
    kept = []
    for r in records:
        if r["mode"] == "JOB_MATCH_ATS" and r["weak_meta"].get("jd_skill_count", 0) >= 3:
            rs = r["target"]["componentScores"]["requiredSkillMatch"]
            if (r["fit_label"] == "Good Fit" and rs < 20) or (r["fit_label"] == "No Fit" and rs >= 90):
                dropped[r["source"]] += 1
                continue
        kept.append(r)
    records = kept
    report["labelling"] = {"errors": len(errors), "error_samples": [e["label_error"] for e in errors[:5]],
                           "contradictions_dropped": dict(dropped), "fit_label_lambda": FIT_LABEL_LAMBDA}
    log(f"  dropped contradictions: {dict(dropped)}")

    log("STEP 10-11  group into pre-assigned splits (resume- and JD-disjoint by construction)")
    splits: dict[str, list] = {"train": [], "validation": [], "test": [], "human_review": []}
    for r in records:
        splits[r["split"]].append(r)
    # Trim the oversampling margin back to each target, per mode.
    for split, recs in splits.items():
        kept, count = [], Counter()
        for r in recs:
            if count[r["mode"]] < CONFIG["targets"][split]:
                kept.append(r)
                count[r["mode"]] += 1
        splits[split] = kept

    # Leakage audit: must be zero by construction; verified, not assumed.
    leak = {}
    names = list(splits)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            ca = {r["cluster"] for r in splits[a]}
            cb = {r["cluster"] for r in splits[b]}
            pa = {_norm_hash(r["resume"] + r["job_description"]) for r in splits[a]}
            pb = {_norm_hash(r["resume"] + r["job_description"]) for r in splits[b]}
            ja = {r["jd_cluster"] for r in splits[a] if r["jd_cluster"] is not None}
            jb = {r["jd_cluster"] for r in splits[b] if r["jd_cluster"] is not None}
            shared_jd = len(ja & jb) if "train" in (a, b) else 0   # eval splits may share held-out JDs
            leak[f"{a}|{b}"] = {"shared_resume_clusters": len(ca & cb), "shared_pairs": len(pa & pb),
                                "shared_jd_clusters_with_train": shared_jd}
    jd_train = {_norm_hash(r["job_description"]) for r in splits["train"] if r["job_description"]}
    jd_test = [r for r in splits["test"] if r["job_description"]]
    report["leakage_audit"] = leak
    report["jd_reuse"] = {"test_jm_examples": len(jd_test),
                          "test_jm_whose_jd_seen_in_train": sum(_norm_hash(r["job_description"]) in jd_train for r in jd_test),
                          "note": "Resumes are cluster-disjoint. JD text can recur across splits (same posting, "
                                  "new applicant); reported so test metrics are read with that in mind."}
    bad = {k: v for k, v in leak.items() if any(v.values())}
    if bad:
        raise SystemExit(f"LEAKAGE DETECTED — refusing to write splits: {bad}")
    log(f"  leakage audit clean across {len(leak)} split pairs")

    log("STEP 12-13  chat format + validate every example")
    token_lens = defaultdict(list)
    for name, recs in splits.items():
        for r in recs:
            r["id"] = f"{r['mode'][:3].lower()}-{_norm_hash(r['resume'] + r['job_description'])[:12]}"
            r["messages"] = chat_messages(r["mode"], r["resume"], r["job_description"], r["target"])
            ids = _tok().apply_chat_template(r["messages"], tokenize=True)
            r["n_tokens"] = len(ids)
            token_lens[name].append(len(ids))
            assert r["n_tokens"] <= CONFIG["max_seq_len"], f"{r['id']} exceeds max_seq_len ({r['n_tokens']})"
            assert json.loads(r["messages"][-1]["content"]) == r["target"]      # JSON round-trips
            assert final_score(r["mode"], r["target"]["componentScores"]) == r["target"]["atsScore"]
    log("  all examples: <= max_seq_len, JSON round-trips, atsScore == Python aggregation")

    log("        write outputs")
    fields = ["id", "mode", "source", "split", "resume", "job_description", "fit_label", "target", "messages", "n_tokens"]
    for name in ("train", "validation", "test"):
        with open(OUT / f"ats_{name}.jsonl", "w", encoding="utf-8") as f:
            for r in splits[name]:
                f.write(json.dumps({k: r[k] for k in fields}, ensure_ascii=False) + "\n")
    with open(OUT / "human_review.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["review_id", "mode", "resume", "job_description", "weak_ats_score", "weak_label_json",
                    "human_ats_score", "human_correct", "review_notes"])
        for r in splits["human_review"]:
            # human_* columns are left EMPTY: no human label is ever fabricated.
            w.writerow([r["id"], r["mode"], r["resume"], r["job_description"], r["target"]["atsScore"],
                        json.dumps(r["target"], ensure_ascii=False), "", "", ""])
    with open(OUT / "careerpilot_human_review.csv", "w", encoding="utf-8", newline="") as f:
        f.write(open(OUT / "human_review.csv", encoding="utf-8").read())

    # ------------------------------------------------------ STEP 15 stats
    stats = {}
    for name, recs in splits.items():
        df = pd.DataFrame([{"mode": r["mode"], "score": r["target"]["atsScore"], "source": r["source"],
                            "rlen": len(r["resume"]), "jlen": len(r["job_description"]),
                            "fit": r["fit_label"]} for r in recs])
        stats[name] = {
            "n": len(df), "mode": df["mode"].value_counts().to_dict(),
            "source": df.source.value_counts().to_dict(),
            "score_by_mode": {m: {k: round(float(v), 2) for k, v in g.score.describe().items()}
                              for m, g in df.groupby("mode")},
            "avg_resume_chars": round(float(df.rlen.mean()), 0),
            "avg_jd_chars": round(float(df[df.jlen > 0].jlen.mean()), 0) if (df.jlen > 0).any() else 0,
            "fit_label": df.fit.dropna().value_counts().to_dict(),
            "tokens": {"mean": round(float(np.mean(token_lens[name])), 0), "p95": int(np.percentile(token_lens[name], 95)),
                       "max": int(max(token_lens[name]))},
        }
    report["splits"] = stats
    (CFG).mkdir(exist_ok=True)
    json.dump(report, open(ROOT / "logs" / "dataset_report.json", "w", encoding="utf-8"), indent=2, default=str)
    json.dump({"label_version": LABEL_VERSION, "fit_label_lambda": FIT_LABEL_LAMBDA,
               "general_weights": GENERAL_WEIGHTS, "job_match_weights": JOB_MATCH_WEIGHTS,
               "formulas": "see ats_pipeline/labels.py docstrings (general_components, job_match_components)",
               "labels_are": "WEAK LABELS - not ground truth"},
              open(CFG / "label_config.json", "w"), indent=2)
    log("\n" + json.dumps(stats, indent=1, default=str))
    log("\nDONE. dataset/ ats_train|validation|test.jsonl + human_review.csv ; logs/dataset_report.json")


if __name__ == "__main__":
    main()
