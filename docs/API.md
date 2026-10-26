# API Reference

Base URL: `http://localhost:5000/api/v1`

---

## Conventions

### Response envelope

Every endpoint returns the same shape.

**Success**
```json
{ "success": true, "data": { }, "meta": { } }
```

**Failure**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid or missing fields.",
    "details": [{ "path": "email", "message": "A valid email address is required" }],
    "requestId": "3f2a…"
  }
}
```

`message` is written to be shown directly to a user. Stack traces are never returned in production.

### Authentication

```
Authorization: Bearer <accessToken>
```

The refresh token is delivered as a signed `httpOnly` cookie (`cp_refresh`) and also returned in the body
for non-browser clients. Access tokens live 15 minutes; the client refreshes transparently.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request failed schema validation; see `details` |
| `UNAUTHENTICATED` | 401 | No or missing token |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `TOKEN_EXPIRED` | 401 | Access token expired — refresh |
| `INVALID_TOKEN` | 401 | Malformed, revoked or replayed token |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `CONSENT_REQUIRED` | 403 | Webcam consent needed before starting |
| `ALUMNI_NOT_VERIFIED` | 403 | Alumni account awaiting verification |
| `NOT_FOUND` | 404 | Resource does not exist or is not yours |
| `CONFLICT` | 409 | Duplicate, or an invalid state transition |
| `ASSESSMENT_ALREADY_SUBMITTED` | 409 | Attempt already submitted |
| `ASSESSMENT_EXPIRED` | 410 | Time limit passed |
| `PAYLOAD_TOO_LARGE` | 413 | Upload exceeds the size limit |
| `UNSUPPORTED_FILE_TYPE` | 415 | Wrong file type, or contents do not match the declared type |
| `RATE_LIMITED` | 429 | Too many requests |
| `RESUME_PARSE_FAILED` | 422 | No readable text could be extracted |
| `CODE_EXECUTION_FAILED` | 503 | Execution service unavailable |
| `AI_SERVICE_UNAVAILABLE` | 503 | AI service unreachable |
| `DB_ERROR` | 503 | Database unavailable |

### Rate limits

| Scope | Limit |
|---|---|
| Global | 300 requests / 15 min |
| Credentials | 20 / 15 min (successful requests not counted) |
| AI endpoints | 60 / 10 min per user |
| Uploads | 20 / hour per user |

### Pagination

List endpoints accept `?page=1&limit=20` and return
`meta: { page, limit, total, totalPages }`.

---

## Authentication — `/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register. Only `STUDENT` and `ALUMNI` may self-register. |
| POST | `/auth/login` | — | Sign in. Returns tokens and sets the refresh cookie. |
| POST | `/auth/refresh` | Cookie | Rotate tokens. Replaying a used token revokes the whole family. |
| POST | `/auth/logout` | — | Revoke the presented refresh token. |
| POST | `/auth/logout-all` | ✓ | Revoke every session for the account. |
| GET | `/auth/me` | ✓ | Current user. |
| POST | `/auth/forgot-password` | — | Request a reset. Identical response whether or not the address exists. |
| POST | `/auth/reset-password` | — | Reset with a token; revokes all sessions. |
| POST | `/auth/change-password` | ✓ | Change password; revokes all sessions. |
| POST | `/auth/verify-email` | — | Verify with a token. |
| POST | `/auth/consent` | ✓ | Record a consent decision. |

<details>
<summary><code>POST /auth/register</code></summary>

```json
{
  "fullName": "Aarthi Ramesh",
  "email": "aarthi@university.edu",
  "password": "SecurePass123",
  "role": "STUDENT",
  "department": "Computer Science",
  "rollNumber": "CS21B001",
  "batch": "2021-2025",
  "graduationYear": 2025
}
```

Alumni additionally require `company`, `designation` and `domain`, and are created with
`verificationStatus: PENDING`.

