# End-to-end demo script

## Before you start

- Run `npm run dev` and open `http://localhost:5173`. Confirm all three services are up.
- Demo accounts (password `Demo@Pass123`): `student@careerpilot.demo`, `alumni@careerpilot.demo`, `officer@careerpilot.demo`, `admin@careerpilot.demo`. Confirm each logs in before the session.
- Have one resume PDF and one job description (text or file) ready.
- **Docker:** if Docker Desktop is not installed and the judge image is not built, Run and Submit on DSA problems will say "your code was not run". Decide beforehand whether to show that honestly or to install Docker and run `npm run judge:build` and `npm run judge:verify` first.
- **LLM:** the local setting is `AI_PROVIDER=mock`. Interview questions and written feedback will be marked as mock output. Say so if asked.

## Screen-by-screen

| # | Screen | What to show | What to say | Technical explanation | Why it matters |
|---|---|---|---|---|---|
| 1 | Login | Sign in as the student | "Access is role-based; this account can only see its own data." | bcrypt password check, 15-minute JWT, refresh token in an httpOnly cookie with rotation | Security is the base of everything else |
| 2 | Dashboard | Readiness score, component cards, DSA progress, next action | "One score built from seven components, updated after every activity." | APIE: recency weighting, weighted sum, bounded modifiers, bands | The student sees what to fix first |
| 3 | Profile | Skills, CGPA, target companies and roles | "Targets drive the gap analysis and job matching." | `StudentProfile` with arrays of target ids | Personalisation needs a profile |
| 4 | Resume & ATS | Upload a PDF | "The resume is parsed and scored with nine transparent criteria." | PyMuPDF extraction, section detection, taxonomy skill matching, capped rule-based scoring | Explainable, repeatable, no GPU |
| 5 | Resume & ATS | Choose "My own job description", paste or upload a JD, analyse | "Matched and missing skills come from exact matching, not a guess." | JD keywords canonicalised; coverage = matched ÷ total | Shows what to add for a specific job |
| 6 | Job Matching | Pick a company and role | "Eligibility is a hard gate; the score cannot override a CGPA cut-off." | 0.55 required + 0.20 preferred + 0.15 similarity + 0.10 eligibility | Mirrors real screening |
| 7 | Assessments | Start one, refresh mid-test | "The timer lives on the server; the page recovers after a refresh." | Server-stored deadline, autosave, server-side grading | Fairness and reliability |
| 8 | DSA Practice | Filter by tag, open Two Sum, switch language | "The student writes only the function. Starter code for four languages comes from one signature." | Code generation from a typed signature | Extensible by design |
| 9 | DSA Practice | Run, then Submit | "Run uses public tests. Submit adds hidden tests whose inputs are never shown." | One container per submission; expected outputs stay on the host; deterministic verdict | Trustworthy verdicts, safe execution |
| 10 | DSA Practice | Results tab | "Execution Result is from the judge. Static Code Analysis is advisory AI and cannot change the verdict." | Verdict stored before the review is requested | AI does not decide correctness |
| 11 | AI Interview | Answer two questions | "Difficulty adapts to my recent scores, and each answer gets five dimension scores." | Threshold controller; overall recomputed in code with mode weights | Adaptive practice with explainable feedback |
| 12 | Readiness | Component breakdown, ML second opinion | "The rule-based score and a Random Forest prediction are shown side by side, labelled as a prototype." | APIE plus a classifier trained on synthetic data | Honest about what is validated |
| 13 | Career Plan | Pick a role, set hours, generate | "Gaps are prioritised with reasons, ordered by prerequisites, and fitted to my time." | Skill graph, priority score, feasibility scheduling, verified resources by ID | A plan that can actually be followed |
| 14 | Career Plan | Resources tab | "Every link was checked; videos come from the YouTube API." | Catalogue of 270 resources with verification status | No invented links |
| 15 | Alumni | Request a mentor | "Mentors are ranked by company, role and skill overlap." | Weighted match formula; WebRTC room; feedback feeds APIE | Human in the loop |
| 16 | Officer login | Cohort analytics, at-risk list | "Placement staff see who needs help before results arrive." | MongoDB aggregation pipelines | Institutional value |
| 17 | Admin login | Users, AI usage, APIE weights, audit log | "Weights are configurable and every sensitive action is audited." | `SystemConfiguration`, `AuditLog`, weights validated to sum to 1.0 | Governance |

## If something fails during the demo

| Failure | What to say |
|---|---|
| DSA Run says "not executed" | "The sandbox needs Docker on this machine. The system refuses to guess a verdict; it never runs student code on the server as a fallback." |
| AI features fail | "The AI service is a separate process. Scores still work because they are deterministic; only wording degrades." |
| A page is slow | "Analysis runs synchronously in this prototype; a queue is planned." |
