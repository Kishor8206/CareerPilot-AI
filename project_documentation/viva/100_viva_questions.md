# Viva questions and answers

104 questions in 24 groups. Each has a **short** answer (one breath), a **technical** answer, a **deep** answer for a follow-up, and the **common mistake** to avoid.

## A. Basic project questions

**Q1. What is CareerPilot AI?**
- **Short:** A placement-preparation platform that combines resume analysis, coding practice, mock interviews and a career plan into one readiness score.
- **Technical:** A React frontend, a Node.js/Express gateway with MongoDB, and a Python FastAPI AI service with 11 agents.
- **Deep:** Every scored activity triggers APIE, a weighted, recency-aware engine, to recompute a Placement Readiness Score with components, reasons and next actions.
- **Common mistake:** Calling it "an AI that predicts placement". It measures preparation; it does not predict outcomes.

**Q2. What problem does it solve?**
- **Short:** Preparation tools are disconnected, so students cannot see overall readiness or priorities.
- **Technical:** It integrates the evidence from each stage into one explainable score and one plan.
- **Deep:** The placement cell gets the same data as cohort analytics and an at-risk list.
- **Common mistake:** Listing features instead of stating the problem.

**Q3. Who are the users?**
- **Short:** Students, alumni, placement officers and administrators.
- **Technical:** Four active roles enforced by `authorize(role)` middleware; a recruiter role is reserved but not built.
- **Deep:** Each role has its own dashboard and route set; ownership checks stop a student reading another student's data.
- **Common mistake:** Mentioning faculty or recruiters as working roles.

**Q4. What is your one-line technical summary?**
- **Short:** Deterministic algorithms compute every score; language models are used only for language.
- **Technical:** Model outputs are schema-validated and final scores are recomputed from fixed weights.
- **Deep:** This makes scores repeatable, explainable and available even when the LLM is down.
- **Common mistake:** Saying "everything is AI-powered".

**Q5. Which parts actually use a language model today?**
- **Short:** Interview questions, answer evaluation, and the advisory code review.
- **Technical:** Through a provider interface; the local setting is the mock provider.
- **Deep:** The ATS score, readiness score, job match, career plan and judge verdicts use no LLM at all.
- **Common mistake:** Claiming the ATS score or career plan comes from a fine-tuned LLM.

## B. Architecture

**Q6. Why three services?**
- **Short:** Node is good at web I/O; Python has the ML libraries.
- **Technical:** The gateway handles auth, sockets and the database; FastAPI hosts NLP, scoring and ML.
- **Deep:** A shared TypeScript package keeps frontend and backend types identical; the gateway is the single AI caller so auth and audit live in one place.
- **Common mistake:** Calling it microservices. It is three services with one database.

**Q7. How do the services communicate?**
- **Short:** HTTP and WebSocket from the browser; HTTP with an internal key between gateway and AI service.
- **Technical:** `aiClient` adds the key, retries connection errors and maps failures to typed errors.
- **Deep:** The AI service is not exposed publicly, so the key and model access never reach the browser.
- **Common mistake:** Saying the frontend calls the AI service.

**Q8. Is it monolithic or microservices?**
- **Short:** Service-oriented with three services.
- **Technical:** No service discovery, message bus or per-service database.
- **Deep:** The split follows technology and trust boundaries, not team or scaling boundaries.
- **Common mistake:** Over-claiming microservices.

**Q9. What happens if the AI service is down?**
- **Short:** Scores still work in principle because they are deterministic; AI-dependent calls return a clear error.
- **Technical:** The gateway returns `AI_SERVICE_UNAVAILABLE`; the resume is saved and can be re-analysed.
- **Deep:** The test suite points the AI client at a closed port to prove graceful degradation.
- **Common mistake:** Saying "nothing breaks". Analysis that needs the Python engine cannot run without it.

**Q10. Where is the single source of truth for types?**
- **Short:** The `shared` package.
- **Technical:** Enums, DTOs and constants imported by both TypeScript apps.
- **Deep:** A change to a DTO breaks the build on both sides, so drift is caught at compile time.
- **Common mistake:** Not knowing the package exists.

## C. Frontend

