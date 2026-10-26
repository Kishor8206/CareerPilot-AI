import type {
  RecognitionHandlers,
  RecognitionOptions,
  SpeakOptions,
  SpeechProvider,
  SpeechRecognitionSession,
  SpeechSynthesisProvider,
  SpeechVoice,
} from './types';
import { toRecognitionError } from './types';

/**
 * Browser-native speech, using the Web Speech API.
 *
 * This is the default path, and the better one where it exists: recognition is
 * instant, costs nothing, and the audio never leaves the device — so there is no
 * recording to consent to, store or delete.
 */

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

function getRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export class BrowserSpeechProvider implements SpeechProvider {
  readonly name = 'browser' as const;

  async isAvailable(): Promise<boolean> {
    return Boolean(getRecognitionConstructor());
  }

  /**
   * Checks the microphone permission without starting recognition.
   *
   * Worth doing separately: the Web Speech API reports a denied permission only
   * after a failed start, which shows the student a recording UI that was never
   * going to work.
   */
  async checkPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      return (status?.state as 'granted' | 'denied' | 'prompt') ?? 'unknown';
    } catch {
      // Firefox and Safari do not expose the microphone permission here.
      return 'unknown';
    }
  }

  async start(options: RecognitionOptions, handlers: RecognitionHandlers): Promise<SpeechRecognitionSession> {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      const error = {
        code: 'not-supported' as const,
        message: 'This browser does not support speech recognition. You can type your answer instead.',
        requiresUserAction: true,
      };
      handlers.onError(error);
      handlers.onEnd('error');
      throw new Error(error.message);
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = options.language;
    recognition.maxAlternatives = 1;

    let finalTranscript = '';
    let stopped = false;
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    // The mic stream is opened separately from recognition purely to drive the
    // input-level meter. Without a live level the student cannot tell whether
    // the browser is actually hearing them, which is the most common confusion.
    let levelStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let levelFrame: number | null = null;

    const clearTimers = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (maxTimer) clearTimeout(maxTimer);
      silenceTimer = null;
      maxTimer = null;
    };

    const teardownLevelMeter = () => {
      if (levelFrame !== null) cancelAnimationFrame(levelFrame);
      levelFrame = null;
      levelStream?.getTracks().forEach((track) => track.stop());
      levelStream = null;
      void audioContext?.close().catch(() => undefined);
      audioContext = null;
    };

    const finish = (reason: 'stopped' | 'silence' | 'error') => {
      if (stopped) return;
      stopped = true;

      clearTimers();
      teardownLevelMeter();
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
      handlers.onEnd(reason);
    };

    const resetSilenceTimer = () => {
      if (!options.silenceTimeoutMs) return;
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => finish('silence'), options.silenceTimeoutMs);
    };

    if (handlers.onLevel) {
      try {
        levelStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(levelStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(buffer);
          const average = buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
          handlers.onLevel?.(Math.min(1, average / 128));
          levelFrame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // The meter is a nicety; recognition proceeds without it.
        teardownLevelMeter();
      }
    }

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += `${chunk} `;
        else interim += chunk;
      }
      handlers.onUpdate({ final: finalTranscript.trimStart(), interim: interim.trim() });
      resetSilenceTimer();
    };

    recognition.onspeechstart = () => resetSilenceTimer();
    recognition.onspeechend = () => resetSilenceTimer();

    recognition.onerror = (event: any) => {
      const error = toRecognitionError(String(event.error));

      // `no-speech` fires routinely during natural pauses. Treating it as a hard
      // failure would end the answer every time the student stops to think.
      if (error.code === 'no-speech' && finalTranscript.trim()) {
        resetSilenceTimer();
        return;
      }
      if (error.code === 'aborted' && stopped) return;

      handlers.onError(error);
      finish('error');
    };

    recognition.onend = () => {
      // Chrome ends the session on its own after a pause. While the student is
      // still recording we restart it, so a thoughtful pause does not silently
      // cut their answer short.
      if (!stopped) {
        try {
          recognition.start();
          return;
        } catch {
          finish('stopped');
          return;
        }
      }
      clearTimers();
      teardownLevelMeter();
    };

    try {
      recognition.start();
    } catch (caught) {
      const error = toRecognitionError('unknown');
      handlers.onError(error);
      handlers.onEnd('error');
      teardownLevelMeter();
      throw caught;
    }

    resetSilenceTimer();
    if (options.maxDurationMs) {
      maxTimer = setTimeout(() => finish('silence'), options.maxDurationMs);
    }

    return {
      stop: () => finish('stopped'),
      abort: () => {
        stopped = true;
        clearTimers();
        teardownLevelMeter();
        try {
          recognition.abort();
        } catch {
          // Already aborted.
        }
      },
    };
  }
}

/**
 * Browser text-to-speech.
 *
 * Server-side TTS was deliberately not built: browser synthesis starts instantly,
 * costs nothing per question, works offline, and keeps the interview responsive.
 * The provider interface is here so a hosted voice could be added later without
 * touching any calling code.
 */
export class BrowserSpeechSynthesis implements SpeechSynthesisProvider {
  readonly name = 'browser';
  private current: SpeechSynthesisUtterance | null = null;

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  getVoices(): SpeechVoice[] {
    if (!this.isAvailable()) return [];

    return window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang.startsWith('en'))
      .map((voice) => ({
        id: voice.voiceURI,
        label: voice.name,
        lang: voice.lang,
        isDefault: voice.default,
      }));
  }

  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isAvailable()) {
        reject(new Error('Text-to-speech is not available in this browser.'));
        return;
      }

      const clean = stripForSpeech(text);
      if (!clean) {
        resolve();
        return;
      }

      // Chrome queues rather than replaces, so an un-cancelled previous
      // utterance would play the last three questions back to back.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = options.rate ?? 0.95;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;

      if (options.voiceId) {
        const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === options.voiceId);
        if (voice) utterance.voice = voice;
      }

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.current = null;
        fn();
      };

      utterance.onend = () => settle(resolve);
      utterance.onerror = (event) => {
        // Cancelling is a normal control action (replay, skip), not a failure.
        if (event.error === 'canceled' || event.error === 'interrupted') {
          settle(resolve);
          return;
        }
        settle(() => reject(new Error(`Speech playback failed: ${event.error}`)));
      };

      this.current = utterance;
      window.speechSynthesis.speak(utterance);

      // Chrome suspends synthesis after ~15s unless it is nudged. Without this
      // a long question stops halfway through with no error.
      const keepAlive = setInterval(() => {
        if (settled || !window.speechSynthesis.speaking) {
          clearInterval(keepAlive);
          return;
        }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }, 10_000);
    });
  }

  cancel(): void {
    if (this.isAvailable()) window.speechSynthesis.cancel();
    this.current = null;
  }

  pause(): void {
    if (this.isAvailable() && window.speechSynthesis.speaking) window.speechSynthesis.pause();
  }

  resume(): void {
    if (this.isAvailable() && window.speechSynthesis.paused) window.speechSynthesis.resume();
  }
}

/**
 * Makes generated text sound right when read aloud.
 *
 * Agent output occasionally carries markdown or symbols that a speech engine
 * pronounces literally ("asterisk", "O parenthesis n"), which is jarring in
 * what is meant to feel like a spoken interview.
 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\bO\(([^)]+)\)/g, 'order $1')
    .replace(/\s*[-–—]\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
