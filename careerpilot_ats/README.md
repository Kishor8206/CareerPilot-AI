# CareerPilot ATS — fine-tuning pipeline

**Model version:** `careerpilot-ats-qwen3-4b-v1` · **Dataset:** `cp-ats-data-v1` · **Labels:** `weak-v1` · **Evaluation:** `cp-ats-eval-v1`

One fine-tuned model, **Qwen/Qwen3-4B-Instruct-2507** with a QLoRA adapter, for two modes:

| Mode | Input | Output |
|---|---|---|
| `GENERAL_ATS` | resume | 8 component scores, strengths, weaknesses, recommendations, evidence |
| `JOB_MATCH_ATS` | resume + job description | 7 component scores, matched/missing skills, strengths, weaknesses, recommendations, evidence |

The model predicts **component scores and evidence only**. The final ATS score is always computed in Python
from fixed, published weights (§11); a score the model emits is discarded and recomputed.

> **Status, stated plainly.** Everything that runs on a CPU has been executed and verified here: dataset
> acquisition, inspection, cleaning, weak labelling, splitting, validation, the deterministic baselines, the
> inference/validation/fallback layer, and the CareerPilot integration. **Training and LLM evaluation need a
> GPU and have not been run yet** (the development machine has none). The notebook
> `notebooks/CareerPilot_ATS_FineTune.ipynb` runs them on a Colab T4. No LLM result appears in this README
> until it has been measured.

---

## 1. Architecture

```
Resume (PDF / DOCX / text)
   │
   ▼
Resume parser  ──────────────►  Deterministic ATS engine  (existing, unchanged; always runs)
   │                                   │  baseline · fallback · weak-label teacher · exact skill facts
   ▼                                   │
Fine-tuned ATS LLM  (optional)         │
   │  component scores + evidence      │
   ▼                                   │
Validation: JSON extraction → strict Pydantic schema → grounding guard
   │  (invalid → one constrained retry → still invalid → deterministic result)
   ▼                                   │
Deterministic score aggregation  ◄─────┘
   │  final = Σ component × weight   (Python, never the model)
   ▼
ResumeAnalyzeOutput  →  Node.js API  →  React frontend
```

**Division of labour:** *facts from deterministic extraction, judgement from the model, arithmetic from Python.*

- Matched/missing keywords and keyword coverage stay deterministic — they are exact facts.
- The model supplies component scores, strengths, weaknesses, recommendations and evidence.
- Every score is computed from fixed weights.

---

## 2. Datasets — what was verified, not assumed

All three candidate datasets were downloaded and inspected before use.

| Dataset | Licence | Records | What inspection found |
|---|---|---|---|
| `datasetmaster/resumes` | MIT | 4,817 structured JSON resumes | **Real-looking PII** (names, emails, phones, LinkedIn/GitHub) in ~4,600 records. Some records are internally inconsistent (e.g. a "final-year student" who was "Project Manager 2013–2024"), suggesting partly synthetic or merged data. |
| `0xnbk/resume-ats-score-v1-en` | Apache-2.0 | 6,374 resume–JD pairs | Metadata says the separator is `[SEP]`; **no row contains it** — the files use a bare ` SEP `. The numeric `ats_score` is **not usable** (see below). |
| `med2425/resume-job-fit-merged-v1` | **Not declared** on the dataset card | 93,733 pairs | `source` is `generated_smart` for **100%** of rows: every label is synthetic. Only 641 unique resumes and ~280 unique JDs. |

### Why `0xnbk`'s `ats_score` was discarded

The three fit classes occupy **disjoint** score bands with near-identical spread, and within a class the score
correlates with nothing in the text:

| Fit label | Score range | Std | Within-class ρ with token overlap / length |
|---|---|---|---|
| No Fit | 19.16 – 30.26 | 2.87 | −0.001 / −0.003 |
| Potential Fit | 50.00 – 60.36 | 2.93 | |
| Good Fit | 78.66 – 90.05 | 2.87 | |

