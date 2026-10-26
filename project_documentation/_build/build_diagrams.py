"""Draws the documentation diagrams (PNG + SVG) and writes a Mermaid source for each.

    python project_documentation/_build/build_diagrams.py

Diagrams are drawn with matplotlib so they render identically everywhere; the
.mmd files carry the same structure for anyone who prefers Mermaid.
"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

OUT = Path(__file__).resolve().parents[1] / "diagrams"
OUT.mkdir(exist_ok=True)

# fill, edge
C = {
    "ui": ("#DBEAFE", "#1D4ED8"),
    "api": ("#E0E7FF", "#4338CA"),
    "logic": ("#DCFCE7", "#15803D"),
    "ai": ("#FEF3C7", "#B45309"),
    "data": ("#F1F5F9", "#475569"),
    "ext": ("#FCE7F3", "#BE185D"),
    "sec": ("#FEE2E2", "#B91C1C"),
    "opt": ("#F5F3FF", "#6D28D9"),
}
INK = "#0F172A"


def _box(ax, x, y, w, h, text, kind="data", size=8.5, bold=False, dashed=False):
    fill, edge = C[kind]
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.12", fc=fill, ec=edge,
                                lw=1.2, ls="--" if dashed else "-"))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=INK,
            fontweight="bold" if bold else "normal", linespacing=1.25)


def _arrow(ax, x1, y1, x2, y2, label=None):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1), arrowprops=dict(arrowstyle="-|>", color="#334155", lw=1.2, shrinkA=0, shrinkB=0))
    if label:
        ax.text((x1 + x2) / 2 + 0.08, (y1 + y2) / 2, label, fontsize=7, color="#475569", va="center")


def _finish(fig, ax, name, title, w, h):
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.axis("off")
    ax.set_title(title, fontsize=12, fontweight="bold", color="#14284B", pad=10)
    fig.savefig(OUT / f"{name}.png", dpi=170, bbox_inches="tight", facecolor="white")
    fig.savefig(OUT / f"{name}.svg", bbox_inches="tight", facecolor="white")
    plt.close(fig)


def _mmd(name, lines):
    (OUT / f"{name}.mmd").write_text("\n".join(lines) + "\n", encoding="utf-8")


def pipeline(name, title, steps, notes=None, width=7.2):
    """A vertical flow. steps: [(text, kind)] ; notes: {index: text} drawn to the right."""
    notes = notes or {}
    box_h, gap = 0.62, 0.34
    total_w = width + (3.9 if notes else 0)
    h = len(steps) * (box_h + gap) + 0.2
    fig, ax = plt.subplots(figsize=(total_w * 0.95, h * 0.78))
    y = h - box_h - 0.1
    for i, (text, kind) in enumerate(steps):
        _box(ax, 0.3, y, width - 0.6, box_h, text, kind, bold=i == 0)
        if i in notes:
            ax.text(width + 0.05, y + box_h / 2, notes[i], fontsize=7.6, color="#334155", va="center", style="italic")
        if i < len(steps) - 1:
            _arrow(ax, width / 2, y, width / 2, y - gap)
        y -= box_h + gap
    _finish(fig, ax, name, title, total_w, h)
    mm = ["flowchart TD"]
    for i, (text, _) in enumerate(steps):
        clean = text.replace("\n", " ").replace('"', "'")
        mm.append(f'  n{i}["{clean}"]')
    mm += [f"  n{i} --> n{i + 1}" for i in range(len(steps) - 1)]
    _mmd(name, mm)


def layers(name, title, rows, width=11.5, row_h=1.0):
    """Stacked layers. rows: [(layer label, [box text], kind)]."""
    gap = 0.42
    h = len(rows) * (row_h + gap) + 0.1
    fig, ax = plt.subplots(figsize=(width * 0.9, h * 0.82))
    y = h - row_h - 0.05
    label_w = 2.0
    for r, (label, boxes, kind) in enumerate(rows):
        ax.text(0.05, y + row_h / 2, label, fontsize=8.2, fontweight="bold", color=C[kind][1], va="center", linespacing=1.2)
        n = len(boxes)
        bw = (width - label_w - 0.15 * (n - 1) - 0.1) / n
        for k, text in enumerate(boxes):
            _box(ax, label_w + k * (bw + 0.15), y, bw, row_h, text, kind, size=7.8 if n <= 3 else 6.7)
        if r < len(rows) - 1:
            _arrow(ax, label_w + (width - label_w) / 2, y, label_w + (width - label_w) / 2, y - gap)
        y -= row_h + gap
    _finish(fig, ax, name, title, width, h)
    mm = ["flowchart TD"]
    for r, (label, boxes, _) in enumerate(rows):
        mm.append(f'  subgraph L{r}["{label.replace(chr(10), " ")}"]')
        for k, text in enumerate(boxes):
            clean = text.replace("\n", " ").replace('"', "'")
            mm.append(f'    b{r}_{k}["{clean}"]')
        mm.append("  end")
    mm += [f"  L{r} --> L{r + 1}" for r in range(len(rows) - 1)]
    _mmd(name, mm)


def columns(name, title, top, cols, bottom=None, width=11.5):
    """One box on top fanning out to parallel columns. cols: [(heading, [(text, kind)])]."""
    box_h, gap = 0.6, 0.3
    depth = max(len(c[1]) for c in cols)
    h = (depth + 2 + (1 if bottom else 0)) * (box_h + gap) + 0.4
    fig, ax = plt.subplots(figsize=(width * 0.9, h * 0.8))
    y = h - box_h - 0.1
    _box(ax, width / 2 - 2.2, y, 4.4, box_h, top[0], top[1], bold=True, size=9.5)
    n = len(cols)
    cw = (width - 0.3 * (n + 1)) / n
    ytop = y - gap - box_h
    for k, (heading, items) in enumerate(cols):
        x = 0.3 + k * (cw + 0.3)
        _arrow(ax, width / 2, y, x + cw / 2, ytop + box_h)
        yy = ytop
        _box(ax, x, yy, cw, box_h, heading, items[0][1] if items else "data", bold=True, size=8.6)
        for text, kind in items:
            _arrow(ax, x + cw / 2, yy, x + cw / 2, yy - gap)
            yy -= box_h + gap
            _box(ax, x, yy, cw, box_h, text, kind, size=7.6)
    if bottom:
        yb = ytop - depth * (box_h + gap) - box_h - gap
        for k in range(n):
            x = 0.3 + k * (cw + 0.3)
            _arrow(ax, x + cw / 2, ytop - depth * (box_h + gap), width / 2, yb + box_h)
        _box(ax, width / 2 - 2.6, yb, 5.2, box_h, bottom[0], bottom[1], bold=True, size=9)
    _finish(fig, ax, name, title, width, h)
    mm = ["flowchart TD", f'  top["{top[0]}"]']
    for k, (heading, items) in enumerate(cols):
        chain = [f'c{k}h["{heading.replace(chr(10), " ")}"]'] + [f'c{k}_{j}["{t.replace(chr(10), " ")}"]' for j, (t, _) in enumerate(items)]
        mm.append("  top --> " + " --> ".join(chain))
        if bottom:
            mm.append(f"  c{k}_{len(items) - 1} --> bottom" if items else f"  c{k}h --> bottom")
    if bottom:
        mm.append(f'  bottom["{bottom[0]}"]')
    _mmd(name, mm)


def main() -> None:
    layers("01_system_architecture", "Figure 1. System architecture (layered)", [
        ("PRESENTATION", ["React 18 + TypeScript (Vite)\nTailwind, TanStack Query, Zustand", "Monaco editor\n(DSA workspace)", "Web Speech API\n(voice interview)", "Socket.IO client\n(notifications, WebRTC signalling)"], "ui"),
        ("API GATEWAY\nNode.js + Express", ["Helmet, CORS allow-list,\nrate limiting", "JWT auth + RBAC\nmiddleware", "Zod validation +\ninput sanitisation", "19 route groups under\n/api/v1"], "api"),
        ("BUSINESS LOGIC\n(Node services)", ["resume, job, assessment,\ninterview, mentorship", "readiness (APIE client),\nanalytics, reports (PDFKit)", "coding service +\ndeterministic judge", "career plan service,\naudit, notifications"], "logic"),
        ("AI SERVICE\nPython FastAPI", ["11 agents +\norchestrator", "NLP parser, ATS engine,\nAPIE, Random Forest", "RAG: chunking, embeddings,\nvector store", "Career planner, skill-gap,\nresource catalogue"], "ai"),
        ("DATA / RESOURCES", ["MongoDB 7\n(33 Mongoose models)", "File storage\n(local or S3)", "Vector store\n(NumPy / FAISS / Chroma)", "Docker judge image\n(one container per run)"], "data"),
        ("EXTERNAL\n(optional)", ["LLM provider: OpenAI-compatible,\nAzure, Ollama (default: mock)", "YouTube Data API v3", "vLLM serving LoRA adapters\n(not deployed)", "STUN / TURN for WebRTC"], "ext"),
    ])

    pipeline("02_user_journey", "Figure 2. Student journey", [
        ("Register / log in  (JWT + refresh token)", "sec"),
        ("Complete profile, choose target companies and roles", "ui"),
        ("Upload resume  ->  parsing + ATS score (rule-based)", "logic"),
        ("Compare with a job description (predefined or your own)", "logic"),
        ("Job matching: coverage, eligibility, match score", "logic"),
        ("Assessments  |  DSA practice  |  AI mock interview", "ui"),
        ("APIE recomputes the Placement Readiness Score after every activity", "ai"),
        ("Career Plan: skill gaps -> phased plan -> schedule -> resources", "ai"),
        ("Alumni mentorship: live mock interview + human feedback", "ui"),
        ("Reports (PDF) and progress tracking", "data"),
    ], width=8.2)

    layers("03_frontend_backend", "Figure 3. Request path from browser to model", [
        ("BROWSER", ["Page component", "TanStack Query hook", "axios client\n(access token header)"], "ui"),
        ("EXPRESS", ["authenticate ->\nauthorize(role)", "validate (Zod)", "controller ->\nservice"], "api"),
        ("NODE SERVICE", ["Mongoose models", "aiClient\n(internal key, retries)", "audit + notifications"], "logic"),
        ("FASTAPI", ["route", "BaseAgent.run():\nvalidate in -> handle -> validate out", "deterministic engine\n(+ optional LLM)"], "ai"),
    ], width=10.5)

    layers("04_database", "Figure 4. Main collections and how they relate", [
        ("IDENTITY", ["User", "RefreshToken", "AuditLog", "Notification"], "sec"),
        ("PROFILES\n(1:1 with User)", ["StudentProfile", "AlumniProfile", "PlacementOfficer"], "ui"),
        ("STUDENT WORK\n(many per student)", ["Resume ->\nResumeAnalysis", "AssessmentAttempt", "InterviewSession ->\nQuestion / Response / Evaluation", "CodingSubmission", "CareerPlan"], "logic"),
        ("DERIVED", ["PlacementReadiness\n(append-only snapshots)", "SkillGap", "Recommendation", "AIInteraction"], "ai"),
        ("CATALOGUE", ["Company -> JobRole ->\nJobDescription", "Assessment ->\nAssessmentQuestion", "CodingProblem", "Skill, RAGDocument,\nSystemConfiguration"], "data"),
        ("MENTORSHIP", ["MentorshipRequest", "MentorshipSession", "AlumniFeedback", "MonitoringEvent"], "opt"),
    ], width=12)

    pipeline("05_ats_pipeline", "Figure 5. Resume / ATS pipeline", [
        ("Resume file (PDF / DOCX / TXT, max 5 MB)", "ui"),
        ("Upload checks: extension + MIME + magic bytes, SHA-256 dedup", "sec"),
        ("Text extraction (PyMuPDF, python-docx) + cleaning", "logic"),
        ("Section detection (heading patterns)", "logic"),
        ("Field extraction: regex + spaCy NER for the name", "logic"),
        ("Skill extraction: 107-skill taxonomy, 181 aliases", "logic"),
        ("ATS score: 9 capped rule-based criteria, total 100", "logic"),
        ("JD keyword match: matched / missing / coverage", "logic"),
        ("OPTIONAL fine-tuned Qwen3-4B (off; not trained yet)", "opt"),
        ("Validation + grounding guard; score recomputed in Python", "sec"),
        ("Strengths, weaknesses, recommendations -> stored analysis", "data"),
    ], notes={8: "ATS_MODEL_PROVIDER=none", 6: "deterministic", 9: "invalid -> fallback"}, width=8.2)

    pipeline("06_career_pipeline", "Figure 6. Career Plan pipeline", [
        ("Profile + current skills + target role (+ ATS result, + progress)", "ui"),
        ("Skill normalisation (122 skills, 214 aliases)", "logic"),
        ("Prerequisite inference over the skill graph (123 edges, acyclic)", "logic"),
        ("Skill-gap analysis: required level above current level", "logic"),
        ("Priority score -> HIGH / MEDIUM / LOW with reasons", "logic"),
        ("Planner: phases in prerequisite (topological) order", "logic"),
        ("Time budget: 75% learning, 15% projects, 10% revision", "logic"),
        ("Resource candidates by ID from the verified catalogue (270)", "data"),
        ("OPTIONAL career model, Qwen3-1.7B (v1 trained, not usable)", "opt"),
        ("Validator: schema + every fact; repair -> retry -> planner", "sec"),
        ("Resource IDs resolved to verified links + YouTube videos", "ext"),
        ("Career plan stored and shown at /career", "ui"),
    ], notes={8: "CAREER_MODEL_PROVIDER=none", 5: "deterministic", 10: "IDs only, never URLs"}, width=8.4)

    pipeline("07_training_pipeline", "Figure 7. Fine-tuning pipeline (both models)", [
        ("Source data (downloaded, inspected, licence recorded)", "data"),
        ("Clean, PII scrub, dedup, near-duplicate clustering", "logic"),
        ("Split by cluster / learner profile BEFORE sampling", "sec"),
        ("Weak labels or planner targets (deterministic teacher)", "logic"),
        ("Chat-format examples; validate every example; leakage audit", "sec"),
        ("Load base model in 4-bit (NF4) on a Colab T4", "ai"),
        ("Attach LoRA adapters r=16, alpha=32 to 7 projection layers", "ai"),
        ("SFT with completion-only loss, cosine LR 1e-4", "ai"),
        ("Checkpoints to Drive, early stopping on validation loss", "data"),
        ("Evaluate: fine-tuned vs base vs deterministic baselines", "logic"),
        ("Serve adapter (vLLM) behind validator + fallback", "opt"),
    ], notes={10: "not deployed"}, width=8.2)

    columns("08_lora_qlora", "Figure 8. LoRA and QLoRA", ("One transformer weight matrix W (d x k)", "data"), [
        ("Full fine-tuning", [("Update all of W", "sec"), ("Billions of trainable\nparameters", "sec"), ("Needs large GPU memory", "sec")]),
        ("LoRA", [("W frozen (16-bit)", "logic"), ("Train A (r x k) and B (d x r)\nW' = W + (alpha/r) B A", "logic"), ("About 1% trainable", "logic")]),
        ("QLoRA (used here)", [("W frozen AND stored\nin 4-bit NF4", "ai"), ("Same A, B adapters,\nr = 16, alpha = 32", "ai"), ("Fits a free 16 GB T4", "ai")]),
    ], bottom=("Output: a small adapter file; the base model is unchanged", "data"))

    pipeline("09_resource_pipeline", "Figure 9. Resource recommendation and verification", [
        ("Skill gap (skill, stage, priority)", "logic"),
        ("Catalogue lookup by skill (270 resources)", "data"),
        ("Rank: base 3.0 + 2.0 stage match + type preference + quality weight", "logic"),
        ("Only verified / reachable resources are eligible", "sec"),
        ("Model (if enabled) may choose resource IDs only", "opt"),
        ("ID resolution: unknown IDs are dropped and counted", "sec"),
        ("Per skill: reading resources + YouTube videos", "ui"),
    ], notes={3: "HTTPS check + SSRF guard", 5: "no invented URLs"}, width=8.4)

    pipeline("10_youtube_integration", "Figure 10. YouTube integration", [
        ("Build time: fetch_youtube_resources.py (needs YOUTUBE_API_KEY)", "data"),
        ("YouTube Data API v3 search per skill", "ext"),
        ("Keep videos that are public and embeddable", "sec"),
        ("180 videos stored in the catalogue with IDs", "data"),
        ("Runtime: GET /ai/career/resources/youtube (live search)", "ext"),
        ("Live results are labelled 'unverified', never added to the catalogue", "sec"),
        ("Key lives only in .env; packaging script scans for leaked keys", "sec"),
    ], notes={3: "151 name the skill in the title"}, width=8.4)

    pipeline("11_dsa_judge", "Figure 11. DSA judge: from Submit to verdict", [
        ("Monaco editor: student implements one function", "ui"),
        ("POST /api/v1/coding/problems/:id/submit  (auth, rate limit, Zod)", "api"),
        ("coding.service: load problem; hidden tests only on Submit", "logic"),
        ("codegen: prelude + student code + harness for the language", "logic"),
        ("Semaphore: at most N sandboxes at once (no external queue)", "logic"),
        ("docker run: one throw-away container", "data"),
        ("Compile once; host streams test inputs one at a time", "sec"),
        ("Container reports exit code, time, memory, result JSON", "data"),
        ("Judge on host compares with expected outputs", "logic"),
        ("Verdict + score stored; AI static review added afterwards", "ai"),
    ], notes={6: "expected outputs never enter", 9: "review cannot change verdict"}, width=8.4)

    layers("12_docker_sandbox", "Figure 12. Sandbox isolation applied to every container", [
        ("NETWORK", ["--network none\nno internet, no database,\nno internal services"], "sec"),
        ("FILESYSTEM", ["--read-only root", "tmpfs /work and /tmp only", "no volumes or bind mounts"], "sec"),
        ("IDENTITY", ["--user 65534 (nobody)", "--cap-drop ALL", "no-new-privileges"], "sec"),
        ("RESOURCES", ["--memory and --memory-swap", "--cpus", "--pids-limit\n(fork bombs)", "time limit inside +\nhost deadline"], "logic"),
        ("LIFECYCLE", ["--pull never", "no -e flags:\nno secrets passed", "--rm plus\nexplicit rm -f"], "data"),
    ], width=11, row_h=0.95)

    pipeline("13_admin_workflow", "Figure 13. Administrator and placement-officer workflow", [
        ("Log in as ADMIN or PLACEMENT_OFFICER (role enforced server-side)", "sec"),
        ("Admin dashboard: users, system health, AI usage per agent", "ui"),
        ("Manage users, companies, job roles and job descriptions", "logic"),
        ("Verify or reject alumni accounts", "logic"),
        ("Configure APIE weights and bands (validated to sum to 1.0)", "ai"),
        ("Knowledge base: ingest documents, re-index, test RAG queries", "ai"),
        ("Placement officer: cohort analytics, at-risk students, reports", "ui"),
        ("Audit log of sensitive actions; research export (pseudonymised)", "data"),
    ], width=8.4)

    pipeline("14_student_workflow", "Figure 14. What triggers a readiness update", [
        ("Resume analysed", "ui"),
        ("Assessment submitted", "ui"),
        ("DSA solution judged", "ui"),
        ("Interview answer evaluated", "ui"),
        ("Alumni feedback received", "ui"),
        ("recomputeReadiness(): collect evidence, recency-weight it", "logic"),
        ("POST /ai/readiness/predict: APIE + Random Forest second opinion", "ai"),
        ("New append-only snapshot, skill gaps, recommendations", "data"),
        ("readiness:updated pushed over Socket.IO", "api"),
    ], width=8.0)

    columns("15_ai_architecture", "Figure 15. AI architecture: what is deterministic and what is a model", ("CareerPilot AI service", "ai"), [
        ("RESUME / ATS", [("Parser + taxonomy\n(deterministic)", "logic"), ("9-criterion ATS score\n(deterministic)", "logic"), ("Qwen3-4B QLoRA\n(optional, not trained)", "opt")]),
        ("READINESS", [("APIE weighted model\n(deterministic)", "logic"), ("Random Forest\n(trained, synthetic data)", "ai"), ("Skill gaps +\nrecommendations", "logic")]),
        ("INTERVIEW / RAG", [("LLM: questions +\n5-dimension scores", "ai"), ("Overall score\nrecomputed in code", "logic"), ("RAG with relevance\nthreshold", "ai")]),
        ("CAREER PLAN", [("Skill-gap + planner\n(deterministic)", "logic"), ("Qwen3-1.7B QLoRA\n(v1 not usable, off)", "opt"), ("Resource catalogue +\nYouTube API", "ext")]),
    ], bottom=("Validation layer: Pydantic schemas, grounding checks, fallback", "sec"), width=12.5)

    layers("16_deployment", "Figure 16. Deployment (docker-compose.yml)", [
        ("CLIENT", ["Browser"], "ui"),
        ("frontend", ["nginx serving the Vite build\nproxies /api and /socket.io"], "ui"),
        ("backend", ["Node.js + Express\n(judge DISABLED in compose:\nno Docker socket is mounted)"], "api"),
        ("ai-service", ["FastAPI + uvicorn\nreachable only from the backend"], "ai"),
        ("mongodb", ["mongo:7 with a named volume"], "data"),
        ("HOST-ONLY\n(outside compose)", ["DSA judge: backend on the host\nstarts careerpilot-judge:1 containers", "GPU host with vLLM for adapters\n(PLANNED)"], "opt"),
    ], width=10.5, row_h=0.85)

    layers("17_security", "Figure 17. Security controls by layer", [
        ("TRANSPORT / HEADERS", ["Helmet security headers", "CORS allow-list", "signed httpOnly\nrefresh cookie"], "sec"),
        ("IDENTITY", ["bcrypt password hashing\n(12 rounds)", "JWT access 15 min,\nrefresh 7 days", "refresh rotation +\nfamily revocation", "RBAC: 4 active roles"], "sec"),
        ("INPUT", ["Zod schemas on\nbody / query / params", "sanitisation against\nNoSQL operators", "upload: extension + MIME\n+ magic bytes + size"], "api"),
        ("ABUSE", ["global, auth, AI, upload and\ncode-run rate limiters", "sandbox concurrency cap", "audit log"], "logic"),
        ("AI", ["schema-validated outputs", "scores recomputed in code", "RAG relevance threshold", "resource IDs only +\nSSRF-guarded verifier"], "ai"),
        ("CODE EXECUTION", ["isolated container per run", "hidden tests and expected\noutputs stay on the host", "never executed on\nthe API host"], "data"),
    ], width=12, row_h=0.95)

    print(f"Wrote {len(list(OUT.glob('*.png')))} diagrams to {OUT}")


if __name__ == "__main__":
    main()
