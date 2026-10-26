# Questions the jury may ask to challenge the project

Each answer is written to be said aloud. They are honest first and strong second; a jury trusts the second only after hearing the first.

**1. Why did you use an LLM instead of traditional ML?**
We used both, each where it fits. Scores are rule-based or classical ML because they must be repeatable and explainable. An LLM is used only where the task is language: writing an interview question, judging a free-text answer, phrasing advice. Traditional ML cannot generate a follow-up question; an LLM should not be trusted to add up a score.

**2. Why QLoRA instead of full fine-tuning?**
Hardware and risk. The only GPU was a free 16 GB Colab T4, and full fine-tuning of a 4-billion-parameter model does not fit. QLoRA freezes the base model in 4-bit and trains about 1% of the parameters. It also gives a small adapter we can version, and lets us evaluate the untuned base model simply by disabling the adapter.

**3. Why this base model?**
Three requirements: an open licence, a size that fits a T4 at our sequence length, and reliable instruction-following for JSON. Qwen3 met them and is Apache-2.0. We did not benchmark it against Llama, Mistral or Gemma, so we do not claim it is better — only that it met the requirements.

**4. How do you prevent hallucination?**
By not asking the model for facts. Skills come from dictionary extraction, scores from formulas, links from a catalogue. Where a model is used, its output must pass a strict schema; a skill it claims is matched but is not in the resume is moved to missing; a resource ID not in the catalogue is dropped; and RAG refuses to answer below a relevance threshold without calling the model. We reduce and detect hallucination; we do not claim to eliminate it.

**5. How do you calculate the ATS score?**
Nine criteria with fixed maximum points summing to 100: skills 20, section structure 15, experience 15, contact 10, education 10, quantified impact 10, formatting 10, action verbs 5, length 5. Each is a capped formula, so piling up keywords gives diminishing returns. The breakdown is returned with the score.

**6. How do you know the score is accurate?**
We do not claim it predicts a real employer's ATS. It is a transparent rubric. What we measured: against our weak labels the engine has a mean absolute error of 5.18 and rank correlation of 0.873 in general mode. What we have not measured: agreement with human reviewers. A 476-example review sheet exists and is empty.

**7. How do you evaluate a generated career roadmap?**
Not with accuracy, because it is generation, not classification. The evaluator measures 13 things: JSON validity, schema compliance, skill-gap F1 against the deterministic analysis, priority agreement, prerequisite correctness, ordering, role alignment, personalisation, schedule feasibility, resource-ID validity, resource hallucination, contradictions and duplicates. Whether the advice is *good* needs expert rating; that sheet is prepared and not yet filled.

**8. Why not use RAG for everything?**
RAG fits questions answered by documents. A readiness score needs arithmetic, a study plan needs constraint handling, and a code verdict needs execution. Retrieval does none of those. We use RAG where it belongs — the knowledge base — and deterministic code elsewhere.

**9. Why do you need the YouTube API?**
Because a model's knowledge is frozen at training time and videos change. The API returns videos that exist now and tells us whether they are public and embeddable. The model's job is to reason about which skill to study; the API's job is to find current material.

**10. What happens if YouTube returns irrelevant videos?**
Catalogue videos whose title does not name the skill rank lower: 29 of 180 are in that group. Live search results are labelled "unverified" and are never added to the catalogue. Honestly, videos are availability-checked, not quality-reviewed; a human review step is future work.

**11. What happens if the model recommends a broken course?**
It cannot recommend a course directly. It may only choose resource IDs that were supplied in the prompt. Each ID resolves to a catalogue entry that was fetched and verified; an unknown ID is dropped and counted as a hallucination. A link can still go stale after verification, which is why each entry stores when it was last verified.

**12. How do you verify resources?**
Each non-video URL was requested over HTTPS: 88 of 90 verified, 2 excluded. Videos were checked through the YouTube Data API. The verifier itself is hardened against server-side request forgery: HTTPS only, the provider's own domain only, no private or loopback addresses, at most three redirects, and a cap on bytes read.

**13. How do you prevent prompt injection?**
We do not have a dedicated injection filter, and I will not claim one. The defence is structural: the model has no tools, cannot set a final score because scores are recomputed from fixed weights, and anything outside the schema is rejected. So an instruction hidden in a resume can at most distort wording, not a score. A classifier for injected instructions is future work.

