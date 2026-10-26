# CareerPilot AI — Algorithms and Technical Explanation

A viva guide. Every formula, weight and threshold below is taken from the source code, and each section names
the file so you can open it if asked. Where a number is a design choice rather than a validated result, this
document says so — say the same in the viva.

**The one-sentence summary:** CareerPilot is a multi-agent system in which *deterministic algorithms compute
every score* and *language models are used only for language* (asking questions, judging free-text answers,
phrasing advice) — with every model output validated and every final score recomputed in code.

---

## 1. System architecture

```
React (Vite, TypeScript)  ──HTTP/WebSocket──►  Node.js + Express gateway  ──HTTP + internal key──►  Python FastAPI AI service
        UI, voice (Web Speech API)              auth, RBAC, MongoDB, Socket.IO, PDF                agents, NLP, RAG, ML, APIE
```

- **Three services, one trust boundary.** The browser never talks to the AI service. Only the Node gateway does,
  with a shared internal key. API keys and model access never reach the frontend.
- **MongoDB** stores users, attempts, sessions and append-only readiness snapshots.
- **Why split Node and Python?** Node handles I/O-heavy work (auth, sockets, database). Python has the NLP/ML
  ecosystem (spaCy, scikit-learn, NumPy).

---

## 2. Multi-agent framework

*Files: `ai-service/app/agents/base.py`, `orchestrator.py`*

### 2.1 What an "agent" is here

An agent is a class with **one responsibility**, a **typed input schema**, a **typed output schema** and a
`handle()` method. `BaseAgent.run()` wraps every agent with the same four steps:

1. Validate the input against the Pydantic input model (reject bad requests early).
2. Run `handle()`.
3. Validate the output against the Pydantic output model (an agent *cannot* return an unvalidated payload).
4. Record latency, provider, token counts and whether the result was degraded.

### 2.2 The agents (11 registered)

| Agent | Responsibility | Uses an LLM? |
|---|---|---|
| Resume Intelligence | Parse a resume, compute the ATS score, match JD keywords | Only to phrase advice |
| Job Matching | Score a student against a job | No |
| Coding Assessment | Static review of submitted code (advisory; never decides a verdict) | Yes |
| Technical / HR / Behavioural Interview | Generate the next adaptive question | Yes |
| Interview Evaluation | Score an answer on five dimensions | Yes (scores recomputed in code) |
| Placement Readiness | Run APIE | No |
| Alumni Mentorship / Feedback Ingest | Match mentors, convert human feedback to signals | No |
| Analytics | Cohort statistics | No |

### 2.3 Orchestration

**Rule: agents never call each other.** Composition happens only in the orchestrator, as fixed workflows:

| Workflow | Steps |
|---|---|
| `RESUME_TO_MATCH` | Resume Intelligence → Job Matching |
| `INTERVIEW_TURN` | Interview Evaluation (previous answer) → interview agent for the mode (next question) |

**Why this design?** The call graph is acyclic and auditable — an agent cannot trigger an unbounded chain of
other agents. This is *workflow orchestration*, not autonomous agent planning.

> **Likely question: "Is this really agentic AI?"** Answer honestly: it is a multi-agent architecture with
> orchestrated, deterministic workflows. The agents are specialised and adaptive (the interview agent changes
> difficulty from your scores), but they do not autonomously plan or call tools in a loop. That was a deliberate
> choice for auditability in an assessment system.

---

## 3. LLM layer

*File: `ai-service/app/services/llm.py`*

### 3.1 Provider abstraction

One interface (`complete_json`), four interchangeable providers selected by `AI_PROVIDER`:
`openai` (any OpenAI-compatible endpoint), `azure`, `ollama` (local models) and `mock`.

Nothing above this layer knows which provider is running — this is the **Strategy pattern**.

### 3.2 The mock provider

It is **not** a language model. It reads the task and the JSON context and assembles a schema-valid response
using rules over the real input. It exists so the whole platform runs offline with no API key. Every mock
response is tagged `provider: "mock"`. **Never present mock output as an LLM's.**