**Q11. Why React with TypeScript?**
- **Short:** Component reuse and type safety.
- **Technical:** Vite for builds, Tailwind and Radix primitives for UI.
- **Deep:** Types come from the shared package, so API shapes are checked at compile time.
- **Common mistake:** Saying "because it is popular".

**Q12. How is state managed?**
- **Short:** TanStack Query for server data, Zustand for auth.
- **Technical:** Queries are cached by key and invalidated after mutations.
- **Deep:** Separating server state from client state avoids a large global store.
- **Common mistake:** Saying Redux.

**Q13. How is the bundle kept small?**
- **Short:** Route-level code splitting.
- **Technical:** 35 pages are loaded with `React.lazy`; Monaco loads only on the problem page.
- **Deep:** No size benchmark was run; the benefit is expected, not measured.
- **Common mistake:** Quoting a load-time number.

**Q14. Why Monaco?**
- **Short:** It is the editor behind VS Code.
- **Technical:** Syntax highlighting for all four languages; read-only while a run is pending.
- **Deep:** Drafts are saved per problem and language in local storage.
- **Common mistake:** Claiming IntelliSense for user code.

**Q15. How does voice input work?**
- **Short:** The browser's Web Speech API, on the device.
- **Technical:** Speech becomes an editable transcript; `speechSynthesis` reads questions aloud.
- **Deep:** A server Whisper fallback exists behind a provider setting; the input mode is not sent to the evaluator.
- **Common mistake:** Saying audio is analysed for tone or emotion. It is not.

## D. Backend

**Q16. Why Express?**
- **Short:** A mature, simple middleware model.
- **Technical:** Each route is a chain: authenticate, authorize, validate, controller.
- **Deep:** Controllers stay thin; services hold the rules; this keeps logic testable.
- **Common mistake:** Putting business logic in controllers when describing it.

**Q17. How are requests validated?**
- **Short:** Zod schemas.
- **Technical:** `validate({ body, query, params })` rejects bad input with field-level details.
- **Deep:** A sanitiser also strips MongoDB operator keys to prevent NoSQL injection.
- **Common mistake:** Saying validation is only on the frontend.

**Q18. How are errors handled?**
- **Short:** One central error handler.
- **Technical:** `ApiError` carries a status and a machine-readable code.
- **Deep:** Stack traces are logged with pino, not returned to the client.
- **Common mistake:** Saying errors are just `console.log`.

**Q19. How do you log?**
- **Short:** Structured JSON logs with pino.
- **Technical:** Each request has an id; AI calls are recorded in `AIInteraction`.
- **Deep:** Sensitive actions are written to an audit log that administrators can read.
- **Common mistake:** Claiming a monitoring stack. There is none.

**Q20. How do real-time updates work?**
- **Short:** Socket.IO.
- **Technical:** The server emits notifications and `readiness:updated`.
- **Deep:** The same channel carries WebRTC signalling for the alumni interview room.
- **Common mistake:** Saying polling.

## E. Database

**Q21. Why MongoDB?**
- **Short:** The data is nested and changed shape during development.
- **Technical:** Analyses, snapshots and plans are documents; 33 Mongoose models.
- **Deep:** The cost is weaker referential integrity, handled in the service layer.
- **Common mistake:** Saying "NoSQL is faster".

**Q22. How are relationships stored without foreign keys?**
- **Short:** `ObjectId` references.
- **Technical:** Mongoose `populate` resolves them.
- **Deep:** Many-to-many relations use a join document, for example `CodingSubmission` between student and problem.
- **Common mistake:** Saying MongoDB has foreign keys.

**Q23. Why are readiness records append-only?**
- **Short:** To keep history.
- **Technical:** Each computation is a new snapshot with the weights used.
- **Deep:** Old scores stay interpretable after an administrator changes the weights.
- **Common mistake:** Saying the score is overwritten.

**Q24. How are hidden test cases protected in the database?**
- **Short:** They are excluded from queries by default.
- **Technical:** `select: false` on `hiddenTestCases` and `referenceSolutions`.
- **Deep:** Only the Submit path asks for them by name, and the DTO builder never reads them.
- **Common mistake:** Saying they are "filtered out in the frontend".

