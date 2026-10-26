"""Deterministic offline content generator backing the `mock` LLM provider (§41).

How it works
------------
Every agent embeds a machine-readable directive in its system prompt::

    [[TASK:interview.generate]]

and passes its inputs as a JSON block in the user message. This module reads the
directive, reads that JSON, and assembles a schema-valid response using real
rules over the real input - a question about React is produced *because* the
resume contains React, not at random.

Why this exists
---------------
It makes the entire platform demonstrable with no API key and no network, while
every response remains honestly labelled as mock output. It is a development and
demonstration aid, never a substitute for a model in production, and it must
never be presented as a research result.

Determinism
-----------
All variation is seeded from the input, so the same input always yields the same
output. That keeps demos reproducible and makes the tests meaningful.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
from typing import Any

TASK_PATTERN = re.compile(r"\[\[TASK:([a-z_.]+)\]\]", re.IGNORECASE)
JSON_BLOCK = re.compile(r"```json\s*(.*?)```", re.DOTALL)


def _seeded_rng(*parts: Any) -> random.Random:
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def _extract_context(user_prompt: str) -> dict[str, Any]:
    match = JSON_BLOCK.search(user_prompt)
    raw = match.group(1) if match else None
    if raw is None:
        start, end = user_prompt.find("{"), user_prompt.rfind("}")
        raw = user_prompt[start : end + 1] if start != -1 and end > start else None
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


# --------------------------------------------------------------------------
# Question banks. Curated from standard campus-placement topics; grounded in
# the candidate's actual skills at selection time.
# --------------------------------------------------------------------------

TECHNICAL_BANK: dict[str, list[dict[str, Any]]] = {
    "dsa": [
        {
            "question": "Given an unsorted array of integers, explain how you would find whether any two numbers sum to a target value. Walk through your approach and its complexity.",
            "expectedPoints": ["Brute-force O(n^2) baseline", "Hash-set single-pass O(n) approach", "Space/time trade-off", "Handling duplicates and negative numbers"],
            "topic": "arrays-hashing",
        },
        {
            "question": "How would you detect a cycle in a singly linked list without using extra memory?",
            "expectedPoints": ["Floyd's tortoise-and-hare", "Two pointers at different speeds", "O(1) space", "Why the pointers must meet inside a cycle"],
            "topic": "linked-lists",
        },
        {
            "question": "Explain the difference between BFS and DFS, and give a problem where each is clearly the better choice.",
            "expectedPoints": ["Queue vs stack/recursion", "BFS finds shortest path on unweighted graphs", "DFS suits topological sort and cycle detection", "Memory profile of each"],
            "topic": "graphs",
        },
        {
            "question": "You need the k largest elements from a very large stream of numbers. What data structure would you use and why?",
            "expectedPoints": ["Min-heap of size k", "O(n log k) time", "Why full sorting is wasteful", "Streaming constraint means data does not fit in memory"],
            "topic": "heaps",
        },
        {
            "question": "Describe dynamic programming in your own words, and explain how you would identify that a problem is a DP problem.",
            "expectedPoints": ["Optimal substructure", "Overlapping subproblems", "Memoisation vs tabulation", "A concrete worked example"],
            "topic": "dynamic-programming",
        },
    ],
    "dbms": [
        {
            "question": "What is database normalisation, and when would you deliberately denormalise a schema?",
            "expectedPoints": ["1NF/2NF/3NF definitions", "Redundancy and update anomalies", "Denormalising for read-heavy workloads", "Trade-off with write complexity"],
            "topic": "database-design",
        },
        {
            "question": "Explain database indexing. What happens to write performance when you add several indexes to a table?",
            "expectedPoints": ["B-tree index structure", "Faster lookups, slower writes", "Index maintenance cost per insert/update", "Composite index column ordering"],
            "topic": "database-performance",
        },
        {
            "question": "What are ACID properties, and what does isolation actually protect you from?",
            "expectedPoints": ["Atomicity, Consistency, Isolation, Durability", "Dirty reads, non-repeatable reads, phantom reads", "Isolation levels", "Concurrency/performance trade-off"],
            "topic": "transactions",
        },
    ],
    "os": [
        {
            "question": "Explain the difference between a process and a thread, and when you would choose one over the other.",
            "expectedPoints": ["Separate vs shared address space", "Context-switch cost", "Isolation and fault containment", "Shared-state concurrency hazards"],
            "topic": "operating-systems",
        },
        {
            "question": "What is a deadlock? Describe the conditions required for one and how you would prevent it.",
            "expectedPoints": ["Mutual exclusion, hold-and-wait, no preemption, circular wait", "Breaking any one condition prevents deadlock", "Lock ordering", "Timeouts and detection"],
            "topic": "operating-systems",
        },
    ],
    "networks": [
        {
            "question": "Walk me through what happens, end to end, when you type a URL into a browser and press Enter.",
            "expectedPoints": ["DNS resolution", "TCP handshake and TLS negotiation", "HTTP request/response", "Rendering and subsequent asset requests"],
            "topic": "computer-networks",
        },
        {
            "question": "What is the difference between TCP and UDP, and give a real system that deliberately chooses UDP.",
            "expectedPoints": ["Connection-oriented vs connectionless", "Ordering and retransmission guarantees", "Header overhead", "Video/voice streaming or gaming as the UDP case"],
            "topic": "computer-networks",
        },
    ],
    "oop": [
        {
            "question": "Explain polymorphism with an example from a project you have built.",
            "expectedPoints": ["Compile-time vs runtime polymorphism", "Method overriding", "A concrete example from their own work", "Why it reduces coupling"],
            "topic": "oop",
        },
        {
            "question": "What are SOLID principles? Pick one and describe a time you applied or violated it.",
            "expectedPoints": ["Names the five principles", "Explains one in depth", "Concrete code example", "Honest reflection on the trade-off"],
            "topic": "software-design",
        },
    ],
}

SKILL_QUESTIONS: dict[str, dict[str, Any]] = {
    "react": {
        "question": "Your resume lists React. Explain the difference between state and props, and describe a situation where lifting state up solved a problem for you.",
        "expectedPoints": ["Props are read-only inputs, state is owned by the component", "Unidirectional data flow", "A concrete lifting-state-up scenario", "When to reach for context or a store instead"],
        "topic": "react",
    },
    "nodejs": {
        "question": "You have listed Node.js. Explain the event loop and what happens when you run a CPU-heavy computation inside a request handler.",
        "expectedPoints": ["Single-threaded event loop", "Non-blocking I/O", "CPU-bound work blocks all requests", "Worker threads, child processes or a queue as the fix"],
        "topic": "nodejs",
    },
    "python": {
        "question": "Your resume mentions Python. Explain list comprehensions versus generator expressions, and when the difference actually matters.",
        "expectedPoints": ["Eager list construction vs lazy iteration", "Memory profile on large datasets", "Single-pass consumption of generators", "A realistic example"],
        "topic": "python",
    },
    "java": {
        "question": "You have listed Java. Explain how garbage collection works and what a memory leak looks like in a garbage-collected language.",
        "expectedPoints": ["Generational collection", "Reachability, not reference counting", "Leaks via lingering references in collections/caches", "Profiling approach"],
        "topic": "java",
    },
    "sql": {
        "question": "Your resume lists SQL. Explain the difference between INNER JOIN and LEFT JOIN, and describe a query where using the wrong one caused a bug.",
        "expectedPoints": ["Matching-rows-only vs all-left-rows", "NULLs from the unmatched side", "Effect on aggregate counts", "A concrete debugging story"],
        "topic": "sql",
    },
    "mongodb": {
        "question": "You have listed MongoDB. When would you embed a document versus referencing it, and what breaks if you choose wrongly?",
        "expectedPoints": ["Embedding for contained, read-together data", "Referencing for shared or unbounded growth", "16 MB document limit", "Read amplification vs join cost"],
        "topic": "mongodb",
    },
    "machinelearning": {
        "question": "Your resume lists machine learning. Explain overfitting, how you detect it, and three concrete things you would do about it.",
        "expectedPoints": ["Train/validation gap as the signal", "Cross-validation", "Regularisation, more data, simpler model, early stopping", "Awareness of data leakage"],
        "topic": "machine-learning",
    },
    "docker": {
        "question": "You have listed Docker. Explain the difference between an image and a container, and how you would reduce a bloated image size.",
        "expectedPoints": ["Image is an immutable template, container is a running instance", "Layer caching", "Multi-stage builds", "Slim/alpine base images"],
        "topic": "devops",
    },
    "git": {
        "question": "Your resume lists Git. Explain the difference between merge and rebase, and when rebasing is a bad idea.",
        "expectedPoints": ["Merge preserves history, rebase rewrites it", "Linear history readability", "Never rebase shared/published branches", "Conflict resolution experience"],
        "topic": "version-control",
    },
}

HR_BANK = [
    {"question": "Tell me about yourself, focusing on what led you towards this role.", "expectedPoints": ["Concise structured narrative", "Relevant academic and project background", "Clear link to the target role", "Under two minutes"], "topic": "introduction"},
    {"question": "Why do you want to join our organisation specifically, rather than any company in this sector?", "expectedPoints": ["Specific, researched reasons", "Alignment with their own goals", "Awareness of the company's work", "Avoids generic praise"], "topic": "motivation"},
    {"question": "Describe your greatest strength and give a concrete example of it producing a result.", "expectedPoints": ["Names a relevant strength", "Supports it with a specific example", "Quantified or observable outcome", "Self-awareness"], "topic": "self-assessment"},
    {"question": "Tell me about a weakness you are actively working on, and what you have changed so far.", "expectedPoints": ["Genuine, non-fatal weakness", "Concrete corrective action", "Evidence of progress", "Avoids the disguised-strength cliché"], "topic": "self-assessment"},
    {"question": "Where do you see yourself in five years, and how does this role fit that path?", "expectedPoints": ["Realistic ambition", "Growth mindset", "Fit with the role's trajectory", "Commitment without rigidity"], "topic": "career-goals"},
    {"question": "How do you handle criticism of your work? Give an example.", "expectedPoints": ["Receptive to feedback", "A specific instance", "What they changed as a result", "No defensiveness in the retelling"], "topic": "professionalism"},
    {"question": "Are you willing to relocate or work from a different city, and what would you weigh in that decision?", "expectedPoints": ["Clear, honest position", "Thought-through reasoning", "Flexibility where genuine", "Professional framing"], "topic": "logistics"},
]

BEHAVIORAL_BANK = [
    {"question": "Describe a time you disagreed with a teammate on a technical decision. How did you resolve it?", "expectedPoints": ["STAR structure", "Specific disagreement", "Evidence-based resolution", "Outcome and lesson"], "topic": "teamwork"},
    {"question": "Tell me about a project that failed or missed its deadline. What did you do and what did you learn?", "expectedPoints": ["Honest ownership", "Concrete corrective action", "Clear lesson", "Applied that lesson later"], "topic": "resilience"},
    {"question": "Give an example of a time you had to learn a new technology quickly for a project.", "expectedPoints": ["Specific technology and driver", "Learning strategy", "Applied outcome", "Time frame"], "topic": "learning-agility"},
    {"question": "Describe a situation where you took the lead without being asked.", "expectedPoints": ["Initiative shown", "Concrete actions", "Effect on the team", "Reflection"], "topic": "leadership"},
    {"question": "Tell me about a time you had to manage several deadlines at once. How did you prioritise?", "expectedPoints": ["Explicit prioritisation method", "Trade-offs made", "Communication with stakeholders", "Result"], "topic": "time-management"},
]

def _normalise(skill: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", skill.lower())


# --------------------------------------------------------------------------
# Task handlers
# --------------------------------------------------------------------------

def _interview_generate(ctx: dict[str, Any]) -> dict[str, Any]:
    """Selects the next question, biased by the candidate's weakest areas."""
    mode = str(ctx.get("mode", "TECHNICAL")).upper()
    index = int(ctx.get("index", 0))
    difficulty = str(ctx.get("difficulty", "MEDIUM")).upper()
    skills = [_normalise(s) for s in ctx.get("skills", [])]
    focus = [str(t).lower() for t in ctx.get("topicFocus", [])]
    asked = {str(q).lower() for q in ctx.get("askedQuestions", [])}
    rng = _seeded_rng(ctx.get("sessionId", "session"), index)

    candidates: list[dict[str, Any]] = []

    if mode in {"HR", "COMPANY_SPECIFIC"}:
        candidates = list(HR_BANK)
    elif mode == "BEHAVIORAL":
        candidates = list(BEHAVIORAL_BANK)
    else:
        # Resume-driven questions first: these are the adaptive ones (§11).
        for skill in skills:
            if skill in SKILL_QUESTIONS:
                candidates.append(SKILL_QUESTIONS[skill])
        # Then the weak-area focus topics chosen by the orchestrator.
        for topic in focus:
            for key, bank in TECHNICAL_BANK.items():
                if topic in key or key in topic:
                    candidates.extend(bank)
        if not candidates:
            for bank in TECHNICAL_BANK.values():
                candidates.extend(bank)

    fresh = [c for c in candidates if c["question"].lower() not in asked]
    pool = fresh or candidates
    choice = pool[rng.randrange(len(pool))] if pool else HR_BANK[0]

    return {
        "question": choice["question"],
        "category": mode,
        "topic": choice.get("topic", "general"),
        "difficulty": difficulty,
        "expectedPoints": choice.get("expectedPoints", []),
        "rationale": (
            f"Selected for a {mode.lower()} round at {difficulty.lower()} difficulty"
            + (f", targeting the candidate's stated skill in {choice.get('topic')}" if skills else "")
            + "."
        ),
    }