**201**
```json
{
  "success": true,
  "data": {
    "user": { "id": "…", "email": "…", "role": "STUDENT", "status": "ACTIVE" },
    "tokens": { "accessToken": "eyJ…", "refreshToken": "…", "expiresIn": 900 }
  }
}
```
</details>

---

## Students — `/students`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/students/me` | Student | Own profile |
| PATCH | `/students/me` | Student | Partial update; unknown keys rejected |
| PUT | `/students/me/targets` | Student | Set target companies and roles |
| GET | `/students/me/dashboard` | Student | Aggregated dashboard in one request |
| GET | `/students` | Officer/Admin | Cohort list with filters and sorting |
| GET | `/students/:id` | Owner or staff | One profile; staff access is audited |

`GET /students` accepts `department`, `batch`, `section`, `band`, `search`, `minPrs`, `maxPrs`,
`targetCompany`, `sort` (`prs`|`name`|`cgpa`|`recent`), `order`.

---

## Resumes — `/resumes`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/resumes/upload` | Student | Multipart `resume`. PDF/DOCX/TXT, ≤5 MB, magic-byte verified. |
| GET | `/resumes` | Student | All uploaded resumes |
| POST | `/resumes/:id/analyze` | Student | Run the analysis pipeline; recomputes readiness. Optional comparison: `jobDescriptionId` (a predefined job) **or** `jobDescriptionText` (your own, 80–20,000 characters, with optional `jobDescriptionLabel`) — not both. A custom job description is used for that analysis only and is not stored. |
| POST | `/resumes/jd/extract` | Student | Multipart field `jd` (PDF, DOCX or TXT). Returns the file's `text` and the `recognisedSkills` found in it. Nothing is stored. |
| GET | `/resumes/analysis/latest` | Student | Most recent analysis |
| GET | `/resumes/analysis/history` | Student | ATS score history |
| GET | `/resumes/analysis/:id` | Owner or staff | One analysis |
| PUT | `/resumes/:id/primary` | Student | Set the primary resume |
| GET | `/resumes/:id/download` | Owner or staff | Stream the original file |
| DELETE | `/resumes/:id` | Student | Delete file and analyses |

<details>
<summary><code>POST /resumes/:id/analyze</code> response</summary>

```json
{
  "success": true,
  "data": {
    "analysis": {
      "atsScore": 76.5,
      "parsed": { "name": "…", "email": "…", "skills": ["Python", "React"], "education": [], "projects": [] },
      "breakdown": [
        { "criterion": "Contact Information", "score": 10, "maxScore": 10, "detail": "All key contact details were detected." }
      ],
      "matchedKeywords": ["React", "Python"],
      "missingKeywords": ["Kubernetes"],
      "strengths": [], "weaknesses": [], "formattingRecommendations": []
    },
    "readiness": { "score": 62.4, "band": "PLACEMENT_READY", "delta": 3.1 }
  }
}
```
</details>

---

## Companies & jobs — `/companies`, `/jobs`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/companies` | ✓ | List with `search`, `industry`, `tier` |
| GET | `/companies/:id` | ✓ | Detail, open roles, and whether recruitment info is sourced |
| GET | `/jobs/roles` | ✓ | Role catalogue |
| GET | `/jobs/descriptions` | ✓ | Job descriptions, filterable by company/role |
| POST | `/jobs/match` | Student | Match against one job description |
| POST | `/jobs/match/company` | Student | Match against every open role at a company |

<details>
<summary><code>POST /jobs/match</code> response</summary>

```json
{
  "success": true,
  "data": {
    "matchScore": 72.4,
    "requiredCoverage": 80,
    "preferredCoverage": 50,
    "semanticSimilarity": 61.2,
    "eligibilityScore": 100,
    "eligible": true,
    "eligibilityNotes": ["CGPA requirement met (8.6 ≥ 7)."],
    "matchingSkills": ["Python", "React"],
    "missingSkills": ["Kubernetes"],
    "verdict": "Good match for Software Developer at Zoho. Closing 1 skill gap would…",
    "preparationPlan": [
      { "focus": "Kubernetes", "reason": "…", "priority": "HIGH", "estimatedHours": 16, "resources": [] }
    ]
  }
}
```
</details>

