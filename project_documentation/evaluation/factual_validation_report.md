# Factual validation report

This report records how each claim in the document was checked against the repository on 8 October 2026. "Verified" means the value was read from source code, a data file or a test run during this audit.

## Verified

| Claim | Evidence |
|---|---|
| Three services: React/Vite frontend, Node/Express backend, Python/FastAPI AI service | `frontend/`, `backend/`, `ai-service/`, root `package.json` workspaces |
| 33 Mongoose models | `backend/src/models/` (33 model files) |
| 135 endpoints in 15 route files, mounted on 19 paths | Counted from `backend/src/routes/v1/*.ts` and `routes/index.ts` |
| 38 page components; 35 lazy-loaded | `frontend/src/pages/`, `React.lazy` calls in `App.tsx` |
| Roles: STUDENT, ALUMNI, PLACEMENT_OFFICER, ADMIN; RECRUITER reserved | `shared/src/enums.ts` |
| 11 registered agents; workflows `RESUME_TO_MATCH`, `INTERVIEW_TURN` | Printed from the orchestrator registry |
| Dependencies and versions in the stack table | `backend/package.json`, `frontend/package.json`, `ai-service/requirements.txt` |
| ATS: nine criteria and their formulas | `ai-service/app/services/ats.py`, `docs/ALGORITHMS.md` |
| Skill taxonomy: 107 skills, 181 aliases, custom boundaries | `ai-service/app/nlp/skills_taxonomy.py` |
| APIE weights 0.25 / 0.20 / 0.15 / 0.10 × 4 | `shared/src/constants.ts`; live `/readiness` response shows seven components |
| Job-match and mentor-match formulas | Agent source files |
| RAG: chunk 900/150, top-k 5, thresholds 0.18 / 0.25 | `ai-service/app/core/config.py` |
| Random Forest metrics (0.735, 0.740, 0.737, 0.737, CV 0.739 ± 0.020) and confusion matrix | `ai-service/artifacts/readiness_metrics.json` |
| Skill recommender metrics and confidence interval | `ai-service/artifacts/skill_recommender.json` |
| ATS dataset sizes, leakage audit, baseline table | `careerpilot_ats/README.md`, `evaluation/metrics.json` |
| ATS training settings (r 16, α 32, LR 1e-4, 1 × 16, 3,072 tokens, 2 epochs) | `careerpilot_ats/README.md` |
| **No ATS adapter exists** | `careerpilot_ats/model/` is empty |
| Career adapter config: LoRA r 16, α 32, dropout 0.05, base `unsloth/Qwen3-1.7B-unsloth-bnb-4bit` | `careerpilot_career/models/career_roadmap/final/adapter_config.json` |
| Career v1 run: 591 examples, 1 epoch, LR 1e-4, max length 4,096, fp16 | `final/model_metadata.json` |
| Career v1 results: 51.7% valid JSON, 6.7% schema, 0% fully valid; base on 8 examples | `evaluation/evaluation_report.json` |
| Career knowledge: 122 skills, 123 edges, depth 6, 24 roots, 20 roles, 80.7% corroborated | `ai-service/app/career/data/*.json` |
| Resource catalogue: 270 total, 239 verified, 29 reachable, 2 unreachable; 112 of 122 skills covered | `resources.json` summary |
| Resource ranking formula | `ai-service/app/career/resources.py` |
| Skill-gap priority formula and thresholds 62 / 40 | `ai-service/app/career/skill_gap.py` |
| Planner time budget 75 / 15 / 10 and deferral rules | `ai-service/app/career/planner.py` |
| DSA: 28 problems, 16 tags, four languages, defaults 2 s / 128 MB | `database/seeds/dsaProblems.ts`, `shared/src/dsa.ts`; live API returned 28 |
| Docker isolation flags | `backend/src/services/execution/dockerRunner.ts`; asserted by a unit test |
| Time factors ×1 / ×2 / ×2 / ×3; per-language memory strategy | `execution/languages.ts` |
| Hidden tests `select: false`; never in responses | `models/CodingProblem.ts`; `tests/dsa.api.test.ts` |
| 112 reference programs accepted | Full-matrix run of `tests/dsa.judge.test.ts` |
| Concurrency cap, no queue | `codeExecution.service.ts` (Semaphore) |
| Security middleware: Helmet, CORS, compression, sanitiser, rate limiters | `backend/src/app.ts`, `middleware/` |
| Refresh token in a signed cookie; rotation | `controllers/auth.controller.ts`, `services/auth.service.ts` |
| Upload checks including magic bytes | `middleware/upload.ts`, `services/storage.service.ts` |
| Custom job description for resume analysis | `resume.service.ts`, `ResumePage.tsx`; live test returned 30% coverage on a sample JD |
| Compose services: mongodb, ai-service, backend, frontend; judge disabled there | `docker-compose.yml` |
| Local provider settings: `AI_PROVIDER=mock`, `EMBEDDING_PROVIDER=hash`, `VECTOR_DB_PROVIDER=numpy` | `.env` (names and non-secret values only) |
| Test results: backend 128, AI service 546, frontend 39 — all passing | Suites run during this audit |
| End-to-end runs: 61, 19 and 25 checks passing | Run on 7 October 2026 against the live AI service |

