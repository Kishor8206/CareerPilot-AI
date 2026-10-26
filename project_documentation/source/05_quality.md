# Performance and speed

No latency, throughput or load benchmark exists in the repository. The table lists the techniques that are actually in the code and marks every one as unmeasured. **Do not quote a speed-up number.**

| Technique | Problem it addresses | Where | Measured? | Expected benefit |
|---|---|---|---|---|
| Database indexes (about 186 declarations) | Slow lookups by student, slug, status, date | Mongoose schemas | No — performance benchmark required | Indexed queries instead of collection scans |
| Pagination | Large lists | List endpoints (`page`, `limit`) | No | Bounded response size |
| Field selection and `lean()` | Loading whole documents | Services | No | Less data read and serialised |
| `select: false` on hidden tests and solutions | Loading large arrays that are rarely needed | `CodingProblem` | No | Smaller reads; also a security control |
| Route-level code splitting (35 lazy-loaded pages) | Large first download | `React.lazy` in `App.tsx` | No | Smaller initial bundle; Monaco loads only on the problem page |
| Client cache | Repeated identical requests | TanStack Query | No | Fewer round trips |
| Response compression | Payload size | `compression` middleware | No | Smaller responses |
| In-memory configuration cache | Reading weights on every request | `config.service` | No | No database read per readiness computation |
| Docker status cache (20 s) | Checking Docker on every page view | `dockerRunner` | No | One check per 20 seconds |
| Concurrency cap on sandboxes | Host exhaustion under a burst | Semaphore in `codeExecution.service` | No | Bounded resource use; excess requests wait or are refused |
| Compile once per submission | Recompiling for each test | Runner script | No | One compile, many test runs |
| Stop after a time-limit or memory failure | A hanging program occupying a sandbox for every test | Judge | No | Bounded worst-case time per submission |
| Normalised vectors | Computing norms at query time | Embeddings | No | Similarity is one dot product |
| 4-bit quantization (QLoRA) | Model does not fit GPU memory | Training notebooks | Not as a benchmark | Training fits a 16 GB T4 |
| LoRA adapters | Training and storing full model copies | Training notebooks | Not as a benchmark | Around 1% of parameters trained; small adapter file |
| Deterministic engines by default | Slow, costly model calls for every score | ATS, APIE, planner, judge | No | Scores need no GPU and no network |

Not present in the repository: a queue, a Redis-style cache, response streaming, batching of model calls, approximate vector indexes, precomputation jobs.

## Recommended benchmark method

1. **API latency.** Use a load tool (k6 or autocannon) against five endpoints: login, dashboard, problem list, resume analyse, career plan. Report p50, p95 and p99 at 10, 50 and 100 virtual users.
2. **Index effect.** Run the same query with `explain("executionStats")` with and without the index; report documents examined and time.
3. **Judge.** For each language submit a reference solution 50 times; report compile time, per-test time, total time and container start-up overhead; then raise concurrency and report the queue wait.
4. **Frontend.** Lighthouse on the dashboard and the problem page; report bundle sizes with and without code splitting.
5. **Model.** If an adapter is served, report tokens per second, time to a complete JSON answer and GPU memory.

# Novelty, innovation and engineering contribution

Be exact about which word applies. A jury will respect "this is integration and careful engineering" far more than an inflated novelty claim.

| Term | Meaning |
|---|---|
| NOVELTY | Something not done before in this form |
| INNOVATION | A new combination or application of known ideas |
| ENGINEERING IMPROVEMENT | A known idea implemented carefully to remove a real weakness |
| FEATURE | A capability users expect; ordinary functionality |

## What the project contributes

| # | Contribution | Category | Existing problem | CareerPilot approach | Benefit |
|---|---|---|---|---|---|
| 1 | One readiness engine (APIE) fed by every module | INNOVATION | Scores from separate tools cannot be combined | A weighted, recency-aware, evidence-aware score recomputed after every activity, with human alumni feedback as a bounded modifier | One explainable number and a priority list |
| 2 | "Facts from code, judgement from the model, arithmetic from code" | INNOVATION | LLM-scored systems are unrepeatable and can hallucinate | Models return dimension scores or wording; final scores, matched skills and links come from deterministic code | Scores survive an LLM outage and can be explained |
| 3 | Resource IDs instead of URLs | ENGINEERING IMPROVEMENT | Models invent links | The model may only choose catalogue IDs; unknown IDs are dropped and counted | A hallucinated link cannot reach a student |
| 4 | Hidden tests that never enter the sandbox | ENGINEERING IMPROVEMENT | A naive judge ships expected outputs with the code | Only inputs are streamed, one test at a time; comparison is on the host | Submitted code cannot read the answers |
| 5 | One typed signature generating four language harnesses | ENGINEERING IMPROVEMENT | Per-language problem definitions drift | Starter code and harness are generated from a signature | Adding a language changes no problem |
| 6 | Leakage-controlled dataset construction | ENGINEERING IMPROVEMENT | Near-duplicate resumes leak between train and test | Cluster first, split by cluster, hold out job descriptions, audit and refuse to write on leakage | The test set measures unseen jobs |
| 7 | Honest failure reporting | ENGINEERING IMPROVEMENT | Systems fake a result when a dependency is down | "Not executed", "degraded", "no verified information", provenance labels | Trustworthy outputs |
| 8 | Voice excluded from evaluation | ENGINEERING IMPROVEMENT | Spoken answers can be judged on accent or delivery | The input mode is stored but never sent to the evaluator | Identical words get identical scores |
| 9 | Resume analysis, DSA, interviews, career plan, mentorship in one account | FEATURE (integration) | Students use many tools | One platform | Convenience |
| 10 | Admin screens, CRUD, reports | FEATURE | — | Standard | — |

