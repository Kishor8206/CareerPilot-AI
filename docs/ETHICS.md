# Ethics, Monitoring and Data Handling

CareerPilot AI scores people. That makes several design choices non-negotiable. This document records what
the system does, what it deliberately does **not** do, and where the guarantees are enforced in code rather
than only in policy.

---

## 1. What is deliberately not built

These are absent by design, not merely unimplemented.

| Not built | Why |
|---|---|
| **Emotion or affect analysis** | There is no reliable, non-discriminatory mapping from facial expression or vocal tone to competence. Inferring "nervousness" and letting it affect a score would penalise anxiety, neurodivergence and cultural difference. |
| **Facial expression scoring** | Same reasoning. The consented webcam check reports face *presence* and person *count* only. |
| **Demographic inference** | No race, gender, ethnicity, age or nationality detection anywhere in the codebase. |
| **Disability inference** | Never inferred, and never used as an input to any score. |
| **Identity inference from biometrics** | No face recognition or voice-print matching. |
| **Accent or fluency scoring** | Communication is scored on structure and content. Penalising accent would be discrimination against non-native speakers dressed up as assessment. |
| **Automatic failing on a monitoring signal** | No integrity signal, at any severity, invalidates a result. |
| **Keystroke or mouse biometrics** | Behavioural biometrics are invasive and unreliable as evidence. |
| **Screen or full-desktop recording** | The platform observes its own page only, never the rest of the machine. |

A test in `ai-service/tests/test_agents.py` asserts that no interview evaluation's generated feedback
contains any of: *gender, race, ethnicity, accent, emotion, nervous, anxious, personality type, introvert,
extrovert, disability*.

---

## 2. What "confidence" means here

Interview reports show a **delivery indicator**. It is derived from two measured, objective properties of
the answer text:

- **Response length adequacy** — an interview answer under ~40 words is usually incomplete; over ~260 is
  usually unfocused.
- **Filler-word rate** — the proportion of the response made up of *um, uh, like, basically, you know*.

That is all. It is not a psychological assessment, and the UI says so wherever it appears:

> The delivery indicator is derived from objective signals only — answer length adequacy and filler-word
> rate. It is not an assessment of personality or emotion.

The measurement happens server-side from the transcript. The model's own estimate of these values is
discarded and replaced with the measured ones, so a provider cannot drift the number.

---

## 3. Assessment integrity monitoring

### What is observed

Full-screen exit and re-entry · tab visibility changes · window focus changes · copy and paste events ·
extended inactivity · unusually rapid answering · network transitions · multiple concurrent sessions.

With **explicit prior consent** only: face presence, and whether more than one person is visible.

### Three guarantees, enforced in code

**1. Nothing fails automatically.**
Signals accumulate points into a LOW/MEDIUM/HIGH indicator. HIGH routes the attempt to a human reviewer and
does nothing else. A test asserts that an attempt with twelve full-screen exits and a perfect score still
records `percentage: 100, passed: true` — only `integrityRisk` changes.

**2. A single signal never reaches HIGH.**
Leaving full screen once is MEDIUM at most. HIGH requires accumulation across multiple events, because a
brief tab switch has many innocent explanations: a notification, an accessibility tool, a misclick.

**3. The student sees everything.**
Every signal recorded about a student appears in their own result, with its severity and a plain-English
explanation. Monitoring is disclosed on the pre-start screen before anything is recorded:

> To protect assessment integrity, the platform records when the window leaves full screen, when the tab is
> hidden, and paste events. You can see every recorded signal in your result afterwards.
>
> These signals are advisory. They never invalidate your result automatically — a person reviews the
> context before any decision. Nothing about your appearance, identity or emotions is analysed.

### The reviewer's obligation

The admin review screen states plainly:

> These signals indicate conditions worth a human review. They are not proof of misconduct, and no result is
> invalidated automatically. A reviewer must consider context before any action is taken.

A review decision requires a written note, which the student then sees in their result.

---

## 4. Camera and microphone

