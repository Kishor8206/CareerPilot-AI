import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, GraduationCap, Users } from 'lucide-react';
import type { PlacementAnalyticsDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState,
  PageHeader, Select,
} from '@/components/ui';
import { DistributionChart, MultiLineChart, ScoreBarChart } from '@/components/charts';
import { apiGet } from '@/services/api';
import { formatPercent } from '@/utils/format';

export default function PlacementDashboard() {
  const [department, setDepartment] = React.useState('');
  const [batch, setBatch] = React.useState('');

  const filters = useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: () => apiGet<{ departments: string[]; batches: string[] }>('/analytics/filters'),
  });

  const analytics = useQuery({
    queryKey: ['analytics', 'placement', department, batch],
    queryFn: () =>
      apiGet<PlacementAnalyticsDto>('/analytics/placement', {
        department: department || undefined,
        batch: batch || undefined,
      }),
  });

  if (analytics.isLoading) return <LoadingState label="Loading institutional analytics…" />;
  if (analytics.error || !analytics.data) {
    return <ErrorState message={(analytics.error as Error)?.message} onRetry={() => analytics.refetch()} />;
  }

  const data = analytics.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Placement Dashboard"
        description="Cohort readiness, skill gaps and engagement across the institution."
        actions={
          <>
            <Button variant="outline" asChild><Link to="/placement/students"><Users className="size-4" />Students</Link></Button>
            <Button asChild><Link to="/placement/analytics"><BarChart3 className="size-4" />Full analytics</Link></Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-56" aria-label="Filter by department">
            <option value="">All departments</option>
            {filters.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-48" aria-label="Filter by batch">
            <option value="">All batches</option>
            {filters.data?.batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="label-muted">Total students</p>
          <p className="stat-value">{data.totals.students}</p>
          <p className="mt-1 text-xs text-muted-foreground">{data.totals.activeStudents} active in the last 30 days</p>
        </Card>
        <Card className="p-5">
          <p className="label-muted">Average readiness</p>
          <p className="stat-value">{data.averages.prs || '—'}</p>
        </Card>
        <Card className="p-5">
          <p className="label-muted">Placement ready</p>
          <p className="stat-value text-success">{formatPercent(data.placementReadyPercentage)}</p>
        </Card>
        <Card className="p-5">
          <p className="label-muted">At risk</p>
          <p className="stat-value text-destructive">{formatPercent(data.atRiskPercentage)}</p>
        </Card>
      </div>

      {data.atRiskPercentage > 25 && (
        <Alert variant="warning" title="A significant share of this cohort is at risk">
          <div className="flex flex-wrap items-center gap-3">
            <p>
              {formatPercent(data.atRiskPercentage)} of students with a computed score are in the at-risk band.
              The analytics page suggests targeted interventions.
            </p>
            <Button size="sm" asChild><Link to="/placement/analytics">See interventions</Link></Button>
          </div>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Readiness distribution</CardTitle></CardHeader>
          <CardContent><DistributionChart data={data.readinessDistribution} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Average component scores</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              height={280}
              colorByValue
              data={[
                { label: 'Resume / ATS', value: data.averages.ats },
                { label: 'Coding', value: data.averages.coding },
                { label: 'Technical interview', value: data.averages.technical },
                { label: 'HR interview', value: data.averages.hr },
                { label: 'Communication', value: data.averages.communication },
                { label: 'Aptitude', value: data.averages.aptitude },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Department comparison</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              height={Math.max(200, data.departmentComparison.length * 44)}
              colorByValue
              data={data.departmentComparison.map((d) => ({ label: `${d.department} (${d.students})`, value: d.averagePrs }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Monthly activity</CardTitle></CardHeader>
          <CardContent>
            <MultiLineChart
              data={data.monthlyProgress}
              series={[
                { key: 'averagePrs', name: 'Average readiness' },
                { key: 'assessments', name: 'Assessments' },
                { key: 'interviews', name: 'Interviews' },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" />
              Most common skill gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.commonSkillGaps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No skill gaps recorded for this cohort yet.</p>
            ) : (
              <div className="space-y-2">
                {data.commonSkillGaps.map((gap) => (
                  <div key={gap.skill} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{gap.skill}</p>
                      <p className="text-xs text-muted-foreground">
                        {gap.count} student(s) · average gap {gap.averageGap}/100
                      </p>
                    </div>
                    <Badge variant={gap.severity === 'CRITICAL' || gap.severity === 'HIGH' ? 'danger' : 'warning'}>
                      {gap.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="size-4" />
              Alumni participation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.alumniParticipation.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alumni have conducted sessions yet.</p>
            ) : (
              <div className="space-y-2">
                {data.alumniParticipation.map((alumni) => (
                  <div key={alumni.alumniName} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">{alumni.alumniName}</p>
                      <p className="text-xs text-muted-foreground">{alumni.company}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{alumni.sessions} session(s)</p>
                      {alumni.averageRating > 0 && <p>{alumni.averageRating}/5 rating</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Most targeted companies</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.topTargetCompanies.map((item) => (
              <Badge key={item.company} variant="secondary">{item.company} · {item.count}</Badge>
            ))}
            {!data.topTargetCompanies.length && <p className="text-sm text-muted-foreground">No targets set yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Engagement</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <p className="label-muted">Assessments taken</p>
              <p className="stat-value">{data.totals.assessmentsTaken}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="label-muted">Interviews taken</p>
              <p className="stat-value">{data.totals.interviewsTaken}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="label-muted">Mentorship sessions</p>
              <p className="stat-value">{data.totals.mentorshipSessions}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="label-muted">Verified alumni</p>
              <p className="stat-value">{data.totals.verifiedAlumni}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
