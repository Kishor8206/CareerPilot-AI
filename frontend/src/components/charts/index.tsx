import * as React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState } from '@/components/ui';

/**
 * Chart wrappers.
 *
 * One shared visual language: a single accent hue for the primary series,
 * semantic colours only where the value carries status meaning, muted grid
 * lines, and no chart junk. Every chart handles the empty case explicitly
 * rather than rendering an empty axis.
 */

const AXIS = { stroke: 'hsl(var(--muted-foreground))', fontSize: 11 };
const GRID = 'hsl(var(--border))';

export const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  danger: 'hsl(var(--destructive))',
  info: 'hsl(var(--info))',
  muted: 'hsl(var(--muted-foreground))',
};

/** Categorical sequence for series that have no inherent status meaning. */
export const SERIES_COLORS = [
  'hsl(224 76% 48%)',
  'hsl(199 89% 42%)',
  'hsl(142 71% 36%)',
  'hsl(32 95% 44%)',
  'hsl(280 65% 55%)',
  'hsl(340 75% 50%)',
];

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {label !== undefined && <p className="mb-1 font-medium text-popover-foreground">{label}</p>}
      {payload.map((entry: any) => (
        <p key={entry.dataKey ?? entry.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: entry.color ?? entry.fill }} />
          <span>{entry.name}:</span>
          <span className="font-medium tabular-nums text-popover-foreground">
            {typeof entry.value === 'number' ? Math.round(entry.value * 10) / 10 : entry.value}
          </span>
        </p>
      ))}
    </div>
  );
}

function ChartFrame({
  height = 260,
  isEmpty,
  emptyMessage,
  children,
}: {
  height?: number;
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactElement;
}) {
  if (isEmpty) {
    return <EmptyState title="No data to chart yet" message={emptyMessage} className="py-10" />;
  }
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Readiness over time. */
export function TrendChart({
  data,
  height = 260,
}: {
  data: Array<{ date: string; score: number }>;
  height?: number;
}) {
  const points = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  }));

  return (
    <ChartFrame
      height={height}
      isEmpty={points.length < 2}
      emptyMessage="Complete at least two activities to see your readiness trend."
    >
      <AreaChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.28} />
            <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} {...AXIS} tickLine={false} axisLine={false} width={40} />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="score"
          name="Readiness"
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          fill="url(#trendFill)"
        />
      </AreaChart>
    </ChartFrame>
  );
}

/** Component scores as a radar — the shape shows profile balance at a glance. */
export function ComponentRadar({
  data,
  height = 300,
}: {
  data: Array<{ label: string; value: number }>;
  height?: number;
}) {
  return (
    <ChartFrame
      height={height}
      isEmpty={data.length < 3}
      emptyMessage="Complete activities across more areas to see your profile shape."
    >
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke={GRID} />
        <PolarAngleAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} axisLine={false} />
        <Tooltip content={<ChartTooltip />} />
        <Radar
          name="Score"
          dataKey="value"
          stroke={CHART_COLORS.primary}
          fill={CHART_COLORS.primary}
          fillOpacity={0.22}
          strokeWidth={2}
        />
      </RadarChart>
    </ChartFrame>
  );
}

/**
 * Horizontal bars. When `colorByValue` is set, bar colour encodes status
 * (red/amber/green), which is the only place colour varies within one series.
 */
export function ScoreBarChart({
  data,
  height = 280,
  colorByValue = false,
  layout = 'horizontal',
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  colorByValue?: boolean;
  layout?: 'horizontal' | 'vertical';
}) {
  const colorFor = (value: number) =>
    value >= 70 ? CHART_COLORS.success : value >= 50 ? CHART_COLORS.warning : CHART_COLORS.danger;

  return (
    <ChartFrame height={height} isEmpty={data.length === 0} emptyMessage="No results recorded yet.">
      <BarChart
        data={data}
        layout={layout === 'vertical' ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, left: layout === 'vertical' ? 8 : -18, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={layout !== 'vertical'} vertical={layout === 'vertical'} />
        {layout === 'vertical' ? (
          <>
            <XAxis type="number" domain={[0, 100]} {...AXIS} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" {...AXIS} tickLine={false} axisLine={false} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={60} />
            <YAxis domain={[0, 100]} {...AXIS} tickLine={false} axisLine={false} width={40} />
          </>
        )}
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
        <Bar dataKey="value" name="Score" radius={layout === 'vertical' ? [0, 4, 4, 0] : [4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color ?? (colorByValue ? colorFor(entry.value) : CHART_COLORS.primary)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Readiness-band distribution across a cohort. */
export function DistributionChart({
  data,
  height = 260,
}: {
  data: Array<{ band: string; count: number; percentage: number }>;
  height?: number;
}) {
  const colorFor = (band: string) =>
    ({
      AT_RISK: CHART_COLORS.danger,
      NEEDS_IMPROVEMENT: CHART_COLORS.warning,
      PLACEMENT_READY: CHART_COLORS.success,
      HIGHLY_READY: 'hsl(142 71% 26%)',
    }[band] ?? CHART_COLORS.muted);

  const points = data.map((d) => ({ ...d, label: d.band.replace(/_/g, ' ') }));

  return (
    <ChartFrame
      height={height}
      isEmpty={data.every((d) => d.count === 0)}
      emptyMessage="No students have a computed readiness score yet."
    >
      <BarChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
        <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]}>
          {points.map((entry, index) => (
            <Cell key={index} fill={colorFor(entry.band)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Multi-series line, used for the monthly activity view. */
export function MultiLineChart({
  data,
  series,
  height = 280,
  xKey = 'month',
}: {
  data: Array<Record<string, unknown>>;
  series: Array<{ key: string; name: string; color?: string }>;
  height?: number;
  xKey?: string;
}) {
  return (
    <ChartFrame height={height} isEmpty={data.length === 0} emptyMessage="No activity recorded in this period.">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} tickLine={false} axisLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} width={40} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        {series.map((s, index) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? SERIES_COLORS[index % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}
