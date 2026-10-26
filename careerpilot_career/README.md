# CareerPilot Career Roadmap model

**Model:** `career-roadmap-qwen3-1.7b-v1` · **Base:** `Qwen/Qwen3-1.7B` (QLoRA) · **Dataset:** `career-sft-v1` · **Knowledge:** `career-knowledge-v1`

A second model, completely separate from the ATS model: different base model, its own folders, its own
settings, no shared weights or checkpoints. The only link is that an ATS **result** can be passed in as context.

> **Status.** Everything that runs without a GPU is built, tested and working end to end: knowledge base,
> skill-gap service, planner, resource catalogue, dataset, validators, API, backend and frontend. With no
> model configured, the rule-based planner produces every plan. **A first training run (v1) has been done and
> its model is not usable** — see section 6 for the measured results and why. The app should stay on the
> rule-based planner until a longer run passes evaluation.

---

## 1. Architecture

```
profile + skills + target role (+ ATS result, + progress)
        │
        ▼
Skill-gap service ── normalise skills, infer prerequisites, find gaps, assign priority     deterministic
        ▼
Planner ──────────── phases in prerequisite order, time-feasible schedule, projects         deterministic
        ▼
Resource service ─── candidate resources by ID (verified only)                              deterministic
        ▼
Career model ─────── reasoning and wording over the supplied facts                          optional
        ▼
Validator ────────── schema + every fact checked; repair → retry → fall back to the planner
        ▼
Resource resolution ─ IDs become real, verified links
        ▼
Career plan  →  Node API  →  React page (/career)
```

**The model reasons; the application knows.** The prompt carries the facts (role requirements, the learner's
gaps with hours and priorities, prerequisite links, candidate projects, candidate resource IDs). The model
explains, groups into phases, lays out the weeks and chooses resources. It never has to recall a requirement or
a URL, so a new role or resource works without retraining.

| Runtime module (`ai-service/app/career/`) | Responsibility |
|---|---|
| `knowledge.py` | skills, aliases, prerequisite graph, roles |
| `skill_gap.py` | deterministic gap analysis and priorities |
| `planner.py` | phases, schedule, projects — the fallback, the teacher and the reference |
| `resources.py` | catalogue, ranking, ID resolution, YouTube retrieval |
| `verification.py` | URL checks with SSRF protection |
| `validation.py` | one validator for training data, serving and evaluation |
| `model_service.py` | load the model, generate text — nothing else |
| `roadmap_service.py` | the pipeline above, with repair, retry and fallback |
| `prompts.py`, `schemas.py` | the shared prompt and the strict output schema |

Training imports these same modules, so training and serving cannot drift apart.

---

## 2. Knowledge sources — and their limits

| Source | Version | Licence | Used for |
|---|---|---|---|
| O*NET | 31.0 | CC BY 4.0 | corroborating which technologies belong to a role |
| ESCO | v1.2.1 (API) | **not verified** — the download page says only "free of charge" | corroboration only; never used as training text |
| CareerPilot skill taxonomy | in repo | project-owned | shared vocabulary with the ATS output |
| Job postings (via the skill recommender) | — | see ATS README | share of job descriptions asking for a skill |
| **Curated knowledge** | `career-knowledge-v1` | project-owned | prerequisites, study hours, role skill levels, projects, interview topics |

**O*NET and ESCO do not contain what a roadmap needs.** Neither has learning prerequisites, study effort,
role-level skill targets, projects or interview topics, and O*NET has no Frontend, DevOps or MERN occupation.
Those layers are written by hand in `training/curated_knowledge.py`. They are editorial judgement, not an
official standard and not empirically validated; study hours are planning estimates.

What was measured: **81% of the 275 role-to-skill links are also attached to that role by O*NET, ESCO or real job
postings.** That supports which skills belong to a role. It does not validate levels, hours or prerequisites.

Built: 122 skills (96 shared with the ATS taxonomy), 214 aliases with zero collisions, 123 prerequisite links
verified acyclic, 20 roles.

---

## 3. Resources

The model outputs resource **IDs only**. The catalogue holds 270 resources:

| Type | Count | How verified |
|---|---|---|
| Official documentation, books, free courses, practice sites | 90 | a real HTTPS request to each; 88 verified, 2 excluded (HTTP 403 to automated requests) |
| YouTube videos | 180 | YouTube Data API: public and embeddable; 151 name the skill in the title, 29 do not and rank lower |

112 of 122 skills have at least one usable resource. Nothing is marked verified by hand, no ratings are stored
(there is no rating data), and `quality_score` is an editorial weight by resource type.

