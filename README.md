# CareerPilot AI

**Agentic AI-Based Placement Preparation and Career Intelligence Platform**

A university-level placement preparation ecosystem for students, alumni, placement officers and
administrators. It turns fragmented placement preparation into a continuous, measurable loop:

```
Assess → Analyse → Identify skill gap → Recommend → Practise
   ↑                                                    ↓
   └──────── Update APIE ← Alumni / AI feedback ────────┘
```

---

## Table of contents

- [What this is](#what-this-is)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Architecture](#architecture)
- [What is real, and what is a prototype](#what-is-real-and-what-is-a-prototype)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Running the tests](#running-the-tests)
- [Training the ML model](#training-the-ml-model)
- [Deployment](#deployment)
- [Feature reference](#feature-reference)
- [Documentation](#documentation)

---

## What this is

CareerPilot AI is a full-stack platform built around one idea: a student's placement readiness should be
a **single, explainable, continuously-updated number**, and everything they do in the platform should move
it.

| Capability | What it does |
|---|---|
| **Resume intelligence** | Parses PDF/DOCX/TXT, extracts structured profile data, scores against ATS criteria with a per-criterion breakdown |
| **Job & company matching** | Scores a profile against a specific opening, checks eligibility, produces a prioritised preparation plan |
| **Assessment engine** | Full-screen proctored papers with a server-authoritative timer, autosave, session recovery and ethical integrity monitoring |
| **DSA practice** | A LeetCode-style environment: 28 problems across 16 topics, Monaco editor, Python / C++ / Java / JavaScript, and a deterministic judge that runs every submission in an isolated Docker container against public and hidden tests |
| **AI mock interview** | Adaptive question selection that responds to your measured weak areas, with explainable per-answer feedback |
| **APIE** | The Adaptive Placement Intelligence Engine: a configurable weighted model producing the Placement Readiness Score |
| **ML prediction** | A Random Forest / Gradient Boosting classifier offering a second opinion alongside APIE |
| **Career Plan** | A personalised path to a target role: skill gaps, phased plan, study schedule, projects, and verified course and video resources per skill |
| **Alumni mentorship** | Verified alumni, live WebRTC mock interviews, and structured human feedback weighted into readiness |
| **Institutional analytics** | Cohort readiness, common skill gaps, at-risk identification and recommended interventions |
| **Research export** | A pseudonymised, provenance-tagged dataset for analysis |

---

## Quick start

### Prerequisites

- **Node.js 20+**
- **Python 3.10+**
- **MongoDB** — *optional.* Without it the backend starts an in-memory MongoDB automatically, so a fresh
  clone runs with no database installation.

### 1. Install

```bash
git clone <repository-url>
cd "CareerPilot AI"

npm install                                        # workspaces: shared, database, backend, frontend
python -m pip install -r ai-service/requirements.txt
python -m spacy download en_core_web_sm            # optional; improves name extraction
```

> **Recommended:** create a virtual environment first (`python -m venv .venv`) so the AI service's
> dependencies do not collide with other Python projects on your machine.

### 2. Configure

```bash
cp .env.example .env
```

The defaults run fully offline: `AI_PROVIDER=mock`, in-memory MongoDB, and development-only JWT secrets.
Nothing else is required to start. See [Configuration](#configuration) to connect a real LLM.

### 3. Seed the demo data

```bash
npm run seed
```

Creates 7 companies, 5 roles, 10 job descriptions, 6 coding problems, 3 assessments, 14 knowledge-base
documents and 6 demo accounts. Everything is tagged `provenance: DEMO`.

### 4. Train the ML model (optional)

```bash
cd ai-service && python -m app.ml.train
```

Without this, APIE still works — the readiness page simply reports that no ML second opinion is available
rather than inventing one.

### 5. Run

```bash
npm run dev
```

Starts all three services together:

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000/api/v1 |
| AI service | http://localhost:8000 (docs at `/docs`) |

Or run them individually: `npm run dev:backend`, `npm run dev:frontend`, `npm run dev:ai`.

---

## Demo accounts

After `npm run seed`, all demo accounts use the password **`Demo@Pass123`**:

| Role | Email | What to look at |
|---|---|---|
| Student | `student@careerpilot.demo` | Dashboard, resume analysis, DSA practice, assessments, interviews, readiness, career plan |
| Student | `student2@careerpilot.demo` | A second, weaker profile for cohort comparison |
| Alumni | `alumni@careerpilot.demo` | **Verified** — mentor dashboard, requests, feedback |
| Alumni | `alumni2@careerpilot.demo` | **Pending** — demonstrates the verification gate |
| Placement officer | `officer@careerpilot.demo` | Cohort analytics, student list, institutional reports |
| Admin | `admin@careerpilot.demo` | System health, alumni verification, knowledge base, APIE config, audit log |

### A 10-minute demonstration path

1. Sign in as **student** → dashboard shows the readiness score and next action
2. **Resume** → upload a PDF → ATS score with a per-criterion breakdown and extracted skills
3. **Job Matching** → pick a company/role → match score, missing skills, preparation plan
4. **Assessments** → start one → full-screen mode, live timer, autosave; refresh mid-test to see recovery
5. Submit → graded result, topic breakdown, and the integrity log shown openly to the student
6. **AI Interview** → answer two questions → watch difficulty adapt and per-answer feedback appear
7. **Readiness** → component breakdown, ML second opinion, target-role readiness
8. **Career Plan** → pick a target role → skill gaps, a phased plan and per-skill courses and videos
   **DSA Practice** → open a problem → write a solution → Run (public tests) → Submit (public + hidden tests)
9. **Alumni** → request a mentor → sign in as **alumni** → accept and schedule → open the interview room
10. Sign in as **officer** → cohort analytics, at-risk identification, recommended interventions
11. Sign in as **admin** → system health, AI usage per agent, APIE weights, audit log

---

## Architecture

```
                         React 18 + Vite + TypeScript
                                     │
                              REST  ·  Socket.IO
                                     │
                    ┌────────────────▼────────────────┐
                    │   Node.js + Express API gateway  │
                    │  auth · RBAC · validation ·      │
                    │  audit · rate limiting · APIE    │
                    │  orchestration · PDF reports     │
                    └───┬──────────────┬───────────┬───┘
                        │              │           │
              ┌─────────▼──┐   ┌───────▼──────┐   ┌▼─────────────┐
              │  MongoDB   │   │ Python /     │   │  Socket.IO   │
              │  Mongoose  │   │ FastAPI      │   │  WebRTC      │
              │  35 models │   │              │   │  signalling  │
              └────────────┘   └───┬──────────┘   └──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
        ┌─────▼─────┐      ┌───────▼──────┐      ┌──────▼──────┐
        │    NLP    │      │  ML pipeline │      │  LLM + RAG  │
        │  spaCy ·  │      │ scikit-learn │      │  provider-  │
        │  parsing  │      │  RF · GBM    │      │  agnostic   │
        └─────┬─────┘      └───────┬──────┘      └──────┬──────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                       ┌───────────▼────────────┐
                       │          APIE          │
                       │  aggregate · normalise │
                       │  weight · explain      │
                       └───────────┬────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Recommendations · CareerPlan│
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │   Alumni human-in-the-loop  │
                    └─────────────────────────────┘
```

### Multi-agent layer

Eleven agents, each with a declared responsibility, a Pydantic input schema, an output schema, validation,
logging and error containment:

`RESUME_INTELLIGENCE` · `JOB_MATCHING` · `CODING_ASSESSMENT` · `TECHNICAL_INTERVIEW` · `HR_INTERVIEW` ·
`BEHAVIORAL_INTERVIEW` · `PLACEMENT_READINESS` ·
`ALUMNI_MENTORSHIP` · `ANALYTICS`

**Agents never call each other.** All composition happens in an orchestration layer through named
workflows (`RESUME_TO_MATCH`, `INTERVIEW_TURN`), which keeps the call graph acyclic
and every multi-agent flow auditable as a single named operation.

---

## What is real, and what is a prototype

This matters more than a feature list, so it is stated plainly.

### Genuinely working

- Resume parsing, section detection, skill extraction and ATS scoring — deterministic NLP, no model needed
- The full authentication, RBAC, audit and privacy stack
- The assessment engine: server-authoritative timing, autosave, recovery, server-side grading
- APIE: the weighted readiness computation and skill-gap derivation
- The Career Plan: role skill-gap analysis, the planner, and verified per-skill resources
- The DSA judge: code generation, the sandbox protocol and verdicts for four languages (see [docs/DSA_JUDGE.md](docs/DSA_JUDGE.md) for what was and was not verified on which machine)
- The ML training and prediction pipeline
- RAG ingestion, chunking, embedding, retrieval and relevance filtering
- WebRTC signalling, the interview room, and the alumni feedback loop into APIE
- Voice-assisted AI interview (below)
- PDF report generation
- All analytics and the research export

#### Voice-assisted interview

The interview can be run by speaking instead of typing, through the **same** agents, orchestration, scoring and
readiness pipeline as the text flow — there is no separate voice code path.

The interview loop is: the agent generates a question → it is spoken via speech synthesis → the student
answers aloud → speech is recognised into an **editable** transcript → the student confirms or corrects it →
the existing evaluation agent scores it → feedback is shown → the next question adapts to the result.

Design points worth knowing:

- **Recognition is on-device by default** (Web Speech API); no audio reaches the server. Browsers without it
  fall back to a server transcription endpoint, negotiated at runtime via `GET /api/v1/speech/status` so the
  client never downgrades silently. See `SPEECH_PROVIDER` in [Configuration](#configuration).
- **The transcript is always editable** before submission, and typing alone completes every flow. Microphone
  denial, an unsupported browser and a failed recogniser each produce a named, actionable message.
- **Voice cannot affect a score.** `inputMode` is persisted for analytics but deliberately excluded from the
  evaluator payload, so identical words score identically whether spoken or typed — verified end-to-end, not
  merely asserted. No accent, fluency, emotion or identity inference exists anywhere in the pipeline.
- **Session state survives interruption.** In-progress answers are drafted to local storage per question, and
  a reload restores the session, the answered questions and the full transcript from the server.

### Clearly labelled as prototype or unavailable

| Area | Status |
|---|---|
| **APIE weights** | A defensible starting point from campus-placement practice, **not empirically validated**. Configurable at runtime; labelled "PROTOTYPE SCORING MODEL" everywhere it appears. |
| **ML metrics** | Trained on a **documented synthetic dataset** by default. Reported as *"Prototype Evaluation — Synthetic Dataset"* with the disclaimer attached. The generator adds deliberate label noise, so accuracy lands around 75% rather than a meaningless 99%. |
| **`AI_PROVIDER=mock`** | An offline deterministic provider so the platform is fully demonstrable with no API key. Every response is tagged `provider: "mock"` and carries a visible notice. **It is not a language model and must never be presented as one.** |
| **Code execution** | Student code runs **only** inside an isolated Docker container (no network, read-only filesystem, non-root, CPU / memory / process limits) and is never executed on the API host. If Docker or the judge image is missing, Run and Submit report **"not executed"** and award **no score** — a verdict is never guessed. The judge logic is verified by the test suite with local compilers; container isolation must be verified on a machine with Docker using `npm run judge:verify`. |
| **Company recruitment data** | Seed patterns are illustrative and carry **no source URL**. The UI labels them "unverified" and the RAG layer refuses to cite them as fact. |
| **Privacy policy** | A template. An institution must review it with its own data-protection officer before deployment. |

### Deliberately not built

- **No emotion, affect or facial expression analysis.** Interview "confidence" is derived only from answer
  length adequacy and filler-word rate — objective, measurable delivery signals.
- **No demographic, identity or disability inference** of any kind.
- **No automatic failing on a monitoring signal.** Integrity events raise a LOW/MEDIUM/HIGH indicator for a
  human to review, and the student sees every signal recorded about them.
- **No in-process code execution.** Student code is never run in the Node process; an in-process sandbox is
  not a security boundary.

---

## Project structure

```
careerpilot-ai/
├── frontend/                 React 18 · Vite · TypeScript · Tailwind
│   └── src/
│       ├── components/       ui primitives · charts · domain components
│       ├── pages/            auth · student · alumni · placement · admin
│       ├── layouts/          application shell with role-filtered navigation
│       ├── hooks/            assessment session · WebRTC · speech · notifications
│       ├── services/         typed API client · Socket.IO
│       ├── store/            Zustand auth store
│       └── utils/            formatting · class merging
│
├── backend/                  Node.js · Express · TypeScript
│   └── src/
│       ├── models/           35 Mongoose models with indexes and validation
│       ├── controllers/      thin HTTP handlers
│       ├── services/         business logic: APIE · assessment · interview · reports
│       ├── routes/v1/        versioned REST API
│       ├── middleware/       auth · RBAC · validation · errors · rate limit · sanitise
│       ├── validators/       Zod schemas for every mutating endpoint
│       ├── sockets/          Socket.IO: notifications · assessment · WebRTC signalling
│       ├── config/           environment · database · logger
│       └── scripts/          database seeding
│
├── ai-service/               Python · FastAPI
│   └── app/
│       ├── agents/           11 agents + orchestrator
│       ├── api/routes/       resume · interview · career · readiness · rag · agents
│       ├── nlp/              text extraction · resume parser · skill taxonomy
│       ├── ml/               features · synthetic data · training · prediction
│       ├── rag/              chunking · vector store · pipeline
│       ├── services/         LLM abstraction · embeddings · ATS · APIE
│       └── core/             config · logging · errors · security
│
├── shared/                   Types, enums and constants shared by frontend and backend
├── database/seeds/           Demo datasets, all tagged provenance: DEMO
├── docker/                   Dockerfiles and nginx configuration
└── docs/                     Architecture, API reference, deployment guide
```

---

## Configuration

Everything is driven by a single `.env` at the repository root, read by both the Node backend and the
Python service. See `.env.example` for the complete annotated list.

### The settings that matter most

```bash
# --- AI provider ---
# mock = offline, deterministic, clearly labelled. No API key needed.
AI_PROVIDER=mock                    # openai | azure | ollama | mock
AI_API_KEY=
AI_MODEL=gpt-4o-mini

# --- Database ---
# Leave blank in development to auto-start an in-memory MongoDB.
MONGODB_URI=

# --- Secrets (mandatory in production; the server refuses to start without them) ---
JWT_SECRET=
JWT_REFRESH_SECRET=
COOKIE_SECRET=
AI_SERVICE_INTERNAL_KEY=

# --- Code execution (DSA judge) ---
# docker   = each submission runs in its own isolated container
# disabled = code is never run, and the API says so
CODE_EXECUTION_PROVIDER=docker      # docker | disabled
CODE_RUNNER_IMAGE=careerpilot-judge:1   # built by: npm run judge:build
CODE_RUNNER_CPUS=1
CODE_RUNNER_PIDS_LIMIT=128
CODE_RUNNER_MAX_CONCURRENT=2

# --- Vector store & embeddings ---
VECTOR_DB_PROVIDER=numpy            # numpy | faiss | chroma
EMBEDDING_PROVIDER=hash             # hash | sentence-transformers | openai

# --- Speech-to-text for the voice interview ---
# none    = browser Web Speech API only; audio never leaves the device (default)
# whisper = server-side fallback for browsers without the API (e.g. Firefox).
#           Transcribed in memory; audio is never written to disk or retained.
SPEECH_PROVIDER=none                # none | whisper
SPEECH_MODEL=base                   # tiny | base | small | medium | large-v3
```

### Connecting a real LLM

```bash
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

Restart the AI service. Nothing else changes — every agent goes through the same provider abstraction, so
no application code is provider-specific.

### Runtime configuration

APIE weights, readiness bands, monitoring severities and retention windows live in the
`SystemConfiguration` collection, not in source. An administrator edits them under **Admin → AI &
Knowledge Base → Configuration**. Weights are validated to sum to 1.0.

---

## Running the tests

```bash
npm test              # backend: 81 tests
npm run test:ai       # AI service: 104 tests
npm run typecheck     # backend + frontend, strict
npm run lint          # ESLint 9 flat config across every TS/TSX workspace
```

**Backend (81 tests)** — authentication and token rotation, account-enumeration resistance, RBAC across
every role, cross-student isolation, privilege-escalation guards, the alumni verification gate, assessment
timing/autosave/recovery/grading, integrity monitoring including the guarantee that a result is never
invalidated automatically, and the voice input-mode contract.

**AI service (104 tests)** — resume parsing and ATS scoring, alias-aware skill matching, agent input/output
schema validation, interview difficulty adaptation, the ethical constraint that no evaluation leaks
emotional or demographic inference, RAG retrieval and the "no verified information" path, APIE weighting
(proving it is not a plain average), the ML pipeline including a test asserting that synthetic labels
are *not* perfectly separable.

These suites deliberately point the AI client at a **closed port**, so they prove the platform degrades
gracefully rather than depending on the Python service being up.

### End-to-end smoke runs (require the live AI service)

```bash
# terminal 1
cd ai-service && AI_SERVICE_INTERNAL_KEY=smoke_test_key python -m uvicorn app.main:app --port 8000

# terminal 2
cd backend
npx tsx tests/e2e.smoke.ts          # the full cross-service loop
npx tsx tests/e2e.voice.smoke.ts    # the voice interview flow
npx tsx tests/e2e.career.smoke.ts   # the Career Plan flow
```

These exercise the real path (Node → FastAPI → agents → APIE → MongoDB) against an in-memory database. They
are scripts rather than vitest files precisely because they need an external service running.

> Both scripts import `tests/smokeEnv.ts` as their **first** import and then assert they are on the in-memory
> database. This is not stylistic: ESM evaluates imported modules before the importing file's own statements,
> so `process.env` assignments written inline in a test file run *after* the config module has already read
> the environment — silently connecting the run to whatever real MongoDB happens to be listening. The guard
> makes that failure loud instead of destructive.

---

## Training the ML model

```bash
cd ai-service

python -m app.ml.train                              # synthetic data (default)
python -m app.ml.train --model gradient_boosting    # alternative algorithm
python -m app.ml.train --data path/to/outcomes.csv  # real labelled outcomes
```

Output includes accuracy, macro precision/recall/F1, per-class metrics, a confusion matrix, feature
importances and 5-fold cross-validation — all labelled with the dataset's provenance.

To train on real data, supply a CSV with the 15 feature columns plus `readinessBand`. The provenance label
changes automatically, and every metric displayed in the application updates to match.

---

## Deployment

### Docker Compose

```bash
cp .env.example .env
# Set JWT_SECRET, JWT_REFRESH_SECRET, COOKIE_SECRET, AI_SERVICE_INTERNAL_KEY.
# Generate each with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:8080 |
| API | http://localhost:5000/api/v1 |
| MongoDB | localhost:27017 |

The AI service is deliberately **not** published to the host — it is internal-only and requires the shared
`X-Internal-Key` on every call.

### Manual build

```bash
npm run build                       # shared → database → backend → frontend
npm start --workspace backend       # serve backend/dist
# serve frontend/dist with nginx (see docker/nginx.conf)
```

### Production checklist

- [ ] Strong unique `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `AI_SERVICE_INTERNAL_KEY`
- [ ] `MONGODB_URI` pointing at a real replica set with authentication and TLS
- [ ] `NODE_ENV=production` (the in-memory database is refused in production)
- [ ] `STORAGE_PROVIDER=s3` with a private bucket, plus `npm i @aws-sdk/client-s3`
- [ ] Docker on a **dedicated judge host**, the judge image built, and `npm run judge:verify` passing there
- [ ] A TURN server configured — WebRTC will not traverse restrictive NATs on STUN alone
- [ ] `AI_PROVIDER` set to a real provider (mock output must never reach real users)
- [ ] `DEMO_MODE=false`, and demo accounts removed
- [ ] The privacy policy reviewed by your data-protection officer
- [ ] The AI service reachable only from the backend, never from the internet

---

## Feature reference

<details>
<summary><strong>Student</strong></summary>

Register/login · complete profile · upload resume · ATS analysis · skill extraction · JD comparison ·
select target companies and roles · coding assessments · aptitude assessments · technical interviews ·
HR interviews · behavioural interviews · AI feedback · Placement Readiness Score ·
skill gaps · personalised recommendations · career plan · DSA practice · search verified alumni · request mentorship ·
schedule and join mock interviews · receive alumni feedback · track progress · download 8 report types ·
export or delete personal data
</details>

<details>
<summary><strong>Alumni</strong></summary>

Register · professional profile · submit employment verification · specify company, role, expertise and
availability · accept/reject mentorship requests · schedule mock interviews · conduct live WebRTC
interviews with chat and notes · submit structured feedback across five dimensions · view feedback history
</details>

<details>
<summary><strong>Placement officer</strong></summary>

Cohort statistics · department comparison · readiness distribution · common skill gaps · at-risk
identification · recommended interventions · monitor assessments · target-company preferences · alumni
participation · monthly progress · filter by department/batch/section/band · institutional, department,
skill-gap and per-student PDF reports · pseudonymised research export (JSON/CSV)
</details>

<details>
<summary><strong>Admin</strong></summary>

Manage users, roles and account status · verify alumni · manage companies, job roles and job descriptions ·
manage the RAG knowledge base with live re-indexing and query testing · view the agent roster with schemas ·
AI usage and failure rates · edit APIE weights and monitoring thresholds at runtime · view ML model metrics ·
review flagged assessments · full audit log · announcements
</details>

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, APIE, the agent framework, RAG, and the reasoning behind the major decisions |
| [`docs/API.md`](docs/API.md) | Every endpoint, request/response shapes, error codes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production deployment, scaling, security hardening |
| [`docs/ETHICS.md`](docs/ETHICS.md) | The monitoring, evaluation and data-handling commitments, and what was deliberately not built |

---

## Licence

Built as a final-year academic project. Review the privacy policy, the scoring model and the AI provider
configuration with your institution before any real deployment.
