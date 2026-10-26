import crypto from 'node:crypto';
import { SCORE_MAX, SCORE_MIN } from '@careerpilot/shared';

/** Clamp a numeric score into the canonical 0-100 range. */
export function clampScore(value: number, min = SCORE_MIN, max = SCORE_MAX): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function average(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Percentage of `part` relative to `total`, safe against divide-by-zero. */
export function percentage(part: number, total: number, decimals = 1): number {
  if (!total) return 0;
  return round((part / total) * 100, decimals);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Case/punctuation-insensitive skill key so "Node.js" === "nodejs" === "node js". */
export function normalizeSkill(skill: string): string {
  return skill.toLowerCase().replace(/[^a-z0-9+#]/g, '');
}

export function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function uniqueStrings(items: string[]): string[] {
  return uniqueBy(items.filter(Boolean), (s) => normalizeSkill(s));
}

/** Overlap of two skill lists, matched on the normalised key. */
export function skillIntersection(a: string[], b: string[]): string[] {
  const bSet = new Set(b.map(normalizeSkill));
  return uniqueStrings(a.filter((s) => bSet.has(normalizeSkill(s))));
}

export function skillDifference(a: string[], b: string[]): string[] {
  const bSet = new Set(b.map(normalizeSkill));
  return uniqueStrings(a.filter((s) => !bSet.has(normalizeSkill(s))));
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** One-way hash used for refresh tokens and reset tokens stored at rest. */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Parse "15m" / "7d" / "3600" style durations into milliseconds. */
export function parseDuration(value: string, fallbackMs: number): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const factor: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (factor[unit] ?? 1);
}

/**
 * Deterministic pseudo-random generator seeded by a string. Used wherever demo
 * content must be stable across restarts (seeded data, mock AI provider) so the
 * same input always produces the same output.
 */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeighted<T>(items: T[], rng: () => number, count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (pool.length && out.length < count) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Counts filler words used by the interview delivery analysis (§12). */
const FILLER_WORDS = [
  'um', 'uh', 'er', 'ah', 'like', 'basically', 'actually', 'literally',
  'you know', 'i mean', 'sort of', 'kind of', 'stuff like that', 'and all',
];

export function countFillerWords(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ')} `;
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const re = new RegExp(`\\s${filler.replace(/ /g, '\\s')}\\s`, 'g');
    count += (lower.match(re) || []).length;
  }
  return count;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
