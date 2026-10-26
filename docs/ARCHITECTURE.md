# Architecture

This document explains how CareerPilot AI is put together and, more usefully, **why** the significant
decisions were made the way they were.

---

## 1. Service boundaries

Three deployable units, split along the lines where the runtime requirements genuinely differ:

| Service | Runtime | Owns |
|---|---|---|
| **Frontend** | Static assets behind nginx | Rendering, client state, WebRTC peer connections |
| **Backend** | Node.js 22 | Authentication, authorisation, persistence, orchestration, reports, Socket.IO |
| **AI service** | Python 3.12 | NLP, ML, embeddings, RAG, the agent framework, APIE computation |

**Why split Node and Python at all?** The NLP and ML ecosystem (spaCy, scikit-learn, PyMuPDF,
sentence-transformers) is Python's. Reimplementing resume parsing or a Random Forest in JavaScript would be
worse in every respect. Meanwhile the API gateway wants Node's ecosystem for auth, Mongoose and Socket.IO.
Splitting lets each side use the tools it is actually good at.

**Why not split further?** Every additional service adds a network hop, a failure mode and a deployment
step. Three is the smallest number that captures the real runtime differences.

### The trust boundary

The AI service is **internal-only**. It requires an `X-Internal-Key` shared secret on every route except
`/health*`, its CORS allowlist contains only the backend, and `docker-compose.yml` deliberately does not
publish its port. All authentication, authorisation and audit happen in the Node gateway; the AI service
trusts its caller precisely because nothing else can reach it.

---

## 2. Data flow: the central loop

```
 Student profile
      │
      ▼
 Resume upload ──► storage abstraction (local disk / S3)
      │
      ▼
 POST /ai/resume/analyze ──► extract text ──► parse sections ──► extract skills ──► ATS score
      │
      ├──► merged into StudentProfile (skills marked verified)
      │
      ▼
 Job matching ──► required-skill coverage · semantic similarity · eligibility
      │
      ▼
 Assessments / interviews / DSA submissions ──► scores persisted
      │
      ▼
 recomputeReadiness()  ◄── triggered by EVERY scoring activity
      │
      ├──► collectEvidence()      gather all component scores, recency-weighted
      ├──► POST /ai/readiness/predict
      │        ├──► APIE: normalise · weight · modify · band
      │        └──► ML classifier: second opinion with confidence
      ├──► persist a new PlacementReadiness snapshot (append-only)
      ├──► upsert SkillGap records, resolve those no longer present
      ├──► replace ACTIVE recommendations
      ├──► emit readiness:updated over Socket.IO
      └──► notify only on a band change
      │
      ▼
 Career Plan ──► role skill gaps, phased plan and verified resources
      │
      ▼
 Alumni mock interview ──► structured human feedback ──► back into APIE
```

The important property: **there is no manual "recalculate" step in the critical path.** Every activity that
produces a score calls `recomputeReadiness`, so the number on the dashboard is never stale relative to what
the student has done.

---

## 3. APIE — the Adaptive Placement Intelligence Engine

APIE is the system's centre of gravity. It lives in `ai-service/app/services/apie.py`.

### It is deliberately not an average

```
base = Σ (normalised_component × weight) / Σ weight

score = clamp(base + Σ modifiers, 0, 100)
```

Default weights (configurable at runtime, validated to sum to 1.0):

| Component | Weight | Rationale |
|---|---|---|
| Coding | 0.25 | The heaviest screening filter for engineering roles |
| Technical interview | 0.20 | Equal weight: knowing and explaining are both required |
| Resume / ATS | 0.10 | A gate rather than a differentiator — but a hard one |
| HR interview | 0.10 | A real elimination stage even for strong technical candidates |
| Communication | 0.15 | Affects every round, not just HR |
| Aptitude | 0.10 | Usually the first automated filter |
| Academic | 0.10 | CGPA cut-offs are applied before anything else |

Modifiers (bounded, so they inform rather than dominate): projects up to +3, certifications up to +2,
internship experience up to +3, and **alumni feedback ±4** — the human-in-the-loop term.

### Three design decisions worth explaining

**Missing evidence costs points.** A component with no evidence still consumes its full weight rather than
being excluded from the denominator. A student who has never attempted a coding test is not
"coding-ready by default", and excluding the component would produce a flattering score built on nothing.
The UI shows these as `—` with "No evidence recorded yet", never as a zero, so the student can tell the
difference between *not tried* and *tried and scored 0*.

