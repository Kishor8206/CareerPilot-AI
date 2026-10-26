"""Speech endpoints (§33): server-side transcription fallback.

This is a *fallback*, not the primary path. The frontend uses the browser's
Web Speech API by default, which keeps audio on the student's device. These
endpoints exist so browsers without that API (Firefox, some managed browsers)
still get voice input rather than being silently downgraded to text-only.

Audio is transcribed in memory and discarded. Nothing is stored.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Form, UploadFile

from app.core.errors import success_response
from app.core.logging import get_logger
from app.services.speech import get_speech_provider, validate_audio

log = get_logger(__name__)

router = APIRouter(prefix="/ai/speech", tags=["speech"])


@router.get("/status")
async def speech_status() -> dict[str, Any]:
    """Whether server transcription is available, so the client can pick a path."""
    provider = get_speech_provider()
    return success_response(
        {
            **provider.status(),
            "maxAudioBytes": 12 * 1024 * 1024,
            "notice": (
                "Server-side transcription is a fallback for browsers without the Web Speech API. "
                "Audio is transcribed in memory and never stored."
            ),
        }
    )


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form("en-IN"),
) -> dict[str, Any]:
    """Transcribes one short utterance (an interview answer)."""
    data = await audio.read()
    validate_audio(data, audio.content_type or "")

    provider = get_speech_provider()
    result = provider.transcribe(data, mime_type=audio.content_type or "", language=language)

    return success_response(
        {
            "text": result.text,
            "language": result.language,
            "durationSeconds": result.duration_seconds,
            "confidence": result.confidence,
            "segments": result.segments,
            # An empty transcript is a real outcome (silence, or unintelligible
            # audio) and must be reported as such rather than as a failure, so
            # the UI can say "no speech detected" instead of "something broke".
            "empty": not result.text.strip(),
        },
        {
            "provider": result.provider,
            "model": result.model,
            "latencyMs": result.latency_ms,
        },
    )
