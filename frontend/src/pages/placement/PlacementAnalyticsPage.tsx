import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import {
  Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState,
  PageHeader, Select, Table, Td, Th,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { apiGet } from '@/services/api';

interface CohortInsights {
  insights: string[];
  riskCohort: Array<{ studentId: string; fullName: string; department: string; prs: number; reason: string }>;
  commonGaps: Array<{ skill: string; count: number; affectedPercentage: number; averageGap: number }>;
  groupComparison: Array<{ group: string; students: number; averagePrs: number; readyPercentage: number }>;
  recommendedInterventions: Array<{ title: string; rationale: string; priority: string; affectedStudents: number }>;
}

export default function PlacementAnalyticsPage() {
  const [department, setDepartment] = React.useState('');

  const filters = useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: () => apiGet<{ departments: string[] }>('/analytics/filters'),
  });

  const insights = useQuery({
    queryKey: ['analytics', 'insights', department],
    queryFn: () => apiGet<CohortInsights>('/analytics/insights', { department: department || undefined }),
  });

  if (insights.isLoading) return <LoadingState label="Analysing the cohort…" />;
  if (insights.error || !insights.data) {
    return <ErrorState message={(insights.error as Error)?.message} onRetry={() => insights.refetch()} />;
  }

  const data = insights.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cohort Analytics"
        description="Institution-level insights, the at-risk cohort, and interventions ranked by how many students they would reach."
      />

      <Card>
        <CardContent className="p-4">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-64" aria-label="Filter by department">
            <option value="">All departments</option>
            {filters.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Key findings</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {data.insights.map((insight, index) => (
              <li key={index} className="flex gap-2 text-muted-foreground">
                <span className="text-primary">·</span>
                {insight}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {data.recommendedInterventions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4 text-warning" />
              Recommended interventions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recommendedInterventions.map((intervention, index) => (
              <div key={index} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">{intervention.title}</h4>
                  <div className="flex items-center gap-2">
                    <Badge variant={intervention.priority === 'CRITICAL' ? 'danger' : intervention.priority === 'HIGH' ? 'warning' : 'info'}>
                      {intervention.priority}
                    </Badge>
                    <Badge variant="muted">{intervention.affectedStudents} student(s)</Badge>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{intervention.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Group comparison</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              height={Math.max(200, data.groupComparison.length * 44)}
              colorByValue
              data={data.groupComparison.map((g) => ({ label: `${g.group} (${g.students})`, value: g.averagePrs }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Gap prevalence</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              height={Math.max(200, data.commonGaps.length * 40)}
              data={data.commonGaps.map((g) => ({ label: g.skill, value: g.affectedPercentage }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">Percentage of the cohort affected by each gap.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            At-risk cohort ({data.riskCohort.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.riskCohort.length === 0 ? (
            <EmptyState title="No students in the at-risk band" message="Every assessed student is above the at-risk threshold." />
          ) : (
            <>
              <Alert variant="info" className="mb-4">
                <p>
                  These students are below the at-risk threshold. Pairing them with verified alumni mentors adds
                  the human feedback loop that automated practice alone cannot provide.
                </p>
              </Alert>

              <Table>
                <thead>
                  <tr><Th>Student</Th><Th>Department</Th><Th>Readiness</Th><Th>Why flagged</Th></tr>
                </thead>
                <tbody>
                  {data.riskCohort.map((student) => (
                    <tr key={student.studentId}>
                      <Td className="font-medium">{student.fullName}</Td>
                      <Td className="text-muted-foreground">{student.department}</Td>
                      <Td className="font-semibold tabular-nums text-destructive">{Math.round(student.prs)}</Td>
                      <Td className="text-sm text-muted-foreground">{student.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