**Recency weighting inside a component.** `collectEvidence` weights the most recent result at 1, the next
at 1/2, then 1/3. Improvement shows up quickly without a single bad day erasing a track record.

**Staleness triggers reassessment, not decay.** Evidence older than `apie.reassessmentDays` is flagged
`stale` and appears in `reassessmentSuggestions`, but its value is not silently reduced. Quietly decaying a
score the student cannot see changing would be unexplainable.

### Explainability

Every computation returns the full working: each component's raw value, normalised value, weight, weighted
contribution, evidence count, last-updated timestamp and staleness; every modifier with its delta and a
plain-English reason; and the exact weight snapshot used. The readiness page renders all of it. A student
who asks "why is my score 62?" can be given a complete answer.

---

## 4. The agent framework

### Structure

`BaseAgent` (`ai-service/app/agents/base.py`) gives every agent, for free:

- **Input validation** against a declared Pydantic schema — a malformed request is rejected before any work
- **Output validation** against its own declared schema — an agent producing malformed output fails loudly
  rather than writing bad data to the database
- Latency measurement, structured logging, and error containment

### Orchestration

**Agents never call each other.** Composition happens only in `orchestrator.py`, through named workflows
with an explicit finite step list:

| Workflow | Steps |
|---|---|
| `RESUME_TO_MATCH` | Resume intelligence → job matching (extracted skills feed the matcher directly) |
| `INTERVIEW_TURN` | Evaluate the previous answer → generate the next question |

This is what makes the call graph acyclic and every multi-agent flow auditable as a single named operation.
An agent cannot trigger an unbounded chain, because it has no way to invoke another agent.

### The LLM abstraction

`ai-service/app/services/llm.py` exposes one interface with four implementations: `openai` (any
OpenAI-compatible endpoint), `azure`, `ollama` (local models), and `mock`.

Nothing above this module knows which provider is running. Agents call `complete_json()` and receive a
validated dict.

**The mock provider deserves explanation.** It is not an attempt to imitate a language model. It reads a
machine-readable task directive from the system prompt and a JSON context block from the user message, then
assembles a schema-valid response using real rules over the real input — a React question is generated
*because* the resume contains React. This makes the entire platform demonstrable with no API key and no
network, while exercising every downstream code path: parsing, validation, scoring, persistence, rendering.
Every mock response is tagged `provider: "mock"` and carries a visible notice.

### The speech abstraction

Voice-assisted interviews (§11) sit on the same pattern, in two independent halves.

**Recognition (speech → text)** has a browser side and a server side, chosen at runtime:

```
frontend/src/services/speech/
  types.ts          SpeechProvider / SpeechSynthesisProvider contracts
  browserSpeech.ts  Web Speech API — recognition happens on-device
  serverSpeech.ts   MediaRecorder ──► POST /api/v1/speech/transcribe
  index.ts          detectSpeechCapabilities(): prefers browser, falls back to server
```

The server path terminates at `ai-service/app/services/speech.py`, which mirrors the LLM abstraction: a
`SpeechProvider` ABC with `NullSpeechProvider` (the default — it raises `SpeechUnavailable` carrying an
actionable message rather than returning empty text) and `WhisperSpeechProvider` (faster-whisper, decoded
from an in-memory buffer that is never written to disk).

Two consequences of doing it this way:

- A browser without the Web Speech API is not silently downgraded to a broken microphone button. The client
  asks `GET /api/v1/speech/status` first and is told which path it has, including that it has none — in which
  case the UI says so and the student types.
- Swapping Whisper for a hosted STT vendor is one class. Nothing above the provider knows the difference,
  and the ethical guarantee below does not depend on which one is running.

**Synthesis (text → speech)** is browser-only, via `speechSynthesis`. No audio is generated or stored
server-side, and a browser without it simply shows the question text.

**Where voice deliberately does not reach.** `inputMode` (`TEXT` | `SPEECH`) is persisted on interview
responses for analytics, and is excluded from the payload sent to the evaluation agent. This is
structural rather than a prompt instruction: an evaluator that knew an answer was spoken could excuse or
penalise disfluency, making a score depend on input method. The exclusion is asserted by a test that reads
`interview.service.ts` itself, and verified end-to-end by scoring identical text through both modes.