---

## Assessments — `/assessments`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/assessments` | Student | Available papers with your attempt history |
| POST | `/assessments/:id/start` | Student | Start **or resume**. Body: `{ webcamConsent }` |
| GET | `/assessments/attempts` | Student | Attempt history |
| GET | `/assessments/attempts/:id` | Student | Rehydrate an in-progress attempt |
| PUT | `/assessments/attempts/:id/autosave` | Student | Merge-save answers. Not rate limited. |
| POST | `/assessments/attempts/:id/submit` | Student | Grade and finalise |
| GET | `/assessments/attempts/:id/result` | Student | Result with correct answers and explanations |
| POST | `/assessments/attempts/:id/monitoring` | Student | Batch of integrity events |
| GET | `/assessments/attempts/:id/integrity` | Owner or staff | Integrity report |

<details>
<summary><code>POST /assessments/:id/start</code> response</summary>

```json
{
  "success": true,
  "data": {
    "attempt": { "id": "…", "status": "IN_PROGRESS", "expiresAt": "2025-01-15T10:30:00.000Z" },
    "assessment": { "title": "General Aptitude", "durationMinutes": 30, "requiresFullscreen": true },
    "questions": [
      { "id": "…", "prompt": "…", "options": [{ "key": "A", "text": "…" }], "topic": "arithmetic", "marks": 1 }
    ],
    "resumed": false,
    "serverTime": 1736933400000,
    "expiresAt": "2025-01-15T10:30:00.000Z",
    "remainingSeconds": 1800
  }
}
```

`correctAnswer` and `explanation` are never present while an attempt is in progress.
</details>

<details>
<summary><code>POST /assessments/attempts/:id/monitoring</code></summary>

```json
{ "events": [{ "type": "TAB_HIDDEN" }, { "type": "PASTE", "metadata": { "length": 42 } }] }
```

**200**
```json
{
  "success": true,
  "data": {
    "recorded": 2,
    "integrityRisk": "LOW",
    "notice": null
  }
}
```

`notice` is non-null at MEDIUM/HIGH and is written to be shown to the student. Signals never invalidate a
result automatically.
</details>

---

## Coding (DSA practice) — `/coding`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/coding/problems` | Student | Problem list. Query: `search`, `difficulty`, `tags` (comma-separated, all must match), `page`, `limit`. Each row carries `status`: `SOLVED`, `ATTEMPTED` or `TODO`. |
| GET | `/coding/problems/:id` | Student | Statement, examples, constraints, signature, starter code per language, **public** test cases and `hiddenTestCount`. |
| GET | `/coding/sandbox` | Student | Whether code can be executed right now, and why not if it cannot |
| POST | `/coding/problems/:id/run` | Student | Body `{ language, code }`. Judges the public tests only; nothing stored or scored. |
| POST | `/coding/problems/:id/submit` | Student | Body `{ language, code }`. Judges public + hidden tests, stores the submission, updates readiness. |
| GET | `/coding/submissions` | Student | Your own submission history. Query: `problemId`. |
| GET | `/coding/progress` | Student | Solved / available counts by difficulty, attempts, acceptance rate |
| GET | `/coding/performance` | Student | Aggregate coding performance used by readiness |

`language` is one of `python`, `cpp`, `java`, `javascript`.

`execution.status` is one of `ACCEPTED`, `WRONG_ANSWER`, `TIME_LIMIT_EXCEEDED`, `MEMORY_LIMIT_EXCEEDED`,
`RUNTIME_ERROR`, `COMPILATION_ERROR`, `INTERNAL_ERROR`. It is decided only by the deterministic judge.
A submit response also carries `aiReview`, an advisory static analysis that is requested after the verdict
is final and cannot change it.