This is `score = class band + noise`. It carries **no information beyond the 3-class label**, so only the label
is used.

### The two fit datasets overlap heavily

After section restoration (below), **626 of 0xnbk's 680 unique resumes (92%) also appear in med2425**. Both
descend from the same LiveCareer resume corpus. They are *not* two independent sources: the unique job-match
resume pool is roughly 700 resumes. This does not cause leakage — splitting is by near-duplicate cluster across
both sources — but it limits diversity, and it is listed under limitations.

### The corpus had lost its line structure

Resumes and JDs in both fit datasets contain **zero newlines** (0xnbk) or only a few, with section headings
glued to the next word: `SummaryI am seeking…`, `Highlights17 years…`. CareerPilot's parser detects sections
line by line, so on the raw text it found only a `header` section in every resume.

`restore_sections()` puts a heading back on its own line **only when it is fused to a following capital or
digit**, so correctly formatted resumes are untouched. Measured on 60 resumes: sections detected 1.00 → 3.43;
resumes with ≥3 sections 0/60 → 55/60. No word is removed.

*A bug found and fixed on the way:* an earlier version skipped any text with ≥3 newlines. med2425 has a few
newlines **and** glued headings, so 96% of it went unrestored, collapsing its `structure` label to 0 and
starving `projectRelevance`. Fixing it raised `projectRelevance` validity from ρ = +0.18 to +0.26.

---

## 3. Data pipeline (`ats_pipeline/build_dataset.py`)

| Step | What it does | Result on this run |
|---|---|---|
| Load | 4,817 structured + 100,107 pair records | 105,394 records |
| Clean | NFKC, control characters, repeated punctuation, whitespace | — |
| **PII scrub** | Emails, phones, LinkedIn/GitHub → format-preserving placeholders; source names never rendered. A digit-count guard stops date ranges (`2019 – 2021`) being eaten. | 0 leaked identifiers in a test on a record with real PII |
| Quality filter | too short (<60 words), too long, low alphabetic ratio, JD <30 words | 35 resumes, 916 pairs rejected |
| Exact dedup | normalised-token SHA-256 | 740 resume and 148 pair duplicates |
| **Near-dup clustering** | MinHash (64 perms) + LSH (16 bands), verified by exact Jaccard ≥ 0.8. Uses `zlib.crc32`, not Python's per-process-salted `hash()`, so it is reproducible (verified identical across 3 processes). | 6,063 unique resumes → **5,346 clusters**; 659 JDs → **382 clusters** |
| **Split first** | Resume clusters → train/val/test/human-review; **JD clusters → train or held-out**. A pair is usable only when both agree. | 50,997 usable pairs |
| Sample | Label-aware cap: ≤1 pair per (resume, fit label), then label-balanced | see §5 |
| **Truncate** | Section-aware, never drops the beginning, marks cuts with `[...]` | 209 resumes, 469 JDs truncated |
| **Label** | Weak labels computed on the **truncated** text | 0 errors |
| Contradiction filter | drop "Good Fit" with <20% skill coverage, or "No Fit" with ≥90% (≥3 JD skills) | 56 (0xnbk), 37 (med2425) dropped |
| Validate every example | ≤ max length · JSON round-trips · `atsScore` == Python aggregation | all pass |
| **Leakage audit** | resume clusters, exact pairs, JD clusters vs train — across all 6 split pairs | **0 / 0 / 0**; refuses to write otherwise |

Three orderings are deliberate, and each is a defensible answer to a likely question:

1. **Truncate before labelling.** Labelling the full resume and training on a truncated one would teach the model
   to cite skills it cannot see — training hallucination directly.
2. **Assign splits before sampling, by cluster.** An earlier version split each mode separately; the audit caught
   the same resume in train (as GENERAL) and test (inside a JOB_MATCH pair) and refused to write.
3. **Hold out JDs, not just resumes.** Before this, **201 of 217** test JOB_MATCH examples used a job description
   seen in training. Now it is **0 of 222**. The research question is about job-specific matching, so the test
   set must contain jobs the model has never seen.

