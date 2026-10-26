# How to defend CareerPilot AI

## What is strongest

- **The scoring is defensible.** Every score has a formula you can write on the board.
- **The separation of duties.** Facts from code, judgement from the model, arithmetic from code.
- **Failure is reported, not hidden.** "Not executed", "degraded", "no verified information".
- **Testing.** Automated suites in all three services; 112 reference programs judged correctly.
- **The data work.** Rejecting a provided score after inspection, leakage audits, held-out jobs and roles.

## What is technically impressive

- Four language harnesses generated from one typed signature.
- A sandbox protocol in which expected outputs never enter the container and inputs are streamed one test at a time.
- Refresh-token rotation with family revocation.
- A resource verifier hardened against server-side request forgery.
- A career planner that respects prerequisites and tells you when a deadline is impossible.

## What to emphasise

1. One readiness score from seven components, recomputed after every activity.
2. A language model here cannot set a score, invent a link, or decide whether code is correct.
3. The honest status of each model.

## What to avoid claiming

| Do not say | Say instead |
|---|---|
| "Our fine-tuned Qwen model scores resumes" | "The ATS score is rule-based. A fine-tuning pipeline is built; training has not been run." |
| "The AI generates the career roadmap" | "A deterministic planner generates it. A model was trained to reword it and was not good enough, so it is off." |
| "73.5% accurate at predicting placement" | "0.735 accuracy on a synthetic dataset; a pipeline check, not a real-world result." |
| "The sandbox is fully tested and secure" | "The judge logic is tested. Container isolation still has to be verified with Docker on this machine." |
| "It uses TF-IDF / BERT / semantic search" | "The default embedding is feature hashing, which is lexical. Semantic embedders can be switched on." |
| "It is faster than other platforms" | "No benchmark has been run." |
| "This is a novel algorithm" | "The contribution is integration and a strict design rule." |

## Limitations to admit without being asked twice

Weights not validated · classifier on synthetic data · both fine-tuned models off · mock LLM provider locally · sandbox not run under Docker · 28 problems · no human evaluation · no benchmarks.

## Handling question types

| The jury asks | How to answer |
|---|---|
| "Why…?" | State the requirement, the option chosen, one alternative, and why not. Example: "We needed repeatable scores, so rules; an LLM would vary between runs." |
| "How…?" | Walk the pipeline in order: input → steps → output. Name the file or formula if you can. |
| "What if…?" | Name the failure, then the fallback. Example: "If the model times out, the deterministic engine answers and the response is marked degraded." |
| "What is the novelty?" | "Not a new algorithm. One explainable readiness model fed by every module, with deterministic scoring kept separate from generative language." |
| Something you do not know | "I have not measured that" or "I would need to check the code for that detail". Then say how you would find out. Never guess a number. |
| A hostile framing | Agree with the true part first ("yes, most scoring is rule-based"), then give the reason it is a strength. |

# Final cheat sheet

## The essentials

| Item | Answer |
|---|---|
| One line | A placement-preparation platform that turns all of a student's preparation evidence into one explainable readiness score and a personal plan |
| Problem | Disconnected tools; no overall readiness view; unexplained scores |
| Solution | One account, one scoring engine (APIE), deterministic scores, AI for language only |
| Architecture | React SPA → Node.js/Express gateway (MongoDB, Socket.IO) → Python FastAPI AI service; Docker sandbox for code |
| Size | 33 models, 135 endpoints, 38 pages, 11 agents |
| Roles | Student, Alumni, Placement Officer, Administrator |
| Frontend | React 18, TypeScript, Vite, Tailwind, TanStack Query, Monaco |
| Backend | Node.js, Express, Mongoose, Zod, JWT, Socket.IO, PDFKit |
| AI service | FastAPI, Pydantic, spaCy, PyMuPDF, scikit-learn, NumPy |
| Database | MongoDB 7; references by ObjectId; append-only readiness snapshots |
| Security | bcrypt, JWT 15 min + refresh 7 days with rotation, RBAC, Zod, rate limits, magic-byte upload checks, audit log, sandbox |

## Formulas to know by heart

```
ATS       = 9 capped criteria: skills 20, structure 15, experience 15, contact 10,
            education 10, impact 10, formatting 10, verbs 5, length 5
Job match = 0.55 required + 0.20 preferred + 0.15 similarity + 0.10 eligibility
APIE      = coding 0.25 + technical 0.20 + communication 0.15 + resume 0.10
            + HR 0.10 + aptitude 0.10 + academic 0.10, then bounded modifiers
Recency   = Σ(score_i / (i+1)) / Σ(1 / (i+1))
Bands     = <40 At Risk | 40–60 Needs Improvement | 60–80 Placement Ready | ≥80 Highly Ready
Mentor    = 0.35 company + 0.20 role + 0.20 skills + 0.15 gap + 0.05 rating + 0.05 availability
Priority  = importance×10 + 8 core + 6 per unblocked (cap 24) + 12 if ATS-missing + 4 per level
LoRA      = W + (α/r)·B·A     with r = 16, α = 32
```

## Models

