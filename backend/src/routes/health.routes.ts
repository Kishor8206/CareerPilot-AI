import { Router } from 'express';
import type { SystemHealthDto } from '@careerpilot/shared';
import { databaseInfo, pingDatabase } from '../config/database';
import { env } from '../config/env';
import { metrics } from '../middleware/requestContext';
import { aiClient } from '../services/aiClient.service';
import { connectedUserCount } from '../sockets/emitter';
import { asyncHandler } from '../utils/asyncHandler';

export const healthRouter = Router();

/**
 * Observability endpoints (§38).
 *
 * `/health` aggregates every dependency and returns 503 when a critical one is
 * down, so container orchestrators restart the process rather than routing
 * traffic to a broken instance. The AI service is treated as non-critical:
 * the platform stays usable (dashboards, profiles, scheduling) without it.
 */
healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [db, ai] = await Promise.all([pingDatabase(), aiClient.health()]);

    const checks: SystemHealthDto['checks'] = [
      {
        name: 'database',
        status: db.ok ? 'OK' : 'DOWN',
        latencyMs: db.latencyMs,
        detail: db.detail ?? (databaseInfo().inMemory ? 'in-memory instance (development)' : undefined),
      },
      {
        name: 'ai-service',
        status: ai.ok ? 'OK' : 'DOWN',
        latencyMs: ai.latencyMs,
        detail: ai.ok ? undefined : `${ai.detail} - AI features are unavailable; the rest of the platform works.`,
      },
      { name: 'realtime', status: 'OK', detail: `${connectedUserCount()} connected socket(s)` },
    ];

    const status: SystemHealthDto['status'] = !db.ok ? 'DOWN' : ai.ok ? 'OK' : 'DEGRADED';

    const payload: SystemHealthDto = {
      status,
      uptimeSeconds: Math.round(process.uptime()),
      version: env.VERSION,
      environment: env.NODE_ENV,
      checks,
      timestamp: new Date().toISOString(),
    };

    res.status(status === 'DOWN' ? 503 : 200).json({ success: true, data: payload });
  }),
);

healthRouter.get(
  '/db',
  asyncHandler(async (_req, res) => {
    const ping = await pingDatabase();
    res.status(ping.ok ? 200 : 503).json({
      success: ping.ok,
      data: { ...databaseInfo(), latencyMs: ping.latencyMs, detail: ping.detail },
    });
  }),
);

healthRouter.get(
  '/ai',
  asyncHandler(async (_req, res) => {
    const health = await aiClient.health();
    res.status(health.ok ? 200 : 503).json({
      success: health.ok,
      data: {
        url: env.AI_SERVICE_URL,
        reachable: health.ok,
        latencyMs: health.latencyMs,
        detail: health.detail,
        service: health.body,
      },
    });
  }),
);

/** Lightweight liveness probe: no dependencies touched. */
healthRouter.get('/live', (_req, res) => {
  res.json({ success: true, data: { alive: true, uptimeSeconds: Math.round(process.uptime()) } });
});

/** Request/latency counters backing the admin dashboard. */
healthRouter.get('/metrics', (_req, res) => {
  res.json({ success: true, data: metrics.snapshot() });
});
