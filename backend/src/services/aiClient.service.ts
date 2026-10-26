import axios, { AxiosError, type AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { ErrorCode, type AgentName } from '@careerpilot/shared';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { AIInteraction } from '../models/AIInteraction';
import { ApiError } from '../utils/ApiError';

const log = moduleLogger('ai-client');

export interface AiCallContext {
  userId?: string | null;
  studentId?: string | null;
  agent: AgentName | string;
  operation: string;
}

export interface AiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: {
    provider?: string;
    model?: string;
    latencyMs?: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    ragSourceCount?: number;
    degraded?: boolean;
    notice?: string;
  };
  error?: { code: string; message: string };
}

/**
 * Typed client for the Python AI service (§3).
 *
 * Responsibilities kept here rather than in each caller:
 *  - internal shared-secret authentication
 *  - correlation ids for cross-service tracing
 *  - retry with backoff for transient failures only
 *  - persisting an `AIInteraction` observability record for every call
 *  - turning transport errors into user-safe `ApiError`s
 */
class AiClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: env.AI_SERVICE_URL,
      timeout: env.AI_SERVICE_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        // Shared secret; the FastAPI service rejects calls without it.
        'X-Internal-Key': env.AI_SERVICE_INTERNAL_KEY,
      },
      // Large resume texts and interview transcripts.
      maxContentLength: 20 * 1024 * 1024,
      maxBodyLength: 20 * 1024 * 1024,
    });
  }

  /** Only idempotent, transient failures are retried. */
  private shouldRetry(error: AxiosError, attempt: number): boolean {
    if (attempt >= 2) return false;
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    const status = error.response?.status;
    return status === 502 || status === 503 || status === 504;
  }

  async post<TReq extends object, TRes>(
    path: string,
    payload: TReq,
    context: AiCallContext,
  ): Promise<{ data: TRes; meta: AiEnvelope<TRes>['meta'] }> {
    const correlationId = randomUUID();
    const started = Date.now();
    const inputBytes = Buffer.byteLength(JSON.stringify(payload));
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const response = await this.http.post<AiEnvelope<TRes>>(path, payload, {
          headers: { 'X-Correlation-Id': correlationId },
        });
        const body = response.data;

        if (!body?.success) {
          throw new ApiError(
            502,
            body?.error?.code ?? ErrorCode.AI_RESPONSE_INVALID,
            body?.error?.message ?? 'The AI service returned an unsuccessful response.',
          );
        }

        const latencyMs = Date.now() - started;
        void this.record({
          context,
          correlationId,
          status: 'SUCCESS',
          latencyMs,
          inputBytes,
          outputBytes: Buffer.byteLength(JSON.stringify(body.data ?? {})),
          meta: body.meta,
        });

        return { data: body.data, meta: body.meta };
      } catch (error) {
        if (error instanceof ApiError) {
          void this.record({
            context,
            correlationId,
            status: 'VALIDATION_ERROR',
            latencyMs: Date.now() - started,
            inputBytes,
            outputBytes: 0,
            error: error.message,
          });
          throw error;
        }

        const axiosError = error as AxiosError<{ error?: { code: string; message: string } }>;
        attempt += 1;
        if (this.shouldRetry(axiosError, attempt)) {
          const backoff = 300 * 2 ** (attempt - 1);
          log.warn({ path, attempt, backoff, code: axiosError.code }, 'Retrying AI service call');
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        const detail = axiosError.response?.data?.error;
        void this.record({
          context,
          correlationId,
          status: 'FAILED',
          latencyMs: Date.now() - started,
          inputBytes,
          outputBytes: 0,
          error: detail?.message ?? axiosError.message,
        });

        log.error(
          { err: axiosError.message, path, status: axiosError.response?.status, correlationId },
          'AI service call failed',
        );

        if (detail?.code) {
          throw new ApiError(502, detail.code, detail.message);
        }
        throw ApiError.serviceUnavailable(
          'The AI analysis service is currently unreachable. Your data is safe - please try again in a moment.',
          ErrorCode.AI_SERVICE_UNAVAILABLE,
          error,
        );
      }
    }
  }

  async get<TRes>(path: string, params?: Record<string, unknown>): Promise<TRes> {
    const response = await this.http.get<AiEnvelope<TRes>>(path, { params });
    if (!response.data?.success) {
      throw new ApiError(502, ErrorCode.AI_RESPONSE_INVALID, 'The AI service returned an unsuccessful response.');
    }
    return response.data.data;
  }

  private async record(input: {
    context: AiCallContext;
    correlationId: string;
    status: 'SUCCESS' | 'FAILED' | 'VALIDATION_ERROR';
    latencyMs: number;
    inputBytes: number;
    outputBytes: number;
    error?: string;
    meta?: AiEnvelope<unknown>['meta'];
  }) {
    try {
      await AIInteraction.create({
        userId: input.context.userId ?? null,
        studentId: input.context.studentId ?? null,
        agent: input.context.agent,
        operation: input.context.operation,
        status: input.status,
        provider: input.meta?.provider ?? env.AI_PROVIDER,
        modelName: input.meta?.model,
        latencyMs: input.latencyMs,
        tokensPrompt: input.meta?.tokensPrompt,
        tokensCompletion: input.meta?.tokensCompletion,
        inputBytes: input.inputBytes,
        outputBytes: input.outputBytes,
        error: input.error ?? null,
        correlationId: input.correlationId,
        ragSourceCount: input.meta?.ragSourceCount ?? 0,
      });
    } catch (error) {
      log.warn({ err: error }, 'Failed to record AI interaction');
    }
  }

  /** Liveness/readiness probe backing `/health/ai`. */
  async health(): Promise<{ ok: boolean; latencyMs: number; detail?: string; body?: unknown }> {
    const start = Date.now();
    try {
      const response = await this.http.get('/health', { timeout: 5000 });
      return { ok: true, latencyMs: Date.now() - start, body: response.data };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        detail: error instanceof Error ? error.message : 'unknown error',
      };
    }
  }
}

export const aiClient = new AiClient();
