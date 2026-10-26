# Five-minute presentation

Speak at a steady pace; each block is about 70 to 130 words.

## 0:00 – 0:30  Problem

"A student preparing for placement uses one tool for the resume, another for coding, another for aptitude and another for interviews. None of them share information. So the student cannot answer two simple questions: how ready am I overall, and what should I fix first? The placement cell has the same blind spot across the whole batch."

## 0:30 – 1:00  Existing limitations

"Single-purpose tools give isolated scores. Many resume checkers return a number without explaining it. And AI-only tools can produce different answers for the same input, or invent facts. For something that affects a student's confidence, a score has to be explainable and repeatable."

## 1:00 – 1:30  Proposed solution

"CareerPilot AI puts the whole preparation journey on one account: resume analysis, job matching, assessments, DSA practice, mock interviews, a career plan and alumni mentorship. One engine, which we call APIE, combines all the evidence into a single Placement Readiness Score and tells the student what to work on next."

## 1:30 – 2:30  Architecture

"There are three services. A React and TypeScript frontend. A Node.js and Express gateway that handles authentication, role-based access, MongoDB and real-time events. And a Python FastAPI service that holds the AI: eleven agents, the resume parser, the scoring engines, retrieval and machine learning. The browser never talks to the AI service; only the gateway does, with an internal key. Student code for DSA problems runs in a separate isolated Docker container, never on the server."

## 2:30 – 3:30  AI and ML

"Our design rule is: facts from code, judgement from the model, arithmetic from code. The ATS score is nine rule-based criteria. The readiness score is a weighted model. A language model writes interview questions and scores answers on five dimensions, but the final score is recomputed in code. We also built QLoRA fine-tuning pipelines for two Qwen models. I want to be accurate here: the ATS model has not been trained yet, and the first career model we trained was measured and found not usable, so both are switched off. The product runs on the deterministic engines."

## 3:30 – 4:15  Key functionality

"Three things to notice in the demo. First, resume analysis with a comparison against any job description, showing exactly which skills are missing. Second, the DSA environment: four languages, hidden test cases that never enter the sandbox, and a deterministic verdict. Third, the career plan: skill gaps prioritised with reasons, ordered by prerequisites, fitted to the time the student has, with verified resources."

## 4:15 – 4:45  Innovation

"We do not claim a new algorithm. Our contribution is a single explainable readiness model fed by every module, and a strict separation between deterministic scoring and generative language. A language model here cannot set a score, cannot invent a link, and cannot decide whether code is correct."

## 4:45 – 5:00  Results and future scope

"The platform is tested across all three services, and every one of our 28 reference solutions is accepted in all four languages. Next we will train and evaluate the models on a GPU, validate the readiness weights with real placement outcomes, and collect human ratings. Thank you."