- **Nothing is captured before consent.** `getUserMedia` is called only after the user accepts an explicit
  consent screen that names each permission and its purpose.
- **A "join without camera" path always exists.** Refusing media never blocks participation.
- **Persistent indicators.** While the camera or microphone is live, a badge is visible in the header, not
  buried in a tooltip.
- **Recording is separate.** Live streaming and recording are distinct consents. When recording is off, the
  UI states: *"This session is NOT recorded. No audio or video is stored anywhere."*
- **Media is peer-to-peer.** Audio and video travel directly between participants over WebRTC. The server
  relays signalling only and never sees the media.
- **Release is guaranteed.** Tracks are stopped on leave and on unmount. A camera light left on after
  navigating away is both a privacy failure and a trust failure.
### Speech-to-text in interviews

Voice is an **input method and nothing else**. It changes how a student gets their words into the system; it
never changes what those words are worth.

- **On-device by default.** With `SPEECH_PROVIDER=none` (the default) recognition runs in the browser via the
  Web Speech API. Audio never reaches our servers.
- **The server fallback is honest about itself.** Browsers without the Web Speech API (Firefox) can post audio
  to `/api/v1/speech/transcribe`, which is transcribed in memory and **never written to disk or retained** —
  only the transcript is stored. The consent notice names this before the first recording, and
  `GET /api/v1/speech/status` tells the client which path it is on rather than downgrading silently.
- **The transcript is the student's to correct.** Recognition output lands in an editable field. Nothing is
  submitted until the student confirms it. A misheard word is a correctable draft, not a scored answer.
- **Typing is always sufficient.** Every voice flow is completable by keyboard. A denied microphone
  permission, an unsupported browser, or an offline recogniser degrades to text with a message that says so.
- **Voice cannot affect a score — structurally, not by policy.** The evaluator is never told whether an answer
  was spoken or typed: `inputMode` is persisted on the response record for analytics but is deliberately
  excluded from the payload sent to the evaluation agent. If the model were told, it could excuse or penalise
  disfluency, and a score would depend on how a student chose to answer rather than on what they said.
  Withholding the field makes the guarantee a property of the code rather than a hope about a prompt, and a
  test in `backend/tests/voice.test.ts` reads the source to assert it stays that way.
- **No inference from how a voice sounds.** There is no accent, fluency, emotion, confidence, personality,
  gender, age, or first-language scoring, and none is derived indirectly. Delivery signals shown to students
  (pace, filler words, answer length) are computed from the **words of the transcript**, are presented as
  practice feedback, and are labelled in the UI as not affecting the score — because they do not.
- **Nothing is recorded.** No audio from an interview is stored, in either path.

---

## 5. Scoring honesty

### The prototype label is not decoration

Every readiness score, in the UI, the API and every PDF, carries:

> **PROTOTYPE SCORING MODEL.** The Placement Readiness Score is produced by a configurable weighted model
> developed for this project. It has not been validated against real placement outcomes and must be used as
> a preparation guide, not as a prediction of employment.

The disclaimer is stored **on each snapshot**, so an exported report always carries the wording that applied
when the score was computed.

### Synthetic ML metrics are labelled as such

The default model trains on generated data. Every metric is reported as
**"Prototype Evaluation — Synthetic Dataset"** with:

> These records were generated by a documented statistical process for development and demonstration. They
> are not real student data, and metrics derived from them must not be presented as empirical research
> results.

The generator deliberately adds ~6% label noise (flipped only to an adjacent class) plus unmeasured
variance. A perfectly separable synthetic dataset would produce a ~99% accuracy figure that means nothing.
A test asserts accuracy stays between 50% and 95%.

### Missing evidence is never shown as zero

A component with no attempts renders as `—` with "No evidence recorded yet", never as 0. Telling a student
they scored zero on something they have not attempted is simply false.

### Unverified information is labelled

A company recruitment pattern with no source URL is marked **unverified** everywhere it appears, and the RAG
layer refuses to cite it as fact. The seeded patterns are illustrative and carry no sources.

### The RAG layer admits ignorance

