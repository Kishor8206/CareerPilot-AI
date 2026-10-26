"""Model output -> validated, grounded, deterministically-scored result.

Shared by production serving and offline evaluation, so a model is judged in
evaluation by exactly the rules that govern it in production.

Nothing the model emits is accepted on trust:
  * its `atsScore` is discarded and recomputed from its component scores;
  * a "matched" skill absent from the resume is a hallucination — counted,
    then moved to missingSkills, never silently kept;
  * malformed output is rejected, never repaired into something plausible.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.ats_model.schemas import SCHEMAS
from app.ats_model.scoring import final_score

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str) -> dict[str, Any]:
    """Strip fences, then take the first *balanced* JSON object, tracking
    string literals so a brace inside a string cannot end it."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("empty model output")
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in model output")
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                obj = json.loads(text[start:i + 1])
                if not isinstance(obj, dict):
                    raise ValueError("top-level JSON is not an object")
                return obj
    raise ValueError("unterminated JSON object (output likely truncated)")


def _present(term: str, text: str) -> bool:
    """Word-boundary, case-insensitive. `Java` does not match `JavaScript`."""
    t = term.strip()
    if not t:
        return False
    return re.search(r"(?<![\w+#.])" + re.escape(t) + r"(?![\w+#])", text, re.I) is not None


def _canonical_names(text: str) -> set[str]:
    from app.nlp.skills_taxonomy import extract_skills
    return {s.name.lower() for s in extract_skills(text)}


def ground(mode: str, obj: dict[str, Any], resume: str, jd: str) -> dict[str, Any]:
    """Enforce "only information present in the input". Corrects `obj` in
    place and returns every violation found, so they can be measured."""
    report: dict[str, Any] = {"hallucinated_matched": [], "missing_not_in_jd": [], "overlap_removed": []}
    if mode != "JOB_MATCH_ATS":
        return report
    resume_canon, jd_canon = _canonical_names(resume), _canonical_names(jd)

    grounded, hallucinated = [], []
    for s in obj.get("matchedSkills", []):
        (grounded if (s.lower() in resume_canon or _present(s, resume)) else hallucinated).append(s)
    report["hallucinated_matched"] = hallucinated

    missing = []
    for s in obj.get("missingSkills", []):
        if s.lower() in jd_canon or _present(s, jd):
            missing.append(s)
        else:
            report["missing_not_in_jd"].append(s)
    # A hallucinated "match" the JD really asks for is, in truth, a missing skill.
    for s in hallucinated:
        if (s.lower() in jd_canon or _present(s, jd)) and s not in missing:
            missing.append(s)

    overlap = {s.lower() for s in grounded} & {s.lower() for s in missing}
    report["overlap_removed"] = sorted(overlap)
    obj["matchedSkills"] = grounded
    obj["missingSkills"] = [s for s in missing if s.lower() not in overlap]
    return report


@dataclass
class ParseOutcome:
    ok: bool
    result: dict[str, Any] | None = None
    error: str | None = None
    grounding: dict[str, Any] = field(default_factory=dict)
    model_ats_score: float | None = None      # what the model claimed, for auditing only


def parse_and_validate(mode: str, raw: str, resume: str, jd: str) -> ParseOutcome:
    try:
        obj = extract_json(raw)
    except (ValueError, json.JSONDecodeError) as exc:
        return ParseOutcome(False, error=f"json: {exc}")
    claimed = obj.get("atsScore")
    obj["mode"] = obj.get("mode", mode)
    if obj["mode"] != mode:
        return ParseOutcome(False, error=f"mode mismatch: asked {mode}, got {obj['mode']}")
    try:
        obj["atsScore"] = final_score(mode, obj.get("componentScores") or {})
    except (ValueError, TypeError) as exc:
        return ParseOutcome(False, error=f"components: {exc}")
    try:
        validated = SCHEMAS[mode].model_validate(obj).model_dump()
    except ValidationError as exc:
        err = exc.errors()[0]
        return ParseOutcome(False, error=f"schema: {err['loc']} {err['msg']}")
    grounding = ground(mode, validated, resume, jd)
    return ParseOutcome(True, result=validated, grounding=grounding,
                        model_ats_score=claimed if isinstance(claimed, (int, float)) else None)
