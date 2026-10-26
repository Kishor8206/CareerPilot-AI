import type { Request, Response } from 'express';
import * as analyticsService from '../services/analytics.service';
import { AuditAction, audit } from '../services/audit.service';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

export const placementAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const filters = req.query as unknown as analyticsService.AnalyticsFilters;
  ok(res, await analyticsService.getPlacementAnalytics(filters));
});

export const cohortInsights = asyncHandler(async (req: Request, res: Response) => {
  const filters = req.query as unknown as analyticsService.AnalyticsFilters;
  ok(res, await analyticsService.getCohortInsights(filters, req.auth!.userId));
});

export const filterOptions = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await analyticsService.getFilterOptions());
});

/**
 * Research dataset export (§42).
 *
 * Pseudonymised and provenance-tagged. Every export is audited, because it is a
 * bulk read of student performance data.
 */
export const researchExport = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as analyticsService.AnalyticsFilters & { provenance?: string; format: 'json' | 'csv' };
  const rows = await analyticsService.buildResearchDataset(query);

  await audit(
    {
      action: AuditAction.DATA_EXPORT,
      resource: 'ResearchDataset',
      metadata: { rows: rows.length, format: query.format, filters: query },
    },
    req,
  );

  if (query.format === 'csv') {
    if (!rows.length) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send('');
      return;
    }

    const headers = Object.keys(rows[0]);
    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      // Quote anything containing a delimiter, quote or newline.
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const csv = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape((row as Record<string, unknown>)[h])).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="careerpilot-research-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
    return;
  }

  ok(res, {
    rows,
    meta: {
      count: rows.length,
      exportedAt: new Date().toISOString(),
      notice:
        'Records are pseudonymised: anonymousId is a one-way hash and no name, roll number or email is included. ' +
        'The provenance column distinguishes DEMO, SYNTHETIC and REAL records - these must never be mixed in analysis.',
    },
  });
});