> **Hidden test cases never leave the server.** No endpoint returns their inputs or expected outputs.
> In a submit response a hidden test appears only as `{ index, hidden, passed, status, executionTimeMs, memoryKb }`.

> When the sandbox is unavailable (Docker not installed or not running, image not built, or
> `CODE_EXECUTION_PROVIDER=disabled`) the response has `execution.executed: false`, status `INTERNAL_ERROR`
> and a `message` saying the code was not run. **No score is awarded and no progress is recorded** —
> a verdict is never guessed. See [DSA_JUDGE.md](DSA_JUDGE.md).

---

## Interviews — `/interviews`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/interviews/start` | Student | Start a session and get question 1 |
| GET | `/interviews/sessions` | Student | Session history |
| GET | `/interviews/sessions/:id` | Student | Session with questions, answers and evaluations |
| POST | `/interviews/sessions/:id/answer` | Student | Submit an answer; returns feedback + the next question |
| POST | `/interviews/sessions/:id/end` | Student | End early; answered questions are still scored |
| GET | `/interviews/sessions/:id/report` | Student | Final report |

<details>
<summary><code>POST /interviews/sessions/:id/answer</code> response</summary>

```json
{
  "success": true,
  "data": {
    "evaluation": {
      "relevance": 78, "correctness": 72, "completeness": 65,
      "communication": 80, "structure": 70, "overall": 73,
      "strengths": ["Your answer covered most of the key points…"],
      "improvements": ["You did not address: unidirectional data flow."],
      "explanation": "Your answer addressed 67% of the expected discussion points in 118 words…",
      "missedPoints": ["Unidirectional data flow"],
      "deliverySignals": {
        "wordCount": 118, "fillerWordRate": 0.017,
        "responseLengthVerdict": "APPROPRIATE", "clarityScore": 89.8
      },
      "disclaimer": "This evaluation is produced by an AI prototype…"
    },
    "nextQuestion": {
      "id": "…", "question": "…", "topic": "react", "difficulty": "HARD",
      "difficultyReason": "Recent answers averaged 79/100, so difficulty was increased…"
    },
    "completed": false
  }
}
```

`deliverySignals` are measured server-side from the transcript, not estimated by the model. They cover
objective properties only — no emotional, personality or demographic inference.
</details>

---