**Q25. Which indexes matter?**
- **Short:** Lookups by student, slug, status and date.
- **Technical:** About 186 index declarations, including unique `email` and `slug`.
- **Deep:** Their effect has not been benchmarked.
- **Common mistake:** Quoting a query time.

## F. APIs

**Q26. How many endpoints are there?**
- **Short:** 135 under `/api/v1`.
- **Technical:** In 15 route files mounted on 19 paths.
- **Deep:** The AI service has a separate internal API.
- **Common mistake:** Guessing a number.

**Q27. What does a response look like?**
- **Short:** A common envelope.
- **Technical:** `{ success, data, meta }` or `{ success: false, error: { code, message, details } }`.
- **Deep:** Error codes are shared constants, so the frontend can branch on them.
- **Common mistake:** Saying raw objects are returned.

**Q28. Which endpoint analyses a resume?**
- **Short:** `POST /api/v1/resumes/:id/analyze`.
- **Technical:** Optional `jobDescriptionId` or `jobDescriptionText`, never both.
- **Deep:** A custom JD is used for that analysis only and is not stored.
- **Common mistake:** Inventing `/api/resume/analyze`.

**Q29. Run versus Submit?**
- **Short:** Run uses public tests and stores nothing; Submit adds hidden tests and stores the result.
- **Technical:** `POST /coding/problems/:id/run` and `/submit`.
- **Deep:** Only Submit updates readiness and requests the advisory review.
- **Common mistake:** Saying Run also uses hidden tests.

**Q30. Is the API versioned?**
- **Short:** Yes, `/api/v1`.
- **Technical:** The prefix is configuration.
- **Deep:** A breaking change would be released as `/api/v2` beside it.
- **Common mistake:** Saying there is no versioning.

## G. AI and ML

**Q31. What ML model is trained and in use?**
- **Short:** A Random Forest readiness classifier.
- **Technical:** 300 trees, 14 features, four classes.
- **Deep:** Trained on 2,000 synthetic rows; accuracy 0.735, macro F1 0.737, three-fold CV 0.739 ± 0.020.
- **Common mistake:** Presenting 73.5% as accuracy on real students.

**Q32. Why synthetic data?**
- **Short:** There are no real placement outcomes yet.
- **Technical:** Students are drawn from four ability archetypes with Gaussian noise and 6% label flips.
- **Deep:** Noise is added on purpose; without it the labels would be a clean function of the features and accuracy would be about 99% and meaningless.
- **Common mistake:** Hiding that it is synthetic.

**Q33. Why Random Forest?**
- **Short:** It suits small tabular data.
- **Technical:** Little tuning, handles mixed scales, gives feature importances.
- **Deep:** Gradient Boosting is available as an alternative; a neural network would overfit this little data.
- **Common mistake:** Saying "it has the best accuracy" without a comparison.

**Q34. What are the top features?**
- **Short:** Academic, coding and technical scores.
- **Technical:** Importances 0.191, 0.157, 0.151.
- **Deep:** These are global importances, not a per-student explanation such as SHAP.
- **Common mistake:** Calling them causal.

**Q35. What is the difference between APIE and the classifier?**
- **Short:** APIE is a rule-based score; the classifier is a learned second opinion.
- **Technical:** Both read the same components.
- **Deep:** They are shown side by side; APIE is authoritative because it is explainable.
- **Common mistake:** Saying the classifier produces the readiness score.

## H. LLM

**Q36. Which LLM does the project use?**
- **Short:** Any provider behind one interface; the local setting is the mock.
- **Technical:** `AI_PROVIDER` selects OpenAI-compatible, Azure, Ollama or mock.
- **Deep:** The mock is rule-based and tagged `provider: "mock"`; it is not a language model.
- **Common mistake:** Naming a specific model as "the one we use" without checking the setting.

**Q37. How do you control LLM output?**
- **Short:** JSON schemas, low temperature and recomputed scores.
- **Technical:** Pydantic validation on every agent output.
- **Deep:** The model returns dimension scores; the overall comes from fixed weights in code.
- **Common mistake:** Saying "we trust the model".