The verifier fetches URLs, so it refuses anything but HTTPS on the resource's own provider domain, refuses hosts
that resolve to private or loopback addresses, follows at most three redirects re-checking each, and caps the
bytes it reads.

`YOUTUBE_API_KEY` lives only in `.env`. It is never written to code, the example file or the Colab package; the
packaging script scans the archive for key-shaped strings and fails if it finds one.

---

## 4. Training data

**How examples are made:** a synthetic learner profile → the deterministic planner over the curated knowledge →
the plan, reduced to the sections the task asks for. Learner profiles are synthetic combinations; every career
fact comes from the knowledge layer and each record stores the facts it was built from.

**What that means:** the model learns to reproduce this planner's reasoning from a request plus supplied
knowledge. It is not learning from human-written roadmaps, because no such dataset exists. It can be measured on
validity, faithfulness to the facts and feasibility. It cannot be shown to give *better* careers advice than the
planner it learned from.

| | Examples | Learner profiles |
|---|---|---|
| Train | 7,157 | — |
| Validation | 957 | — |
| Test | 1,802 | 903 in-distribution + 899 from two held-out roles |

- 10,000 generated, 9,916 kept; all 84 rejects were over the 4,096-token limit. Zero contradictory examples.
- 32 task types (career selection through portfolio planning), all 20 roles.
- Split by learner profile, so one profile never spans two splits.
- **Site Reliability Engineer and Product Analyst never appear in training.** They test whether the model can
  handle a role it has not seen, which is the point of putting the facts in the prompt.
- Rebuilding from the Colab package reproduces all three splits byte for byte.

Priorities, total hours and weeks needed are given to the model as facts: a small model should explain and
organise them, not redo the arithmetic. It still lays out the weekly hours itself, and will make slips; the
service replaces any infeasible schedule and evaluation reports how often.

---

## 5. Training

| Setting | Value |
|---|---|
| Base | `Qwen/Qwen3-1.7B`, 4-bit (Unsloth, with a Hugging Face fallback) |
| Method | QLoRA, r 16, α 32, dropout 0.05, all seven projection layers |
| Max length | 4,096 tokens (examples over the limit are dropped, never truncated) |
| Batch | 2 × 8 accumulation on a T4 |
| Learning rate | 1e-4, cosine, weight decay 0.01 |
| Epochs | 2, early stopping on validation loss |
| Checkpoints | every 50 steps to Google Drive, latest 3 kept, automatic resume |
| Loss | answer tokens only |

Three details that prevent silent failures:

- **Qwen3-1.7B is a "thinking" model.** By default its chat template adds reasoning blocks. Prompts are always
  rendered with thinking disabled, and a test confirms the training prompt is token-for-token the serving prompt.
- **Checkpoint resume skips broken checkpoints.** If Colab dies mid-save, the half-written checkpoint is
  detected and the previous one is used. Steps are compared numerically (1000 after 950).
- **`group_by_length` and `warmup_ratio` no longer exist** in current transformers; neither is used.

If Qwen3-1.7B cannot be loaded, training stops. No other model is substituted.

---

## 6. Evaluation

`training/evaluate.py` measures 13 things on held-out test examples, for the fine-tuned model **and** the untuned
base model, before any repair: JSON validity, schema compliance, skill-gap F1, priority agreement, prerequisite
correctness, roadmap ordering, role alignment, personalisation, study-plan feasibility, resource-ID validity,
resource hallucination, contradiction rate and duplicate rate. Results are split by seen roles and held-out roles.

The scorer is tested at inputs with known answers: an oracle scores perfectly, garbage scores zero, and each
injected fault moves its own metric.

These metrics show faithfulness to the facts and to the planner. They do not show whether the advice is good
careers advice. For that, `evaluate.py human-sheet` writes a review sheet with seven criteria scored 1–5 and
every score cell empty.

### Measured results — run v1 (quick run, Colab T4)

591 training examples, 1 epoch, **37 learning updates**, 82 minutes, final validation loss 0.273.
Evaluated on 60 held-out test examples (30 seen roles, 30 held-out roles), before any repair.

| Metric | Fine-tuned v1 | Untuned base model |
|---|---|---|
| Examples evaluated | 60 | 8 (generation was interrupted) |
| Valid JSON | 51.7% | 87.5% |
| Passes the schema | 6.7% | 0% |
| Fully valid plan, no repair needed | **0%** | 0% |
| Role alignment (where checkable) | 100% | — |
| Resource hallucination (where checkable) | 0% | — |

The remaining metrics rest on the four outputs that passed the schema, which is too few to mean anything.
The base model was only run on 8 examples, so this is **not** a fair before/after comparison.