---

## 5. RAG pipeline

```
Document ──► chunk (sentence/paragraph aligned, overlapping)
         ──► embed  ──► vector store (numpy | FAISS | Chroma)

Query    ──► embed  ──► retrieve top-k  ──► relevance filter
         ──► if nothing survives: "I do not have verified information"
         ──► else: LLM with grounded context ──► answer + source metadata
```

**The relevance filter is the point.** Chunks scoring below the threshold are discarded, and if nothing
survives the pipeline returns an explicit no-information answer rather than asking a model to improvise.
This is what stops the system inventing a company's recruitment policy.

The threshold is provider-aware, and calibrated from measurement rather than guessed. Against the seeded
corpus with the lexical hash embedder:

| Query type | Observed top score |
|---|---|
| On-topic | 0.28 – 0.31 |
| Off-topic but domain-adjacent | 0.11 – 0.14 |
| Entirely unrelated | 0.02 – 0.07 |

The lexical cut-off is **0.18**, sitting in the clean gap between the first two rows: it keeps genuine
matches and rejects questions the corpus merely shares vocabulary with. Semantic embeddings occupy a higher
range and use 0.25. Calibrating one threshold for both would either reject everything or accept everything.

*(The original value of 0.08 was too permissive — the end-to-end smoke run caught it letting a
domain-adjacent but unanswerable question through, which is exactly the case the filter exists to stop.)*

**Sourcing.** A `RAGDocument` with no `sourceUrls` is labelled unverified throughout the UI, and seeded
company recruitment patterns deliberately carry no sources — they are illustrative demonstration data, and
the platform says so rather than presenting them as fact.

The hash embedder exists so the RAG path works offline with zero dependencies. It is a deterministic hashed
bag-of-words projection with sub-word shingles and sub-linear term weighting — genuinely useful for the
lexical retrieval this corpus needs, and honestly not a semantic model.

---

## 6. The assessment engine

The full-screen assessment (§13) has more moving parts than anything else in the system.

### Server-authoritative timing

The deadline lives on the `AssessmentAttempt` document. The client receives `expiresAt` plus `serverTime`,
computes the clock skew once, and displays a smooth local countdown. Socket.IO pushes the authoritative
remaining time every five seconds and corrects any drift. A student with a wrong system clock still sees
the correct time; a student who manipulates their clock gains nothing, because submission is validated
against the server's deadline.

### Session recovery

Question order is frozen at start and stored on the attempt. Starting an assessment that already has a live
attempt **resumes** it rather than replacing it, restoring every saved answer, review flag and per-question
timing. A refresh, a crashed tab or a dropped connection costs nothing.

### Autosave

Debounced at 1.5 seconds, merged rather than replaced (so a partial save from one tab cannot wipe another's
answers), queued and retried while offline, and flushed before submission. The endpoint is deliberately
excluded from rate limiting — throttling a save to protect the server would cost the student their work,
which is the wrong trade.

### Grading

Entirely server-side, reading `correctAnswer` directly from the question bank. `correctAnswer` and
`explanation` are projected out at the database level while an attempt is live, so they cannot leak through
a serialisation mistake. `MULTI_SELECT` requires an exact set match — partial credit would reward selecting
every option.

---

## 7. Integrity monitoring, and its limits

Signals recorded: full-screen exit/enter, tab visibility, window focus, copy, paste, inactivity, rapid
answering, network transitions, multiple sessions, and — **only with explicit consent** — face presence and
multiple-person detection.

Three rules are enforced in code, not just documented:

1. **Nothing auto-fails.** Signals accumulate points into a LOW/MEDIUM/HIGH indicator. Even HIGH only routes
   the attempt to a human reviewer. A test asserts that a 100%-scoring attempt with twelve full-screen exits
   still passes with its score intact.
2. **A single signal never reaches HIGH.** Leaving full screen once is MEDIUM at most. Reaching HIGH requires
   an accumulated pattern, because brief tab switches happen for innocent reasons.
3. **The student sees everything.** Every recorded signal, with its severity and a plain-English
   explanation, appears in their own result. Monitoring is disclosed before the assessment starts and is
   never covert.

Deliberately absent: any inference of identity, demographics, emotion or disability. The webcam signals are
face-presence and person-count only.

---

## 8. Security