def _score_answer_text(answer: str, expected_points: list[str]) -> dict[str, Any]:
    """Rule-based answer scoring used by the mock evaluator.

    Deliberately transparent: coverage of the expected points, length adequacy,
    structure markers and filler density. No opaque numbers.
    """
    words = [w for w in re.split(r"\s+", answer.strip()) if w]
    word_count = len(words)
    lower = answer.lower()

    # Keyword coverage against the model answer's expected points.
    hits = 0
    missed: list[str] = []
    for point in expected_points:
        tokens = [t for t in re.findall(r"[a-z]{4,}", point.lower()) if t not in {"their", "explains", "concrete", "example"}]
        if tokens and sum(1 for t in tokens if t in lower) >= max(1, len(tokens) // 3):
            hits += 1
        else:
            missed.append(point)
    coverage = (hits / len(expected_points)) if expected_points else (0.6 if word_count > 30 else 0.2)

    # Length adequacy: an interview answer is expected to run 60-220 words.
    if word_count < 15:
        length_score, length_verdict = 0.2, "TOO_SHORT"
    elif word_count < 40:
        length_score, length_verdict = 0.55, "TOO_SHORT"
    elif word_count <= 260:
        length_score, length_verdict = 1.0, "APPROPRIATE"
    elif word_count <= 400:
        length_score, length_verdict = 0.8, "TOO_LONG"
    else:
        length_score, length_verdict = 0.55, "TOO_LONG"

    structure_markers = ["first", "second", "then", "finally", "for example", "because",
                         "however", "in my project", "the result", "therefore", "as a result"]
    structure_hits = sum(1 for m in structure_markers if m in lower)
    structure = min(1.0, 0.3 + structure_hits * 0.14)

    fillers = ["um", "uh", "like", "basically", "actually", "you know", "i mean", "sort of", "kind of"]
    filler_count = sum(len(re.findall(rf"\b{re.escape(f)}\b", lower)) for f in fillers)
    filler_rate = (filler_count / word_count) if word_count else 0.0
    clarity = max(0.0, 1.0 - filler_rate * 6)

    relevance = round(min(100.0, coverage * 85 + length_score * 15), 1)
    correctness = round(min(100.0, coverage * 100), 1)
    completeness = round(min(100.0, coverage * 70 + length_score * 30), 1)
    communication = round(min(100.0, clarity * 55 + structure * 45), 1)
    structure_score = round(structure * 100, 1)
    overall = round(
        relevance * 0.25 + correctness * 0.3 + completeness * 0.2 + communication * 0.15 + structure_score * 0.1, 1
    )

    return {
        "relevance": relevance,
        "correctness": correctness,
        "completeness": completeness,
        "communication": communication,
        "structure": structure_score,
        "overall": overall,
        "wordCount": word_count,
        "fillerWordRate": round(filler_rate, 4),
        "lengthVerdict": length_verdict,
        "clarityScore": round(clarity * 100, 1),
        "missedPoints": missed,
        "coverage": coverage,
        "structureHits": structure_hits,
        "fillerCount": filler_count,
    }


def _interview_evaluate(ctx: dict[str, Any]) -> dict[str, Any]:
    answer = str(ctx.get("answer", ""))
    expected = list(ctx.get("expectedPoints", []))
    s = _score_answer_text(answer, expected)

    strengths: list[str] = []
    improvements: list[str] = []

    if s["coverage"] >= 0.6:
        strengths.append("Your answer covered most of the key points the interviewer would be listening for.")
    if s["lengthVerdict"] == "APPROPRIATE":
        strengths.append("The response length was well judged for an interview setting.")
    if s["structureHits"] >= 3:
        strengths.append("You structured the answer clearly with explicit signposting.")
    if s["fillerCount"] == 0 and s["wordCount"] > 30:
        strengths.append("The delivery was clean, with no filler words detected.")

    if s["coverage"] < 0.6 and s["missedPoints"]:
        improvements.append(f"You did not address: {'; '.join(s['missedPoints'][:3])}.")
    if s["lengthVerdict"] == "TOO_SHORT":
        improvements.append("The answer was too brief. Aim for 60-150 words so you can include reasoning and an example.")
    if s["lengthVerdict"] == "TOO_LONG":
        improvements.append("The answer ran long. Lead with your conclusion, then support it with one example.")
    if s["structureHits"] < 2:
        improvements.append("Use an explicit structure - state your position, give a concrete example, then state the outcome.")
    if s["fillerWordRate"] > 0.04:
        improvements.append(
            f"Filler words made up about {round(s['fillerWordRate'] * 100)}% of your words. A short pause reads as more confident than 'um'."
        )
    if not improvements:
        improvements.append("Add a specific, quantified example from your own projects to make the answer more memorable.")

    explanation = (
        f"Your answer addressed {round(s['coverage'] * 100)}% of the expected discussion points in "
        f"{s['wordCount']} words. "
        + ("The structure was clear. " if s["structureHits"] >= 3 else "The structure could be more explicit. ")
        + ("Delivery was clean. " if s["fillerCount"] <= 1 else f"{s['fillerCount']} filler word(s) were detected. ")
    )

    return {
        "relevance": s["relevance"],
        "correctness": s["correctness"],
        "completeness": s["completeness"],
        "communication": s["communication"],
        "structure": s["structure"],
        "overall": s["overall"],
        "strengths": strengths or ["You engaged with the question directly."],
        "improvements": improvements,
        "explanation": explanation.strip(),
        "missedPoints": s["missedPoints"][:5],
        "deliverySignals": {
            "wordCount": s["wordCount"],
            "fillerWordRate": s["fillerWordRate"],
            "responseLengthVerdict": s["lengthVerdict"],
            "clarityScore": s["clarityScore"],
        },
    }


def _code_review(ctx: dict[str, Any]) -> dict[str, Any]:
    """Static heuristics over the submitted code - no execution, no guessing."""
    code = str(ctx.get("code", ""))
    language = str(ctx.get("language", "python"))
    lines = [ln for ln in code.splitlines() if ln.strip()]
    line_count = len(lines)

    nested_loops = len(re.findall(r"for[\s\S]{0,200}?for", code))
    has_sort = bool(re.search(r"\b(sort|sorted|Arrays\.sort)\b", code))
    has_hash = bool(re.search(r"\b(dict|set|HashMap|HashSet|Map|Object)\b|\{\}", code))
    has_recursion = bool(re.search(r"\bdef\s+(\w+)[\s\S]*?\1\s*\(", code)) if language == "python" else False

    if nested_loops >= 1:
        time_complexity, confidence = "O(n^2)", 0.6
    elif has_sort:
        time_complexity, confidence = "O(n log n)", 0.65
    elif re.search(r"\bfor\b|\bwhile\b", code):
        time_complexity, confidence = "O(n)", 0.6
    else:
        time_complexity, confidence = "O(1)", 0.5

    space = "O(n)" if has_hash else "O(1)"

    comment_lines = sum(1 for ln in lines if ln.strip().startswith(("#", "//", "/*", "*")))
    long_lines = sum(1 for ln in lines if len(ln) > 110)
    avg_len = (sum(len(ln) for ln in lines) / line_count) if line_count else 0
    readability = 100.0
    if long_lines:
        readability -= min(25, long_lines * 5)
    if avg_len > 90:
        readability -= 12
    if line_count > 120:
        readability -= 10
    if comment_lines == 0 and line_count > 25:
        readability -= 8
    readability = max(30.0, round(readability, 1))

    suggestions: list[str] = []
    if nested_loops >= 1 and has_hash is False:
        suggestions.append("Nested loops detected. A hash map or set often reduces this from O(n^2) to O(n).")
    if long_lines:
        suggestions.append(f"{long_lines} line(s) exceed 110 characters. Shorter lines are easier to review.")
    if comment_lines == 0 and line_count > 25:
        suggestions.append("Add a brief comment explaining the core approach - interviewers read for reasoning.")
    if not re.search(r"\bif\b", code) and line_count > 10:
        suggestions.append("No conditional branches found. Confirm you have handled empty and boundary inputs.")
    if not suggestions:
        suggestions.append("The structure is clean. Next, state the complexity aloud before you start coding in an interview.")

    patterns = []
    if has_hash:
        patterns.append("hash-map lookup")
    if has_sort:
        patterns.append("sorting")
    if has_recursion:
        patterns.append("recursion")
    if nested_loops:
        patterns.append("nested iteration")

    return {
        "correctnessNotes": [
            "This review is static analysis of the submitted source only.",
            "Functional correctness is determined by the test-case results, not by this review.",
        ],
        "complexityEstimate": {"time": time_complexity, "space": space, "confidence": confidence},
        "readabilityScore": readability,
        "suggestions": suggestions,
        "detectedPatterns": patterns or ["straight-line logic"],
    }


def _recommendations(ctx: dict[str, Any]) -> dict[str, Any]:
    """Turns detected gaps into concrete, deep-linked next actions."""
    gaps = list(ctx.get("skillGaps", []))
    components = dict(ctx.get("components", {}))
    target_roles = list(ctx.get("targetRoles", []))
    band = str(ctx.get("band", "NEEDS_IMPROVEMENT"))

    recommendations: list[dict[str, Any]] = []

    weak = sorted(
        ((k, v) for k, v in components.items() if isinstance(v, (int, float))),
        key=lambda kv: kv[1],
    )

    route_map = {
        "coding": ("/coding", "Practise coding problems", "ASSESSMENT",
                   "Coding is the highest-weighted component of your readiness score and currently your weakest."),
        "technical": ("/interview", "Start a technical mock interview", "INTERVIEW",
                      "Technical interview performance carries the same weight as coding in the readiness model."),
        "hr": ("/interview", "Practise an HR interview round", "INTERVIEW",
               "HR rounds are a common elimination stage even for strong technical candidates."),
        "communication": ("/interview", "Practise structured spoken answers", "COMMUNICATION",
                          "Communication affects every interview round, not just HR."),
        "aptitude": ("/assessments", "Take an aptitude test", "ASSESSMENT",
                     "Aptitude tests are usually the first automated filter in the hiring funnel."),
        "resume": ("/resume", "Improve your resume and ATS score", "RESUME",
                   "A low ATS score means your resume may be filtered before a human ever reads it."),
        "academic": ("/profile", "Complete your academic record", "PROJECT",
                     "Missing academic details lower your readiness score and block eligibility checks."),
    }

    for key, value in weak[:4]:
        if value >= 70:
            continue
        route, label, category, rationale = route_map.get(
            key, ("/dashboard", "Review your dashboard", "SKILL", "This component is below the target level.")
        )
        priority = "CRITICAL" if value < 35 else "HIGH" if value < 55 else "MEDIUM"
        recommendations.append({
            "title": label,
            "description": f"Your {key} score is {round(value)}/100. Raising it to 70 would move your overall readiness up meaningfully.",
            "category": category,
            "priority": priority,
            "estimatedHours": 8 if priority in {"CRITICAL", "HIGH"} else 4,
            "actionRoute": route,
            "actionLabel": label,
            "rationale": rationale,
            "resources": [],
        })

    for gap in gaps[:4]:
        skill = gap.get("skill", "this skill") if isinstance(gap, dict) else str(gap)
        severity = gap.get("severity", "MEDIUM") if isinstance(gap, dict) else "MEDIUM"
        recommendations.append({
            "title": f"Build {skill} to the level your target roles require",
            "description": (
                f"{skill} appears in the requirements for "
                f"{', '.join(target_roles[:2]) if target_roles else 'your target roles'} "
                "but is missing or under-evidenced in your profile."
            ),
            "category": "SKILL",
            "priority": severity,
            "estimatedHours": 12 if severity in {"CRITICAL", "HIGH"} else 6,
            "actionRoute": "/job-matching",
            "actionLabel": "See where this skill is required",
            "rationale": f"Detected as a {severity.lower()}-severity gap against your selected target roles.",
            "resources": [
                {"title": f"Official {skill} documentation", "type": "DOCUMENTATION"},
                {"title": f"Build one small project using {skill}", "type": "PROJECT"},
            ],
        })

    if band in {"PLACEMENT_READY", "HIGHLY_READY"}:
        recommendations.append({
            "title": "Book a mock interview with a verified alumnus",
            "description": "Your scores are in placement-ready territory. Human feedback is now the highest-value next step.",
            "category": "MENTORSHIP",
            "priority": "MEDIUM",
            "estimatedHours": 1,
            "actionRoute": "/alumni",
            "actionLabel": "Find a mentor",
            "rationale": "Alumni feedback is weighted into your readiness score and catches issues automated scoring cannot.",
            "resources": [],
        })

    return {"recommendations": recommendations[:8]}


def _rag_answer(ctx: dict[str, Any]) -> dict[str, Any]:
    """Answers strictly from retrieved context, or admits it cannot (§10)."""
    question = str(ctx.get("question", ""))
    chunks = list(ctx.get("context", []))

    if not chunks:
        return {
            "answer": (
                "I do not have verified information on this in the knowledge base. "
                "Rather than guess at a company's recruitment process, please check the official careers page "
                "or ask your placement office. An administrator can add a verified source document to the "
                "knowledge base so this question can be answered in future."
            ),
            "grounded": False,
            "insufficientContext": True,
        }

    joined = " ".join(str(c.get("text", c)) for c in chunks)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", joined) if len(s.strip()) > 25]
    q_tokens = {t for t in re.findall(r"[a-z]{4,}", question.lower())}
    scored = sorted(
        sentences,
        key=lambda s: -sum(1 for t in q_tokens if t in s.lower()),
    )
    body = " ".join(scored[:4]) if scored else joined[:600]

    return {
        "answer": f"Based on the verified documents in the knowledge base: {body}",
        "grounded": True,
        "insufficientContext": False,
    }


def _resume_recommendations(ctx: dict[str, Any]) -> dict[str, Any]:
    missing = list(ctx.get("missingKeywords", []))
    role = str(ctx.get("roleTitle", "the target role"))
    recs = []
    if missing:
        recs.append(
            f"Add evidence of {', '.join(missing[:5])} - these appear in the {role} job description but not in your resume."
        )
        recs.append(
            "Do not simply list the missing keywords. Add a project bullet that shows the skill being used and the result it produced."
        )
    recs.append(f"Mirror the exact terminology used in the {role} posting; ATS keyword matching is literal.")
    recs.append("Lead each bullet with an action verb and close it with a measurable outcome.")
    return {"recommendations": recs}


_HANDLERS = {
    "interview.generate": _interview_generate,
    "interview.evaluate": _interview_evaluate,
    "code.review": _code_review,
    "recommendation.generate": _recommendations,
    "rag.answer": _rag_answer,
    "resume.recommendations": _resume_recommendations,
}


def build_mock_response(system_prompt: str, user_prompt: str, *, json_mode: bool = True) -> str:
    """Entry point used by `MockProvider`."""
    match = TASK_PATTERN.search(system_prompt) or TASK_PATTERN.search(user_prompt)
    task = match.group(1).lower() if match else "unknown"
    ctx = _extract_context(user_prompt)

    handler = _HANDLERS.get(task)
    if handler is None:
        payload: dict[str, Any] = {
            "notice": MOCK_NOTICE,
            "task": task,
            "message": (
                "The offline mock provider has no handler for this task. "
                "Configure a real AI_PROVIDER to use this feature."
            ),
        }
    else:
        payload = handler(ctx)
        payload["_mock"] = True

    return json.dumps(payload) if json_mode else json.dumps(payload, indent=2)
