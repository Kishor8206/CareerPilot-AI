import type { Response } from 'express';
import type { PaginationMeta } from '@careerpilot/shared';

/** Standard success envelope used by every controller (§37). */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  return res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function noContent(res: Response) {
  return res.status(204).send();
}

export function paginated<T>(res: Response, items: T[], meta: PaginationMeta, extra?: Record<string, unknown>) {
  return res.status(200).json({ success: true, data: items, meta: { ...meta, ...extra } });
}

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}
