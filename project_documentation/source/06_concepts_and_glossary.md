# Concepts explained like a professor

Each concept: what it is, how CareerPilot uses it, a simple example, and the technical point to add if pressed.

## Web and system concepts

| Concept | Definition | In CareerPilot | Simple example | Technical point |
|---|---|---|---|---|
| Frontend | The part that runs in the browser | React + TypeScript single-page app | The Resume page you see | Renders from JSON returned by the API |
| Backend | The server-side program | Node.js + Express gateway | Checks your login and saves a submission | Stateless request handling with middleware chains |
| REST API | Resources addressed by URLs and HTTP verbs | 135 endpoints under `/api/v1` | `GET /coding/problems` lists problems | JSON envelope with typed error codes |
| Database | Organised persistent storage | MongoDB with 33 Mongoose models | Your resume analysis is one document | Documents with `ObjectId` references and indexes |
| Authentication | Proving who you are | Email and password, then a token | Logging in | bcrypt comparison, then a signed JWT |
| Authorization | Deciding what you may do | Role middleware and ownership checks | A student cannot open the admin page | `authorize(role)` plus per-record owner check |
| JWT | A signed token carrying claims | 15-minute access token | A wristband that expires | HMAC signature; verified without a database lookup |
| MongoDB | A document database | The only database | A plan stored as one nested document | No joins or foreign keys; references are populated |
| Services (not microservices) | Separate programs with separate jobs | Three: frontend, gateway, AI service | Python does ML, Node does web | One database, no message bus |
| Docker | Packaging and isolating a process | The judge sandbox; Compose for deployment | A sealed box for one run | Namespaces isolate, cgroups limit |
| Container | A running isolated process from an image | One per code submission | The box is thrown away after the run | `--rm`, no network, read-only root |
| API gateway | A single entry point in front of services | The Node backend plays this role | The reception desk | It alone holds the internal AI key |
| Queue | A waiting line for background jobs | **Not used**; an in-process limiter instead | — | A queue with workers is planned |
| Caching | Keeping a result to avoid recomputing | Client query cache; in-memory config cache | Not refetching the problem list | No Redis; server caches are per process |

## AI and NLP concepts

| Concept | Definition | In CareerPilot | Simple example | Technical point |
|---|---|---|---|---|
| NLP | Processing human language | Resume parsing and skill extraction | Finding "Python" in a resume | Regex, dictionary matching, spaCy NER |
| Embedding | A vector representing text | 384-dimensional hashed vectors | Two similar texts get nearby vectors | Feature hashing, sub-linear TF, L2-normalised |
| Vector database | A store searched by vector similarity | NumPy store by default; FAISS or Chroma optional | Finding the closest chunks | Exact inner-product search |
| Semantic search | Search by meaning, not exact words | Available by switching the embedder; default is lexical | "car" finding "automobile" | Needs a learned embedding model |
| RAG | Retrieve text, then generate from it | Knowledge-base answers | Answering from the placement handbook | Top-5 retrieval, relevance threshold, sources returned |
| LLM | A model that predicts the next token | Interview questions, answer evaluation | Writing a follow-up question | Called through a provider interface |
| Fine-tuning | Further training on a task | Two QLoRA pipelines | Teaching a strict JSON format | Adapters only; base frozen |
| SFT | Fine-tuning on input–target pairs | Both pipelines | Resume → expected JSON | Completion-only loss |
| PEFT | Training few parameters | LoRA adapters | Sticky notes on a textbook | About 1% trainable |
| LoRA | Low-rank adapters added to weight matrices | r 16, α 32 on 7 projections | Two thin matrices instead of one big one | `W + (α/r)·B·A` |
| QLoRA | LoRA with a 4-bit base model | Fits a T4 | Smaller print, same notes | NF4 quantization via bitsandbytes |
| Quantization | Fewer bits per weight | 4-bit loading | Rounding to fewer decimal places | Trades a little precision for memory |
| Transformer | The architecture behind LLMs | Qwen3 models | Words looking at each other | Attention plus feed-forward layers |
| Attention | Weighting which tokens matter to each token | Inside the models | "it" attending to its noun | Query–key–value projections; LoRA attaches here |
| Tokenization | Splitting text into model units | Length limits of 3,072 and 4,096 tokens | "unhappiness" → pieces | Limits are in tokens, not words |
| Inference | Running a trained model | One call with a timeout | Asking a question | Validation and fallback follow |
| Hallucination | Fluent output without basis | Guarded by schemas, grounding, IDs | A made-up URL | Reduced and counted, not eliminated |
| Prompt injection | Instructions hidden in input data | Structural limits only | "Ignore the rubric" inside a resume | No dedicated filter; scores are code-computed |

