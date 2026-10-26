"""Voice-assisted interview tests (§11).

Server transcription must report honestly when it is not configured, so the
frontend can keep using browser recognition instead of showing a broken mic.
"""
from __future__ import annotations

import pytest


class TestSpeechProvider:
    def test_defaults_to_no_server_transcription(self):
        from app.services.speech import NullSpeechProvider, get_speech_provider, reset_speech_provider

        reset_speech_provider()
        provider = get_speech_provider()
        assert isinstance(provider, NullSpeechProvider)
        assert provider.available is False

    def test_unconfigured_provider_explains_itself_rather_than_returning_empty_text(self):
        from app.services.speech import NullSpeechProvider, SpeechUnavailable

        provider = NullSpeechProvider()
        with pytest.raises(SpeechUnavailable) as exc:
            provider.transcribe(b"audio", mime_type="audio/webm", language="en")

        # Empty text would look to the student like "you said nothing".
        assert "not configured" in str(exc.value).lower()
        assert "browser" in str(exc.value).lower()

    def test_status_names_the_browser_fallback(self):
        from app.services.speech import NullSpeechProvider

        status = NullSpeechProvider().status()
        assert status["available"] is False
        assert "device" in status["detail"].lower()

    def test_rejects_empty_audio(self):
        from app.core.errors import ServiceError
        from app.services.speech import validate_audio

        with pytest.raises(ServiceError, match="No audio"):
            validate_audio(b"", "audio/webm")

    def test_rejects_oversized_audio(self):
        from app.core.errors import ServiceError
        from app.services.speech import MAX_AUDIO_BYTES, validate_audio

        with pytest.raises(ServiceError, match="too large"):
            validate_audio(b"x" * (MAX_AUDIO_BYTES + 1), "audio/webm")

    def test_accepts_browser_codec_parameters(self):
        from app.services.speech import validate_audio

        # Browsers send `audio/webm;codecs=opus`; rejecting that would break
        # every Chrome recording.
        validate_audio(b"x" * 2048, "audio/webm;codecs=opus")

    def test_rejects_a_non_audio_mime_type(self):
        from app.core.errors import ServiceError
        from app.services.speech import validate_audio

        with pytest.raises(ServiceError, match="not a supported audio format"):
            validate_audio(b"x" * 2048, "application/x-msdownload")


class TestSpeechApi:
    def test_status_requires_the_internal_key(self, client):
        assert client.get("/ai/speech/status").status_code == 401

    def test_status_reports_availability(self, client, internal_headers):
        response = client.get("/ai/speech/status", headers=internal_headers)
        assert response.status_code == 200

        data = response.json()["data"]
        assert data["available"] is False
        assert "never stored" in data["notice"].lower()

    def test_transcribe_reports_unavailability_with_a_usable_message(self, client, internal_headers):
        response = client.post(
            "/ai/speech/transcribe",
            headers=internal_headers,
            files={"audio": ("utterance.webm", b"x" * 4096, "audio/webm")},
            data={"language": "en-IN"},
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "SPEECH_PROVIDER_UNAVAILABLE"