### 3.3 How LLM output is controlled

Three techniques used everywhere a model is called:

1. **Structured output.** Prompts demand JSON matching a stated schema; the response is parsed and validated.
2. **Low temperature** (0.15–0.2 for evaluation) so the same answer gets a consistent score.
3. **Score recomputation.** The model returns *dimension* scores; the *overall* score is recomputed in code from
   fixed weights. The model's own total is never trusted.

### 3.4 Fine-tuned ATS model (prepared, not yet trained)

*Folder: `careerpilot_ats/`, integration in `ai-service/app/ats_model/`*

- **Base model:** Qwen3-4B-Instruct-2507. **Method:** QLoRA.
- **QLoRA in one paragraph:** the base model's weights are frozen and loaded in 4-bit precision to fit a small GPU.
  Small trainable low-rank matrices (rank 16) are added to the attention and feed-forward projections. Only
  those ~33 million parameters (~0.8% of the model) are trained.
- **Labels are weak labels**, generated by formulas built on the existing ATS engine — not human scores.
- **Status:** the dataset, training notebook, evaluation and integration are built and tested. **Training on a GPU
  has not been run yet.** Do not quote any fine-tuned result until it is measured. See `careerpilot_ats/README.md`.

---

## 4. Resume parsing and skill extraction (NLP)

*Files: `ai-service/app/nlp/resume_parser.py`, `skills_taxonomy.py`, `text_extraction.py`*

### 4.1 Pipeline

```
PDF / DOCX / TXT ─► text extraction ─► section detection ─► field extractors ─► skill extraction
   (PyMuPDF, python-docx)   (heading patterns)   (regex + spaCy NER for name)   (taxonomy matching)
```

### 4.2 Section detection

A line is a heading if, after stripping decoration, it is ≤ 45 characters and matches a known section name
(exactly, or as a prefix with up to 12 extra characters, e.g. "TECHNICAL SKILLS :"). Text between headings
becomes that section.

### 4.3 Skill extraction — dictionary matching with aliases

- A taxonomy of **107 canonical skills with 181 aliases** (e.g. "ReactJS", "React.js" → **React**).
- Each term is compiled to a regular expression with **custom word boundaries**:
  `(?<![a-zA-Z0-9+#])term(?![a-zA-Z0-9+#])`.
- Separators inside a term are flexible, so `node.js`, `node js` and `nodejs` all match.

**Why custom boundaries?** The standard `\b` breaks on `C++` and `C#`, and a naive substring search would find
"Java" inside "JavaScript" and "R" inside every word. This is tested.

**Why a dictionary instead of a neural NER model?** It is deterministic, explainable, needs no training data and
cannot invent a skill. The trade-off is that it only finds skills in the taxonomy.

---

## 5. ATS scoring (rule-based)

*File: `ai-service/app/services/ats.py`*

Nine criteria, with maximum points summing to 100:

| Criterion | Points | Exact rule |
|---|---|---|
| Skills coverage | 20 | min(8, skills × 0.55) + min(4, languages × 1.4) + min(4, frameworks × 1.2) + min(4, CS fundamentals × 1.4) |
| Section structure | 15 | (required sections found ÷ required) × 9 + min(6, optional sections × 1.5). Required: education, skills |
| Experience evidence | 15 | min(7, projects × 2.2) + min(5, internships × 2.5) + min(3, jobs × 3) |
| Contact information | 10 | name 3 + email 3 + phone 2 + LinkedIn/GitHub link 2 |
| Education details | 10 | any education 4 + CGPA/percentage 3 + institution 1.5 + graduation year 1.5 |
| Quantified impact | 10 | min(10, quantified phrases × 1.8) — regex for %, counts, "by 40", "from X to Y" |
| Formatting hygiene | 10 | starts at 10; −2.5 if under 5 bullet lines, −2 if more than 5 very long lines, −2 for heavy table layout, −1.5 for unusual symbols |
| Action verbs | 5 | min(5, distinct action verbs × 0.45) − min(2, weak phrases × 0.7) |
| Length appropriateness | 5 | under 200 words 1.5 · 200–700 words 5 · 701–1,100 words 3.5 · longer 2 |