**Verdict: v1 is not usable.** With it switched on, every plan would be repaired or replaced by the planner.

**Why.** 37 updates is far too few to learn a strict output format:

- 21 of 60 outputs never stopped and were cut off at the 3,000-token limit;
- 8 more had broken JSON partway through;
- most that parsed invented fields (`estimated_weeks`) and omitted required ones (`prerequisites`,
  `completion_criteria`);
- training loss was still falling steeply (0.65 → 0.30) when the run ended.

**What changed for v2.** Training costs about 6.6 seconds per example on a T4, so the full dataset would take
about 26 hours. The notebook now updates the model every 4 examples instead of every 16 — four times as many
updates for the same compute — and offers `quick` (600 examples, ~150 updates), `medium` (1,500, ~375 updates,
about 3 hours) and `full`. It writes to a new run folder, so v1 is kept. v2 has not been run.

Raw outputs: `models/career_roadmap/evaluation/pred_finetuned.jsonl`. Loss curve: `models/career_roadmap/logs/loss_curve.png`.

---

## 7. What is tested (all passing)

| Suite | Checks | Covers |
|---|---|---|
| `ai-service/tests/test_career_planner.py` | 422 | every role × 4 skill sets × 5 time profiles: schema, feasible weeks, prerequisite order, no known skill recommended, no invented resources; plus the SSRF guard |
| `ai-service/tests/test_career_service.py` | 14 | repair, retry, fallback, timeout, hallucinated resources, the ATS bridge |
| `careerpilot_career/tests` | 10 | checkpoint resume, prompt masking, the evaluator |
| `training/inference_test.py` | 44 | the ten required profiles and the final example, with behavioural checks |
| `backend/tests/e2e.career.smoke.ts` | 25 | browser API → Node → FastAPI → MongoDB, including access control and progress |

The existing suites still pass: 81 backend tests, 561 AI-service tests in total, the ATS pipeline tests, and the
original 71-check and 35-check end-to-end runs.

---

## 8. Run it

**Locally (no GPU):**

```bash
cd careerpilot_career
python training/download_data.py            # O*NET + ESCO, writes the source manifest
python training/build_skill_taxonomy.py
python training/normalize_skills.py
python training/build_skill_graph.py
python training/build_career_knowledge.py
python training/build_resource_catalog.py   # verifies every seeded URL
python training/fetch_youtube_resources.py  # optional; needs YOUTUBE_API_KEY, ~6,000 quota units
python training/build_training_dataset.py
python training/validate_dataset.py
python training/split_dataset.py
python training/inference_test.py           # 44 checks on the rule-based planner
python package_for_colab.py
```

**Train (Colab T4):** upload `careerpilot_career_colab.zip` to `MyDrive/careerpilot_career/`, open the notebook,
choose a T4 runtime, run cells 1–19. `QUICK_RUN = True` (cell 3) trains on 600 examples for one epoch. After a
disconnect, re-run cells 1–14 and then 15.

**Serve the trained adapter:**

```bash
vllm serve Qwen/Qwen3-1.7B --enable-lora --max-lora-rank 16 \
    --lora-modules careerpilot-career=/models/career_roadmap/final --port 8002
# ai-service .env
CAREER_MODEL_PROVIDER=openai_compatible
CAREER_MODEL_ENDPOINT=http://<gpu-host>:8002/v1
CAREER_MODEL_NAME=careerpilot-career
```

**In the app:** students open **Career Plan** in the sidebar (`/career`).

---

## 9. Limitations

- **The only trained model so far (v1) is not usable**: 0% of its plans were fully valid.
- **The curated knowledge is editorial**, written by one author and not reviewed by placement staff.
- **Training targets come from a rule-based planner**, so the model can at best match it on substance.
- **Synthetic learner profiles** include some unrealistic skill combinations.
- **Study hours are estimates.** A tight deadline often cannot fit the core skills; the plan says so plainly.
- **17 skills have no verified resource**, mostly process and business skills.
- **Videos are search results** that passed an availability check, not quality-reviewed.
- **ESCO's reuse licence is unverified**; confirm before redistributing its text.
- **The frontend page builds and typechecks, and the API behind it is tested end to end, but the page has not been
  checked by eye in a browser.**
- **vLLM's support for the `chat_template_kwargs` thinking switch** was not verified against a running server.

## 10. Next steps

1. Run the updated notebook at `medium` size (v2) and compare its evaluation table with v1.
2. Have a placement officer review the role knowledge and fill the human evaluation sheet.
3. Check the Career Plan page in a browser with a real account.
4. Add resources for the 17 uncovered skills.
