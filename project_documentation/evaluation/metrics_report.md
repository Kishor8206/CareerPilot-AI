# Metrics and evaluation report

Every number here is copied from a file in the repository, named in the "Source" column. Nothing is estimated. Where a measurement does not exist the table says [NOT YET MEASURED] and how to obtain it.

## Measured — ATS deterministic baselines

Source: `careerpilot_ats/evaluation/metrics.json`. Test split of 485 records (263 general, 222 job-match). "Teacher fidelity" compares a system's score with the weak label. "Versus fit label" compares with a dataset label that no system sees at test time, on job descriptions never seen in training.

| System | Mode | MAE | RMSE | Pearson | Spearman | Spearman vs fit label |
|---|---|---|---|---|---|---|
| Predict the training mean (trivial floor) | General | 7.50 | 10.31 | — | — | — |
| Predict the training mean (trivial floor) | Job match | 10.96 | 13.37 | — | — | — |
| Existing rule-based engine | General | 5.18 | 5.97 | 0.941 | 0.873 | — |
| Existing engine (keyword coverage) | Job match | 24.86* | 27.93* | 0.823 | 0.795 | 0.079 |
| Rubric heuristic without label anchoring | Job match | 4.05 | 5.13 | 0.948 | 0.942 | 0.227 |
| Base Qwen3-4B | Both | [NOT YET MEASURED] | | | | |
| Fine-tuned Qwen3-4B | Both | [NOT YET MEASURED] | | | | |

\* Different scale: keyword coverage is not a 0–100 fit score, so its MAE is not comparable; its rank correlations are.

**Meaning.** These describe how closely the *rule-based* engine follows the documented rubric (weak labels). They are not accuracy against human judgement. The key finding is that plain keyword coverage barely tracks job fit on unseen jobs (ρ = 0.079), which is the headroom a fine-tuned model would have to beat (ρ = 0.227 for the richer heuristic).

**Human agreement:** [NOT YET MEASURED]. `careerpilot_ats/dataset/careerpilot_human_review.csv` holds 476 examples with empty score columns. Evaluation required before claiming this metric.

## Measured — ATS dataset

Source: `careerpilot_ats/README.md`, `logs/dataset_report.json`.

| Split | Total | General | Job match (No / Potential / Good fit) |
|---|---|---|---|
| Train | 2,162 | 1,225 | 937 (353 / 335 / 249) |
| Validation | 470 | 263 | 207 (84 / 73 / 50) |
| Test | 485 | 263 | 222 (89 / 80 / 53) |
| Human review | 476 | 250 | 226 (85 / 83 / 58) |

Leakage audit across all split pairs: 0 resume clusters, 0 exact pairs, 0 job-description clusters shared. Longest example: 2,771 tokens.

## Measured — readiness classifier

Source: `ai-service/artifacts/readiness_metrics.json`, trained 7 October 2026. **Dataset provenance: SYNTHETIC.**

| Metric | Value | Dataset | Method |
|---|---|---|---|
| Accuracy | 0.735 | 400 synthetic test rows | 80/20 stratified split of 2,000 rows |
| Macro precision | 0.740 | same | same |
| Macro recall | 0.737 | same | same |
| Macro F1 | 0.737 | same | same |
| Cross-validation accuracy | 0.739 ± 0.020 | 2,000 rows | 3-fold stratified |

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| At Risk | 0.806 | 0.823 | 0.814 | 96 |
| Needs Improvement | 0.674 | 0.600 | 0.635 | 100 |
| Placement Ready | 0.661 | 0.739 | 0.698 | 111 |
| Highly Ready | 0.820 | 0.785 | 0.802 | 93 |

Confusion matrix (rows = actual, columns = predicted, in the class order above):

```
At Risk             79  16   1   0
Needs Improvement   18  60  21   1
Placement Ready      1  13  82  15
Highly Ready         0   0  20  73
```

Errors fall almost entirely on neighbouring bands, which is what you expect from an ordered target with noise. Top feature importances: academic 0.191, coding 0.157, technical 0.151, ATS 0.099, communication 0.087.

**Meaning.** "Prototype evaluation — synthetic dataset." It shows the pipeline works. It is **not** evidence that the model predicts real placements.

## Measured — skill recommender

Source: `ai-service/artifacts/skill_recommender.json`, `careerpilot_skills/skill_recommender_report.json`. Real data: 844 skill baskets (594 train, 115 validation, 135 test), 84 skills. Leave-one-out evaluation, 1,473 trials.

| Model | MRR | Recall@5 | Recall@10 |
|---|---|---|---|
| Popularity baseline | 0.195 | 0.272 | 0.476 |
| **Item similarity (selected)** | **0.313** | **0.411** | **0.585** |
| PPMI + SVD embeddings | 0.238 | 0.348 | 0.483 |

Gain over popularity in Recall@5: +0.138, 95% confidence interval +0.101 to +0.176 (paired bootstrap, 2,000 rounds). **Status:** trained and evaluated, but not connected to a live feature.

## Measured — career model, run v1

