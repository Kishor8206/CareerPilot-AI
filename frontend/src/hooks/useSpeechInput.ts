import { useCallback, useEffect, useRef, useState } from 'react';
import {
  detectSpeechCapabilities,
  getRecognitionProvider,
  resetSpeechCapabilities,
  type RecognitionError,
  type SpeechCapabilities,
  type SpeechRecognitionSession,
} from '@/services/speech';
import { useVoiceStore } from '@/store/voice.store';

/**
 * Speech-to-text for spoken interview answers (§11).
 *
 * Delegates to the speech provider abstraction, so the browser Web Speech API
 * and the server-side Whisper fallback are interchangeable here. The transcript
 * is always editable before submission — recognition makes mistakes, and a
 * student should never be scored on a word they did not say.
 */
export interface UseSpeechInputOptions {
  /** Stop automatically after this much continuous silence. 0 disables. */
  silenceTimeoutMs?: number;
  /** Hard ceiling on one utterance, so a forgotten mic cannot run indefinitely. */
  maxDurationMs?: number;
  /** Fires with the completed transcript when recording stops naturally. */
  onFinal?: (transcript: string) => void;
}

export function useSpeechInput(options: UseSpeechInputOptions = {}) {
  const { silenceTimeoutMs = 6000, maxDurationMs = 180_000, onFinal } = options;
  const language = useVoiceStore((s) => s.language);

  const [capabilities, setCapabilities] = useState<SpeechCapabilities | null>(null);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<RecognitionError | null>(null);
  const [usedSpeech, setUsedSpeech] = useState(false);
  const [stoppedBySilence, setStoppedBySilence] = useState(false);

  const sessionRef = useRef<SpeechRecognitionSession | null>(null);
  const finalRef = useRef('');
  // Held in a ref so the provider callbacks always see the current handler
  // rather than the one captured when recording started.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    let cancelled = false;
    void detectSpeechCapabilities().then((caps) => {
      if (!cancelled) setCapabilities(caps);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (listening || starting) return;

    const caps = capabilities ?? (await detectSpeechCapabilities());
    setCapabilities(caps);

    if (!caps.recognition || !caps.provider) {
      setError({
        code: 'not-supported',
        message: caps.reason ?? 'Speech recognition is unavailable. You can type your answer instead.',
        requiresUserAction: true,
      });
      return;
    }

    setStarting(true);
    setError(null);
    setStoppedBySilence(false);
    setInterimTranscript('');

    try {
      const provider = getRecognitionProvider(caps.provider);
      const session = await provider.start(
        { language, silenceTimeoutMs, maxDurationMs },
        {
          onUpdate: ({ final, interim }) => {
            // The server provider delivers one final block; the browser streams.
            finalRef.current = final;
            setFinalTranscript(final);
            setInterimTranscript(interim);
            if (final || interim) setUsedSpeech(true);
          },
          onError: (recognitionError) => {
            setError(recognitionError);
            // A denied permission may have been granted since the last check.
            if (recognitionError.code === 'permission-denied') resetSpeechCapabilities();
          },
          onEnd: (reason) => {
            setListening(false);
            setInterimTranscript('');
            setLevel(0);
            if (reason === 'silence') setStoppedBySilence(true);
            if (reason !== 'error' && finalRef.current.trim()) {
              onFinalRef.current?.(finalRef.current.trim());
            }
          },
          onLevel: setLevel,
        },
      );

      sessionRef.current = session;
      setListening(true);
    } catch {
      // The provider has already reported a specific error through onError.
      setListening(false);
    } finally {
      setStarting(false);
    }
  }, [capabilities, language, listening, maxDurationMs, silenceTimeoutMs, starting]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
  }, []);

  /** Discards the in-flight recording without emitting a transcript. */
  const cancel = useCallback(() => {
    sessionRef.current?.abort();
    sessionRef.current = null;
    setListening(false);
    setInterimTranscript('');
    setLevel(0);
  }, []);

  /** Clears everything for a fresh answer. */
  const reset = useCallback(() => {
    cancel();
    finalRef.current = '';
    setFinalTranscript('');
    setInterimTranscript('');
    setUsedSpeech(false);
    setError(null);
    setStoppedBySilence(false);
  }, [cancel]);

  /** Lets the student correct a recognition mistake without losing the rest. */
  const setTranscript = useCallback((text: string) => {
    finalRef.current = text;
    setFinalTranscript(text);
  }, []);

  /**
   * Prompts for microphone access explicitly.
   *
   * Asking up front, on a button the student pressed, is far better than the
   * permission dialog appearing the instant recording starts.
   */
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      resetSpeechCapabilities();
      setCapabilities(await detectSpeechCapabilities(true));
      setError(null);
      return true;
    } catch {
      setError({
        code: 'permission-denied',
        message:
          'Microphone access was denied. Allow it from the icon in your browser address bar, then try again — or type your answer instead.',
        requiresUserAction: true,
      });
      return false;
    }
  }, []);

  // Always release the microphone when the component unmounts.
  useEffect(() => () => sessionRef.current?.abort(), []);

  return {
    /** Combined view for display: confirmed text plus the in-flight phrase. */
    transcript: [finalTranscript, interimTranscript].filter(Boolean).join(' ').trim(),
    finalTranscript,
    interimTranscript,
    listening,
    starting,
    level,
    error,
    usedSpeech,
    stoppedBySilence,
    capabilities,
    supported: capabilities?.recognition ?? false,
    liveTranscript: capabilities?.liveTranscript ?? false,
    providerName: capabilities?.provider ?? null,
    start,
    stop,
    cancel,
    reset,
    setTranscript,
    requestPermission,
  };
}