---

## 4. Weak labels (`ats_pipeline/labels.py`)

**These are weak labels, not ground truth.** Every component is a documented, deterministic function built on
CareerPilot's existing engine: its criterion scores (`engine[X]`, as 0–100) and its own primitives
(`QUANTIFIER_RE`, `ACTION_VERBS`, `WEAK_PHRASES`, `extract_skills`, `keyword_match`). **No label is produced by an LLM.**

### GENERAL_ATS

| Component | Weight | Formula |
|---|---|---|
| structure | 0.15 | 0.5·engine[Section Structure] + 0.5·min(100, coreSectionsPresent/4·100) |
| sectionCompleteness | 0.10 | mean(engine[Contact], hasEducation, hasSkills, hasExperienceOrProjects) |
| skills | 0.15 | 0.6·engine[Skills Coverage] + 0.4·min(100, distinctSkills/12·100) |
| experience | 0.15 | 0.5·engine[Experience Evidence] + 0.5·min(100, months/36·60 + 40·[section ≥ 40 words]) |
| projects | 0.15 | section: min(100, 40 + 15·distinctSkillsInProjects); else 25 if experience mentions projects; else 0 |
| achievements | 0.10 | 0.5·engine[Quantified Impact] + 0.5·min(100, quantifiedPhrases/5·100) + 15·[achievements section] |
| keywords | 0.10 | 0.5·engine[Action Verbs] + 0.5·min(100, actionVerbs/10·100) − 5·weakPhrases |
| formatting | 0.10 | mean(engine[Formatting Hygiene], engine[Length Appropriateness]) |

The engine is blended with section-text evidence because its item extractors return empty lists on this corpus
even after restoration (entries within a section remain run together). Blending corrects that known artefact
without editing the production parser.

### JOB_MATCH_ATS

| Component | Weight | Formula |
|---|---|---|
| requiredSkillMatch | 0.30 | taxonomy `keyword_match` coverage of the JD's skills. **Never label-anchored**, so it always agrees with matchedSkills/missingSkills. |
| experienceRelevance | 0.20 | min(100, 220·cosine(experienceTerms, jdTerms) + min(25, months/48·25)) |
| projectRelevance | 0.15 | % of JD skills appearing in projects/experience text |
| keywordCoverage | 0.15 | % of the JD's top-20 content terms present in the resume |
| educationEligibility | 0.10 | 100 if education present; 30 if JD requires a degree and none found; else 70 |
| structure, formatting | 0.05 each | as GENERAL |

**Dataset-label anchoring (λ = 0.35).** Only `experienceRelevance`, `projectRelevance` and `keywordCoverage` —
holistic judgements that lexical heuristics under-measure — become `0.65·heuristic + 0.35·bandCentre(fitLabel)`,
with band centres No Fit 20, Potential 55, Good 85. Everything else stays pure evidence.

### Are the heuristics measuring anything? Measured without the label

On 250 med2425 pairs, with the fit label **withheld**, Spearman ρ against that label:

| experienceRelevance | keywordCoverage | requiredSkillMatch | projectRelevance | structure | formatting | **heuristic total** |
|---|---|---|---|---|---|---|
| +0.491 | +0.434 | +0.306 | +0.256 | +0.005 | −0.007 | **+0.486** |

Structure and formatting correctly show **no** relationship with job fit — they are not supposed to.

### Narrative fields

Strengths, weaknesses and recommendations are deterministic templates keyed on component values. Evidence is
built **only** from extracted resume content (detected sections, skills found, dated months, verbatim quantified
snippets). Missing-skill advice never tells a candidate to claim a skill:
*"The job asks for Docker, which the resume does not mention. If you have used it, add a concrete example; if not,
consider a small project that uses it."*

---

## 5. Final dataset