Each "min(…)" is a **cap**: it gives diminishing returns, so listing 40 skills cannot outscore a balanced resume.
The scoring favours projects over jobs because the target users are freshers.

`ATS score = sum of criterion scores`. Each criterion returns its score, maximum and a plain-language detail, so
the breakdown **is** the explanation.

**Keyword match against a job description:** for each JD keyword, canonicalise it; if it is a taxonomy skill,
check the resume's skill set; otherwise do a word-boundary text search.
`coverage = matched / (matched + missing) × 100`.

> **Say this:** it is a rule-based approximation to help students improve a resume. It is not any employer's
> real ATS, and the response carries that disclaimer.

---

## 6. Job matching

*File: `ai-service/app/agents/job_matching_agent.py`*

```
match = 0.55 × required-skill coverage
      + 0.20 × preferred-skill coverage
      + 0.15 × semantic similarity (profile text vs JD text)
      + 0.10 × eligibility fit (CGPA, backlogs)
```

- Coverage is computed on **canonical** skills, so aliases match.
- Semantic similarity is the cosine similarity of two embedding vectors, clamped to [0, 1].
- Eligibility is also a **hard gate**: failing a stated CGPA or backlog limit sets `eligible = false` whatever the score.

**Why is required-skill coverage 55%?** It is what a recruiter filters on first. Semantic similarity is kept to
15% so the score never becomes an unexplainable embedding number.

---

## 7. Embeddings and vector search

*Files: `ai-service/app/services/embeddings.py`, `rag/vector_store.py`*

### 7.1 Default embedder: feature hashing (the "hashing trick")

Each text becomes a 384-dimensional vector:

1. Tokenise; count each token.
2. For each token: `weight = (1 + ln(count)) × sign(token)` — **sub-linear term frequency**, so the tenth
   occurrence matters far less than the first. The sign (+1/−1 from a hash) reduces collision bias.
3. Add the weight to bucket `MD5(token) mod 384`.
4. For tokens longer than 5 characters, also add **character trigrams** at 0.25 weight, so "optimise" and
   "optimisation" land near each other.
5. **L2-normalise** the vector.

**Be precise in the viva:** this is a *lexical* embedding, not a semantic model. It was chosen because it needs no
download or network. `EMBEDDING_PROVIDER` can switch to `sentence-transformers` (all-MiniLM-L6-v2) or OpenAI
embeddings for true semantic similarity.

### 7.2 Cosine similarity

`cos(a, b) = (a · b) / (‖a‖ ‖b‖)`. Because all vectors are L2-normalised, **cosine similarity equals the dot
product**, so search is one matrix–vector multiplication.

### 7.3 Vector stores

| Store | Algorithm | Complexity per query |
|---|---|---|
| `numpy` (default) | exact brute-force cosine | O(N·d) |
| `faiss` | `IndexFlatIP` — exact inner product | O(N·d), optimised |
| `chroma` | external vector database | — |

Both built-in stores are **exact** search, not approximate (no HNSW/IVF). That is correct for a small knowledge
base; approximate indexes only pay off at much larger scale.

---

## 8. Retrieval-Augmented Generation (RAG)

*Files: `ai-service/app/rag/chunking.py`, `pipeline.py`*

```
Ingest:  document ─► chunk ─► embed ─► vector store
Query:   question ─► embed ─► top-k search ─► relevance filter ─► LLM with retrieved context ─► answer + sources
```

### 8.1 Chunking

- Target size **900 characters**, **150 characters overlap**.
- Splits on **paragraph**, then **sentence** boundaries — never mid-sentence. Only an over-long sentence is split by words.
- The tail of each chunk is carried into the next as overlap, so a fact on a boundary is not lost.
- Chunks under 40 characters are dropped.

### 8.2 Retrieval and the relevance threshold