When retrieval returns nothing above the relevance threshold:

> The knowledge base does not contain verified information on this. Rather than guess — particularly about a
> company's recruitment process — please confirm with the official careers page or your placement office.

The model is never asked to improvise an answer about a company's policies.

### Unavailable is reported, not faked

- When the code sandbox is unavailable, Run and Submit report that the code was **not executed** and award
  **no score**. A fabricated verdict would corrupt every downstream readiness computation.
- A coding verdict comes only from the deterministic judge. The AI code review is advisory, is labelled
  "Static Code Analysis", and cannot change a verdict or a score.
- An untrained ML model produces no prediction; the readiness page states it is unavailable, and APIE's
  explainable score remains authoritative.
- The `mock` LLM provider tags every response `provider: "mock"` with a visible notice.

---

## 6. Data handling

### Collected, and why

| Category | Purpose |
|---|---|
| Account | Authentication and access control |
| Profile, CGPA, skills | Readiness scoring, job matching, eligibility checks |
| Resume file and extracted text | ATS analysis and skill extraction |
| Assessment answers and scores | Performance measurement |
| Interview transcripts | Feedback and readiness scoring |
| Integrity signals | Human review of assessment integrity |
| Alumni feedback | Human-in-the-loop readiness input |

### Not stored

**AI prompts are not persisted.** `AIInteraction` records the agent, operation, outcome, latency and byte
counts — never the prompt or completion, because those contain resume content and interview answers.

### Student rights

| Right | How |
|---|---|
| See everything held about you | `GET /privacy/my-data` — includes every monitoring event |
| Export it | `GET /privacy/export` — machine-readable JSON |
| Request deletion | `POST /privacy/delete-account` |
| Withdraw media consent | `POST /privacy/withdraw-consent` |
| Read the policy before registering | `GET /privacy/policy` — public |

**Deletion is honest about what it does.** The account locks immediately, all sessions are revoked, and
uploaded resume files are deleted straight away. Assessment and interview records are retained pending staff
processing under institutional retention policy — and the user is told exactly that, rather than being given
a false promise of instant erasure.

### Research export

Identity is replaced with a one-way SHA-256 `anonymousId`: stable across exports so longitudinal analysis
works, but not reversible without the database. No name, roll number or email is included. Every row carries
its provenance (`DEMO` / `SYNTHETIC` / `REAL`) and the export can be filtered to one, so demo and synthetic
records cannot silently contaminate an analysis of real outcomes. Every export is written to the audit log.

---

## 7. Fairness

- **Weights are visible and configurable.** The exact weighting is shown to students and editable by
  administrators. A hidden scoring model cannot be challenged.
- **Score changes are attributable.** Every snapshot records what triggered it and the delta.
- **Human feedback is bounded.** Alumni feedback moves the score by at most ±4 points. A single mentor
  having a bad day should not dominate a student's readiness.
- **Eligibility failures are explained.** "Your CGPA of 5.5 is below the stated minimum of 7.0" — not a
  silent rejection.
- **A missing CGPA is not a rejection.** It is flagged as a data gap the student can fix, and the notes say
  so.
- **Alumni verification is manual.** Their feedback affects student scores, so employment is confirmed by a
  named administrator with an audit trail — never automatically.

---

## 8. Before deploying this at an institution

1. **Have the privacy policy reviewed** by your data-protection officer. The shipped version is a template
   and is labelled as one.
2. **Decide who reviews integrity flags**, and train them on the "not proof of misconduct" standard.
3. **Validate the APIE weights** against your own placement outcomes before presenting the score as
   meaningful, or retune them — they are configurable for exactly this reason.
4. **Retrain the ML model on real outcomes.** The synthetic model is a working pipeline, not a validated
   predictor.
5. **Decide your retention windows** and configure them under `privacy.retention`.
6. **Confirm the AI provider's data-processing terms** cover sending resume text and interview transcripts,
   or run a local model via `AI_PROVIDER=ollama`.
7. **Never present mock provider output as a model result**, and never present synthetic metrics as research
   findings.
