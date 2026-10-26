# Ten-minute technical presentation

| Time | Section | Speaking points |
|---|---|---|
| 0:00 – 0:45 | Problem | Preparation is spread over disconnected tools. No overall readiness view for the student or the placement cell. Unexplained scores reduce trust. |
| 0:45 – 1:30 | Existing system | Single-purpose resume checkers, coding sites and learning platforms. Each is good at one thing; none combine the evidence. AI-only scoring is not repeatable. |
| 1:30 – 2:15 | Proposed system | One platform, four roles (student, alumni, placement officer, administrator). One readiness engine fed by every scored activity. |
| 2:15 – 3:30 | Architecture | React + TypeScript SPA. Node.js + Express gateway: JWT, RBAC, Zod validation, MongoDB with 33 models, Socket.IO, 135 endpoints. Python FastAPI AI service: 11 agents and an orchestrator. One trust boundary: only the gateway calls the AI service. Docker Compose for deployment. |
| 3:30 – 4:30 | Modules | Resume and ATS; job matching; assessments with a server-side timer; DSA judge; AI interview with voice; APIE readiness; career plan; mentorship; analytics and PDF reports. |
| 4:30 – 5:30 | Algorithms | Dictionary skill extraction with custom boundaries. Capped multi-criteria ATS scoring. Feature-hashing embeddings and cosine similarity. RAG with a relevance threshold. Harmonic recency weighting in APIE. Random Forest. A prerequisite graph in topological order for the plan. Structural JSON comparison in the judge. |
| 5:30 – 6:30 | AI models | LLM behind a provider interface; mock provider for offline use. Random Forest trained on synthetic data, accuracy 0.735, labelled a prototype. Two QLoRA pipelines: Qwen3-4B for ATS (not trained), Qwen3-1.7B for career plans (v1 not usable). |
| 6:30 – 7:15 | Training | QLoRA: frozen 4-bit base model plus rank-16 adapters, about 1% of parameters. ATS data: three public datasets inspected, PII scrubbed, near-duplicates clustered, split by cluster with a leakage audit, weak labels from the existing engine. Career data: synthetic profiles through the planner, two roles held out. |
| 7:15 – 8:00 | Evaluation | What is measured: deterministic ATS baselines, the classifier, the skill recommender, career model v1, and the judge with 112 reference programs. What is not: any fine-tuned ATS result, human agreement, performance benchmarks. State this plainly. |
| 8:00 – 8:30 | Innovation | One explainable readiness model; "facts from code, judgement from the model, arithmetic from code"; resource IDs instead of URLs; hidden tests that never enter the sandbox. |
| 8:30 – 9:00 | Security | bcrypt, JWT with refresh rotation and family revocation, RBAC, Zod and sanitisation, rate limits, upload magic-byte checks, audit log. Student code only in an isolated container with no network, read-only filesystem, non-root user and resource limits. |
| 9:00 – 9:30 | Performance | Indexes, pagination, lazy-loaded routes, client caching, concurrency cap on sandboxes. No benchmark yet; method defined. |
| 9:30 – 10:00 | Demo pointer and future work | Train and evaluate the models; validate weights with real outcomes; human ratings; verify the sandbox with Docker; queue and admin problem editor. |

## Lines worth memorising

- "Deterministic algorithms compute every score; language models are used only for language."
- "The model reasons; the application knows."
- "A language model here cannot set a score, cannot invent a link, and cannot decide whether code is correct."
- "The accuracy figure is on synthetic data. It shows the pipeline works, not that it predicts real placements."
- "When the sandbox is unavailable the system says 'not executed'. It never guesses a verdict."