Source: `careerpilot_career/models/career_roadmap/evaluation/evaluation_report.json` (11:37, 7 October 2026) and `final/model_metadata.json`. Training: 591 examples, 1 epoch, 37 learning updates, 82 minutes on a Colab T4, final validation loss 0.273. Evaluation on held-out test examples **before any repair**.

| Metric | Fine-tuned v1 (60 examples) | Untuned base (8 examples) |
|---|---|---|
| Valid JSON | 51.7% | 87.5% |
| Passes the schema | 6.7% | 0% |
| Fully valid plan without repair | **0%** | 0% |
| Role alignment (where checkable) | 100% | — |
| Resource-ID validity (where checkable) | 100% | — |
| Resource hallucination (where checkable) | 0% | — |

Only four outputs passed the schema, so the remaining ten measures rest on too few cases to mean anything. The base model was run on 8 examples only, so this is **not** a fair before/after comparison.

**Verdict: not usable.** 21 of 60 outputs never stopped and were cut at the 3,000-token limit; 8 more had broken JSON; training loss was still falling (0.65 to 0.30) when the run ended. The model is switched off and the planner generates every plan.

## Measured — career knowledge and resources

Source: `ai-service/app/career/data/*.json`.

| Item | Value |
|---|---|
| Skills / aliases | 122 / 214 |
| Prerequisite edges, roots, maximum depth | 123, 24, 6 (verified acyclic) |
| Roles | 20 |
| Role-to-skill links corroborated by O*NET, ESCO or job postings | 222 of 275 (80.7%) |
| Resources | 270 (239 verified, 29 reachable, 2 unreachable and excluded) |
| By type | 180 videos, 65 documentation, 13 free courses, 8 practice platforms, 4 books |
| Skills with a usable resource | 112 of 122 |

## Measured — RAG threshold calibration

Source: comment and settings in `ai-service/app/core/config.py`. Cosine scores with the lexical embedder against the seeded corpus: on-topic questions 0.28–0.31; domain-adjacent but unanswerable 0.11–0.14; unrelated 0.02–0.07. Threshold 0.18. This was an informal calibration, not a labelled retrieval benchmark; precision and recall at k are [NOT YET MEASURED].

## Measured — DSA judge correctness

Source: `backend/tests/dsa.judge.test.ts` (full matrix run).

| Check | Result |
|---|---|
| Reference solutions judged Accepted | 28 problems × 4 languages = 112 programs, every public and hidden test |
| Wrong Answer, Runtime Error, Compilation Error, Time Limit Exceeded | Each reproduced with a real program |
| Hidden test data in any API response or stored record | None (asserted by test) |
| Execution environment for these checks | Local compilers through a test-only transport — **not** Docker |
| Container isolation (network, filesystem, fork bomb, memory) | [NOT YET MEASURED] — run `npm run judge:verify` on a machine with Docker |

## Measured — automated tests

| Suite | Result | Notes |
|---|---|---|
| Backend (Vitest) | 128 passed, 0 failed (7 files) | auth, RBAC, assessment, voice, DSA judge, DSA API, resume/JD |
| AI service (pytest) | 546 passed, 0 failed | agents, ATS model layer, career planner and service, RAG/APIE/ML, resume pipeline, recommender, voice |
| Frontend (Vitest) | 39 passed, 0 failed (3 files) | components, formatting, speech |
| End-to-end, platform | 61 checks passed | against the live AI service |
| End-to-end, voice interview | 19 checks passed | against the live AI service |
| End-to-end, career plan | 25 checks passed | against the live AI service |

Passing tests show **system quality** — the code does what it was written to do. They are not a measure of model quality or of usefulness to students.

## Not yet measured — and how to measure it

| Metric | Why it is missing | How to measure |
|---|---|---|
| Fine-tuned ATS model: JSON validity, skill precision/recall/F1, hallucination rate, MAE, Spearman vs fit label | Training needs a GPU and has not been run | Run the notebook on a T4; cells 14–15 produce the comparison against the base model and the baselines above |
| ATS human agreement | No reviewer has filled the sheet | Have placement officers score 100 examples; report Pearson and Spearman with the engine |
| Career plan quality | No expert ratings | `evaluate.py human-sheet` produces a seven-criterion sheet; average the 1–5 ratings |
| Career model v2 | Not run | Run the notebook at `medium` (about 375 updates) and regenerate the evaluation table |
| APIE validity | No real outcomes | Correlate readiness scores with placement results; report calibration |
| Classifier on real data | No real data | Retrain and report macro F1 with a confusion matrix |
| RAG retrieval quality | No labelled questions | Build a question set with relevant chunks; report Precision@5, Recall@5, MRR |
| Interview scoring agreement | No human scores | Have two raters score 50 answers; report inter-rater and model agreement |
| API latency and throughput | No load test | k6 or autocannon; p50/p95/p99 at 10, 50, 100 users |
| Judge latency and capacity | Docker not installed here | Per-language compile and run time over 50 submissions; queue wait under concurrency |
| Model inference latency, GPU memory | No model is served | Tokens per second and time to a complete JSON answer on the serving GPU |
| Frontend load time, bundle size | Not profiled | Lighthouse; bundle analyser with and without code splitting |
