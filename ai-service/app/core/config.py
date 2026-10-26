"""Environment-driven configuration for the CareerPilot AI Python service.

Reads the same repository-root `.env` as the Node backend so both services
share provider settings and the internal shared secret.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# ai-service/app/core/config.py -> repository root
ROOT_DIR = Path(__file__).resolve().parents[3]
SERVICE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", SERVICE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ---- General ----
    node_env: str = "development"
    app_name: str = "CareerPilot AI Service"
    version: str = "1.0.0"
    log_level: str = "INFO"

    # ---- Security ----
    # Shared secret required on every request from the Node gateway.
    ai_service_internal_key: str = "dev_internal_key"
    # Comma-separated list of origins permitted to call this service directly.
    ai_service_allowed_origins: str = "http://127.0.0.1:5000,http://localhost:5000"

    # ---- LLM provider abstraction (§3) ----
    # openai | azure | ollama | mock
    ai_provider: str = "mock"
    ai_api_key: str = ""
    ai_base_url: str = ""
    ai_model: str = "gpt-4o-mini"
    ai_embedding_model: str = "text-embedding-3-small"
    ai_temperature: float = 0.3
    ai_max_tokens: int = 1200
    ai_request_timeout: float = 90.0

    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2024-02-15-preview"
    azure_openai_deployment: str = ""

    # ---- Vector store ----
    # chroma | faiss | numpy
    vector_db_provider: str = "numpy"
    vector_db_path: str = ""
    # hash | sentence-transformers | openai
    embedding_provider: str = "hash"
    embedding_dimension: int = 384
    rag_chunk_size: int = 900
    rag_chunk_overlap: int = 150
    rag_top_k: int = 5
    # Retrieved chunks below this cosine score are discarded, which is what makes
    # "I do not have verified information" possible instead of a hallucination.
    #
    # The correct cut-off depends on the embedder, so each has its own value and
    # `effective_min_relevance` picks the right one. Setting RAG_MIN_RELEVANCE
    # explicitly overrides both.
    #
    # The lexical figure is calibrated from measurement against the seeded
    # corpus, not guessed:
    #     on-topic question .................... 0.28 - 0.31
    #     off-topic but domain-adjacent ........ 0.11 - 0.14
    #     entirely unrelated ................... 0.02 - 0.07
    # 0.18 sits in the clean gap: it keeps genuine matches and rejects questions
    # the corpus merely shares vocabulary with. That gap is the whole reason the
    # "no verified information" answer is trustworthy.
    rag_min_relevance: float | None = None
    rag_min_relevance_semantic: float = 0.25
    rag_min_relevance_lexical: float = 0.18

    # ---- Speech-to-text (§11 voice-assisted interviews) ----
    # none    = browser Web Speech API only (default; audio never leaves the device)
    # whisper = server-side faster-whisper fallback for browsers without the API
    speech_provider: str = "none"
    speech_model: str = "base"          # tiny | base | small | medium | large-v3
    speech_device: str = "cpu"          # cpu | cuda
    speech_compute_type: str = "int8"   # int8 keeps CPU inference viable
    speech_language: str = "en"

    # ---- Fine-tuned ATS model (careerpilot_ats/; off by default) ----
    # none              = deterministic ATS engine only (unchanged behaviour)
    # openai_compatible = LoRA adapter served by vLLM or any OpenAI-compatible server
    # local             = in-process transformers + PEFT; requires a CUDA GPU
    ats_model_provider: str = "none"
    ats_model_endpoint: str = ""                 # e.g. http://gpu-host:8001/v1
    ats_model_name: str = "careerpilot-ats"      # served LoRA module name
    ats_model_api_key: str = ""
    ats_model_base: str = "Qwen/Qwen3-4B-Instruct-2507"
    ats_model_adapter_path: str = ""             # local provider only
    ats_model_timeout_s: float = 60.0
    ats_model_max_new_tokens: int = 900

    # ---- Career Plan model (careerpilot_career/; separate from the ATS model) ----
    # none              = deterministic planner only
    # openai_compatible = LoRA adapter served by vLLM or any OpenAI-compatible server
    # local             = in-process transformers + PEFT; requires a CUDA GPU
    career_model_provider: str = "none"
    career_model_endpoint: str = ""
    career_model_name: str = "careerpilot-career"
    career_model_api_key: str = ""
    career_model_base: str = "Qwen/Qwen3-1.7B"
    career_model_adapter_path: str = ""
    career_model_timeout_s: float = 90.0
    career_model_max_new_tokens: int = 3000

    # ---- Career Plan: learning-resource retrieval ----
    youtube_api_key: str = ""                    # YouTube Data API v3; empty = YouTube retrieval disabled

    # ---- ML ----
    ml_artifacts_path: str = ""
    ml_model_version: str = "1.0.0"
    ml_random_state: int = 42

    # ---- Demo mode ----
    demo_mode: bool = True

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def effective_min_relevance(self) -> float:
        """Relevance cut-off matched to the configured embedding provider."""
        if self.rag_min_relevance is not None:
            return self.rag_min_relevance
        if self.embedding_provider.lower().strip() == "hash":
            return self.rag_min_relevance_lexical
        return self.rag_min_relevance_semantic

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.ai_service_allowed_origins.split(",") if o.strip()]

    @property
    def vector_path(self) -> Path:
        path = Path(self.vector_db_path) if self.vector_db_path else SERVICE_DIR / "data" / "vectorstore"
        if not path.is_absolute():
            path = (ROOT_DIR / path).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def artifacts_path(self) -> Path:
        path = Path(self.ml_artifacts_path) if self.ml_artifacts_path else SERVICE_DIR / "artifacts"
        if not path.is_absolute():
            path = (ROOT_DIR / path).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def data_path(self) -> Path:
        path = SERVICE_DIR / "data"
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