**Q38. What is a transformer?**
- **Short:** A neural network built on attention.
- **Technical:** Each token attends to others to build a context-aware representation.
- **Deep:** Stacked attention and feed-forward layers; LoRA adapters are attached to their projection matrices.
- **Common mistake:** Confusing it with an RNN.

**Q39. What is tokenization?**
- **Short:** Splitting text into pieces the model reads.
- **Technical:** Sequence limits are in tokens: 3,072 for ATS, 4,096 for the career model.
- **Deep:** Over-long career examples were dropped rather than truncated; ATS text is truncated before labelling.
- **Common mistake:** Saying tokens are words.

**Q40. What is hallucination and how do you handle it?**
- **Short:** A fluent statement with no basis.
- **Technical:** Schemas, a grounding guard, resource IDs and a RAG threshold.
- **Deep:** Facts come from deterministic extraction; a "matched" skill not in the resume is moved to missing and counted.
- **Common mistake:** Claiming hallucination is eliminated.

## I. Fine-tuning

**Q41. Which models did you fine-tune?**
- **Short:** Two pipelines: Qwen3-4B for ATS and Qwen3-1.7B for career plans.
- **Technical:** Both QLoRA, rank 16, alpha 32.
- **Deep:** The ATS model has not been trained; the career model's first run was measured as not usable. Neither is serving.
- **Common mistake:** Saying "we fine-tuned and deployed Qwen".

**Q42. What is supervised fine-tuning?**
- **Short:** Training on input and target pairs.
- **Technical:** Chat-format examples with completion-only loss.
- **Deep:** Loss is computed on the answer tokens only, so the model learns the JSON and not to reproduce the resume.
- **Common mistake:** Confusing it with pre-training.

**Q43. Where do the ATS labels come from?**
- **Short:** Weak labels computed by formulas on the existing engine.
- **Technical:** No label is produced by an LLM or a human.
- **Deep:** Three holistic components are blended with a dataset fit label at λ = 0.35; the rest are pure evidence.
- **Common mistake:** Calling them ground truth.

**Q44. How did you prevent data leakage?**
- **Short:** Split by near-duplicate cluster before sampling.
- **Technical:** MinHash with LSH, verified by Jaccard ≥ 0.8; job descriptions are held out too.
- **Deep:** An audit over all split pairs reports 0/0/0 and the build refuses to write otherwise.
- **Common mistake:** Saying "we used a random split".

**Q45. Why was a dataset's provided ATS score discarded?**
- **Short:** It carried no information beyond the class label.
- **Technical:** Within a class its correlation with text features was about −0.001.
- **Deep:** The three classes sat in disjoint score bands with the same spread: class band plus noise.
- **Common mistake:** Using a provided label without inspecting it.

## J. LoRA

**Q46. What is LoRA?**
- **Short:** Training small adapter matrices instead of the whole model.
- **Technical:** `W' = W + (α/r)·B·A` with W frozen.
- **Deep:** A and B are low-rank, so the number of trained parameters is small.
- **Common mistake:** Saying LoRA compresses the model.

**Q47. What do rank and alpha mean?**
- **Short:** Rank is adapter capacity; alpha scales its effect.
- **Technical:** r = 16, α = 32, so the scale is 2.
- **Deep:** Higher rank can fit more but risks overfitting on small data.
- **Common mistake:** Confusing rank with the number of layers.

**Q48. Which layers have adapters?**
- **Short:** All seven projection layers.
- **Technical:** The attention and feed-forward projections.
- **Deep:** For the ATS model that is about 33 million trainable parameters, about 0.8%.
- **Common mistake:** Quoting a parameter count for the career model; it was not recorded.

**Q49. What is the output of LoRA training?**
- **Short:** A small adapter file.
- **Technical:** `adapter_model.safetensors` and its config.
- **Deep:** The base model is unchanged, so the untuned model can be evaluated by disabling the adapter.
- **Common mistake:** Saying a new full model is produced.

## K. QLoRA

