import pino from 'pino';
import { env } from './env';

/**
 * Structured application logger (§38).
 * Pretty-printed in development, newline-delimited JSON everywhere else so log
 * shippers (Loki, CloudWatch, ELK) can index fields directly.
 */
const usePretty = env.LOG_PRETTY && !env.isProd;

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'careerpilot-backend', env: env.NODE_ENV, version: env.VERSION },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.refreshToken',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,env,version' },
        },
      }
    : {}),
});

/** Child logger for a specific subsystem, e.g. `moduleLogger('apie')`. */
export const moduleLogger = (module: string) => logger.child({ module });