**14. How do you protect user resumes?**
Uploads are checked by extension, MIME type and magic bytes; stored under generated keys; and returned only to the owner or, with an audit entry, to staff. Downloads are sent as attachments with `nosniff`. Training data was scrubbed of emails, phones and profile links. Encryption at rest is not implemented in the repository and would be the storage provider's responsibility.

**15. How is user code executed securely?**
In its own container with no network, a read-only filesystem, a non-root user, all capabilities dropped, and limits on memory, CPU, processes and time. No environment variables are passed in, so no secret is present. Expected outputs never enter the container. I should add: this was verified with unit tests and local compilers, but not yet run under Docker on our machine.

**16. Why Docker?**
It is the standard isolation primitive, with namespaces to separate the process and cgroups to cap resources, and containers start quickly. It is not as strong as a virtual machine. For hostile public traffic we would add a dedicated host, a custom seccomp profile or gVisor.

**17. How do you prevent infinite loops?**
A time limit enforced twice: `timeout` inside the container, and a deadline on the host that removes the container if the inner timer fails. After a time-limit failure the remaining tests are skipped, so one submission cannot occupy a sandbox for the whole test set.

**18. How do you handle memory limits?**
The container has a hard memory ceiling with swap disabled. Because compilers need more memory than the problem allows, the per-problem limit is also enforced on the program: `-Xmx` for Java, `--max-old-space-size` for Node, an address-space limit for C++. Exceeding it gives Memory Limit Exceeded.

**19. What happens if the model goes down?**
Scores are unaffected in principle because none is produced by a model. Features that need the AI service return a clear error rather than a fabricated result. For the fine-tuned paths, a timeout or crash falls back to the deterministic engine and marks the response `degraded` with the reason.

**20. What is your fallback architecture?**
Every model has a deterministic twin: the ATS engine behind the ATS model, the planner behind the career model, the mock provider behind the LLM. The order is: valid model answer; else one corrective retry; else the deterministic result, labelled as such. A degraded answer is never presented as a model answer.

**21. What is actually novel?**
No new algorithm. The contribution is integration with discipline: one explainable readiness model fed by every module, and a hard line between deterministic scoring and generative language. Smaller engineering contributions support it — resource IDs instead of URLs, hidden tests that never enter the sandbox, leakage-audited datasets.

**22. What is your measurable improvement?**
I have no measured improvement over another product or over a baseline cohort, and I will not invent one. What is measured is internal: the baselines for the ATS engine, the classifier and recommender metrics, the career model's results, and judge correctness on 112 reference programs. A user study is the next step.

**23. What is the biggest limitation?**
Validation. The readiness weights are a design choice, the classifier is trained on synthetic data, the fine-tuned models are not in service, and no human has rated the outputs. The system is engineered carefully, but its usefulness to real students is not yet demonstrated.

**24. Why should someone use this instead of existing platforms?**
Not for depth in one area — a dedicated coding site has far more problems. The reason is connection: a resume gap changes the career plan, a coding result moves the readiness score, an alumni's feedback adjusts it, and the placement cell sees all of it. That linkage is what a set of separate tools cannot give.

**25. What happens when the job market changes?**
Nothing needs retraining for facts. Role requirements, prerequisites and resources are data files, and the model receives them in the prompt, so a new role or resource works immediately. Two roles were held out of training precisely to test that. What does need periodic human review is the curated knowledge itself.

**26. You say "AI platform", but most of it is rules. Is that not misleading?**
It would be if we hid it. We state it openly: rules compute the scores because scores must be defensible, and AI is used for language. We consider that the right design for a system that judges students, not a weakness.

**27. Your accuracy is only 73.5%. Is that not poor?**
It is on purpose not higher. The data is synthetic with deliberate noise; without the noise the labels would be a clean function of the features and accuracy would be about 99%, which would mean nothing. The figure shows the pipeline works. It says nothing about real placements.

**28. Why did you remove Group Discussion and the earlier roadmap?**
They were removed from the product to focus the scope. The readiness weights were rebalanced — the former 10% went to coding and communication — and stored records were migrated. The career plan replaced the earlier roadmap with a deterministic, testable planner.

**29. Did you write all of this yourself?**
Answer truthfully about your own contribution and the tools you used. Whatever the answer, be able to explain any module from this document: that is what the jury is really checking.

**30. If you had one more month, what would you do first?**
Collect ground truth. Have placement officers score 100 resumes and rate 30 career plans, gather last year's placement outcomes, and then train and evaluate the models against those. Everything else — more problems, a queue, better embeddings — matters less than knowing whether the scores are right.