**Q50. What is QLoRA?**
- **Short:** LoRA on a base model loaded in 4-bit.
- **Technical:** 4-bit NF4 quantization with bitsandbytes or Unsloth.
- **Deep:** The frozen weights are quantized; adapters train in higher precision.
- **Common mistake:** Saying the adapters are 4-bit.

**Q51. Why QLoRA and not full fine-tuning?**
- **Short:** Only a free 16 GB T4 was available.
- **Technical:** Full fine-tuning of a 4B model does not fit.
- **Deep:** QLoRA also gives a swappable, versioned adapter and a clean base-versus-tuned comparison.
- **Common mistake:** Saying QLoRA is more accurate.

**Q52. What does quantization cost?**
- **Short:** A small loss of precision.
- **Technical:** Each training step is somewhat slower.
- **Deep:** No quantized-versus-full comparison was run in this project.
- **Common mistake:** Claiming zero quality loss.

**Q53. What is gradient accumulation and why use it?**
- **Short:** Simulating a larger batch on a small GPU.
- **Technical:** 1 × 16 for ATS behaves like batch 16.
- **Deep:** For the career model, updating every 16 examples gave only 37 updates in v1, which is why the notebook now updates every 4.
- **Common mistake:** Saying it speeds training up.

## L. NLP

**Q54. Which NLP techniques are used?**
- **Short:** Regex, dictionary matching and spaCy NER.
- **Technical:** Section detection by heading patterns; skills from a taxonomy.
- **Deep:** The only statistical NLP model in the resume path is spaCy's NER, used for the name.
- **Common mistake:** Claiming TF-IDF or BERT.

**Q55. Why not `\b` word boundaries?**
- **Short:** They break on `C++` and `C#`.
- **Technical:** A custom look-around excludes letters, digits, `+` and `#`.
- **Deep:** It also stops "Java" matching inside "JavaScript"; this is tested.
- **Common mistake:** Saying substring search is used.

**Q56. How are skill variations handled?**
- **Short:** Aliases map to a canonical name.
- **Technical:** 181 aliases for 107 skills, with flexible separators.
- **Deep:** "ReactJS", "React.js" and "react js" all become "React".
- **Common mistake:** Saying fuzzy matching.

**Q57. What if the resume is a scanned image?**
- **Short:** It is rejected with a clear message.
- **Technical:** Fewer than 120 extracted characters raises a parse error.
- **Deep:** OCR is not implemented; it is future work.
- **Common mistake:** Claiming OCR support.

## M. ATS

**Q58. How is the ATS score calculated?**
- **Short:** Nine rule-based criteria summing to 100.
- **Technical:** Skills 20, structure 15, experience 15, contact 10, education 10, impact 10, formatting 10, verbs 5, length 5.
- **Deep:** Each uses capped formulas, giving diminishing returns.
- **Common mistake:** Saying an LLM scores the resume.

**Q59. How do you know the ATS score is accurate?**
- **Short:** It is a transparent rubric, not a validated predictor.
- **Technical:** Against weak labels the engine has MAE 5.18 and Spearman 0.873 in general mode.
- **Deep:** No human agreement exists yet; the review sheet of 476 examples is empty.
- **Common mistake:** Saying "it matches real ATS systems".

**Q60. What was learned from the baseline evaluation?**
- **Short:** Keyword coverage barely tracks job fit on unseen jobs.
- **Technical:** Spearman 0.079 against fit labels; a richer heuristic reaches 0.227.
- **Deep:** That gap is the headroom a fine-tuned model would have to beat.
- **Common mistake:** Claiming the fine-tuned model beat it. It was not measured.

**Q61. If the model were enabled, what would it decide?**
- **Short:** Component scores and wording only.
- **Technical:** The final score is aggregated in Python.
- **Deep:** Matched and missing keywords stay deterministic even then.
- **Common mistake:** Saying the model outputs the ATS score.

## N. Career plan

**Q62. How is the career plan generated?**
- **Short:** By a deterministic planner.
- **Technical:** Normalise skills, find gaps, score priority, order by prerequisites, fit to time.
- **Deep:** A fine-tuned model can optionally reword and organise it; that path is off.
- **Common mistake:** Saying a fine-tuned LLM writes the plan.

