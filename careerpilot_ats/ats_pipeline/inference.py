"""Model output -> validated, grounded, deterministically-scored result (§21, §22).

The pipeline for one request:

    generate ─► extract JSON ─► Pydantic (strict) ─► grounding guard ─► Python score
        │ invalid                                                       │
        └──► one constrained-correction retry ─► still invalid ─► deterministic fallback

Nothing the model emits is accepted on trust:
  * its `atsScore` is discarded and recomputed from its component scores;
  * a "matched" skill that does not appear in the resume is a hallucination —
    it is counted, then moved to missingSkills (never silently kept);
  * malformed output never reaches the caller: the deterministic engine answers
    instead, and the result says `degraded: true` and why.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any, Callable, Protocol

from .labels import general_target, job_match_target
from .prompts import chat_messages

MODEL_VERSION = "careerpilot-ats-qwen3-4b-v1"


class ATSGenerator(Protocol):
    """Anything that turns chat messages into text. Keeps inference
    independent of the serving stack (HF transformers, vLLM, an API...)."""

    def __call__(self, messages: list[dict[str, str]]) -> str: ...


# Validation, grounding and JSON extraction are the PRODUCTION implementations,
# so evaluation judges the model by exactly the rules it is served under.
from app.ats_model.validation import ParseOutcome, extract_json, ground, parse_and_validate  # noqa: E402,F401


# -------------------------------------------------------------- orchestration
def _call_with_timeout(fn: Callable[[], str], timeout_s: float) -> str:
    with ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(fn).result(timeout=timeout_s)


def deterministic(mode: str, resume: str, jd: str) -> dict[str, Any]:
    """The existing CareerPilot engine, via the same rubric the model learned."""
    if mode == "GENERAL_ATS":
        return general_target(resume)
    return job_match_target(resume, jd, fit_label=None)[0]


def analyze(mode: str, resume: str, jd: str = "", generator: ATSGenerator | None = None,
            timeout_s: float = 90.0, retry: bool = True) -> dict[str, Any]:
    """Always returns a usable, schema-valid result.

    `inference` records exactly what happened, so a degraded answer is never
    presented as a model answer.
    """
    meta: dict[str, Any] = {"modelVersion": MODEL_VERSION, "attempts": 0, "degraded": False}
    if generator is None:
        meta.update(degraded=True, reason="model not loaded")
        return {"result": deterministic(mode, resume, jd), "inference": {**meta, "provider": "deterministic"}}

    messages = chat_messages(mode, resume, jd)
    errors: list[str] = []
    t0 = time.time()
    for attempt in range(2 if retry else 1):
        meta["attempts"] = attempt + 1
        try:
            raw = _call_with_timeout(lambda: generator(messages), timeout_s)
        except FutureTimeout:
            errors.append(f"timeout after {timeout_s}s")
            break                                  # a retry would time out too
        except Exception as exc:                   # OOM, device errors, load failures
            errors.append(f"{type(exc).__name__}: {exc}")
            break
        outcome = parse_and_validate(mode, raw, resume, jd)
        if outcome.ok:
            meta.update(provider="fine-tuned", latencyMs=int((time.time() - t0) * 1000),
                        grounding=outcome.grounding, modelClaimedAtsScore=outcome.model_ats_score)
            return {"result": outcome.result, "inference": meta}
        errors.append(outcome.error or "invalid")
        # Constrained correction: show the model its own error, ask for JSON only.
        messages = [*messages, {"role": "assistant", "content": raw[:4000]},
                    {"role": "user", "content": f"That output was invalid ({outcome.error}). "
                                                f"Return ONLY the corrected JSON object for mode {mode}."}]

    meta.update(degraded=True, provider="deterministic", reason="; ".join(errors),
                latencyMs=int((time.time() - t0) * 1000))
    return {"result": deterministic(mode, resume, jd), "inference": meta}
