import type { GapSeverity, ReadinessBand } from '@careerpilot/shared';

export const BAND_LABEL: Record<ReadinessBand, string> = {
  AT_RISK: 'At Risk',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
  PLACEMENT_READY: 'Placement Ready',
  HIGHLY_READY: 'Highly Ready',
};

/**
 * Colour is used consistently across the app: red always means "at risk",
 * amber "needs work", green "on track". Never decorative.
 */
export const BAND_TONE: Record<ReadinessBand, 'danger' | 'warning' | 'success' | 'info'> = {
  AT_RISK: 'danger',
  NEEDS_IMPROVEMENT: 'warning',
  PLACEMENT_READY: 'success',
  HIGHLY_READY: 'success',
};

export const SEVERITY_TONE: Record<GapSeverity, 'danger' | 'warning' | 'info' | 'muted'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
};

export function scoreTone(score: number | null | undefined): 'danger' | 'warning' | 'success' | 'muted' {
  if (score === null || score === undefined) return 'muted';
  if (score >= 70) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}

/** Formats a 0-100 score, distinguishing "no evidence yet" from a real zero. */
export function formatScore(score: number | null | undefined, suffix = ''): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  return `${Math.round(score * 10) / 10}${suffix}`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 10) / 10}%`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return formatDate(date);
}

/** mm:ss for the assessment timer; hh:mm:ss once past an hour. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