## Readiness & recommendations

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/readiness` | Student / staff | Current readiness with gaps and recommendations |
| POST | `/readiness/recompute` | Student | Force a recomputation |
| GET | `/readiness/trend` | Student / staff | Score over time |
| GET | `/readiness/history` | Student / staff | Full snapshot history |
| GET | `/readiness/skill-gaps` | Student / staff | Skill gaps |
| GET | `/readiness/model-metrics` | ✓ | ML metrics with dataset provenance |
| GET | `/recommendations` | Student / staff | Active recommendations |
| PATCH | `/recommendations/:id` | Student | Mark completed or dismissed |

Staff may pass `?studentId=` to the readiness endpoints; a student may only ever read their own.

<details>
<summary><code>GET /readiness</code> response (abridged)</summary>

```json
{
  "success": true,
  "data": {
    "readiness": {
      "score": 62.4,
      "band": "PLACEMENT_READY",
      "delta": 3.1,
      "evidenceCoverage": 75,
      "components": [
        {
          "key": "coding", "label": "Coding", "raw": 68, "normalized": 68,
          "weight": 0.25, "weighted": 17, "evidenceCount": 3,
          "lastUpdated": "2025-01-10T…", "stale": false
        },
        { "key": "aptitude", "label": "Aptitude", "raw": null, "normalized": 0, "weight": 0.1, "evidenceCount": 0, "stale": false }
      ],
      "modifiers": [
        { "label": "Projects", "delta": 2.25, "reason": "3 project(s) on your profile provide evidence…" },
        { "label": "Alumni feedback", "delta": 1.5, "reason": "Verified alumni rated your mock interview 75/100…" }
      ],
      "strengths": [], "weaknesses": [], "skillGaps": [],
      "targetRoleReadiness": [], "targetCompanyReadiness": [],
      "reassessmentSuggestions": [],
      "mlPrediction": {
        "band": "PLACEMENT_READY", "confidence": 0.71,
        "classProbabilities": { "PLACEMENT_READY": 0.71, "NEEDS_IMPROVEMENT": 0.22 },
        "trainedOn": "SYNTHETIC",
        "disclaimer": "Prototype Evaluation - Synthetic Dataset…"
      },
      "agreementNote": "The weighted APIE score and the ML classifier agree on your readiness band.",
      "modelDisclaimer": "PROTOTYPE SCORING MODEL…"
    }
  }
}
```

A component with `raw: null` has **no evidence yet** — distinct from a genuine score of 0.
</details>

---

## Alumni & mentorship — `/alumni`, `/mentorship`

### Student-facing

| Method | Path | Description |
|---|---|---|
| GET | `/alumni/search` | Search **verified** alumni only |
| GET | `/alumni/recommended` | AI-ranked mentors with reasons |
| GET | `/alumni/:id` | One verified profile (employment proof never exposed) |
| POST | `/mentorship/request` | Request a session |
| GET | `/mentorship/requests` | Your requests |
| GET | `/mentorship/sessions` | Your sessions |
| GET | `/mentorship/feedback` | Feedback received |
| POST | `/mentorship/sessions/:id/rate` | Rate your mentor (1–5) |

### Alumni-facing

| Method | Path | Description |
|---|---|---|
| GET | `/alumni/me` | Own profile (available while unverified) |
| PATCH | `/alumni/me` | Update; changing employment details returns to PENDING |
| GET | `/alumni/dashboard` | Requires verification |
| GET | `/alumni/requests` | Incoming requests |
| POST | `/alumni/requests/:id/respond` | Accept (schedules a session) or decline |
| GET | `/alumni/sessions` | Scheduled and past sessions |
| POST | `/alumni/sessions/:id/feedback` | Structured feedback → feeds APIE |
| GET | `/alumni/feedback` | Feedback you have given |

### Interview room (both participants)

| Method | Path | Description |
|---|---|---|
| GET | `/mentorship/sessions/:id/room` | Room credentials + ICE servers |
| PUT | `/mentorship/sessions/:id/notes` | Save notes |
| POST | `/mentorship/sessions/:id/end` | End the session |

TURN credentials are issued by the server and never bundled into the client.

---

## Analytics — `/analytics` *(officer/admin)*

| Method | Path | Description |
|---|---|---|
| GET | `/analytics/placement` | Cohort statistics, distribution, gaps, department comparison |
| GET | `/analytics/insights` | AI cohort insights, at-risk list, recommended interventions |
| GET | `/analytics/filters` | Distinct filter values |
| GET | `/analytics/research-export` | Pseudonymised dataset (`format=json|csv`) |

The research export replaces identity with a one-way `anonymousId` hash and tags every row with its
provenance. Every export is audited.

---

## Reports — `/reports`

| Method | Path | Description |
|---|---|---|
| GET | `/reports` | Report types available to you |
| GET | `/reports/:type` | Download a student report as PDF |
| GET | `/reports/institution/:type` | `INSTITUTION`, `DEPARTMENT`, `SKILL_GAP` |
| GET | `/reports/student/:studentId/performance` | Per-student report (staff) |

Student types: `RESUME_ANALYSIS`, `ATS`, `PLACEMENT_READINESS`, `INTERVIEW`, `CODING`,
`ALUMNI_FEEDBACK`. Session-scoped reports take `?ref=<sessionId>`.

---

## Notifications & privacy

| Method | Path | Description |
|---|---|---|
| GET | `/notifications` | List (`?unreadOnly=true`) |
| GET | `/notifications/unread-count` | Badge count |
| POST | `/notifications/:id/read` | Mark read |
| POST | `/notifications/read-all` | Mark all read |
| GET | `/privacy/policy` | **Public.** What is collected, retention, rights |
| GET | `/privacy/my-data` | Everything held about you |
| GET | `/privacy/export` | Download as JSON |
| POST | `/privacy/delete-account` | Request deletion; locks the account, deletes files immediately |
| POST | `/privacy/withdraw-consent` | Withdraw a consent |

---

## Admin — `/admin`

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard` | Users, alumni, catalogue, AI usage, health, audit, flagged |
| GET | `/admin/users` | User list |
| PATCH | `/admin/users/:id/role` | Change role (last admin protected) |
| PATCH | `/admin/users/:id/status` | Change status; suspension revokes sessions immediately |
| GET | `/admin/alumni` | Alumni by verification status |
| POST | `/admin/alumni/:id/verify` | Verify or reject |
| POST/PATCH | `/admin/companies`, `/admin/roles`, `/admin/jobs` | Catalogue management |
| GET/POST/PUT/DELETE | `/admin/rag`, `/admin/rag/:id` | Knowledge base; saving re-indexes immediately |
| POST | `/admin/rag/reindex` | Rebuild the whole index |
| POST | `/admin/rag/query` | Test a grounded query |
| GET | `/admin/config` | Runtime configuration |
| PUT | `/admin/config/:key` | Update; APIE weights validated to sum to 1.0 |
| GET | `/admin/ai/usage` | Usage over time, agent roster, health |
| GET | `/admin/ai/interactions` | Individual AI call records |
| GET | `/admin/audit` | Audit log with filters |
| GET | `/admin/flagged` | Attempts and events awaiting review |
| POST | `/admin/flagged/attempts/:id/review` | Record a review decision |
| POST | `/admin/announce` | Broadcast to roles |

