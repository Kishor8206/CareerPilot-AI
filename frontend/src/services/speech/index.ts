import { BrowserSpeechProvider, BrowserSpeechSynthesis } from './browserSpeech';
import { ServerSpeechProvider } from './serverSpeech';
import type { SpeechProvider, SpeechSynthesisProvider } from './types';

export * from './types';
export { BrowserSpeechProvider, BrowserSpeechSynthesis, stripForSpeech } from './browserSpeech';
export { ServerSpeechProvider } from './serverSpeech';

const browserProvider = new BrowserSpeechProvider();
const serverProvider = new ServerSpeechProvider();
const synthesis = new BrowserSpeechSynthesis();

export interface SpeechCapabilities {
  recognition: boolean;
  synthesis: boolean;
  provider: 'browser' | 'server' | null;
  /** True when the provider streams an interim transcript as the student speaks. */
  liveTranscript: boolean;
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
  /** Why voice is unavailable, when it is. */
  reason?: string;
}

let cached: SpeechCapabilities | null = null;

/**
 * Resolves which speech path this browser can actually use.
 *
 * Browser recognition is preferred: it is instant, free, gives a live interim
 * transcript, and keeps audio on the device. The server provider is the
 * fallback for browsers without the Web Speech API, and is only offered when the
 * deployment actually has a transcription engine configured.
 */
export async function detectSpeechCapabilities(force = false): Promise<SpeechCapabilities> {
  if (cached && !force) return cached;

  const synthesisAvailable = synthesis.isAvailable();
  const permission = await browserProvider.checkPermission();

  if (await browserProvider.isAvailable()) {
    cached = {
      recognition: true,
      synthesis: synthesisAvailable,
      provider: 'browser',
      liveTranscript: true,
      permission,
    };
    return cached;
  }

  if (await serverProvider.isAvailable()) {
    cached = {
      recognition: true,
      synthesis: synthesisAvailable,
      provider: 'server',
      // Server transcription runs once the clip is complete, so there is no
      // interim text. The UI says so rather than appearing frozen.
      liveTranscript: false,
      permission,
    };
    return cached;
  }

  cached = {
    recognition: false,
    synthesis: synthesisAvailable,
    provider: null,
    liveTranscript: false,
    permission,
    reason:
      'This browser does not support speech recognition, and server transcription is not configured on this deployment. You can type your answers instead.',
  };
  return cached;
}

export function getRecognitionProvider(name: 'browser' | 'server'): SpeechProvider {
  return name === 'server' ? serverProvider : browserProvider;
}

export function getSynthesisProvider(): SpeechSynthesisProvider {
  return synthesis;
}

/** Clears the capability cache, e.g. after the student grants permission. */
export function resetSpeechCapabilities(): void {
  cached = null;
}
