import type { NextFunction, Request, Response } from 'express';

const MAX_DEPTH = 12;

/**
 * Strips MongoDB operator keys (`$gt`, `$where`) and dotted paths from
 * user-supplied objects, blocking NoSQL-injection payloads such as
 * `{"email": {"$ne": null}}`.
 *
 * `mongoose.set('sanitizeFilter')` covers query filters; this covers documents
 * we build from request bodies.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = scrub(val, depth + 1);
  }
  return out;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = scrub(req.body) as Record<string, unknown>;
  }
  if (req.query && typeof req.query === 'object') {
    const cleaned = scrub(req.query);
    Object.defineProperty(req, 'query', { value: cleaned, writable: true, configurable: true });
  }
  if (req.params && typeof req.params === 'object') {
    req.params = scrub(req.params) as Record<string, string>;
  }
  next();
}

/**
 * Removes ASCII control characters that would corrupt logs, PDFs or downstream
 * parsers. Tab, newline and carriage return are preserved.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');

export function stripControlCharacters(input: string): string {
  return input.replace(CONTROL_CHARS, '');
}