**Q63. How is priority decided?**
- **Short:** An additive score with stated weights.
- **Technical:** Importance × 10, +8 core, +6 per skill unblocked, +12 if ATS flagged it, +4 per level.
- **Deep:** HIGH at 62, MEDIUM at 40; each gap returns its reasons.
- **Common mistake:** Saying the weights were learned.

**Q64. How do you ensure a correct learning order?**
- **Short:** A prerequisite graph.
- **Technical:** 122 skills, 123 edges, verified acyclic, topological order.
- **Deep:** A skill is never deferred while a kept skill depends on it.
- **Common mistake:** Saying order is by priority only.

**Q65. What if the deadline is too short?**
- **Short:** Low-priority gaps are deferred, and the plan says so.
- **Technical:** 75/15/10 time budget; defer LOW then MEDIUM secondary gaps.
- **Deep:** If it still does not fit, the plan states the deadline is not achievable at this pace.
- **Common mistake:** Saying the plan always fits.

**Q66. Where does role knowledge come from?**
- **Short:** A curated knowledge base, corroborated by O*NET, ESCO and job postings.
- **Technical:** 81% of 275 role-to-skill links are corroborated.
- **Deep:** Levels, hours and prerequisites are editorial and unvalidated; O*NET and ESCO do not contain them.
- **Common mistake:** Saying the roadmap "comes from O*NET".

## O. Recommendation systems

**Q67. How are resources recommended?**
- **Short:** A deterministic ranking over a verified catalogue.
- **Technical:** Points for covering the skill, stage match, verification, quality weight, preference and language.
- **Deep:** Ties break on the resource ID so the order is reproducible.
- **Common mistake:** Calling it collaborative filtering.

**Q68. Is there a learned recommender?**
- **Short:** Yes, for skills, but it is not live.
- **Technical:** Item-based collaborative filtering with shrinkage.
- **Deep:** Recall@5 0.411 against 0.272 for popularity, with a 95% interval of +0.101 to +0.176.
- **Common mistake:** Presenting it as a running feature.

**Q69. Why did the simpler recommender win?**
- **Short:** The dataset is small.
- **Technical:** 844 baskets; PPMI + SVD embeddings scored lower.
- **Deep:** A popularity penalty was also tested and rejected because it lowered validation scores.
- **Common mistake:** Assuming the more complex model is better.

**Q70. What is `quality_score`?**
- **Short:** An editorial weight by resource type.
- **Technical:** Between 0 and 1.
- **Deep:** It is not a user rating; there is no rating data.
- **Common mistake:** Calling it a rating.

## P. YouTube API

**Q71. Why use the YouTube Data API?**
- **Short:** To get current videos that actually exist.
- **Technical:** Search per skill, keep public and embeddable videos.
- **Deep:** 180 videos are in the catalogue; a live search endpoint returns results labelled unverified.
- **Common mistake:** Saying the model generates YouTube links.

**Q72. What if YouTube returns an irrelevant video?**
- **Short:** It ranks lower or is not used.
- **Technical:** 151 of 180 name the skill in the title; the other 29 rank lower.
- **Deep:** Videos are availability-checked, not quality-reviewed; that is a stated limitation.
- **Common mistake:** Claiming relevance is guaranteed.

**Q73. Where is the API key?**
- **Short:** Only in the local `.env` file.
- **Technical:** Never in code, the example file or the Colab package.
- **Deep:** The packaging script scans the archive for key-shaped strings and fails if it finds one.
- **Common mistake:** Showing the key on screen.

## Q. DSA judge

**Q74. How is submitted code executed?**
- **Short:** In a throw-away Docker container.
- **Technical:** Compile once, then run each test with inputs streamed by the host.
- **Deep:** The harness writes the return value to a result file; the host compares it with the expected value.
- **Common mistake:** Saying code runs on the backend.

**Q75. How is the verdict decided?**
- **Short:** By a fixed decision list.
- **Technical:** Time limit, memory, runtime error, wrong answer, accepted.
- **Deep:** The submission's verdict is its first failing test; no AI is involved.
- **Common mistake:** Saying AI checks the code.