| Split | Total | GENERAL | JOB_MATCH (No / Potential / Good) | Tokens mean / p95 / max |
|---|---|---|---|---|
| train | 2,162 | 1,225 | 937 (353 / 335 / 249) | 1,343 / 2,596 / 2,763 |
| validation | 470 | 263 | 207 (84 / 73 / 50) | 1,376 / 2,622 / 2,731 |
| test | 485 | 263 | 222 (89 / 80 / 53) | 1,320 / 2,566 / 2,713 |
| human review | 476 | 250 | 226 (85 / 83 / 58) | 1,361 / 2,557 / 2,771 |

- JOB_MATCH falls short of its targets (e.g. test 222 of 263) because the one-pair-per-label cap and the JD
  hold-out bind together. Leakage control was not loosened to fill it.
- **Human review** (`dataset/careerpilot_human_review.csv`) is isolated from every other split. Its
  `human_ats_score`, `human_correct` and `review_notes` columns are **empty**: no human label has been
  fabricated. It is for validation and calibration, not training.
- Training examples are chat format, stored as system / user / assistant messages.

---

## 6. Training (`notebooks/CareerPilot_ATS_FineTune.ipynb`)

| Setting | Value | Why |
|---|---|---|
| Base | `unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit` (fallback: HF `Qwen/Qwen3-4B-Instruct-2507` + bitsandbytes NF4) | Apache-2.0, non-thinking variant (no `<think>` block) |
| Method | QLoRA, r = 16, α = 32, dropout 0.05, all 7 projections | ~33M trainable parameters (~0.8%) |
| Sequence length | 3,072 on T4 (auto: 2,048 below 14 GB, 4,096 on 40 GB+) | the longest example is 2,771 tokens |
| Batch | 1 × 16 accumulation on T4 | effective batch 16 |
| LR / schedule | 1e-4, cosine, 10 warmup steps, weight decay 0.01, `paged_adamw_8bit` | conservative, per spec |
| Epochs | 2, early stopping (patience 3 on eval loss), eval + checkpoint every 25 steps | |
| Precision | bf16 if supported, else **fp16** | a T4 cannot compute in bf16 |
| Loss | **completion only** | the model learns the JSON, not to reproduce resumes |
| Packing | off | packing with prompt masking can leak across examples |

**API claims verified against the release wheels, not memory:**

- Unsloth 2026.9.12 pins `trl<=0.24` and `transformers<=5.5`; the fallback path gets TRL 1.14 / transformers 5.17.
  **Both** expose `max_length`, `completion_only_loss` and `processing_class`.
- `max_seq_length` no longer exists in `SFTConfig`, and `max_length` **defaults to 1024**. Left at the default,
  it would silently truncate these examples and cut off the very JSON being trained on.
- `tokenizer=` is no longer accepted by `SFTTrainer`; it is `processing_class=`.
- With `completion_only_loss=None`, TRL masks the prompt **only** for prompt/completion datasets. A plain
  `messages` dataset trains on the full sequence. The notebook converts to prompt/completion, sets `True`
  explicitly, and **asserts** after building a batch that the prompt is masked.
- `warmup_ratio` does not exist in transformers 5.x; `warmup_steps` is used.
- The tokenizer's pad token (`<|endoftext|>`) differs from EOS (`<|im_end|>`), so the model can learn to stop.

Output is versioned (§27): `MyDrive/careerpilot_ats/runs/<model_version>/`. An unfinished run resumes; a finished
one is **never overwritten** — bump the version to retrain.

---

## 7. Evaluation (`ats_pipeline/evaluate.py`)

Three axes, reported separately because they answer different questions:

1. **Teacher fidelity** — score vs the weak label. How faithfully a system reproduces the rubric. The labeller
   itself is excluded: against its own labels it would score perfectly by construction.
2. **External validity** — Spearman against the dataset fit label, which **no system sees at test time**, on
   JDs **never seen in training**. This is the closest measurement to the research question.
3. **Human agreement** — reported as **not available** until the human-review CSV is filled in.