- Retrieve the **top 5** chunks by cosine similarity.
- **Discard any chunk below the relevance threshold**: 0.18 for the lexical embedder, 0.25 for semantic embedders.
- **If nothing survives, the LLM is not called at all.** The system returns a fixed "the knowledge base does not
  contain verified information on this" answer.

**How 0.18 was chosen:** measured, not guessed. On-topic questions scored 0.28–0.31, domain-adjacent but
unanswerable questions about 0.14, and unrelated questions 0.02–0.07. The threshold sits in the gap.

> **Likely question: "How do you stop hallucination?"** Three layers: (1) the relevance filter refuses to answer
> without evidence, (2) the model is given only retrieved text and told to answer from it, (3) answers carry their
> sources, and unsourced seed documents are labelled "unverified".

---

## 9. APIE — Adaptive Placement Intelligence Engine

*Files: `ai-service/app/services/apie.py`, `backend/src/services/apie.service.ts`*

The central algorithm. It turns all evidence about a student into one explainable **Placement Readiness Score**.

### 9.1 Step 1 — recency-weighted evidence (in the Node gateway)

For each component, results are ordered newest first and combined as:

```
value = Σ (score_i × 1/(i+1)) / Σ 1/(i+1)        i = 0 for the newest result
```

A **harmonic decay**: the newest result has weight 1, the next ½, then ⅓. Improvement shows quickly, but one bad
day does not erase a track record.

### 9.2 Step 2 — weighted base score

| Component | Weight | | Component | Weight |
|---|---|---|---|---|
| Coding | 0.25 | | Communication | 0.15 |
| Technical interview | 0.20 | | Aptitude | 0.10 |
| Resume & ATS | 0.10 | | Academic | 0.10 |
| HR interview | 0.10 | | | |

There are seven components. Group Discussion was removed from the platform; its former 0.10 was split between
Coding (+0.05) and Communication (+0.05). That split is a stated design choice, not a measured one.

```
base = Σ (normalised_component × weight) / Σ weights
```

Two design decisions to explain:

- **Missing evidence counts as zero, and still uses its weight.** A student who has never taken a coding test is
  not "coding-ready by default". The UI shows it as "no evidence", never as a zero score.
- **Academic** is derived: `CGPA/10 × 100 − min(25, backlogs × 8)`.

### 9.3 Step 3 — bounded modifiers

| Modifier | Formula | Range |
|---|---|---|
| Projects | min(count, 4)/4 × 3 | 0 to +3 |
| Certifications | min(count, 4)/4 × 2 | 0 to +2 |
| Internships | min(months/6, 2)/2 × 3 | 0 to +3 |
| Alumni feedback | (score − 60)/40 × 4, clamped | **−4 to +4** |

`final = clamp(base + Σ modifiers, 0, 100)`

Alumni feedback is the **human-in-the-loop** signal: a verified alumnus' mock-interview rating moves the score in
either direction.

### 9.4 Step 4 — bands

| Score | Band |
|---|---|
| 0–39.99 | At Risk |
| 40–59.99 | Needs Improvement |
| 60–79.99 | Placement Ready |
| 80–100 | Highly Ready |

### 9.5 Derived outputs

- **Strengths:** components ≥ 70. **Weaknesses:** components < 50, plus any with no evidence.
- **Target-role readiness:** `0.65 × overall + 0.35 × role skill coverage`.
- **Target-company readiness:** overall, minus 20 if below the company's CGPA minimum, minus 15 if over its
  backlog limit, then blended `0.7 × that + 0.3 × job-match score`.
- **Reassessment triggers:** any component whose evidence is older than 30 days is flagged stale.
- **Skill gaps:** a skill missing for one target role is HIGH; missing for two or more roles is CRITICAL.
- **Improvement tracking:** every computation is stored as an append-only snapshot; the delta from the previous
  one is reported.

