import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { globalLimiter } from './middleware/rateLimit';
import { requestId, requestTiming } from './middleware/requestContext';
import { sanitizeInput } from './middleware/sanitize';
import { buildApiRouter } from './routes';
import { healthRouter } from './routes/health.routes';

export function createApp(): Express {
  const app = express();

  // Behind a load balancer the real client IP arrives in X-Forwarded-For; this
  // makes rate limiting and audit logs accurate. `1` = trust one proxy hop.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /* ---- Security headers (§29) ---- */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", ...env.CORS_ORIGINS],
          mediaSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // would block the WebRTC media pipeline
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests and server-to-server calls have no Origin header.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not permitted by the CORS policy.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 86_400,
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  app.use(requestId);
  app.use(requestTiming);
  app.use(sanitizeInput);

  /* ---- Health probes: outside the rate limiter so monitors never trip it ---- */
  app.use('/health', healthRouter);

  app.use(env.API_PREFIX, globalLimiter, buildApiRouter());

  // Locally stored reports/resumes are streamed through authenticated routes;
  // the storage directory itself is never served statically.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: env.APP_NAME,
        version: env.VERSION,
        environment: env.NODE_ENV,
        api: env.API_PREFIX,
        docs: '/docs/API.md',
        health: '/health',
      },
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const STORAGE_ROOT = path.resolve(env.STORAGE_LOCAL_PATH);