| Model | Status | Number to quote |
|---|---|---|
| Rule-based ATS engine | In use | MAE 5.18, Spearman 0.873 against weak labels |
| APIE | In use | Weights not validated |
| Random Forest | In use as a second opinion | Accuracy 0.735, macro F1 0.737 — synthetic data |
| Skill recommender | Trained, not live | Recall@5 0.411 vs 0.272 baseline |
| Qwen3-4B ATS (QLoRA) | Not trained | None |
| Qwen3-1.7B career (QLoRA) | v1 trained, not usable, off | 51.7% valid JSON, 0% fully valid |
| LLM for interviews | Provider interface; mock locally | None |

## DSA judge

Four languages (Python, C++, Java, JavaScript) · 28 problems, 16 tags · one container per submission · no network, read-only, non-root, memory/CPU/process/time limits · expected outputs stay on the host · seven verdicts · first failing test decides · 112 reference programs accepted with local compilers · Docker isolation still to be verified.

## Training

QLoRA = frozen 4-bit base + rank-16 adapters, about 1% of parameters, fits a free T4. ATS data: 2,162 train / 470 validation / 485 test, weak labels, leakage audit 0/0/0. Career data: 7,157 / 957 / 1,802, two roles held out; v1 used 591 examples and 37 updates.

## Innovation, in one sentence

One explainable readiness model fed by every module, with deterministic scoring kept strictly separate from generative language.

## Future scope, in one sentence

Train and evaluate the models, validate the weights with real outcomes, collect human ratings, and verify and harden the sandbox.

# "What is CareerPilot AI?" at four lengths

## 30-second answer

"CareerPilot AI is a placement-preparation platform. A student analyses their resume, practises coding and interviews, and gets a personal career plan, all on one account. Every activity feeds one engine that produces an explainable Placement Readiness Score and tells the student what to fix first. Scores come from deterministic algorithms; AI is used only for language."

## 1-minute answer

"Students preparing for placement use many disconnected tools and cannot see their overall readiness. CareerPilot AI brings resume analysis, job matching, assessments, DSA practice, mock interviews, a career plan and alumni mentorship into one platform. It has a React frontend, a Node.js gateway with MongoDB, and a Python AI service. A rule-based engine scores the resume on nine criteria, a weighted engine called APIE combines seven components into a readiness score, and a deterministic planner builds a study plan from the student's skill gaps. A language model writes interview questions and evaluates answers, but every final score is recomputed in code, so results are repeatable and explainable."

## 3-minute answer

Start with the 1-minute answer, then add:

"Three design decisions define the project. First, a single trust boundary: the browser talks only to the gateway, which alone calls the AI service. Second, a strict rule for AI: facts from code, judgement from the model, arithmetic from code. A model cannot set a score, cannot invent a link because it may only choose verified resource IDs, and cannot decide whether code is correct because a deterministic judge does that. Third, honest failure: if the code sandbox is unavailable the system says the code was not run; if retrieval finds nothing relevant it says so instead of answering.

For the DSA environment, a student writes one function in Python, C++, Java or JavaScript. The backend generates the surrounding harness from a typed signature and runs it in a throw-away container with no network and strict limits. Expected outputs never enter the container.

We also built QLoRA fine-tuning pipelines for two Qwen models. To be accurate: the ATS model has not been trained yet, and the first career model was measured and found not usable, so both are off and the deterministic engines serve users."

## 5-minute answer

Use the five-minute presentation script in the presentation chapter.

# Top 20 things to remember tomorrow

1. **One line:** deterministic algorithms compute every score; language models are used only for language.
2. **Three services:** React frontend, Node.js/Express gateway, Python FastAPI AI service. The browser never calls the AI service.
3. **Numbers:** 33 models, 135 endpoints, 38 pages, 11 agents, 4 active roles.
4. **ATS = nine rule-based criteria summing to 100.** No LLM.
5. **APIE weights:** coding 0.25, technical 0.20, communication 0.15, resume, HR, aptitude and academic 0.10 each. **Not validated.**
6. **Job match:** 0.55, 0.20, 0.15, 0.10 — and eligibility is a hard gate.
7. **Random Forest: accuracy 0.735 on synthetic data.** Always say "synthetic".
8. **The ATS fine-tuned model is NOT trained.** Pipeline and integration are built.
9. **The career model v1 is NOT usable** (0% fully valid plans) and is switched off.
10. **The career plan comes from a deterministic planner:** gaps → priority → prerequisite order → time budget → verified resources.
11. **QLoRA = frozen 4-bit base + rank-16, alpha-32 adapters, about 1% trained**, chosen because only a free T4 was available.
12. **Resources by ID, never by URL.** 270 in the catalogue; videos via the YouTube Data API.
13. **DSA: four languages, 28 problems, seven verdicts.** C is not supported.
14. **Student code runs only in a container:** no network, read-only, non-root, limits. Never on the server.
15. **Hidden tests and expected outputs never enter the sandbox** and never reach the browser.
16. **The Docker sandbox has not been run on this machine yet.** The judge logic was verified with local compilers.
17. **The local LLM setting is the mock provider**, which is not a language model.
18. **No TF-IDF, no BERT, no queue, no Redis, no faculty role.** Do not mention them as present.
19. **No benchmark, no human evaluation, no real-outcome validation.** Say "not yet measured" and how you would measure it.
20. **If you do not know, say so.** "I have not measured that" is a stronger answer than a guessed number.