## Recommendation, similarity and metrics

| Concept | Definition | In CareerPilot | Simple example | Technical point |
|---|---|---|---|---|
| Recommendation system | Suggesting relevant items | Resource ranking; skill recommender (not live) | "Learn Docker next" | Deterministic scoring; item-based CF |
| Ranking | Ordering items by a score | Resources, mentors, gaps | Best resource first | Additive scores with reproducible tie-breaks |
| Cosine similarity | Angle between vectors | Job match, RAG | Same direction = similar | Equals the dot product for unit vectors |
| TF-IDF | Term frequency × inverse document frequency | **Not used** | — | The project uses hashed TF without IDF |
| Accuracy | Share of correct predictions | Classifier: 0.735 (synthetic) | 73 of 100 right | Misleading with imbalanced classes |
| Precision | Correct among predicted positives | Per-class in the classifier | Of flagged, how many were right | TP / (TP + FP) |
| Recall | Found among actual positives | Per-class; Recall@K for the recommender | Of real ones, how many found | TP / (TP + FN) |
| F1 | Harmonic mean of precision and recall | Macro F1 0.737 | One balanced number | 2PR / (P + R) |
| Overfitting | Memorising training data | Guarded by validation loss and early stopping | Good on practice, bad on the exam | Training loss falls, validation loss rises |
| Underfitting | Not learning enough | Career model v1 | Stopped studying too early | 37 updates; loss still falling |
| Train / validation / test split | Separate data for learning, tuning and final check | Split by cluster or learner profile | Practice, mock, final exam | Prevents leakage; test used once |

# Technical glossary

