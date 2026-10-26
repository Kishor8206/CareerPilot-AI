import FormData from 'form-data';
import type { Request, Response } from 'express';
import { AgentName } from '@careerpilot/shared';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { aiClient } from '../services/aiClient.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

const log = moduleLogger('speech');

/**
 * Server-side speech-to-text fallback (§11).
 *
 * The browser's Web Speech API is the primary path and keeps audio on the
 * student's device. This route exists for browsers without that API, so those
 * students still get voice input rather than being silently downgraded.
 *
 * Audio is proxied straight through to the AI service, transcribed in memory
 * and discarded. Nothing is written to storage, and no transcript is cached.
 */

/** Tells the client which speech path to use before it records anything. */
export const status = asyncHandler(async (_req: Request, res: Response) => {
  try {
    const result = await aiClient.get<Record<string, unknown>>('/ai/speech/status');
    ok(res, { ...result, serverTranscription: result.available === true });
  } catch {
    // The AI service being down must not break voice: the browser path still
    // works, so report unavailability rather than an error.
    ok(res, {
      provider: 'none',
      available: false,
      serverTranscription: false,
      detail: 'The AI service is unreachable, so server transcription is unavailable. Browser speech recognition still works.',
    });
  }
});

export const transcribe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest('No audio was received. Attach a recording in the "audio" field.');
  }

  const language = typeof req.body?.language === 'string' ? req.body.language.slice(0, 12) : 'en-IN';

  const form = new FormData();
  form.append('audio', req.file.buffer, {
    filename: req.file.originalname || 'utterance.webm',
    contentType: req.file.mimetype,
  });
  form.append('language', language);

  const started = Date.now();
  const response = await fetch(`${env.AI_SERVICE_URL}/ai/speech/transcribe`, {
    method: 'POST',
    headers: {
      ...form.getHeaders(),
      'X-Internal-Key': env.AI_SERVICE_INTERNAL_KEY,
    },
    body: form.getBuffer(),
    signal: AbortSignal.timeout(env.AI_SERVICE_TIMEOUT_MS),
  }).catch((error: Error) => {
    log.warn({ err: error.message }, 'Speech transcription request failed');
    throw ApiError.serviceUnavailable(
      'The transcription service could not be reached. Your recording was not lost — you can type your answer instead.',
    );
  });

  const body = (await response.json().catch(() => null)) as
    | { success?: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }
    | null;

  if (!response.ok || !body?.success) {
    const detail = body?.error;
    throw new ApiError(
      response.status === 503 ? 503 : 502,
      detail?.code ?? 'SPEECH_TRANSCRIPTION_FAILED',
      detail?.message ?? 'The recording could not be transcribed. You can type your answer instead.',
    );
  }

  log.info(
    { chars: String(body.data?.text ?? '').length, latencyMs: Date.now() - started, language },
    'Audio transcribed',
  );

  ok(res, body.data);
});

export { AgentName };