## Partially verified

| Claim | What is verified | What is not |
|---|---|---|
| DSA sandbox security | Argument list, protocol, verdict logic, local execution | Behaviour under real Docker — Docker is not installed on the development machine |
| Memory Limit Exceeded | Classification logic (unit tests) | Real enforcement, which needs the container |
| ATS fine-tuning pipeline | Dataset build, baselines, integration, validation layer, tests | Training and any LLM result |
| Career fine-tuning | One short run and its evaluation | A run long enough to be usable |
| Voice interview | API path and identical scoring for spoken and typed input (end-to-end run) | Browser speech recognition itself cannot be exercised from Node |
| Career Plan page | Builds, type-checks, API tested end to end | Not reviewed screen by screen in a browser during this audit |
| ESCO usage | Used for corroboration | Its reuse licence is not verified |
| Trainable parameter count | About 33 million for the ATS model (documented) | Not recorded for the career model |

## Not verified from source

| Item | Note |
|---|---|
| Any production or cloud deployment | Only Docker Compose and local development exist |
| CI pipeline, monitoring, alerting | Not present |
| Encryption at rest | Not implemented in the repository |
| Performance figures of any kind | No benchmark exists |
| Comparison of Qwen with Llama, Mistral or Gemma | Never run |
| Which LLM would answer in the demo | Depends on `AI_PROVIDER` at the time; the local value is `mock` |
| Human agreement with any score | Review sheets are empty |

## Planned (not built)

| Item | Where it is referenced |
|---|---|
| Recruiter module | Role constant only |
| Trained ATS model and its evaluation | Notebook ready; needs a GPU |
| Career model v2 | Notebook updated; not run |
| Judge queue and workers; stricter seccomp profile | `docs/DSA_JUDGE.md` limitations |
| Admin problem editor; custom test input; C language | Not present |
| vLLM serving of adapters | Documented commands only |
| Validation of APIE weights with real outcomes | Limitations |

## Corrections made while validating

- The existing viva guide listed 15 agents and older classifier metrics; the current values are 11 agents and accuracy 0.735. `docs/ALGORITHMS.md` was corrected.
- An older career README states that 17 skills have no verified resource; the current catalogue summary shows 10 (112 of 122 covered). This document uses the data file.
- Older documents mention Group Discussion and a Career Roadmap agent; both were removed from the product and are not described as features here.

## Things this document deliberately does not contain

- No API key, password, token or `.env` secret. Secret names appear with their values [REDACTED].
- No invented accuracy, precision, recall, F1, latency or speed-up figure.
- No claim that a fine-tuned model is deployed.