| Term | Meaning |
|---|---|
| Adapter | The small set of trained LoRA weights saved after fine-tuning |
| Agent | A class with one responsibility and typed input and output |
| Alias | An alternative spelling mapped to a canonical skill name |
| APIE | Adaptive Placement Intelligence Engine; computes the readiness score |
| Append-only | Records are added, never changed, to keep history |
| ATS | Applicant Tracking System; software that screens resumes |
| Audit log | A record of sensitive actions and who performed them |
| Band | A readiness category: At Risk, Needs Improvement, Placement Ready, Highly Ready |
| Base model | The pre-trained model before fine-tuning |
| bcrypt | A slow, salted password-hashing function |
| bitsandbytes | The library that loads models in 4-bit or 8-bit |
| Bootstrap sample | A random sample with replacement, used by Random Forest |
| Canonical skill | The single official name for a skill and its aliases |
| Capability (Linux) | A fine-grained root privilege; all are dropped in the sandbox |
| cgroup | A Linux feature that limits a process's CPU, memory and process count |
| Checkpoint | A saved state during training |
| Chunking | Splitting a document into overlapping pieces for retrieval |
| Code splitting | Loading page code only when the page is opened |
| Collaborative filtering | Recommending items that co-occur with what a user has |
| Comparator | The judge component that compares returned and expected values |
| Completion-only loss | Training loss computed only on the answer tokens |
| Confusion matrix | A table of actual versus predicted classes |
| Container | An isolated process started from an image |
| CORS | Browser rule controlling which origins may call an API |
| Cosine schedule | A learning rate that decays along a cosine curve |
| Cross-validation | Training and testing on several different splits |
| DTO | Data Transfer Object; the shape of data sent over the API |
| Degraded | A response produced by a fallback, labelled as such |
| Deterministic | Same input always gives the same output |
| Early stopping | Ending training when validation loss stops improving |
| Embedding | A numeric vector representing text |
| Epoch | One pass over the training data |
| ESCO | The European skills and occupations classification |
| Evidence coverage | The share of readiness components that have data |
| Express | The Node.js web framework used by the gateway |
| FAISS | A library for fast vector search |
| FastAPI | The Python web framework used by the AI service |
| Feature hashing | Mapping tokens to vector positions with a hash function |
| Feature importance | How much a feature contributes to a tree model's splits |
| Fork bomb | A program that creates processes endlessly |
| Gradient accumulation | Summing gradients over small batches before an update |
| Gradient checkpointing | Saving memory by recomputing activations in the backward pass |
| Grounding guard | A check that a model's claims are supported by the input |
| Harness | Generated code that calls the student's function and records the result |
| Helmet | Express middleware that sets security headers |
| Hidden test | A test whose input and expected output are never shown |
| httpOnly cookie | A cookie JavaScript cannot read |
| Index | A database structure that speeds up lookups |
| Jaccard similarity | Overlap of two sets divided by their union |
| JD | Job description |
| JWT | JSON Web Token; a signed, self-contained token |
| Lazy loading | Deferring work until it is needed |
| Leakage | Test data influencing training, inflating results |
| Lexical | Based on the words themselves, not their meaning |
| LoRA | Low-Rank Adaptation |
| LSH | Locality-Sensitive Hashing; groups similar items into buckets |
| MAE | Mean Absolute Error |
| Magic bytes | The first bytes of a file that identify its real type |
| Middleware | A function that runs before a route handler |
| MinHash | A compact signature for estimating set similarity |
| Mock provider | A rule-based stand-in for an LLM, used offline |
| Monaco | The code editor component from VS Code |
| Mongoose | The MongoDB object-modelling library for Node.js |
| MRR | Mean Reciprocal Rank |
| Namespace (Linux) | Isolation of what a process can see |
| NER | Named-Entity Recognition |
| NF4 | A 4-bit quantization format for normally distributed weights |
| Nonce | A random value used once; marks genuine sandbox report lines |
| O*NET | The US occupational information database |
| ObjectId | MongoDB's document identifier type |
| Orchestrator | The component that runs agents in fixed workflows |
| Pagination | Returning a list one page at a time |
| PEFT | Parameter-Efficient Fine-Tuning |
| PII | Personally identifiable information |
| Planner | The deterministic module that builds a career plan |
| Prerequisite graph | Skills as nodes, "must learn first" as edges |
| Provenance | Whether data is DEMO, SYNTHETIC or REAL |
| Pydantic | The Python library for typed data validation |
| QLoRA | LoRA applied to a 4-bit quantized base model |
| RAG | Retrieval-Augmented Generation |
| Random Forest | An ensemble of decision trees that vote |
| Rank (LoRA) | The inner dimension of the adapter matrices |
| Rate limiting | Restricting how often a client may call an endpoint |
| RBAC | Role-Based Access Control |
| Recall@K | How often the right item is in the top K |
| Refresh token | A longer-lived token used to obtain a new access token |
| Relevance threshold | The minimum similarity for a retrieved chunk to be used |
| Result file | The file the harness writes the return value to |
| Sandbox | An isolated environment for running untrusted code |
| Schema | A formal description of the shape data must have |
| seccomp | A Linux filter restricting system calls |
| Semaphore | A counter that limits how many tasks run at once |
| SFT | Supervised Fine-Tuning |
| Shrinkage | A constant that damps similarities built on few observations |
| Signature (function) | A function's name, parameter types and return type |
| Socket.IO | The library used for real-time events |
| Spearman correlation | Agreement between two rankings |
| SSRF | Server-Side Request Forgery; making a server fetch a hostile URL |
| Starter code | The empty function a student begins with |
| Stratified split | A split that preserves class proportions |
| Taxonomy | A controlled list of skills and their aliases |
| Temperature | A setting controlling randomness in generation |
| tmpfs | An in-memory filesystem that disappears with the container |
| Token | The unit of text a language model reads |
| Topological order | An ordering in which every prerequisite comes first |
| Unsloth | A library that speeds up QLoRA training |
| Verdict | The judge's final result for a submission |
| vLLM | A server for running LLMs and LoRA adapters efficiently |
| Weak label | A training label produced by rules rather than humans |
| WebRTC | Browser technology for real-time audio and video |
| Zod | The TypeScript validation library used for requests |
