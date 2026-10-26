"""Career roadmap model service: load the model, generate text. Nothing else.

No database access, no resource lookup, no validation: those belong to the
roadmap service. This module is completely separate from the ATS model
(app/ats_model): different base model, different adapter, different settings,
and neither ever loads the other's weights.

    CAREER_MODEL_PROVIDER=none               default: the deterministic planner answers
    CAREER_MODEL_PROVIDER=openai_compatible  adapter served by vLLM on a GPU host (recommended)
    CAREER_MODEL_PROVIDER=local              in-process transformers + PEFT (needs a CUDA GPU)
"""
from __future__ import annotations

import abc
import asyncio
from typing import Any

import httpx

from app.career.prompts import render
from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

MODEL_NAME = "CareerPilot Career Roadmap"
MODEL_VERSION = "career-roadmap-qwen3-1.7b-v1"
BASE_MODEL = "Qwen/Qwen3-1.7B"


class CareerModelUnavailable(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class CareerGenerator(abc.ABC):
    name = "abstract"

    @abc.abstractmethod
    async def generate(self, messages: list[dict[str, str]]) -> str: ...


class OpenAICompatibleGenerator(CareerGenerator):
    """vLLM:  vllm serve Qwen/Qwen3-1.7B --enable-lora --max-lora-rank 16 \\
                  --lora-modules careerpilot-career=/models/career_roadmap/final
    Thinking is disabled through the chat-template argument, matching training."""

    name = "openai_compatible"

    def __init__(self, base_url: str, model: str, api_key: str, timeout_s: float, max_tokens: int):
        if not base_url:
            raise CareerModelUnavailable("CAREER_MODEL_ENDPOINT is not set")
        self.url = base_url.rstrip("/") + "/chat/completions"
        self.model, self.timeout_s, self.max_tokens = model, timeout_s, max_tokens
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}

    async def generate(self, messages: list[dict[str, str]]) -> str:
        body = {"model": self.model, "messages": messages, "temperature": 0, "max_tokens": self.max_tokens,
                "chat_template_kwargs": {"enable_thinking": False}}
        async with httpx.AsyncClient(timeout=self.timeout_s) as client:
            response = await client.post(self.url, json=body, headers=self.headers)
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"] or ""


class LocalGenerator(CareerGenerator):
    name = "local"

    def __init__(self, base_model: str, adapter_path: str, max_new_tokens: int):
        if not adapter_path:
            raise CareerModelUnavailable("CAREER_MODEL_ADAPTER_PATH is not set")
        try:
            import torch
            from peft import PeftModel
            from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        except ImportError as exc:
            raise CareerModelUnavailable(f"local provider needs torch, transformers, peft, bitsandbytes ({exc.name} missing)") from exc
        if not torch.cuda.is_available():
            raise CareerModelUnavailable("local provider needs a CUDA GPU; use openai_compatible on a CPU host")
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(adapter_path)
        base = AutoModelForCausalLM.from_pretrained(
            base_model, device_map={"": 0}, torch_dtype=dtype,
            quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=dtype))
        self.model = PeftModel.from_pretrained(base, adapter_path).eval()
        self.max_new_tokens = max_new_tokens
        self._lock = asyncio.Lock()

    def _sync(self, messages: list[dict[str, str]]) -> str:
        text = render(self.tok, messages, add_generation_prompt=True)       # thinking disabled, as in training
        enc = self.tok(text, return_tensors="pt", add_special_tokens=False).to(self.model.device)
        with self.torch.no_grad():
            out = self.model.generate(**enc, max_new_tokens=self.max_new_tokens, do_sample=False,
                                      pad_token_id=self.tok.pad_token_id, eos_token_id=self.tok.eos_token_id)
        return self.tok.decode(out[0, enc["input_ids"].shape[1]:], skip_special_tokens=True)

    async def generate(self, messages: list[dict[str, str]]) -> str:
        async with self._lock:
            return await asyncio.to_thread(self._sync, messages)


_generator: CareerGenerator | None = None
_load_error: str | None = None


def get_generator() -> CareerGenerator | None:
    """None when disabled. A failed load is remembered rather than retried on every request."""
    global _generator, _load_error
    provider = settings.career_model_provider.lower().strip()
    if provider in ("", "none"):
        return None
    if _generator is not None or _load_error is not None:
        return _generator
    try:
        if provider == "openai_compatible":
            _generator = OpenAICompatibleGenerator(settings.career_model_endpoint, settings.career_model_name,
                                                   settings.career_model_api_key, settings.career_model_timeout_s,
                                                   settings.career_model_max_new_tokens)
        elif provider == "local":
            _generator = LocalGenerator(settings.career_model_base, settings.career_model_adapter_path,
                                        settings.career_model_max_new_tokens)
        else:
            raise CareerModelUnavailable(f"unknown CAREER_MODEL_PROVIDER '{provider}'")
        log.info("Career model ready", extra={"provider": provider, "modelVersion": MODEL_VERSION})
    except CareerModelUnavailable as exc:
        _load_error = exc.reason
        log.warning("Career model unavailable; the deterministic planner will be used", extra={"reason": exc.reason})
    except Exception as exc:
        _load_error = f"{type(exc).__name__}: {exc}"
        log.warning("Career model failed to load; the deterministic planner will be used", extra={"reason": _load_error})
    return _generator


def load_error() -> str | None:
    return _load_error


def reset_career_model() -> None:
    global _generator, _load_error
    _generator, _load_error = None, None


def info() -> dict[str, Any]:
    return {"model_name": MODEL_NAME, "model_version": MODEL_VERSION, "base_model": BASE_MODEL,
            "provider": settings.career_model_provider}
