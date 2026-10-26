import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState,
  PageHeader, Progress,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { ModelDisclaimer } from '@/components/domain/ScoreCards';
import { apiDownload, apiGet } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

export default function InterviewReportPage() {
  const { sessionId = '' } = useParams();
  const toast = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['interview', 'report', sessionId],
    queryFn: () => apiGet<{ session: Record<string, any>; questions: Array<Record<string, any>>; evaluation: Record<string, any> | null }>(`/interviews/sessions/${sessionId}`),
  });

  if (isLoading) return <LoadingState label="Loading your report…" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;

  const evaluation = data.evaluation;

  if (!evaluation) {
    return (
      <div className="space-y-6">
        <PageHeader title="Interview report" />
        <EmptyState
          title="No evaluation available"
          message="This interview was not completed, so no report was generated."
          action={<Button asChild><Link to="/interview">Start a new interview</Link></Button>}
        />
      </div>
    );
  }

  const tone = scoreTone(evaluation.overallScore);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Report"
        description={`${String(data.session.mode).replace(/_/g, ' ')} · ${evaluation.questionsAnswered} question(s) answered`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/interview"><ArrowLeft className="size-4" />All interviews</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                apiDownload(`/reports/INTERVIEW?ref=${sessionId}`, 'interview-report.pdf').catch((e) =>
                  toast.error('Download failed', e?.message),
                )
              }
            >
              <Download className="size-4" />
              Download PDF
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row">
          <div className="text-center">
            <p className={cn('text-5xl font-semibold tabular-nums', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-destructive')}>
              {Math.round(evaluation.overallScore)}
            </p>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall</p>
          </div>
          <div className="flex-1 space-y-2">
            <Progress value={evaluation.overallScore} tone={tone === 'muted' ? 'primary' : tone} />
            <p className="text-sm text-muted-foreground">{evaluation.summary}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dimension scores</CardTitle></CardHeader>
        <CardContent>
          <ScoreBarChart
            layout="vertical"
            height={220}
            colorByValue
            data={[
              { label: 'Technical content', value: evaluation.technicalScore },
              { label: 'Communication', value: evaluation.communicationScore },
              { label: 'Answer structure', value: evaluation.structureScore },
              { label: 'Delivery indicator', value: evaluation.confidenceIndicatorScore },
            ]}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            The delivery indicator is derived from objective signals only — answer length adequacy and
            filler-word rate. It is not an assessment of personality or emotion.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-success">Strengths</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {(evaluation.strengths as string[]).map((item, i) => <li key={i}>· {item}</li>)}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-destructive">Areas to improve</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {(evaluation.weaknesses as string[]).map((item, i) => <li key={i}>· {item}</li>)}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recommendations</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {(evaluation.recommendations as string[]).map((item, i) => (
              <li key={i} className="rounded-md border border-border p-3 text-muted-foreground">{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Question by question</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data.questions.map((question, index) => {
            const response = question.response as Record<string, any> | null;
            const questionEval = response?.evaluation as Record<string, any> | null;

            return (
              <div key={question.id ?? index} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="muted">Q{index + 1}</Badge>
                  <Badge variant="secondary">{question.topic}</Badge>
                  <Badge variant="outline">{question.difficulty}</Badge>
                  {questionEval && (
                    <Badge variant={questionEval.overall >= 60 ? 'success' : questionEval.overall >= 40 ? 'warning' : 'danger'} className="ml-auto">
                      {Math.round(questionEval.overall)}/100
                    </Badge>
                  )}
                </div>

                <p className="mt-2 font-medium leading-relaxed">{question.question}</p>

                {response ? (
                  <>
                    <div className="mt-3 rounded-md bg-muted/50 p-3">
                      <p className="text-xs font-medium text-muted-foreground">Your answer</p>
                      <p className="mt-1 text-sm">{response.transcript}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {response.wordCount} words · {response.fillerWordCount} filler word(s)
                      </p>
                    </div>

                    {questionEval && (
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="text-muted-foreground">{questionEval.explanation}</p>
                        {(questionEval.missedPoints as string[])?.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-warning">Points you did not cover</p>
                            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                              {(questionEval.missedPoints as string[]).map((point, i) => <li key={i}>· {point}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-sm italic text-muted-foreground">Not answered.</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <ModelDisclaimer text={evaluation.disclaimer as string} />
    </div>
  );
}