**Q76. How do you compare outputs?**
- **Short:** Structurally, as JSON.
- **Technical:** Float tolerance 1e-6; optional order-insensitive modes.
- **Deep:** Formatting cannot change a verdict because values, not text, are compared.
- **Common mistake:** Saying string comparison.

**Q77. How are four languages supported from one problem?**
- **Short:** Code generation from a typed signature.
- **Technical:** Starter code and harness are generated per language.
- **Deep:** Arguments use a token format that every language can parse without a JSON library.
- **Common mistake:** Saying each problem is written four times.

**Q78. How was the judge tested?**
- **Short:** 28 reference solutions in four languages, all accepted.
- **Technical:** 112 programs on every public and hidden test.
- **Deep:** Through a test-only local transport with local compilers; container isolation was not exercised.
- **Common mistake:** Saying the Docker sandbox was tested.

## R. Docker

**Q79. Why Docker?**
- **Short:** Isolation with resource limits.
- **Technical:** Namespaces and cgroups separate the process and cap memory, CPU and processes.
- **Deep:** It is not a VM boundary; a dedicated host and stricter profiles are recommended for hostile traffic.
- **Common mistake:** Saying Docker is fully secure.

**Q80. How do you stop an infinite loop?**
- **Short:** A time limit.
- **Technical:** `timeout` inside the container and a host-side deadline.
- **Deep:** After a time-limit failure the remaining tests are not run, bounding total time.
- **Common mistake:** Saying the server detects loops.

**Q81. How do you stop a fork bomb?**
- **Short:** A process limit.
- **Technical:** `--pids-limit`.
- **Deep:** The verification script includes a fork-bomb probe.
- **Common mistake:** Saying memory limits handle it.

**Q82. How are memory limits enforced?**
- **Short:** A container ceiling plus per-language limits.
- **Technical:** `-Xmx` for Java, `--max-old-space-size` for Node, an address-space limit for C++.
- **Deep:** C++ and Java containers get a larger ceiling because their compilers need it.
- **Common mistake:** Saying one flag does everything.

**Q83. Why is the judge disabled in Docker Compose?**
- **Short:** A containerised backend would need the host's Docker socket.
- **Technical:** Mounting that socket is root on the host.
- **Deep:** So the backend runs on the host when the judge is needed.
- **Common mistake:** Suggesting the socket be mounted.

## S. Security

**Q84. How are passwords stored?**
- **Short:** As bcrypt hashes.
- **Technical:** 12 rounds with a per-password salt.
- **Deep:** The cost factor makes brute force slow.
- **Common mistake:** Saying encrypted. Hashing is one-way.

**Q85. How does authentication work?**
- **Short:** A short-lived access token and a rotating refresh token.
- **Technical:** 15 minutes and 7 days; refresh in a signed httpOnly cookie.
- **Deep:** Reuse of an old refresh token revokes the whole family.
- **Common mistake:** Saying tokens are stored in the database as sessions.

**Q86. How do you prevent injection?**
- **Short:** Validation and sanitisation.
- **Technical:** Zod types; operator keys stripped.
- **Deep:** Mongoose casts values to schema types as a further layer.
- **Common mistake:** Talking about SQL injection for MongoDB.

**Q87. How are uploads secured?**
- **Short:** Type, content and size checks.
- **Technical:** Extension, MIME type, magic bytes, 5 MB.
- **Deep:** Files are stored under generated keys and served only as attachments.
- **Common mistake:** Saying only the extension is checked.

**Q88. How are resumes protected?**
- **Short:** Owner-only access with audit.
- **Technical:** Ownership checks; staff access is logged.
- **Deep:** Training data was PII-scrubbed; privacy endpoints support export and deletion.
- **Common mistake:** Claiming encryption at rest. Not in the repository.

## T. Performance

**Q89. What performance optimisations exist?**
- **Short:** Indexes, pagination, lazy loading, caching, a concurrency cap.
- **Technical:** See the performance table.
- **Deep:** None has been benchmarked.
- **Common mistake:** Quoting a speed-up.

**Q90. How would you benchmark?**
- **Short:** Load tests and query plans.
- **Technical:** p50/p95/p99 latency at fixed users; `explain("executionStats")`.
- **Deep:** For the judge: compile time, per-test time and queue wait under concurrency.
- **Common mistake:** Saying "it feels fast".

