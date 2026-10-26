import { useCallback, useEffect, useRef, useState } from 'react';
import { getSynthesisProvider, type SpeechVoice } from '@/services/speech';
import { useVoiceStore } from '@/store/voice.store';

/**
 * Text-to-speech for AI interview questions (§11).
 *
 * Exposes exactly what an interview UI needs: speak, replay, stop, and a
 * `speaking` flag to drive the "AI is talking" state. Playback failures are
 * surfaced rather than swallowed — silent TTS looks like a frozen interview.
 */
export function useSpeechSynthesis() {
  const provider = getSynthesisProvider();
  const { voiceId, rate, speakEnabled, enabled } = useVoiceStore();

  const [supported] = useState(() => provider.isAvailable());
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Kept so "replay" works without the caller having to remember the text. */
  const lastSpokenRef = useRef<string>('');
  const activeRef = useRef(false);

  useEffect(() => {
    if (!supported) return;

    // Chrome populates voices asynchronously, so the first read is often empty.
    const load = () => setVoices(provider.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, [provider, supported]);

  const speak = useCallback(
    async (text: string, options?: { force?: boolean }) => {
      if (!text?.trim()) return;

      // Remember it even when muted, so enabling voice mid-interview can replay
      // the question the student is currently looking at.
      lastSpokenRef.current = text;

      const shouldSpeak = options?.force || (enabled && speakEnabled);
      if (!shouldSpeak || !supported) return;

      setError(null);
      setSpeaking(true);
      activeRef.current = true;

      try {
        await provider.speak(text, { voiceId: voiceId ?? undefined, rate });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? `${caught.message} You can still read the question on screen.`
            : 'Audio playback failed. You can still read the question on screen.',
        );
      } finally {
        activeRef.current = false;
        setSpeaking(false);
      }
    },
    [enabled, provider, rate, speakEnabled, supported, voiceId],
  );

  /** Re-reads the most recent utterance, ignoring the mute setting. */
  const replay = useCallback(async () => {
    if (!lastSpokenRef.current) return;
    await speak(lastSpokenRef.current, { force: true });
  }, [speak]);

  const stop = useCallback(() => {
    provider.cancel();
    activeRef.current = false;
    setSpeaking(false);
  }, [provider]);

  // Never let audio outlive the page the student navigated away from.
  useEffect(() => () => provider.cancel(), [provider]);

  return {
    supported,
    voices,
    speaking,
    error,
    speak,
    replay,
    stop,
    hasSpokenContent: Boolean(lastSpokenRef.current),
  };
}
