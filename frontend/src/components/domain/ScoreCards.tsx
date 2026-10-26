import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ComponentScore, GapSeverity, ReadinessBand, SkillGapDto } from '@careerpilot/shared';
import { Badge, Card, Progress } from '@/components/ui';
import { BAND_LABEL, BAND_TONE, SEVERITY_TONE, formatScore, scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Domain display components.
 *
 * These encode one important rule consistently: a missing score is shown as
 * "—" with a "no data yet" affordance, never as zero. Conflating the two would
 * tell a student they scored 0 when they simply have not attempted anything.
 */

export function StatCard({
  label,
  value,
  suffix,
  delta,
  tone,
  hint,
  icon: Icon,
  to,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  delta?: number | null;
  tone?: 'success' | 'warning' | 'danger' | 'muted' | 'primary';
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  to?: string;
}) {
  const resolvedTone = tone ?? scoreTone(value);
  const hasValue = value !== null && value !== undefined;

  const toneText = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
    muted: 'text-muted-foreground',
    primary: 'text-primary',
  }[resolvedTone];

  const body = (
    <Card className={cn('p-5 transition-shadow', to && 'hover:shadow-md')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="label-muted truncate">{label}</p>
          <p className={cn('stat-value', hasValue ? toneText : 'text-muted-foreground')}>
            {formatScore(value, suffix)}
          </p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          {!hasValue && !hint && <p className="text-xs text-muted-foreground">No data yet</p>}
        </div>
        {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" />}
      </div>

      {delta !== null && delta !== undefined && (
        <div className="mt-3 flex items-center gap-1 text-xs">
          {delta > 0.05 ? (
            <>
              <ArrowUpRight className="size-3 text-success" />
              <span className="font-medium text-success">+{Math.abs(delta).toFixed(1)}</span>
            </>
          ) : delta < -0.05 ? (
            <>
              <ArrowDownRight className="size-3 text-destructive" />
              <span className="font-medium text-destructive">-{Math.abs(delta).toFixed(1)}</span>
            </>
          ) : (
            <>
              <Minus className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">No change</span>
            </>
          )}
          <span className="text-muted-foreground">since last update</span>
        </div>
      )}
    </Card>
  );

  return to ? (
    <Link to={to} className="block focus-visible:rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Headline readiness display used on the dashboard and readiness page. */
export function ReadinessHero({
  score,
  band,
  delta,
  computedAt,
  evidenceCoverage,
}: {
  score: number;
  band: ReadinessBand;
  delta?: number | null;
  computedAt?: string;
  evidenceCoverage?: number;
}) {
  const tone = BAND_TONE[band];
  const ring = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-destructive',
    info: 'text-info',
  }[tone];

  // Circumference of an r=52 circle, used to drive the stroke-dash progress.
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <Card className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-secondary" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            className={cn('transition-all duration-700', ring)}
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl font-semibold tabular-nums', ring)}>{Math.round(score)}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">of 100</span>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
          <Badge variant={tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'success'}>
            {BAND_LABEL[band]}
          </Badge>
          {delta !== null && delta !== undefined && Math.abs(delta) > 0.05 && (
            <Badge variant={delta > 0 ? 'success' : 'danger'}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)} points
            </Badge>
          )}
        </div>
        <h2 className="text-lg font-semibold">Placement Readiness Score</h2>
        <p className="text-sm text-muted-foreground">
          A weighted score across resume, coding, interviews, communication, aptitude and
          academics.{' '}
          {evidenceCoverage !== undefined && evidenceCoverage < 100 && (
            <span className="text-warning">
              Only {Math.round(evidenceCoverage)}% of components have evidence — completing more activities makes
              this score more meaningful.
            </span>
          )}
        </p>
        {computedAt && (
          <p className="text-xs text-muted-foreground">Last computed {new Date(computedAt).toLocaleString()}</p>
        )}
      </div>
    </Card>
  );
}

/** Component breakdown with weights, staleness and missing-evidence states. */
export function ComponentBreakdown({ components }: { components: ComponentScore[] }) {
  return (
    <div className="space-y-4">
      {components.map((component) => {
        const missing = component.raw === null;
        return (
          <div key={component.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{component.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {Math.round(component.weight * 100)}% weight
                </span>
                {component.stale && (
                  <Badge variant="warning" className="shrink-0">
                    Stale
                  </Badge>
                )}
              </div>
              <span
                className={cn(
                  'shrink-0 font-semibold tabular-nums',
                  missing ? 'text-muted-foreground' : '',
                )}
              >
                {missing ? '—' : Math.round(component.normalized)}
              </span>
            </div>

            <Progress
              value={missing ? 0 : component.normalized}
              tone={missing ? 'muted' : scoreTone(component.normalized) === 'muted' ? 'primary' : scoreTone(component.normalized)}
            />

            <p className="text-xs text-muted-foreground">
              {missing
                ? `No evidence recorded yet. This costs you up to ${Math.round(component.weight * 100)} points.`
                : `${component.evidenceCount} result(s) recorded${component.lastUpdated ? `, most recent ${new Date(component.lastUpdated).toLocaleDateString()}` : ''}.`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function SkillGapList({ gaps, limit }: { gaps: SkillGapDto[]; limit?: number }) {
  const visible = limit ? gaps.slice(0, limit) : gaps;

  return (
    <ul className="space-y-3">
      {visible.map((gap) => (
        <li key={gap.skill} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{gap.skill}</span>
            <Badge variant={SEVERITY_TONE[gap.severity as GapSeverity] === 'danger' ? 'danger' : SEVERITY_TONE[gap.severity as GapSeverity] === 'warning' ? 'warning' : 'info'}>
              {gap.severity}
            </Badge>
          </div>

          <div className="mt-2 space-y-1">
            <Progress value={gap.currentLevel} tone="warning" className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              Current {Math.round(gap.currentLevel)} · required {Math.round(gap.requiredLevel)}
              {gap.relatedRoles.length > 0 && ` · needed for ${gap.relatedRoles.join(', ')}`}
            </p>
          </div>

          {gap.recommendedActions.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{gap.recommendedActions[0]}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Prominent "do this next" card, driven by the top-priority recommendation. */
export function NextActionCard({
  title,
  description,
  route,
  label,
}: {
  title: string;
  description?: string;
  route?: string;
  label?: string;
}) {
  return (
    <Card className="border-primary/30 bg-primary/5 p-5">
      <p className="label-muted">Recommended next action</p>
      <h3 className="mt-1.5 font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {route && (
        <Link
          to={route}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {label ?? 'Start now'}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </Card>
  );
}

/**
 * Disclaimer shown wherever an AI or prototype score is displayed (§7, §12).
 * Deliberately quiet but always present - never hidden behind a tooltip.
 */
export function ModelDisclaimer({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground', className)}>
      {text}
    </p>
  );
}

/** Marks demo or synthetic data so it is never mistaken for real results (§42). */
export function ProvenanceBadge({ provenance }: { provenance: string }) {
  if (provenance === 'REAL') return null;
  return (
    <Badge variant={provenance === 'SYNTHETIC' ? 'warning' : 'muted'}>
      {provenance === 'SYNTHETIC' ? 'Synthetic data' : 'Demo data'}
    </Badge>
  );
}