**Q91. What is the bottleneck?**
- **Short:** Synchronous analysis and the judge.
- **Technical:** Both run inside the request.
- **Deep:** A queue with workers is the planned fix.
- **Common mistake:** Saying there is none.

## U. Algorithms

**Q92. What is cosine similarity?**
- **Short:** The angle between two vectors.
- **Technical:** Dot product over the product of norms.
- **Deep:** With normalised vectors it equals the dot product.
- **Common mistake:** Confusing it with Euclidean distance.

**Q93. Do you use TF-IDF?**
- **Short:** No.
- **Technical:** Feature hashing with sub-linear term frequency.
- **Deep:** There is no inverse document frequency term; it is a lexical embedding.
- **Common mistake:** Saying yes.

**Q94. What is RAG?**
- **Short:** Retrieve relevant text, then generate from it.
- **Technical:** Chunk, embed, top-5 search, relevance filter, answer with sources.
- **Deep:** Below the threshold the LLM is not called at all.
- **Common mistake:** Saying RAG removes hallucination.

**Q95. How was the RAG threshold chosen?**
- **Short:** By measurement.
- **Technical:** On-topic 0.28–0.31, adjacent 0.11–0.14, unrelated 0.02–0.07; 0.18 sits in the gap.
- **Deep:** It depends on the embedder, so semantic embedders use 0.25.
- **Common mistake:** Saying it was guessed.

**Q96. Why harmonic recency weighting?**
- **Short:** Recent results matter more, without ignoring history.
- **Technical:** Weights 1, ½, ⅓.
- **Deep:** A mean ignores improvement; latest-only is too noisy.
- **Common mistake:** Saying exponential decay.

## V. Innovation

**Q97. What is novel?**
- **Short:** The integration, not a new algorithm.
- **Technical:** One explainable readiness model fed by every module.
- **Deep:** Plus a strict split between deterministic scoring and generative language.
- **Common mistake:** Calling CRUD or a dashboard an innovation.

**Q98. What is your measurable improvement?**
- **Short:** None measured against another product.
- **Technical:** Internal measurements exist: baselines, classifier, recommender, judge correctness.
- **Deep:** A user study or outcome comparison is future work.
- **Common mistake:** Inventing a percentage.

## W. Limitations

**Q99. What is the biggest limitation?**
- **Short:** Nothing is validated against real placement outcomes.
- **Technical:** Weights are design choices; ML data is synthetic.
- **Deep:** Both fine-tuned models are off; no human evaluation exists.
- **Common mistake:** Saying there are no limitations.

**Q100. Why is the career model not usable?**
- **Short:** Too little training.
- **Technical:** 591 examples, 37 updates; 51.7% valid JSON, 6.7% passed the schema, 0% fully valid.
- **Deep:** 21 of 60 outputs never stopped; loss was still falling when the run ended.
- **Common mistake:** Hiding the result.

**Q101. Is the sandbox verified?**
- **Short:** The logic yes, the container isolation not yet.
- **Technical:** Docker was not installed on the development machine.
- **Deep:** `npm run judge:verify` runs hostile programs to check each control.
- **Common mistake:** Saying "fully tested".

## X. Future scope

**Q102. What is next?**
- **Short:** Train and evaluate the models, and validate the weights.
- **Technical:** GPU runs, human review sheets, real outcome data.
- **Deep:** Then a judge queue, an admin problem editor and semantic embeddings.
- **Common mistake:** Listing unrelated features.

**Q103. How would you validate APIE?**
- **Short:** Against real outcomes.
- **Technical:** Collect placement results, fit weights, compare with the current ones.
- **Deep:** Report calibration and discrimination, and re-validate each year.
- **Common mistake:** Saying "ask students if they like it".

**Q104. How would it scale?**
- **Short:** Stateless services behind a load balancer.
- **Technical:** A queue and judge workers; a shared cache; a managed database.
- **Deep:** Socket.IO would need a shared adapter; none of this is built.
- **Common mistake:** Saying it already scales.