> **Likely question: "How were the weights chosen? Are they validated?"** Answer: they are a defensible starting
> point based on campus-placement practice — coding and technical rounds are usually the main filters. They are
> **not empirically validated**. They are configurable at runtime, stored with each snapshot, and every score
> carries a "PROTOTYPE SCORING MODEL" label. Validating them needs real placement outcomes.

> **"Why not a simple average?"** An average treats aptitude and coding as equal, ignores how recent the evidence
> is, and rewards missing data. APIE is weighted, recency-aware and evidence-aware.

---

## 10. Machine learning model — readiness band prediction

*Files: `ai-service/app/ml/features.py`, `synthetic_data.py`, `train.py`, `predict.py`*

### 10.1 Task

Multi-class classification into the four readiness bands, from **14 features**: the 7 component scores, project
count, certification count, internship months, alumni feedback score, open skill gaps, assessments taken and
interviews taken.

### 10.2 Algorithms

| Model | Hyperparameters |
|---|---|
| **Random Forest** (default) | 300 trees, max depth 12, min samples per leaf 4, balanced class weights |
| Gradient Boosting (alternative) | 250 trees, learning rate 0.08, max depth 4 |

Pipeline: `StandardScaler → classifier`. 80/20 **stratified** split, plus stratified k-fold cross-validation.

**How a Random Forest works (if asked):** many decision trees, each trained on a bootstrap sample of the rows and
considering a random subset of features at each split; the forest predicts by majority vote. Averaging many
decorrelated trees reduces variance (overfitting). `predict_proba` gives class probabilities, and the largest is
reported as confidence.

**Why Random Forest?** It works well on small tabular data, needs little tuning, handles mixed feature scales, and
gives feature importances for explanation.

### 10.3 Training data — synthetic, and labelled as such

There are no real placement outcomes yet, so the model is trained on a **documented synthetic dataset**:

- Students are drawn from four ability archetypes (22% / 34% / 30% / 14%), with scores correlated to ability.
- A latent readiness is computed from weights mirroring APIE, plus **Gaussian noise (σ = 6.5)** for unmeasured
  factors, and **6% of labels are flipped to an adjacent class**.

**Why add noise on purpose?** Without it, the labels would be a clean function of the features and the model would
score ~99% — a number that means nothing. The noise makes the metric say something about the pipeline.

### 10.4 Measured result (saved model)

| Metric | Value |
|---|---|
| Test accuracy | 0.735 |
| Macro precision / recall / F1 | 0.740 / 0.737 / 0.737 |
| 3-fold CV accuracy | 0.739 ± 0.020 |
| Data | 2,000 synthetic rows (1,600 train / 400 test) |
| Top features | academic 0.191, coding 0.157, technical 0.151, ATS 0.099, communication 0.087 |

> **Say this exactly:** "This is a prototype evaluation on a synthetic dataset. It shows the pipeline works; it is
> not evidence that the model predicts real placements." The API and UI attach that label to every prediction.

**Explainability:** predictions return the model's global feature importances paired with the student's values.
The code states this is *not* a per-prediction causal attribution (it is not SHAP).

---

## 11. Adaptive AI interview

*File: `ai-service/app/agents/interview_agents.py`*

### 11.1 Loop

```
generate question ─► (spoken via browser TTS) ─► student answers (typed or speech-to-text, editable)
        ▲                                                         │
        └── adapt difficulty ◄── recompute overall ◄── LLM scores 5 dimensions
```

### 11.2 Difficulty adaptation (a threshold controller)

Look at the **last 3** answer scores. Do nothing until at least 2 exist (one answer is too noisy).

| Mean of recent scores | Action |
|---|---|
| ≥ 78 | step up one level (EASY → MEDIUM → HARD) |
| ≤ 42 | step down one level |
| otherwise | hold |

The reason is returned to the student ("Recent answers averaged 81/100, so difficulty was increased").

### 11.3 Answer evaluation

The LLM scores five dimensions (0–100). The **overall is recomputed in code** with mode-specific weights:

