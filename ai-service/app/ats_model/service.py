"""Serving the fine-tuned ATS model behind a provider abstraction.

    ATS_MODEL_PROVIDER=none               default — the model is never called
    ATS_MODEL_PROVIDER=openai_compatible  recommended — the LoRA adapter served by vLLM
                                          (or any OpenAI-compatible server) on a GPU host
    ATS_MODEL_PROVIDER=local              in-process transformers + PEFT (needs a CUDA GPU)

Every failure raises ATSModelUnavailable with a reason. The agent catches it
and returns the deterministic engine's result, so an outage, a timeout or a
malformed answer changes the provenance of the response, never its availability.
"""
from __future__ import annotations

import abc
import asyncio
import time
from typing import Any

import httpx

from app.ats_model.prompts import chat_messages
from app.ats_model.validation import parse_and_validate
from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

MODEL_VERSION = "careerpilot-ats-qwen3-4b-v1"


class ATSModelUnavailable(Exception):
    """The model could not produce a valid answer. `reason` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class ATSGenerator(abc.ABC):
    name: str = "abstract"

    @abc.abstractmethod
    async def generate(self, messages: list[dict[str, str]]) -> str: ...


class OpenAICompatibleGenerator(ATSGenerator):
    """Calls /chat/completions. vLLM serves a LoRA adapter under its own model
    name:  vllm serve Qwen/Qwen3-4B-Instruct-2507 --enable-lora \\
               --lora-modules careerpilot-ats=/models/careerpilot-ats-qwen3-4b-v1"""

    name = "openai_compatible"

    def __init__(self, base_url: str, model: str, api_key: str, timeout_s: float, max_tokens: int):
        if not base_url:
            raise ATSModelUnavailable("ATS_MODEL_ENDPOINT is not set")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model, self.timeout_s, self.max_tokens = model, timeout_s, max_tokens
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def generate(self, messages: list[dict[str, str]]) -> str:
        body = {"model": self.model, "messages": messages, "temperature": 0, "max_tokens": self.max_tokens}
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            response = await client.post(self.url, json=body, headers=self.headers)
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"] or ""


class LocalHFGenerator(ATSGenerator):
    """In-process 4-bit base model + LoRA adapter. Loaded lazily, once."""

    name = "local"

    def __init__(self, base_model: str, adapter_path: str, max_new_tokens: int):
        if not adapter_path:
            raise ATSModelUnavailable("ATS_MODEL_ADAPTER_PATH is not set")
        try:
            import torch
            from peft import PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        except ImportError as exc:
            raise ATSModelUnavailable(
                f"local provider needs torch, transformers, peft and bitsandbytes ({exc.name} missing); "
                "see requirements-optional.txt") from exc
        if not torch.cuda.is_available():
            raise ATSModelUnavailable("local provider needs a CUDA GPU; use openai_compatible on a CPU host")
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(adapter_path)
        base = AutoModelForCausalLM.from_pretrained(
            base_model, device_map={"": 0}, torch_dtype=dtype,
            quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                                                   bnb_4bit_compute_dtype=dtype))
        self.model = PeftModel.from_pretrained(base, adapter_path).eval()
        self.max_new_tokens = max_new_tokens
        self._lock = asyncio.Lock()           # one generation at a time on a single GPU

    def _generate_sync(self, messages: list[dict[str, str]]) -> str:
        ids = self.tok.apply_chat_template(messages, add_generation_prompt=True,
                                           return_tensors="pt").to(self.model.device)
        with self.torch.no_grad():
            out = self.model.generate(ids, max_new_tokens=self.max_new_tokens, do_sample=False,
                                      pad_token_id=self.tok.pad_token_id, eos_token_id=self.tok.eos_token_id)
        return self.tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True)

    async def generate(self, messages: list[dict[str, str]]) -> str:
        async with self._lock:
            return await asyncio.to_thread(self._generate_sync, messages)


# ------------------------------------------------------------- singleton
_generator: ATSGenerator | None = None
_load_error: str | None = None


def get_generator() -> ATSGenerator | None:
    """None when disabled. A failed load is remembered, not retried per request."""
    global _generator, _load_error
    provider = settings.ats_model_provider.lower().strip()
    if provider in ("", "none"):
        return None
    if _generator is not None or _load_error is not None:
        return _generator
    try:
        if provider == "openai_compatible":
            _generator = OpenAICompatibleGenerator(settings.ats_model_endpoint, settings.ats_model_name,
                                                   settings.ats_model_api_key, settings.ats_model_timeout_s,
                                                   settings.ats_model_max_new_tokens)
        elif provider == "local":
            _generator = LocalHFGenerator(settings.ats_model_base, settings.ats_model_adapter_path,
                                          settings.ats_model_max_new_tokens)
        else:
            raise ATSModelUnavailable(f"unknown ATS_MODEL_PROVIDER '{provider}'")
        log.info("ATS model ready", extra={"provider": provider, "modelVersion": MODEL_VERSION})
    except ATSModelUnavailable as exc:
        _load_error = exc.reason
        log.warning("ATS model unavailable; deterministic engine will be used", extra={"reason": exc.reason})
    except Exception as exc:  # a broken GPU runtime must not take the service down
        _load_error = f"{type(exc).__name__}: {exc}"
        log.warning("ATS model failed to load; deterministic engine will be used", extra={"reason": _load_error})
    return _generator


def reset_ats_model() -> None:
    global _generator, _load_error
    _generator, _load_error = None, None


async def run_model(mode: str, resume: str, jd: str = "") -> dict[str, Any]:
    """Generate -> validate -> ground. One constrained-correction retry.
    Returns {"result", "grounding", "attempts", "latencyMs", "provider"}."""
    generator = get_generator()
    if generator is None:
        raise ATSModelUnavailable(_load_error or "ATS model disabled (ATS_MODEL_PROVIDER=none)")

    messages = chat_messages(mode, resume, jd)
    errors: list[str] = []
    t0 = time.monotonic()
    for attempt in (1, 2):
        try:
            raw = await asyncio.wait_for(generator.generate(messages), timeout=settings.ats_model_timeout_s)
        except asyncio.TimeoutError:
            errors.append(f"timeout after {settings.ats_model_timeout_s}s")
            break
        except Exception as exc:              # HTTP errors, CUDA OOM, connection refused...
            errors.append(f"{type(exc).__name__}: {exc}")
            break
        outcome = parse_and_validate(mode, raw, resume, jd)
        if outcome.ok:
            if outcome.grounding.get("hallucinated_matched"):
                log.warning("ATS model hallucinated skills; corrected by grounding guard",
                            extra={"skills": outcome.grounding["hallucinated_matched"]})
            return {"result": outcome.result, "grounding": outcome.grounding, "attempts": attempt,
                    "latencyMs": int((time.monotonic() - t0) * 1000), "provider": generator.name}
        errors.append(outcome.error or "invalid output")
        messages = [*messages, {"role": "assistant", "content": raw[:4000]},
                    {"role": "user", "content": f"That output was invalid ({outcome.error}). "
                                                f"Return ONLY the corrected JSON object for mode {mode}."}]
    raise ATSModelUnavailable("; ".join(errors))
