import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

/** Assigns a correlation id and echoes it so clients can quote it in support. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}

/** Minimal API-latency logging (§38). */
export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.record(req.method, req.route?.path ?? req.path, res.statusCode, durationMs);
    if (durationMs > 2000) {
      logger.warn(
        { requestId: req.requestId, method: req.method, url: req.originalUrl, durationMs: Math.round(durationMs) },
        'Slow request',
      );
    }
  });
  next();
}

interface RouteMetric {
  count: number;
  totalMs: number;
  maxMs: number;
  errors: number;
}

/**
 * In-process metrics registry. Deliberately simple: it backs `/health` and the
 * admin dashboard without adding a Prometheus dependency to an academic build.
 * Swap for a real exporter in production.
 */
class MetricsRegistry {
  private routes = new Map<string, RouteMetric>();
  private startedAt = Date.now();

  record(method: string, path: string, status: number, durationMs: number) {
    const key = `${method} ${path}`;
    const entry = this.routes.get(key) ?? { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
    entry.count += 1;
    entry.totalMs += durationMs;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
    if (status >= 500) entry.errors += 1;
    this.routes.set(key, entry);
  }

  snapshot() {
    const routes = [...this.routes.entries()]
      .map(([route, m]) => ({
        route,
        count: m.count,
        avgMs: Math.round((m.totalMs / m.count) * 100) / 100,
        maxMs: Math.round(m.maxMs * 100) / 100,
        errors: m.errors,
      }))
      .sort((a, b) => b.count - a.count);

    const totals = routes.reduce(
      (acc, r) => ({ requests: acc.requests + r.count, errors: acc.errors + r.errors }),
      { requests: 0, errors: 0 },
    );

    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      totalRequests: totals.requests,
      totalErrors: totals.errors,
      errorRate: totals.requests ? Math.round((totals.errors / totals.requests) * 10000) / 100 : 0,
      topRoutes: routes.slice(0, 25),
    };
  }

  reset() {
    this.routes.clear();
  }
}

export const metrics = new MetricsRegistry();