| Dimension | Technical | HR | Behavioural |
|---|---|---|---|
| Relevance | 0.20 | 0.25 | 0.20 |
| Correctness | 0.35 | 0.15 | 0.15 |
| Completeness | 0.25 | 0.20 | 0.20 |
| Communication | 0.12 | 0.25 | 0.20 |
| Structure | 0.08 | 0.15 | 0.25 |

Technical rounds reward correctness; behavioural rounds reward structure (the STAR format).

### 11.4 Delivery signals — measured from the words only

- Word count; verdict: under 40 words = too short, 40–260 = appropriate, above = too long.
- Filler-word rate = filler words / total words.
- `clarity = 100 − 600 × fillerRate − 6 × hedgeCount`, clamped to 0–100.

**These come from the transcript text, never from audio.** There is no accent, emotion, tone or facial analysis.

### 11.5 Voice

- **Speech-to-text:** the browser's Web Speech API (on-device), with a server Whisper fallback behind a provider abstraction.
- **Text-to-speech:** the browser's `speechSynthesis`.
- **Fairness guarantee:** whether an answer was spoken or typed is stored for analytics but **not sent to the
  evaluator**, so identical words get identical scores. Verified end-to-end (94.4 vs 94.4).

---

## 12. DSA judge (deterministic code evaluation)

*Files: `backend/src/services/execution/` — `codegen.ts`, `sandbox.ts`, `dockerRunner.ts`, `languages.ts`,
`judge.service.ts`. Setup and limits: `docs/DSA_JUDGE.md`.*

No machine learning and no LLM is involved in a verdict. The same code and the same tests always give the same
result.

### 12.1 From one signature to four languages

A problem stores a typed signature, for example `twoSum(nums: int[], target: int) -> int[]`. From it the
backend **generates** two things per language (Python, C++, Java, JavaScript):

- the **starter code** the student sees — only the function to implement;
- the **harness** wrapped around the student's code: it reads the arguments from standard input, calls the
  function, and writes the returned value as JSON to a result file.

Standard output is left to the student's own prints (the Console tab), so a debug print can never be mistaken
for an answer. Supported types: `int`, `long`, `double`, `bool`, `string`, `int[]`, `string[]`, `int[][]`,
lists of lists, `ListNode` and `TreeNode`.

### 12.2 Isolated execution

Each submission runs in its **own throw-away Docker container**: no network, read-only root filesystem,
non-root user, all Linux capabilities dropped, with memory, CPU and process-count limits, and removed
afterwards. Student code is never executed on the API server.

Two properties protect the hidden tests:

1. **Expected outputs never enter the container.** Only inputs are sent; comparison happens on the host.
2. **Inputs are streamed one test at a time.** While a public test runs, the hidden inputs are not in the
   container yet.

### 12.3 Verdict

For each test, in order:

```
killed at the time limit                      -> Time Limit Exceeded
killed for memory, or an out-of-memory error  -> Memory Limit Exceeded
non-zero exit, or no value returned           -> Runtime Error
returned value != expected                    -> Wrong Answer
otherwise                                     -> Accepted
```

A compile failure is a **Compilation Error** and no test runs. If the sandbox itself fails (Docker not
running, image missing) the result is **Internal Error / not executed** — never a guessed verdict. The verdict
of a submission is the verdict of its **first failing test**; the score is `passed / total × 100`.

### 12.4 Comparator

Both sides are parsed as JSON and compared structurally, so spacing, trailing newlines or `5` versus `5.0`
cannot change a verdict. Floating-point answers use a relative tolerance of 1e-6. A problem may declare that
list order does not matter (`unordered`, `unorderedNested`), e.g. Two Sum or Subsets.

### 12.5 Limits

Defaults are 2 s and 128 MB per problem. Interpreted and JIT languages get a longer time limit
(C++ ×1, Java ×2, JavaScript ×2, Python ×3), a common practice so one limit is fair across languages.

### 12.6 What the AI does here

After the verdict is final, the Coding Assessment agent produces a **Static Code Analysis** (estimated
complexity, readability, suggestions). It is advisory, shown separately from the "Code Execution Result", and
cannot change a verdict or a score.