**What is genuinely novel?** Nothing here is a new algorithm. The honest claim is: *the integration of a single explainable readiness model with a strict separation between deterministic scoring and generative language, applied to campus placement.* Rows 1 and 2 are the ones to lead with.

**What to avoid claiming:** that the ATS model is "AI-powered" in the sense of a trained LLM (it is rule-based today); that the career plan is "AI-generated" by a fine-tuned model (the planner generates it); that any accuracy figure reflects real students.

# Comparison with conventional platforms

Compared with a *conventional single-purpose platform* in each category. Many commercial products combine several of these; the table describes the typical single-purpose tool, not a specific competitor.

| Capability | Typical job portal | Typical resume checker | Typical learning platform | Typical DSA platform | CareerPilot AI |
|---|---|---|---|---|---|
| Resume analysis | Limited | Yes | No | No | Yes, with a nine-criterion breakdown |
| JD comparison | Sometimes | Often | No | No | Yes, predefined or custom |
| Career guidance | Limited | No | Course suggestions | No | Skill-gap based plan |
| Skill gap vs a role | No | Sometimes | Sometimes | No | Yes, with priorities and reasons |
| Roadmap with schedule | No | No | Learning paths | Study plans | Yes, time-feasible |
| Learning resources | No | No | Own catalogue | Editorials | Verified catalogue + videos |
| DSA practice with a judge | No | No | Sometimes | Yes, far larger problem sets | Yes, 28 problems |
| Mock interview | No | No | Sometimes | Sometimes | Yes, text and voice |
| Combined readiness score | No | No | No | No | Yes (prototype weights) |
| Alumni mentorship | No | No | No | No | Yes |
| Institutional analytics | Recruiter-side | No | Sometimes | Sometimes | Yes, placement-side |

**Where CareerPilot is weaker:** a dedicated DSA site has thousands of problems, a hardened production judge and contest features; a dedicated learning platform has far more content. CareerPilot's value is the connection between modules, not depth in any single one.

# Limitations and future work

## Current limitations

| Area | Limitation |
|---|---|
| ATS LLM | Not trained. No adapter exists; no LLM result may be quoted |
| Career LLM | v1 trained on 591 examples for 37 updates; 0% of plans were fully valid; switched off |
| APIE | Weights and band thresholds are design choices, not validated on real placements |
| ML classifier | Trained and evaluated on synthetic data only |
| Embeddings | The default is lexical (feature hashing), not semantic |
| Skill extraction | Finds only the 107 taxonomy skills; no OCR for scanned resumes |
| LLM provider | The local configuration uses the mock provider, which is not a language model |
| DSA sandbox | Not yet executed on a machine with Docker; isolation is unverified there |
| DSA scale | 28 hand-written problems; no queue; no admin problem editor; C not supported; no custom input |
| Sandbox hardening | Docker's default seccomp profile; container isolation is not a VM boundary |
| Career knowledge | Levels, hours and prerequisites written by one author; not reviewed by placement staff |
| Resources | 10 skills have no usable resource; videos are search results that passed an availability check, not quality-reviewed |
| Human evaluation | The ATS review sheet and the career plan review sheet are empty |
| Data | Training resumes are mostly US-style, not Indian campus resumes |
| Performance | No benchmark has been run |
| Security | No multi-factor authentication; no dedicated prompt-injection filter |
| Operations | No CI pipeline, monitoring or cloud deployment in the repository |
| Roles | Recruiter is reserved but not built |

## Future enhancements

All items below are [PLANNED].

1. Train the ATS model on a GPU and record the comparison against the deterministic baselines.
2. Run the career model at `medium` size (about 375 updates) and compare with v1.
3. Collect human scores from placement officers and report agreement.
4. Collect real placement outcomes, validate APIE weights and retrain the classifier.
5. Install Docker, run `npm run judge:verify`, then add a queue with judge workers and a stricter seccomp profile.
6. Add an admin problem editor, more problems, custom test input and C support.
7. Switch to semantic embeddings and evaluate retrieval quality.
8. Add Indian campus resumes with consent and recalibrate.
9. Add CI, monitoring, load testing and a recruiter module.
