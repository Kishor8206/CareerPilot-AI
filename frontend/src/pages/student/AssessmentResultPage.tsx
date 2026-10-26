import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ShieldAlert, X } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState,
  PageHeader, Progress, Tabs,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { apiGet } from '@/services/api';
import { formatDateTime, formatDuration, scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

interface ResultPayload {
  attempt: {
    id: string; percentage: number | null; score: number | null; maxScore: number | null;
    correctCount: number | null; passed: boolean | null; submittedAt: string | null;
    integrityRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    topicBreakdown: Array<{ topic: string; correct: number; total: number; percentage: number }>;
  };
  assessment: { title: string; type: string; passingScore: number } | null;
  review: Array<{
    questionId: string; prompt?: string; options?: Array<{ key: string; text: string }>;
    topic?: string; yourAnswer: string[] | null; correctAnswer?: string[]; explanation?: string;
    isCorrect: boolean | null; awardedMarks?: number; timeSpentSeconds: number;
  }>;
  integrity: {
    risk: string; points: number; eventCount: number; byType: Record<string, number>;
    events: Array<{ type: string; severity: string; explanation: string; occurredAt: string }>;
    disclaimer: string; reviewed: boolean; reviewNote: string | null;
  };
}

export default function AssessmentResultPage() {
  const { attemptId = '' } = useParams();
  const [tab, setTab] = React.useState('review');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assessment', 'result', attemptId],
    queryFn: () => apiGet<ResultPayload>(`/assessments/attempts/${attemptId}/result`),
  });

  if (isLoading) return <LoadingState label="Loading your result…" />;
  if (error || !data) {
    return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;
  }

  const { attempt, assessment, review, integrity } = data;
  const percentage = attempt.percentage ?? 0;
  const tone = scoreTone(percentage);

  return (
    <div className="space-y-6">
      <PageHeader
        title={assessment?.title ?? 'Assessment result'}
        description={`Submitted ${formatDateTime(attempt.submittedAt)}`}
        actions={
          <Button variant="outline" asChild>
            <Link to="/assessments">
              <ArrowLeft className="size-4" />
              All assessments
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row">
          <div className="text-center">
            <p
              className={cn(
                'text-5xl font-semibold tabular-nums',
                tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-destructive',
              )}
            >
              {Math.round(percentage)}%
            </p>
            <Badge variant={attempt.passed ? 'success' : 'danger'} className="mt-2">
              {attempt.passed ? 'Passed' : 'Not passed'}
            </Badge>
          </div>

          <div className="flex-1 space-y-3">
            <Progress value={percentage} tone={tone === 'muted' ? 'primary' : tone} />
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="label-muted">Correct</p>
                <p className="font-semibold tabular-nums">{attempt.correctCount} / {review.length}</p>
              </div>
              <div>
                <p className="label-muted">Marks</p>
                <p className="font-semibold tabular-nums">{attempt.score} / {attempt.maxScore}</p>
              </div>
              <div>
                <p className="label-muted">Pass mark</p>
                <p className="font-semibold tabular-nums">{assessment?.passingScore}%</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Integrity: shown to the student in full, because monitoring is transparent (§30) */}
      {integrity.eventCount > 0 && (
        <Alert variant={integrity.risk === 'LOW' ? 'info' : 'warning'} title={`Assessment integrity: ${integrity.risk}`}>
          <p>{integrity.disclaimer}</p>
          {integrity.reviewed && integrity.reviewNote && (
            <p className="mt-2">
              <strong>Reviewer note:</strong> {integrity.reviewNote}
            </p>
          )}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'review', label: 'Question review', count: review.length },
          { value: 'topics', label: 'Topic breakdown' },
          { value: 'integrity', label: 'Integrity log', count: integrity.eventCount },
        ]}
      />

      {tab === 'review' && (
        <div className="space-y-3">
          {review.map((item, index) => (
            <Card key={item.questionId} className={cn(item.isCorrect ? 'border-success/40' : 'border-destructive/40')}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                      item.isCorrect ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    {item.isCorrect ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Question {index + 1}</span>
                      {item.topic && <Badge variant="muted">{item.topic}</Badge>}
                      <span>{formatDuration(item.timeSpentSeconds)} spent</span>
                    </div>

                    <p className="font-medium leading-relaxed">{item.prompt}</p>

                    <div className="mt-3 space-y-1.5">
                      {(item.options ?? []).map((option) => {
                        const chosen = item.yourAnswer?.includes(option.key);
                        const correct = item.correctAnswer?.includes(option.key);
                        return (
                          <div
                            key={option.key}
                            className={cn(
                              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                              correct
                                ? 'border-success bg-success/5'
                                : chosen
                                  ? 'border-destructive bg-destructive/5'
                                  : 'border-border',
                            )}
                          >
                            <span className="font-mono text-xs">{option.key}</span>
                            <span className="flex-1">{option.text}</span>
                            {correct && <Badge variant="success">Correct</Badge>}
                            {chosen && !correct && <Badge variant="danger">Your answer</Badge>}
                          </div>
                        );
                      })}
                    </div>

                    {!item.yourAnswer?.length && (
                      <p className="mt-2 text-xs text-muted-foreground">You did not answer this question.</p>
                    )}

                    {item.explanation && (
                      <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
                        <p className="font-medium">Explanation</p>
                        <p className="mt-0.5 text-muted-foreground">{item.explanation}</p>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'topics' && (
        <Card>
          <CardHeader><CardTitle>Performance by topic</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              colorByValue
              height={Math.max(200, attempt.topicBreakdown.length * 48)}
              data={attempt.topicBreakdown.map((t) => ({ label: t.topic, value: t.percentage }))}
            />
            <div className="mt-4 space-y-2">
              {attempt.topicBreakdown.map((topic) => (
                <div key={topic.topic} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <span className="font-medium">{topic.topic}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {topic.correct} / {topic.total} correct ({Math.round(topic.percentage)}%)
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'integrity' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4" />
              Integrity signals recorded
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <p>{integrity.disclaimer}</p>
            </Alert>

            {integrity.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No integrity signals were recorded during this attempt.</p>
            ) : (
              <ul className="space-y-2">
                {integrity.events.map((event, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                    <Badge variant={event.severity === 'HIGH' ? 'danger' : event.severity === 'MEDIUM' ? 'warning' : 'muted'}>
                      {event.severity}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{event.type.replace(/_/g, ' ').toLowerCase()}</p>
                      <p className="text-xs text-muted-foreground">{event.explanation}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