> **Likely question: "Was the sandbox tested?"** Answer honestly: the judge logic (harnesses, runner script,
> comparator, verdicts) is verified by automated tests that judge 28 reference solutions in all four languages
> using local compilers. Container isolation is verified separately by `npm run judge:verify` on a machine with
> Docker; state whether you have run it and what it reported.

---

## 13. Mentor matching

*File: `ai-service/app/agents/mentorship_agent.py`*

```
match = 0.35 company + 0.20 role + 0.20 skills + 0.15 gap coverage + 0.05 rating + 0.05 availability
```

Company match dominates because company-specific insight is what a student cannot get elsewhere. Rating is only
5% so new alumni are not buried. Alumni feedback after a session becomes a bounded ±4 modifier in APIE.

---

## 13A. Skill recommender (trained model)

*Files: `ai-service/app/ml/skill_recommender.py`, `careerpilot_skills/train_skill_recommender.py`,
report in `careerpilot_skills/skill_recommender_report.json`*

### What it does

Given the skills a student has and the skills their target role requires, it answers two questions for the
roadmap: **in what order should the required skills be learned**, and **which adjacent skills are worth adding**.

### Data — real, and one source was rejected

Skill sets ("baskets") are extracted with the skill taxonomy from **real job descriptions and resumes**:
844 distinct baskets (594 train / 115 validation / 135 test), 84 skills.

The 4,817 structured resumes were tested and **rejected**. Beyond the one skill implied by the job title, their
skills were statistically independent of each other — Django–Python lift 1.06, where 1.00 means "unrelated".
They were randomly generated. In the data actually used, the same pair has lift 4.3, and Docker–Kubernetes 12.

> **Lift** = P(A and B) ÷ (P(A) × P(B)). Above 1 means the two skills appear together more often than chance.

### Algorithm — item-based collaborative filtering

The same idea as "people who bought this also bought", applied to skills:

```
similarity(i, j) = cooccurrence(i, j) / ( sqrt(count_i × count_j) + shrinkage )
score(candidate) = sum of similarity(candidate, s) over the skills s the student has
```

- This is **cosine similarity** between two skills' occurrence patterns.
- **Shrinkage** (5) pulls down similarities built on very few co-occurrences, so a pair seen together twice does
  not outrank a well-supported one.

### Model selection

Three models were fitted on the training baskets and compared on validation data:

| Model | Idea |
|---|---|
| Popularity | always recommend the most common skills (the baseline) |
| **Item similarity (selected)** | the formula above |
| PPMI + SVD embeddings | factorise the skill association matrix into 32-dimensional vectors |

### Measured result — test baskets, used once

Evaluation is **leave-one-out**: hide one skill from a basket, ask the model to rank all missing skills, and see
where the hidden one lands (1,473 trials).

| Model | MRR | Recall@5 | Recall@10 |
|---|---|---|---|
| Random guessing | — | ~0.06 | — |
| Popularity baseline | 0.195 | 0.272 | 0.476 |
| **Item similarity** | **0.313** | **0.411** | **0.585** |
| PPMI + SVD | 0.238 | 0.348 | 0.483 |

Gain over the baseline in Recall@5: **+0.138, 95% confidence interval +0.101 to +0.176** (paired bootstrap over
baskets). The interval excludes zero, so the improvement is not chance.

> **Recall@5** = how often the hidden skill is in the top 5. **MRR** = average of 1 ÷ rank; higher is better.

Two honest findings to mention:

- **The simpler model won.** The embedding model lost to plain item similarity, which is common on small data.
- **A fix I expected to help was rejected by the data.** Penalising very popular skills made validation results
  worse at every setting (MRR 0.286 → 0.235 → 0.089), so it is switched off.

### Where it is used now

The recommender was originally wired into the Career Roadmap agent, which ordered required skills and added
adjacent skills by readiness band. **That agent has been removed from the platform**, so the recommender no
longer shapes a plan at runtime. The model, its training script and its evaluation report remain, and its
skill co-occurrence data is reused read-only as job-demand evidence when the Career Plan knowledge base is
built (`careerpilot_career/training/build_career_knowledge.py`). Present it as a trained and evaluated model
whose runtime integration was retired, not as a live feature.