LLM outputs are re-validated with the **production validator**, so JSON validity and hallucination rate are
measured exactly as they would be when served. Skill precision/recall/F1 are computed against the deterministic
skill extraction; the deterministic systems themselves are not scored on it, because that would be circular.

The evaluator is tested at its extremes: an oracle emitting the target JSON scores MAE 0, 100% validity and
F1 1.0; garbage scores 0% validity; injected fake skills are counted, not hidden.

### Measured results (test split, 485 records, deterministic systems)

| System | Mode | MAE | RMSE | Pearson | Spearman | Spearman vs fit label |
|---|---|---|---|---|---|---|
| Predict the training mean (trivial floor) | GENERAL | 7.50 | 10.31 | — | — | — |
| Predict the training mean (trivial floor) | JOB_MATCH | 10.96 | 13.37 | — | — | — |
| Existing production engine | GENERAL | 5.18 | 5.97 | 0.941 | 0.873 | — |
| Existing production engine (keyword coverage) | JOB_MATCH | 24.86* | 27.93* | 0.823 | 0.795 | **0.079** |
| Rubric heuristic, no label anchoring | JOB_MATCH | 4.05 | 5.13 | 0.948 | 0.942 | **0.227** |
| Base Qwen3-4B | both | *not yet measured — needs GPU* | | | | |
| Fine-tuned Qwen3-4B | both | *not yet measured — needs GPU* | | | | |

\* Different scale: the production job signal is raw keyword coverage, not a 0–100 fit score, so its MAE against
the weak label is not comparable; its rank correlations are.

**How to read this:**

- The **existing engine's job-match signal barely tracks fit on unseen jobs (ρ = 0.079)**. That is the headroom
  a fine-tuned model could fill.
- The heuristic reaches ρ = 0.227 on this test set versus 0.486 on a random med2425 sample. The test set is
  deliberately harder: each resume appears with JDs of *different* fit, which removes resume quality as a
  shortcut and demands job-specific discrimination.
- The heuristic's MAE of 4.05 against its own teacher is exactly the **fit label's contribution** (λ = 0.35). A
  fine-tuned model must infer that part from text alone.

**The research question, operationalised:** does the fine-tuned model exceed ρ = 0.227 (heuristic) and 0.079
(production) against fit labels on job descriptions it has never seen, while keeping JSON validity high and
hallucination near zero? **No improvement is claimed until CELL 15 has measured it.**

---

## 8. Inference safety (`ai-service/app/ats_model/validation.py`)

| Failure | Handling |
|---|---|
| JSON in markdown fences / surrounded by prose | balanced-brace extraction aware of string literals |
| Invalid, truncated or empty JSON | one constrained-correction retry showing the model its error, then deterministic fallback |
| Score < 0, > 100, NaN, ∞, missing or extra component | rejected by strict Pydantic (`extra="forbid"`) |
| Uncontrolled field (e.g. `hiddenPersonalityScore`) | rejected |
| Model's own `atsScore` | discarded; recomputed in Python |
| **Hallucinated matched skill** | counted, then moved to missingSkills (word-boundary match: `Java` ≠ `JavaScript`) |
| "Missing" skill the JD never asked for | removed and counted |
| Timeout · crash · CUDA OOM · model not loaded | deterministic engine answers; response says `degraded: true` and why |

A malformed answer never reaches a user, and a degraded answer is never presented as a model answer.

---

## 9. CareerPilot integration

`ResumeIntelligenceAgent` remains the entry point. The shared prompt, schema, weights, normaliser and validator
live in **`ai-service/app/ats_model/`**; the training pipeline re-exports those same modules, so the model is served
exactly the prompt it was trained on.

```
ATS_MODEL_PROVIDER=none               # default: the deterministic engine only — behaviour unchanged
ATS_MODEL_PROVIDER=openai_compatible  # recommended: adapter served by vLLM on a GPU host
ATS_MODEL_PROVIDER=local              # in-process transformers + PEFT; needs a CUDA GPU
ATS_MODEL_ENDPOINT=http://gpu-host:8001/v1
ATS_MODEL_NAME=careerpilot-ats
ATS_MODEL_TIMEOUT_S=60
```

