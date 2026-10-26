/**
 * Speech provider contract (§11 voice-assisted interviews).
 *
 * Nothing above this file knows whether recognition happens in the browser or
 * on the server, which is the same abstraction discipline the LLM layer uses.
 * Swapping the engine is a configuration change, not a rewrite.
 */

export type RecognitionErrorCode =
  | 'not-supported'
  | 'permission-denied'
  | 'no-microphone'
  | 'no-speech'
  | 'network'
  | 'aborted'
  | 'timeout'
  | 'service-unavailable'
  | 'unknown';

export interface RecognitionError {
  code: RecognitionErrorCode;
  /** Written to be shown to the student, and to name the way out. */
  message: string;
  /** False when the student can simply retry; true when they must act first. */
  requiresUserAction: boolean;
}

export interface RecognitionUpdate {
  /** Everything confirmed so far this session. */
  final: string;
  /** The in-flight phrase, not yet confirmed. Shown greyed so it reads as provisional. */
  interim: string;
}

export interface RecognitionHandlers {
  onUpdate(update: RecognitionUpdate): void;
  onError(error: RecognitionError): void;
  /** Fires when the engine stops, whether by request, silence or failure. */
  onEnd(reason: 'stopped' | 'silence' | 'error'): void;
  /** 0-1 input level, where the provider can measure it. Drives the level meter. */
  onLevel?(level: number): void;
}

export interface RecognitionOptions {
  language: string;
  /** Stop automatically after this many ms of continuous silence. 0 disables. */
  silenceTimeoutMs: number;
  /** Hard ceiling on a single utterance, so a forgotten mic cannot run forever. */
  maxDurationMs: number;
}

export interface SpeechRecognitionSession {
  stop(): void;
  /** Discards the session without emitting a final transcript. */
  abort(): void;
}

export interface SpeechProvider {
  readonly name: 'browser' | 'server';
  /** Whether this provider can run at all in the current environment. */
  isAvailable(): Promise<boolean>;
  start(options: RecognitionOptions, handlers: RecognitionHandlers): Promise<SpeechRecognitionSession>;
}

/* ------------------------------------------------------------------ */
/* Text-to-speech                                                      */
/* ------------------------------------------------------------------ */

export interface SpeechVoice {
  id: string;
  label: string;
  lang: string;
  isDefault: boolean;
}

export interface SpeakOptions {
  voiceId?: string;
  /** 0.5-2. Interview questions read better slightly below conversational pace. */
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface SpeechSynthesisProvider {
  readonly name: string;
  isAvailable(): boolean;
  getVoices(): SpeechVoice[];
  /** Resolves when playback finishes; rejects if it fails. */
  speak(text: string, options?: SpeakOptions): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

/** Maps a raw engine error onto our vocabulary, with a way out for the student. */
export function toRecognitionError(raw: string): RecognitionError {
  const table: Record<string, RecognitionError> = {
    'not-allowed': {
      code: 'permission-denied',
      message:
        'Microphone access is blocked. Allow it from the icon in your browser address bar, then try again — or type your answer instead.',
      requiresUserAction: true,
    },
    'service-not-allowed': {
      code: 'permission-denied',
      message: 'Your browser blocked speech recognition. You can type your answer instead.',
      requiresUserAction: true,
    },
    'audio-capture': {
      code: 'no-microphone',
      message: 'No microphone was found. Connect one and try again, or type your answer.',
      requiresUserAction: true,
    },
    'no-speech': {
      code: 'no-speech',
      message: 'No speech was detected. Move a little closer to the microphone and try again.',
      requiresUserAction: false,
    },
    network: {
      code: 'network',
      message: 'Speech recognition lost its network connection. Check your connection and try again, or type your answer.',
      requiresUserAction: false,
    },
    aborted: {
      code: 'aborted',
      message: 'Recording stopped.',
      requiresUserAction: false,
    },
  };

  return (
    table[raw] ?? {
      code: 'unknown',
      message: 'Speech recognition stopped unexpectedly. You can try again, or type your answer.',
      requiresUserAction: false,
    }
  );
}
