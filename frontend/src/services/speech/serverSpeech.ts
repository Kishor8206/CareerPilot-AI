import { http } from '@/services/api';
import type {
  RecognitionHandlers,
  RecognitionOptions,
  SpeechProvider,
  SpeechRecognitionSession,
} from './types';

/**
 * Server-side recognition, for browsers without the Web Speech API.
 *
 * Records with MediaRecorder, then posts one clip to the backend, which proxies
 * it to the AI service for transcription. The clip is held in memory and
 * discarded after transcription; nothing is stored.
 *
 * The trade-off against the browser provider is deliberate and visible in the
 * UI: there is no live interim transcript, because the audio is only transcribed
 * once recording stops. Firefox users get working voice input rather than none.
 */
export class ServerSpeechProvider implements SpeechProvider {
  readonly name = 'server' as const;
  private availability: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availability !== null) return this.availability;

    // Both halves must work: the browser must be able to record, and the
    // deployment must actually have a transcription engine configured.
    const canRecord =
      typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    if (!canRecord) {
      this.availability = false;
      return false;
    }

    try {
      const response = await http.get('/speech/status');
      this.availability = response.data?.data?.serverTranscription === true;
    } catch {
      this.availability = false;
    }
    return this.availability;
  }

  async start(options: RecognitionOptions, handlers: RecognitionHandlers): Promise<SpeechRecognitionSession> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (caught) {
      const name = (caught as DOMException).name;
      handlers.onError({
        code: name === 'NotAllowedError' ? 'permission-denied' : 'no-microphone',
        message:
          name === 'NotAllowedError'
            ? 'Microphone access was denied. Allow it from your browser address bar, or type your answer instead.'
            : 'No microphone was found. Connect one and try again, or type your answer.',
        requiresUserAction: true,
      });
      handlers.onEnd('error');
      throw caught;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((type) => MediaRecorder.isTypeSupported(type)) ?? '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    let stopped = false;
    let aborted = false;
    // No silence *timer* here: without the Web Speech API's `onspeechend` there
    // is nothing to schedule against, so silence is measured from the analyser
    // level in `tick()` below instead.
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let levelFrame: number | null = null;
    let audioContext: AudioContext | null = null;

    const cleanup = () => {
      if (maxTimer) clearTimeout(maxTimer);
      if (levelFrame !== null) cancelAnimationFrame(levelFrame);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext?.close().catch(() => undefined);
    };

    // Level meter, and silence detection built on top of it: without the Web
    // Speech API there is no `onspeechend`, so silence has to be measured.
    if (handlers.onLevel || options.silenceTimeoutMs) {
      try {
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const buffer = new Uint8Array(analyser.frequencyBinCount);
        let lastSound = Date.now();

        const tick = () => {
          analyser.getByteFrequencyData(buffer);
          const average = buffer.reduce((sum, v) => sum + v, 0) / buffer.length;
          const level = Math.min(1, average / 128);
          handlers.onLevel?.(level);

          if (level > 0.06) lastSound = Date.now();
          if (options.silenceTimeoutMs && Date.now() - lastSound > options.silenceTimeoutMs && !stopped) {
            stopRecording('silence');
            return;
          }
          levelFrame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // Proceed without metering.
      }
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    let endReason: 'stopped' | 'silence' | 'error' = 'stopped';

    recorder.onstop = async () => {
      cleanup();

      if (aborted) return;

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 1024) {
        handlers.onError({
          code: 'no-speech',
          message: 'No speech was detected. Try again, speaking a little closer to the microphone.',
          requiresUserAction: false,
        });
        handlers.onEnd('error');
        return;
      }

      try {
        const form = new FormData();
        form.append('audio', blob, 'utterance.webm');
        form.append('language', options.language);

        const response = await http.post('/speech/transcribe', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        const text = String(response.data?.data?.text ?? '').trim();
        if (!text) {
          handlers.onError({
            code: 'no-speech',
            message: 'Nothing intelligible was picked up. Try again, or type your answer.',
            requiresUserAction: false,
          });
          handlers.onEnd('error');
          return;
        }

        handlers.onUpdate({ final: text, interim: '' });
        handlers.onEnd(endReason);
      } catch (caught) {
        const message =
          (caught as { message?: string })?.message ??
          'The recording could not be transcribed. You can type your answer instead.';
        handlers.onError({ code: 'service-unavailable', message, requiresUserAction: false });
        handlers.onEnd('error');
      }
    };

    function stopRecording(reason: 'stopped' | 'silence') {
      if (stopped) return;
      stopped = true;
      endReason = reason;
      if (recorder.state !== 'inactive') recorder.stop();
    }

    recorder.start();

    if (options.maxDurationMs) {
      maxTimer = setTimeout(() => stopRecording('silence'), options.maxDurationMs);
    }

    return {
      stop: () => stopRecording('stopped'),
      abort: () => {
        aborted = true;
        stopped = true;
        if (recorder.state !== 'inactive') recorder.stop();
        cleanup();
      },
    };
  }
}