---

## Health — `/health`

| Path | Description |
|---|---|
| `/health` | Aggregate; 503 if the database is down, `DEGRADED` if only AI is down |
| `/health/live` | Liveness; touches no dependency |
| `/health/db` | Database ping with latency |
| `/health/ai` | AI service reachability |
| `/health/metrics` | Request counts and latency |

---

## Socket.IO

Connect with `auth: { token: accessToken }`. Anonymous connections are refused.

| Event | Direction | Purpose |
|---|---|---|
| `notification:new` | ← server | Live notification |
| `assessment:subscribe` | → server | Subscribe to timer ticks |
| `assessment:tick` | ← server | Authoritative remaining time |
| `readiness:updated` | ← server | Readiness recomputed |
| `interview:join` / `interview:leave` | → server | Join/leave a room (participation enforced) |
| `interview:participant:joined` / `:left` | ← server | Presence |
| `interview:chat` | ↔ | Room chat (persisted) |
| `rtc:offer` / `rtc:answer` / `rtc:ice` | ↔ | WebRTC signalling relay |
| `rtc:media-state` | ↔ | Camera/mic on-off, for the peer's indicator |

---

## AI service (internal)

Requires `X-Internal-Key`. Not reachable from the internet.

| Path | Purpose |
|---|---|
| `POST /ai/resume/analyze` | Parse and score a resume |
| `POST /ai/resume/match` | Resume + job matching workflow |
| `POST /ai/interview/generate` | Next adaptive question |
| `POST /ai/interview/evaluate` | Score one answer |
| `POST /ai/interview/turn` | Evaluate + generate in one call |
| `POST /ai/readiness/predict` | APIE + ML |
| `POST /ai/coding/review` | Static code review (never executes) |
| `POST /ai/mentorship/match` / `/feedback` | Mentor ranking, feedback ingestion |
| `POST /ai/analytics/cohort` | Cohort insights |
| `POST /ai/rag/ingest` / `/query` / `/search` | Knowledge base |
| `GET /ai/agents` | Agent roster with JSON schemas |
| `POST /ai/agents/run` / `/workflow` | Invoke an agent or workflow |
| `GET /ai/ml/metrics` | Model metrics |
| `POST /ai/ml/train` | Retrain on synthetic data |
