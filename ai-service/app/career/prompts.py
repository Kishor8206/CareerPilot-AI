"""Prompt construction for the career model — the single source for training AND serving.

Design: the prompt carries the FACTS (role requirements, the user's gaps with
study hours, prerequisite links, candidate projects, candidate resources by
ID). The model supplies the REASONING: prioritising, explaining, grouping into
phases, laying out weeks, choosing resources. A small model cannot be trusted
to recall requirements or URLs, and it does not have to — which also means a
new role or resource works without retraining.

Qwen3-1.7B is a "thinking" model: its chat template emits <think> blocks unless
`enable_thinking=False` is passed. `render()` is the only place a prompt is
turned into text, and it always passes it.
"""
from __future__ import annotations

import json
from typing import Any

SYSTEM_PROMPT = (
    "You are CareerPilot Career Roadmap AI. You turn a learner's profile and the supplied career knowledge into "
    "a personalised plan.\n"
    "Rules:\n"
    "- Return ONLY one JSON object with exactly these keys: target_role, readiness_summary, skill_gap, roadmap, "
    "study_plan, projects, interview_preparation, resource_ids.\n"
    "- Use only the skills, projects, interview topics and resource IDs given in KNOWLEDGE. Never invent any.\n"
    "- Never write a URL. Refer to resources by ID only.\n"
    "- Never recommend a skill the learner already has at the required level.\n"
    "- A skill must not appear in a phase before the phase containing its prerequisite.\n"
    "- No study week may exceed the learner's weekly hours.\n"
    "- Fill only the sections the TASK asks for; leave the others as empty lists.\n"
    "- priority is HIGH, MEDIUM or LOW. Levels are none, beginner, intermediate or advanced."
)

# Which output sections each task fills. Everything else must be an empty list.
ALL_SECTIONS = ("skill_gap", "roadmap", "study_plan", "projects", "interview_preparation", "resource_ids")


def knowledge_block(context: dict[str, Any], plan_inputs: dict[str, Any]) -> str:
    """The facts the model may use, as compact lines (fewer tokens than JSON)."""
    gap = context["gap_analysis"]
    lines = [f"role: {gap['target_role']}",
             f"readiness_percent: {gap['readiness_percent']:g} | requirements_met: {len(gap['met'])}/{gap['requirements_total']}",
             f"weekly_hours: {context['weekly_hours']:g} ({context['hours_per_day']:g}h x {context['days_per_week']} days)"
             + (f" | deadline_weeks: {context['deadline_weeks']}" if context.get("deadline_weeks") else " | deadline: none")]
    if gap["met"]:
        lines.append("already_met: " + ", ".join(gap["met"]))
    # Totals and priorities are computed by the application and stated as facts:
    # a small model should explain and organise them, not redo the arithmetic.
    lines.append(f"plan_totals: study_hours={context['hours_planned']:g} | weeks_needed={context['weeks_needed']} | "
                 f"fits_deadline={'n/a' if not context.get('deadline_weeks') else 'yes' if context['fits_deadline'] else 'no'}")
    lines.append("gaps (skill | current -> required | priority | tier | hours | unblocks | ats_flagged):")
    for g in plan_inputs["gaps"]:
        lines.append(f"- {g['skill']} | {g['current_level']} -> {g['required_level']} | {g['priority']} | {g['tier']} | "
                     f"{g['estimated_hours']:g} | {len(g['unblocks'])} | {'yes' if g['ats_flagged'] else 'no'}")
    if plan_inputs.get("deferred"):
        lines.append("deferred_to_fit_deadline: " + ", ".join(d["skill"] for d in plan_inputs["deferred"]))
    edges = [f"{g['skill']} <- {', '.join(g['prerequisites'])}" for g in plan_inputs["gaps"] if g["prerequisites"]]
    if edges:
        lines.append("prerequisites (skill <- needs):")
        lines += [f"- {e}" for e in edges]
    if plan_inputs.get("projects"):
        lines.append("projects (title | difficulty | skills):")
        lines += [f"- {p['title']} | {p['difficulty']} | {', '.join(p['skills'])}" for p in plan_inputs["projects"]]
    if plan_inputs.get("interview_topics"):
        lines.append("interview_topics: " + "; ".join(plan_inputs["interview_topics"]))
    if plan_inputs.get("resources"):
        lines.append("resources (id | type | skills | difficulty):")
        lines += [f"- {r['resource_id']} | {r['resource_type']} | {', '.join(r['skill_ids'][:4])} | {'/'.join(r['difficulty'])}"
                  for r in plan_inputs["resources"]]
    return "\n".join(lines)


def user_prompt(task: str, sections: tuple[str, ...], request_text: str, knowledge: str) -> str:
    return (f"TASK: {task}\nFILL: {', '.join(sections)}\n\nREQUEST:\n{request_text}\n\nKNOWLEDGE:\n{knowledge}")


def target_json(plan: dict[str, Any]) -> str:
    return json.dumps(plan, ensure_ascii=False, separators=(",", ":"))


def chat_messages(task: str, sections: tuple[str, ...], request_text: str, knowledge: str,
                  target: dict[str, Any] | None = None) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt(task, sections, request_text, knowledge)}]
    if target is not None:
        messages.append({"role": "assistant", "content": target_json(target)})
    return messages


def render(tokenizer: Any, messages: list[dict[str, str]], *, add_generation_prompt: bool, tokenize: bool = False) -> Any:
    """Apply the chat template with thinking DISABLED. Use this everywhere."""
    return tokenizer.apply_chat_template(messages, tokenize=tokenize, add_generation_prompt=add_generation_prompt,
                                         enable_thinking=False)
