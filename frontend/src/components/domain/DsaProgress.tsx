import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Code2 } from 'lucide-react';
import type { DsaProgressDto, SubmissionStatus } from '@careerpilot/shared';
import { submissionStatusLabel } from '@careerpilot/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Progress } from '@/components/ui';
import { apiGet } from '@/services/api';
import { cn } from '@/utils/cn';

export function useDsaProgress() {
  return useQuery({
    queryKey: ['coding', 'progress'],
    queryFn: () => apiGet<DsaProgressDto>('/coding/progress'),
  });
}

/** Badge for a judge verdict. Green only for Accepted. */
export function VerdictBadge({ status, className }: { status: string; className?: string }) {
  const variant =
    status === 'ACCEPTED' ? 'success' : status === 'INTERNAL_ERROR' || status === 'ERROR' ? 'muted' : 'danger';
  return (
    <Badge variant={variant} className={className}>
      {submissionStatusLabel(status as SubmissionStatus)}
    </Badge>
  );
}

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const variant = difficulty === 'EASY' ? 'success' : difficulty === 'MEDIUM' ? 'warning' : 'danger';
  const label = difficulty.charAt(0) + difficulty.slice(1).toLowerCase();
  return <Badge variant={variant}>{label}</Badge>;
}

const ROWS = [
  { key: 'easy', label: 'Easy', tone: 'text-success' },
  { key: 'medium', label: 'Medium', tone: 'text-warning' },
  { key: 'hard', label: 'Hard', tone: 'text-destructive' },
] as const;

/**
 * Solved counts by difficulty. Used on the student dashboard and above the
 * problem list. "Solved" means the judge accepted a submission.
 */
export function DsaProgressCard({ showLink = false, className }: { showLink?: boolean; className?: string }) {
  const { data, isLoading } = useDsaProgress();

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Code2 className="size-4 text-primary" aria-hidden />
          DSA progress
        </CardTitle>
        {showLink && (
          <Button variant="outline" size="sm" asChild>
            <Link to="/coding">Practice</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">{isLoading ? '—' : data?.solved.total ?? 0}</span>
          <span className="text-sm text-muted-foreground">/ {data?.available.total ?? 0} problems solved</span>
        </div>

        <div className="space-y-3">
          {ROWS.map((row) => {
            const solved = data?.solved[row.key] ?? 0;
            const available = data?.available[row.key] ?? 0;
            return (
              <div key={row.key} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={cn('font-medium', row.tone)}>{row.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {solved} / {available}
                  </span>
                </div>
                <Progress value={available ? (solved / available) * 100 : 0} />
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {data?.submissions
            ? `${data.submissions} submission${data.submissions === 1 ? '' : 's'} across ${data.attempted} problem${data.attempted === 1 ? '' : 's'}` +
              (data.acceptanceRate !== null ? ` · ${data.acceptanceRate}% accepted` : '')
            : 'No submissions yet. Solve a problem to start tracking progress.'}
        </p>
      </CardContent>
    </Card>
  );
}
