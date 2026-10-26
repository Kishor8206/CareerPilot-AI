"""Speech-to-text provider abstraction (§11 voice-assisted interviews).

Why this exists alongside browser speech recognition
----------------------------------------------------
The browser's Web Speech API is the *default* path and the better one for most
users: it is instant, costs nothing, and — critically — the audio never leaves
the device, so no recording consent or storage is required.

But it is not available everywhere. Firefox has no implementation, and some
managed/locked-down browsers disable it. Without a server-side fallback those
students would be silently pushed onto the text-only path while everyone else
gets voice.

So this module provides a server-side transcription path with the same
provider-abstraction discipline used for the LLM: nothing above it knows which
engine is running, and an unconfigured engine reports that honestly rather than
returning empty text that would look like "you said nothing".

Providers
---------
`whisper` : faster-whisper, running locally. Requires the optional dependency
            and ffmpeg on PATH. Audio is processed in memory and discarded.
`none`    : the default. Reports that server transcription is not configured,
            so the frontend keeps using browser recognition.
"""
from __future__ import annotations

import abc
import io
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.core.errors import ServiceError
from app.core.logging import get_logger

log = get_logger(__name__)

#: Upper bound on a single utterance. An interview answer is
#: at most a couple of minutes; anything larger is a misuse of the endpoint.
MAX_AUDIO_BYTES = 12 * 1024 * 1024

SUPPORTED_AUDIO_TYPES = {
    "audio/webm",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp4",
    "audio/m4a",
}


class SpeechUnavailable(ServiceError):
    """Raised when no server-side transcription engine is configured."""

    status_code = 503
    code = "SPEECH_PROVIDER_UNAVAILABLE"


@dataclass
class TranscriptionResult:
    text: str
    provider: str
    model: str
    language: str
    duration_seconds: float
    latency_ms: int
    #: 0-1 where the engine reports it; None where it does not.
    confidence: float | None = None
    segments: list[dict[str, Any]] = field(default_factory=list)


class SpeechProvider(abc.ABC):
    name: str = "base"
    available: bool = False

    @abc.abstractmethod
    def transcribe(self, audio: bytes, *, mime_type: str, language: str) -> TranscriptionResult:
        ...

    def status(self) -> dict[str, Any]:
        return {"provider": self.name, "available": self.available}


class NullSpeechProvider(SpeechProvider):
    """Default. Server transcription is off; the browser handles speech."""

    name = "none"
    available = False

    def transcribe(self, audio: bytes, *, mime_type: str, language: str) -> TranscriptionResult:
        raise SpeechUnavailable(
            "Server-side speech recognition is not configured on this deployment. "
            "Voice input uses your browser's built-in speech recognition instead. "
            "To enable the server path, install faster-whisper and set SPEECH_PROVIDER=whisper."
        )

    def status(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "available": False,
            "detail": (
                "Server transcription is disabled. The browser's Web Speech API is used instead, "
                "which keeps audio on the student's device."
            ),
        }


class WhisperSpeechProvider(SpeechProvider):
    """Local Whisper transcription via faster-whisper.

    The model is loaded once and reused. Audio is held in memory for the
    duration of the call and never written to disk — there is no transcription
    cache, because caching a student's spoken answer would create a recording
    store that nobody consented to.
    """

    name = "whisper"

    def __init__(self) -> None:
        self._model: Any = None
        self.available = False
        try:
            from faster_whisper import WhisperModel  # noqa: F401

            self.available = True
        except ImportError:
            log.warning(
                "SPEECH_PROVIDER=whisper but faster-whisper is not installed. "
                "Install it with: pip install -r ai-service/requirements-optional.txt"
            )

    def _load(self) -> Any:
        if self._model is not None:
            return self._model

        from faster_whisper import WhisperModel

        log.info("Loading Whisper model", extra={"model": settings.speech_model})
        # int8 keeps CPU inference fast enough for short utterances without a GPU.
        self._model = WhisperModel(
            settings.speech_model,
            device=settings.speech_device,
            compute_type=settings.speech_compute_type,
        )
        return self._model

    def transcribe(self, audio: bytes, *, mime_type: str, language: str) -> TranscriptionResult:
        if not self.available:
            raise SpeechUnavailable(
                "The Whisper speech provider is selected but faster-whisper is not installed. "
                "Install it with: pip install -r ai-service/requirements-optional.txt"
            )

        started = time.perf_counter()
        model = self._load()

        # faster-whisper accepts a file-like object, so nothing touches the disk.
        segments, info = model.transcribe(
            io.BytesIO(audio),
            language=(language or "en").split("-")[0],
            beam_size=5,
            vad_filter=True,  # drops silence, which shortens inference noticeably
        )

        collected: list[dict[str, Any]] = []
        parts: list[str] = []
        for segment in segments:
            parts.append(segment.text.strip())
            collected.append(
                {
                    "start": round(float(segment.start), 2),
                    "end": round(float(segment.end), 2),
                    "text": segment.text.strip(),
                }
            )

        text = " ".join(p for p in parts if p).strip()
        latency_ms = int((time.perf_counter() - started) * 1000)

        log.info(
            "Audio transcribed",
            extra={"chars": len(text), "latencyMs": latency_ms, "segments": len(collected)},
        )

        return TranscriptionResult(
            text=text,
            provider=self.name,
            model=settings.speech_model,
            language=getattr(info, "language", language) or language,
            duration_seconds=round(float(getattr(info, "duration", 0.0)), 2),
            latency_ms=latency_ms,
            confidence=None,
            segments=collected,
        )

    def status(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "available": self.available,
            "model": settings.speech_model,
            "loaded": self._model is not None,
            "detail": None if self.available else "faster-whisper is not installed.",
        }


_provider: SpeechProvider | None = None


def get_speech_provider() -> SpeechProvider:
    global _provider
    if _provider is not None:
        return _provider

    name = settings.speech_provider.lower().strip()
    if name == "whisper":
        _provider = WhisperSpeechProvider()
    else:
        _provider = NullSpeechProvider()

    log.info("Speech provider ready", extra={"provider": _provider.name, "available": _provider.available})
    return _provider


def reset_speech_provider() -> None:
    global _provider
    _provider = None


def validate_audio(audio: bytes, mime_type: str) -> None:
    """Rejects an upload before any engine work is attempted."""
    if not audio:
        raise ServiceError("No audio was received.")

    if len(audio) > MAX_AUDIO_BYTES:
        raise ServiceError(
            f"The audio clip is too large ({len(audio) // 1024} KB). "
            f"The limit is {MAX_AUDIO_BYTES // (1024 * 1024)} MB — record a shorter answer."
        )

    # Browsers append codec parameters, e.g. `audio/webm;codecs=opus`.
    base_type = mime_type.split(";")[0].strip().lower()
    if base_type and base_type not in SUPPORTED_AUDIO_TYPES:
        raise ServiceError(
            f"'{mime_type}' is not a supported audio format. "
            f"Supported: {', '.join(sorted(SUPPORTED_AUDIO_TYPES))}."
        )