The response stays compatible with `ResumeAnalyzeOutput`. When the model is enabled:

| Field | Source |
|---|---|
| `atsScore`, `breakdown` (8 items summing to the score) | model GENERAL components, aggregated in Python |
| `strengths`, `weaknesses`, `formattingRecommendations`, `evidence` | model, after validation and grounding |
| `matchedKeywords`, `missingKeywords`, `keywordCoverage` | **deterministic** (exact facts) |
| `jobMatchScore`, `jobMatchBreakdown`, `jobSpecificRecommendations` | model JOB_MATCH (new, optional) |
| `modelInfo` | provider, model, version, per-mode provider/attempts/latency, `degraded`, reasons, `baselineAtsScore`, `hallucinationsCorrected` |

Modes fail independently. With the model disabled, `modelInfo` is `null` and the response is the engine's.

---

## 10. Tests — all run and passing

| Suite | Tests | Covers |
|---|---|---|
| `careerpilot_ats/tests/test_inference.py` | 22 | §20 hallucination (incl. Java/JavaScript), score authority, fences, braces in strings, malformed / out-of-range / NaN / extra fields, retry, timeout, crash, fallback |
| `careerpilot_ats/tests/test_evaluate.py` | 4 | oracle scores perfectly, garbage is invalid, hallucinations measured, human agreement never fabricated |
| `ai-service/tests/test_ats_model.py` | 6 | disabled = unchanged, Python-computed score, deterministic keywords, degradation, independent mode failure, misconfigured provider |
| `ai-service/tests` (whole suite) | 110 | the existing 104 still pass: the ATS system is not broken |

Scenario and hallucination tests for the **trained** model (10 GENERAL + 10 JOB_MATCH covering strong, weak,
fresher, experienced, poor extraction, missing sections, strong/weak/unrelated matches; plus 5 adversarial skill
cases) are in `ats_pipeline/scenarios.py` and run in notebook CELL 16.

---

## 11. How to run

**Locally (CPU):**

```bash
pip install -r careerpilot_ats/requirements.txt
python -m spacy download en_core_web_sm
cd careerpilot_ats
python -m ats_pipeline.build_dataset          # ~4 min; writes dataset/, logs/dataset_report.json
python -m ats_pipeline.evaluate               # deterministic baselines -> evaluation/metrics.json
python -m pytest tests
python package_for_colab.py                   # -> careerpilot_ats_colab.zip (no raw data inside)
```

**Train (Colab T4):** upload `careerpilot_ats_colab.zip` to `MyDrive/careerpilot_ats/`, open
`notebooks/CareerPilot_ATS_FineTune.ipynb`, select a T4 runtime, and run the cells in order. CELL 11 resumes after
a disconnect. Expect several hours on a free T4; `MAX_TRAIN_EXAMPLES` (CELL 6) caps it if needed.

**Evaluate the trained model:** CELL 14 generates test predictions for the fine-tuned model **and** the base model
(the same weights with the adapter disabled). CELL 15 produces the full comparison table.

---

## 12. Deployment

**Recommended — vLLM on a GPU host, CareerPilot unchanged except for configuration:**

```bash
# GPU host
pip install vllm
vllm serve Qwen/Qwen3-4B-Instruct-2507 --enable-lora --max-lora-rank 16 \
    --lora-modules careerpilot-ats=/models/careerpilot-ats-qwen3-4b-v1 --port 8001

# ai-service .env
ATS_MODEL_PROVIDER=openai_compatible
ATS_MODEL_ENDPOINT=http://<gpu-host>:8001/v1
ATS_MODEL_NAME=careerpilot-ats
```

The flag syntax (`--enable-lora`, `--lora-modules name=path`, adapter selected through the request's `model`
field) was checked against the current vLLM LoRA documentation. `--max-lora-rank` is set explicitly because that
page does not state its default.

