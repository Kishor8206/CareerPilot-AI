import rateLimit, { type Options } from 'express-rate-limit';
import { ErrorCode } from '@careerpilot/shared';
import { env } from '../config/env';

function build(max: number, windowMs: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Rate limiting would make the test suite flaky and non-deterministic.
    skip: () => env.isTest,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code: ErrorCode.RATE_LIMITED, message } });
    },
    ...extra,
  });
}

/** Broad limiter applied to the whole API surface. */
export const globalLimiter = build(
  env.RATE_LIMIT_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many requests from this client. Please wait a moment and try again.',
);

/** Strict limiter for credential endpoints, to slow brute-force attempts. */
export const authLimiter = build(
  env.AUTH_RATE_LIMIT_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many authentication attempts. Please wait 15 minutes before trying again.',
  { skipSuccessfulRequests: true },
);

/** AI endpoints are expensive; keep a per-user ceiling. */
export const aiLimiter = build(
  60,
  10 * 60_000,
  'You have reached the AI usage limit for now. Please wait a few minutes before requesting more AI analysis.',
  { keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anonymous' },
);

/** Each run or submit starts a sandbox, so executions are capped per user. */
export const codeRunLimiter = build(
  40,
  5 * 60_000,
  'You are running code too quickly. Please wait a moment before trying again.',
  { keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anonymous' },
);

/** Upload endpoints: low ceiling, since each upload triggers parsing work. */
export const uploadLimiter = build(
  20,
  60 * 60_000,
  'You have reached the hourly upload limit. Please try again later.',
  { keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anonymous' },
);