### Safeguards

- It never recommends a skill the student already has.
- If it recognises none of the student's skills, it falls back to popularity **and says so** (`basis: "popularity"`).
- The model is a small JSON file (an 84 × 84 table), so it can be inspected and loading it cannot run code.

### Limitations

- Small data: 844 baskets, mostly US general-IT resumes, so broad skills (Java, SQL) rank high.
- Only the 84 skills seen often enough in training can be recommended.
- It models what appears together, not what causes employability.
- One source dataset declares no licence — fine for academic work; check before commercial use.

---

## 14. Assessment engine and integrity

- **Server-authoritative timing:** the deadline is stored on the server; the browser timer is only a display.
- **Autosave and recovery:** answers save as the student works and survive a refresh.
- **Server-side grading:** correct answers never reach the browser.
- **Code execution:** student code is **never run in the Node process** or on the host; it runs only in an
  isolated container (section 12). If the sandbox is unavailable, nothing is run and no score is awarded.
- **Integrity monitoring:** signals such as tab switches raise a LOW/MEDIUM/HIGH indicator **for a human to
  review**. A signal never fails a student automatically, and the student can see every signal recorded.

---

## 15. Security algorithms

| Concern | Technique |
|---|---|
| Passwords | bcrypt hashing with salt (12 rounds) — never stored in plain text |
| Sessions | JWT access tokens (15 min) + refresh tokens (7 days) |
| Stolen refresh token | **rotation with family revocation**: each refresh issues a new token; reuse of an old one revokes the whole family |
| Authorisation | role-based access control across four roles, enforced in middleware |
| Input | Zod schema validation plus sanitisation at the boundary (prevents NoSQL injection) |
| Abuse | rate limiting, stricter on authentication routes |
| Headers | Helmet, CORS allow-list |

---

## 16. Responsible-AI design decisions

- No emotion, facial-expression, demographic, identity or disability inference anywhere.
- Camera and microphone only after explicit consent; nothing is secretly recorded.
- Every score is explainable: it comes with its components, weights and reasons.
- Data provenance is labelled **DEMO / SYNTHETIC / REAL** and never mixed.
- Prototype models are labelled as prototypes wherever they appear.

---

## 17. Quick answers for the jury

| Question | Answer |
|---|---|
| Which algorithms did you use? | Rule-based NLP with regex and a skill taxonomy; weighted multi-criteria scoring (ATS, APIE, job match); feature hashing + cosine similarity; RAG with a relevance threshold; Random Forest / Gradient Boosting; item-based collaborative filtering for skill recommendation; a threshold controller for adaptive difficulty; LLMs with structured JSON output; QLoRA fine-tuning (prepared). |
| Where is the LLM used? | Generating interview questions, evaluating free-text answers, static code review, phrasing advice. Never for computing a final score. |
| What if the LLM is down? | Scores still work — they are deterministic. Only the wording degrades, and the response is marked `degraded`. |
| Is the accuracy real? | The 73.5% is on a synthetic dataset and is labelled a prototype evaluation. There is no real-outcome accuracy yet. |
| Is the readiness score validated? | No. It is a configurable prototype model, labelled as such. |
| What is novel? | APIE as one explainable, recency-aware, human-in-the-loop readiness model fed by every module; plus structural guarantees (scores recomputed in code, voice excluded from evaluation, no automatic failing). |
| Main limitations? | Unvalidated weights; synthetic ML data; lexical default embeddings; dictionary-bound skill extraction; fine-tuned models not yet usable; the code sandbox needs Docker on the host and its isolation must be verified there. |
| Future work? | Collect real placement outcomes to validate weights and retrain the model; train and evaluate the fine-tuned ATS model; add semantic embeddings; harden the judge with a seccomp profile and a dedicated judge host. |