**Hugging Face (only with explicit permission; adapter only — never training resumes):**

```python
from huggingface_hub import login, HfApi
login()                                                   # a WRITE token
HfApi().create_repo("<user>/careerpilot-ats-qwen3-4b-v1", private=True, exist_ok=True)
HfApi().upload_folder(folder_path="runs/careerpilot-ats-qwen3-4b-v1/model/adapter",
                      repo_id="<user>/careerpilot-ats-qwen3-4b-v1")
```

```python
# download + inference
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer
tok = AutoTokenizer.from_pretrained("<user>/careerpilot-ats-qwen3-4b-v1")
base = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3-4B-Instruct-2507", device_map="auto", torch_dtype="auto")
model = PeftModel.from_pretrained(base, "<user>/careerpilot-ats-qwen3-4b-v1")
# build messages with app.ats_model.prompts.chat_messages(...) — never hand-write the prompt
```

---

## 13. Limitations

- **Labels are weak.** The model learns to reproduce a documented rubric plus a bounded share of synthetic fit
  labels. It can be at most as right as that rubric about what a "good resume" is.
- **The fit labels are synthetic.** med2425 is 100% `generated_smart`; 0xnbk's labels agree less with measurable
  evidence (heuristic ρ = 0.17 vs 0.49 on med2425) and lost proportionally more pairs to the contradiction filter.
- **Limited diversity.** ~700 unique job-match resumes (92% shared between the two fit datasets), 382 JD clusters,
  mostly US LiveCareer resumes — not Indian engineering-student resumes, CareerPilot's actual users.
- **med2425 declares no licence.** Suitable for academic research; confirm terms before any commercial use.
- **datasetmaster** contains real PII (scrubbed here) and some internally inconsistent records.
- **No human labels yet.** Human agreement cannot be reported until reviewers fill the CSV.
- **Serving truncation is approximate** (characters, ~3.5 per token) while training truncation is exact
  (tokenizer). Both keep the beginning and mark cuts with `[...]`.
- **Latency.** Two generations per request when a JD is supplied (GENERAL + JOB_MATCH), each several seconds on a
  GPU. The deterministic result is always available as a fallback.

## 14. Next steps

1. Run the notebook on a T4 and record the measured comparison table in §7.
2. Have placement officers fill `careerpilot_human_review.csv` (start with 100 examples), then report human agreement.
3. Add Indian campus resumes (with consent) and recalibrate λ and the rubric against human scores.
4. If fine-tuning improves external validity, enable `openai_compatible` behind a flag for a pilot cohort, keeping
   `baselineAtsScore` visible for comparison.

---

## Files

```
careerpilot_ats/
  ats_pipeline/        build_dataset · labels · evaluate · inference · scenarios
                       (prompts · schemas · scoring · normalize re-export ai-service/app/ats_model)
  dataset/             ats_train|validation|test.jsonl · careerpilot_human_review.csv (+ human_review.csv)
  config/              label_config.json · tokenizer/
  evaluation/          metrics.json · metrics_table.md
  logs/                dataset_report.json · build_dataset.log
  notebooks/           CareerPilot_ATS_FineTune.ipynb · make_notebook.py
  tests/               test_inference.py · test_evaluate.py
  package_for_colab.py · requirements.txt · README.md
  raw/                 downloaded source datasets (not redistributed)
ai-service/app/ats_model/   prompts · schemas · scoring · normalize · validation · service
ai-service/app/agents/resume_agent.py   integration (additive, off by default)
ai-service/tests/test_ats_model.py
```

Written by the notebook after training: `runs/<version>/model/adapter/`, `config/training_config.json`,
`evaluation/pred_{base,finetuned}.jsonl`, `evaluation/metrics.json`, `inference/test_general.json`,
`inference/test_job_match.json`, `inference/hallucination_tests.json`, `logs/log_history.json`, `logs/loss_curve.png`.