| Layer | Measure |
|---|---|
| **Transport** | Helmet with CSP, HSTS in production, strict CORS allowlist |
| **Authentication** | bcrypt (12 rounds), JWT access tokens (15 min), refresh-token rotation with family revocation on reuse |
| **Session** | Account status re-checked on every request, so a suspension takes effect immediately rather than at token expiry |
| **Authorisation** | Role middleware plus per-resource ownership checks; staff access to a student record is audited |
| **Input** | Zod validation on every mutating endpoint; `$`-prefixed and dotted keys stripped from body, query and params |
| **Uploads** | MIME + extension + **magic-byte** verification; a renamed executable cannot pose as a PDF |
| **Storage** | Opaque non-guessable keys, path-traversal guards, files streamed through authenticated routes and never served statically |
| **Code execution** | Never in-process. `eval`, `vm` and `child_process` are absent from the codebase by design |
| **Rate limiting** | Tiered: global, strict on credentials, per-user on AI and uploads |
| **Audit** | Authentication, privileged actions, data exports and cross-user access all recorded |

### A note on `sanitizeFilter`

`mongoose.set('sanitizeFilter', true)` is deliberately **not** used. It rewrites every `$`-prefixed operator
in a filter to `$eq`, which corrupts the application's own legitimate queries —
`{ createdAt: { $gte: date } }` becomes `{ createdAt: { $eq: { $gte: date } } }` and throws. Injection is
prevented at the boundary instead, where user input actually enters: the sanitiser strips dangerous keys
from every request object before a handler sees them, and Zod coerces the survivors to primitives.

*(This was found by the RBAC test suite, which caught the resulting 400s on every aggregate endpoint.)*

---

## 9. Data provenance

Three labels that must never be mixed, enforced at the schema level:

| Label | Meaning |
|---|---|
| `DEMO` | Seeded demonstration content |
| `SYNTHETIC` | Generated by a documented statistical process for ML training |
| `REAL` | Actual institutional records |

Demo accounts additionally carry `isDemoAccount: true`. The research export tags every row with its
provenance and can filter to one label, so `DEMO` and `SYNTHETIC` records can never silently contaminate an
analysis of real outcomes.

The synthetic generator adds deliberate label noise (~6%, flipped only to an adjacent class) and unmeasured
variance. A perfectly separable synthetic dataset would yield a ~99% accuracy figure that means nothing
whatsoever; the noise keeps the reported metrics informative about the *pipeline* while remaining explicitly
synthetic. A test asserts accuracy stays between 50% and 95%.

---

## 10. Failure behaviour

The platform degrades in layers rather than falling over:

| Failure | Behaviour |
|---|---|
| AI service unreachable | Dashboards, profiles, assessments, scheduling and reports all keep working. AI features return a clear message with a retry. |
| AI fails during resume analysis | The resume stays saved; `parseStatus` records the failure and the student can retry. |
| AI fails during readiness recomputation | The activity that triggered it still completes; the existing score is unchanged. |
| AI fails during a coding submission | The submission is stored; only the AI review is missing. |
| Code execution unavailable | Reported honestly, with **no score awarded** — a fabricated pass would corrupt APIE. |
| ML model not trained | APIE still returns the authoritative score; the ML second opinion says it is unavailable. |
| MongoDB unreachable in development | Falls back to an in-memory instance with a warning. Refused in production. |
| Network drop mid-assessment | Answers queue locally and flush on reconnect; the timer continues server-side. |

---

## 11. Trade-offs accepted

**In-memory MongoDB fallback.** Makes a fresh clone run with zero setup, which matters for a project review.
Refused in production, where silent data loss would be unacceptable.

**Analytics computed in application code.** Cohort aggregation joins in Node rather than in a single
aggregation pipeline. At institutional scale (thousands, not millions) this is comfortably fast and far more
readable. It would need revisiting at a different order of magnitude.

**One vector-store process.** The numpy and FAISS stores are in-process, so the AI service runs one worker.
Scaling horizontally means switching to `VECTOR_DB_PROVIDER=chroma`.

**Append-only readiness snapshots.** Every recomputation inserts a row rather than updating one. This costs
storage but gives a complete, auditable trend and makes the research export possible. The `isLatest` flag
keeps the common read a single indexed lookup.

**PDF generation is synchronous.** Reports are built in-process on request. Fine at this scale; a job queue
would be needed for bulk institutional exports.
