import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Clock, Play, ShieldCheck } from 'lucide-react';
import type { AssessmentAttemptDto, AssessmentDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, Table, Tabs, Td, Th,
} from '@/components/ui';
import { apiGet, apiGetPaginated, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate, scoreTone } from '@/utils/format';

type AssessmentRow = AssessmentDto & { attemptsUsed: number; bestScore: number | null };

export default function AssessmentsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = React.useState('available');

  const assessments = useQuery({
    queryKey: ['assessments'],
    queryFn: () => apiGetPaginated<AssessmentRow>('/assessments', { limit: 50 }),
  });

  const attempts = useQuery({
    queryKey: ['assessments', 'attempts'],
    queryFn: () => apiGet<AssessmentAttemptDto[]>('/assessments/attempts'),
  });

  const start = useMutation({
    mutationFn: (assessment: AssessmentRow) =>
      apiPost<{ attempt: { id: string }; resumed: boolean }>(`/assessments/${assessment.id}/start`, {
        webcamConsent: false,
      }),
    onSuccess: (data) => {
      if (data.resumed) toast.toast({ title: 'Resuming your attempt', description: 'Your saved answers were restored.' });
      navigate(`/assessments/attempt/${data.attempt.id}`);
    },
    onError: (error) => toast.error('Could not start', error instanceof Error ? error.message : undefined),
  });

  const inProgress = attempts.data?.filter((a) => a.status === 'IN_PROGRESS') ?? [];
  const completed = attempts.data?.filter((a) => a.status !== 'IN_PROGRESS') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assessments"
        description="Timed aptitude and technical papers, graded on the server with your answers saved as you work."
      />

      {inProgress.length > 0 && (
        <Alert variant="warning" title="You have an assessment in progress">
          <div className="flex flex-wrap items-center gap-3">
            <p>Your answers and remaining time were saved. You can pick up exactly where you left off.</p>
            <Button size="sm" asChild>
              <Link to={`/assessments/attempt/${inProgress[0].id}`}>Resume assessment</Link>
            </Button>
          </div>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'available', label: 'Available', count: assessments.data?.items.length },
          { value: 'history', label: 'My results', count: completed.length },
        ]}
      />

      {tab === 'available' &&
        (assessments.isLoading ? (
          <LoadingState />
        ) : assessments.error ? (
          <ErrorState message={(assessments.error as Error).message} onRetry={() => assessments.refetch()} />
        ) : !assessments.data?.items.length ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No assessments available"
            message="Ask your placement office to publish assessments, or run the seed script in a development environment."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {assessments.data.items.map((assessment) => (
              <Card key={assessment.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{assessment.type.replace(/_/g, ' ')}</Badge>
                    <Badge variant="outline">{assessment.difficulty}</Badge>
                    {assessment.requiresFullscreen && (
                      <Badge variant="info" className="gap-1">
                        <ShieldCheck className="size-3" />
                        Proctored
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="mt-2">{assessment.title}</CardTitle>
                  {assessment.description && (
                    <p className="text-sm text-muted-foreground">{assessment.description}</p>
                  )}
                </CardHeader>

                <CardContent className="mt-auto space-y-3">
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {assessment.durationMinutes} min
                    </span>
                    <span>{assessment.totalQuestions} questions</span>
                    <span>Pass {assessment.passingScore}%</span>
                  </div>

                  {assessment.bestScore !== null && (
                    <p className="text-sm">
                      Best score:{' '}
                      <span className="font-semibold">{Math.round(assessment.bestScore)}%</span>
                      <span className="text-muted-foreground"> · {assessment.attemptsUsed} attempt(s)</span>
                    </p>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => start.mutate(assessment)}
                    loading={start.isPending && start.variables?.id === assessment.id}
                  >
                    <Play className="size-4" />
                    {assessment.attemptsUsed > 0 ? 'Retake' : 'Start'} assessment
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'history' &&
        (completed.length === 0 ? (
          <EmptyState title="No completed assessments yet" message="Your results will appear here once you submit an assessment." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Assessment</Th>
                <Th>Type</Th>
                <Th>Score</Th>
                <Th>Result</Th>
                <Th>Integrity</Th>
                <Th>Submitted</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {completed.map((attempt) => {
                const assessment = attempt as unknown as { assessmentId?: { title?: string; type?: string } };
                const tone = scoreTone(attempt.percentage);
                return (
                  <tr key={attempt.id}>
                    <Td className="font-medium">{assessment.assessmentId?.title ?? 'Assessment'}</Td>
                    <Td className="text-muted-foreground">{assessment.assessmentId?.type?.replace(/_/g, ' ')}</Td>
                    <Td>
                      <span
                        className={
                          tone === 'success' ? 'font-semibold text-success'
                            : tone === 'warning' ? 'font-semibold text-warning'
                              : 'font-semibold text-destructive'
                        }
                      >
                        {Math.round(attempt.percentage ?? 0)}%
                      </span>
                    </Td>
                    <Td>
                      <Badge variant={attempt.passed ? 'success' : 'danger'}>
                        {attempt.passed ? 'Passed' : 'Not passed'}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge variant={attempt.integrityRisk === 'HIGH' ? 'danger' : attempt.integrityRisk === 'MEDIUM' ? 'warning' : 'muted'}>
                        {attempt.integrityRisk}
                      </Badge>
                    </Td>
                    <Td className="text-muted-foreground">{formatDate(attempt.submittedAt)}</Td>
                    <Td>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/assessments/result/${attempt.id}`}>View</Link>
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ))}
    </div>
  );
}
