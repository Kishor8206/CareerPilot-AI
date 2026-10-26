import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, TrendingUp } from 'lucide-react';
import type { PlacementReadinessDto, RecommendationDto, SkillGapDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, Progress, Tabs,
} from '@/components/ui';
import { ComponentRadar, ScoreBarChart, TrendChart } from '@/components/charts';
import { ComponentBreakdown, ModelDisclaimer, ReadinessHero, SkillGapList } from '@/components/domain/ScoreCards';
import { apiDownload, apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { BAND_LABEL } from '@/utils/format';

interface ReadinessPayload {
  readiness: (PlacementReadinessDto & { evidenceCoverage?: number; improvementSummary?: string; agreementNote?: string; mlUnavailableReason?: string }) | null;
  skillGaps: SkillGapDto[];
  recommendations: RecommendationDto[];
  message?: string;
}

export default function ReadinessPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('components');

  const readiness = useQuery({
    queryKey: ['readiness'],
    queryFn: () => apiGet<ReadinessPayload>('/readiness'),
  });

  const trend = useQuery({
    queryKey: ['readiness', 'trend'],
    queryFn: () => apiGet<Array<{ date: string; score: number; band: string }>>('/readiness/trend'),
  });

  const recompute = useMutation({
    mutationFn: () => apiPost('/readiness/recompute'),
    onSuccess: async () => {
      toast.success('Readiness recomputed');
      await queryClient.invalidateQueries({ queryKey: ['readiness'] });
      await queryClient.invalidateQueries({ queryKey: ['student', 'dashboard'] });
    },
    onError: (error) => toast.error('Could not recompute', error instanceof Error ? error.message : undefined),
  });

  if (readiness.isLoading) return <LoadingState label="Loading your readiness…" />;
  if (readiness.error) {
    return <ErrorState message={(readiness.error as Error).message} onRetry={() => readiness.refetch()} />;
  }

  const data = readiness.data?.readiness;

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Placement Readiness" />
        <Card className="p-6">
          <EmptyState
            icon={TrendingUp}
            title="No readiness score yet"
            message={readiness.data?.message ?? 'Complete an activity and your score will be computed automatically.'}
            action={<Button asChild><Link to="/resume">Upload your resume</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const ml = data.mlPrediction;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Placement Readiness"
        description="How your Placement Readiness Score is calculated, component by component."
        actions={
          <>
            <Button variant="outline" onClick={() => recompute.mutate()} loading={recompute.isPending}>
              <RefreshCw className="size-4" />
              Recompute
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                apiDownload('/reports/PLACEMENT_READINESS', 'readiness-report.pdf').catch((e) =>
                  toast.error('Download failed', e?.message),
                )
              }
            >
              <Download className="size-4" />
              Download report
            </Button>
          </>
        }
      />

      <ReadinessHero
        score={data.score}
        band={data.band}
        delta={data.delta}
        computedAt={data.computedAt}
        evidenceCoverage={data.evidenceCoverage}
      />

      {data.improvementSummary && (
        <Alert variant={data.delta && data.delta > 0 ? 'success' : 'info'}>
          <p>{data.improvementSummary}</p>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'components', label: 'Components' },
          { value: 'trend', label: 'Trend' },
          { value: 'targets', label: 'Target readiness' },
          { value: 'gaps', label: 'Skill gaps', count: readiness.data?.skillGaps.length },
          { value: 'model', label: 'Scoring model' },
        ]}
      />

      {tab === 'components' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Component breakdown</CardTitle></CardHeader>
            <CardContent>
              <ComponentBreakdown components={data.components} />
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Profile balance</CardTitle></CardHeader>
              <CardContent>
                <ComponentRadar
                  data={data.components.filter((c) => c.raw !== null).map((c) => ({ label: c.label.split(' ')[0], value: c.normalized }))}
                />
              </CardContent>
            </Card>

            {data.modifiers.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Score modifiers</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.modifiers.map((modifier, i) => (
                    <div key={i} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{modifier.label}</p>
                        <p className="text-xs text-muted-foreground">{modifier.reason}</p>
                      </div>
                      <Badge variant={modifier.delta >= 0 ? 'success' : 'danger'}>
                        {modifier.delta >= 0 ? '+' : ''}{modifier.delta}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-success">Strengths</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {data.strengths.map((item, i) => <li key={i}>· {item}</li>)}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-destructive">Needs work</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {data.weaknesses.map((item, i) => <li key={i}>· {item}</li>)}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {tab === 'trend' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Readiness over time</CardTitle></CardHeader>
            <CardContent><TrendChart data={trend.data ?? []} height={320} /></CardContent>
          </Card>

          {data.reassessmentSuggestions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Suggested reassessment</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.reassessmentSuggestions.map((item, i) => (
                  <div key={i} className="rounded-md border border-border p-3">
                    <p className="text-sm font-medium">{item.component}</p>
                    <p className="text-xs text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === 'targets' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Target role readiness</CardTitle></CardHeader>
            <CardContent>
              {data.targetRoleReadiness.length === 0 ? (
                <EmptyState title="No target roles set" message="Choose target roles to see role-specific readiness." action={<Button size="sm" asChild><Link to="/job-matching">Set targets</Link></Button>} />
              ) : (
                <div className="space-y-4">
                  {data.targetRoleReadiness.map((role) => (
                    <div key={role.roleTitle} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{role.roleTitle}</span>
                        <Badge variant={role.band === 'AT_RISK' ? 'danger' : role.band === 'NEEDS_IMPROVEMENT' ? 'warning' : 'success'}>
                          {BAND_LABEL[role.band]}
                        </Badge>
                      </div>
                      <Progress value={role.score} tone={role.score >= 60 ? 'success' : role.score >= 40 ? 'warning' : 'danger'} />
                      {role.missingSkills.length > 0 && (
                        <p className="text-xs text-muted-foreground">Missing: {role.missingSkills.join(', ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Target company readiness</CardTitle></CardHeader>
            <CardContent>
              {data.targetCompanyReadiness.length === 0 ? (
                <EmptyState title="No target companies set" message="Choose target companies to see eligibility and fit." />
              ) : (
                <div className="space-y-4">
                  {data.targetCompanyReadiness.map((company) => (
                    <div key={company.companyName} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{company.companyName}</span>
                        <Badge variant={company.band === 'AT_RISK' ? 'danger' : company.band === 'NEEDS_IMPROVEMENT' ? 'warning' : 'success'}>
                          {BAND_LABEL[company.band]}
                        </Badge>
                      </div>
                      <Progress value={company.score} tone={company.score >= 60 ? 'success' : company.score >= 40 ? 'warning' : 'danger'} />
                      <p className="text-xs text-muted-foreground">{company.gapSummary}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'gaps' && (
        <Card>
          <CardHeader><CardTitle>Skill gaps against your targets</CardTitle></CardHeader>
          <CardContent>
            {!readiness.data?.skillGaps.length ? (
              <EmptyState title="No open skill gaps" message="Nothing is missing against your current target roles." />
            ) : (
              <SkillGapList gaps={readiness.data.skillGaps} />
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'model' && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>How your score is calculated</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ScoreBarChart
                layout="vertical"
                height={300}
                data={Object.entries(data.components.reduce<Record<string, number>>((acc, c) => {
                  acc[c.label] = c.weight * 100;
                  return acc;
                }, {})).map(([label, value]) => ({ label, value }))}
              />
              <p className="text-sm text-muted-foreground">
                Each component is normalised to 0-100 and multiplied by its weight above. Projects,
                certifications, internship experience and verified alumni feedback then adjust the total.
                Weights version {data.weightsVersion}.
              </p>
            </CardContent>
          </Card>

          {/* ML second opinion, clearly separated from the authoritative APIE score */}
          <Card>
            <CardHeader><CardTitle>Machine learning second opinion</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {ml ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={ml.band === 'AT_RISK' ? 'danger' : ml.band === 'NEEDS_IMPROVEMENT' ? 'warning' : 'success'}>
                      {BAND_LABEL[ml.band]}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Confidence {Math.round(ml.confidence * 100)}% · {ml.modelVersion}
                    </span>
                    <Badge variant={ml.trainedOn === 'SYNTHETIC' ? 'warning' : 'muted'}>
                      Trained on {ml.trainedOn.toLowerCase()} data
                    </Badge>
                  </div>

                  {data.agreementNote && <Alert variant="info"><p>{data.agreementNote}</p></Alert>}

                  {ml.featureContributions.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium">Which inputs the model weighs most</p>
                      <ScoreBarChart
                        layout="vertical"
                        height={240}
                        data={ml.featureContributions.map((f) => ({ label: f.feature, value: f.importance * 100 }))}
                      />
                    </div>
                  )}

                  <ModelDisclaimer text={ml.disclaimer} />
                </>
              ) : (
                <Alert variant="info" title="No ML prediction available">
                  <p>
                    {data.mlUnavailableReason ??
                      'The readiness classifier has not been trained in this environment. Your APIE score above is unaffected and remains authoritative.'}
                  </p>
                </Alert>
              )}
            </CardContent>
          </Card>

          <ModelDisclaimer text={data.modelDisclaimer} />
        </div>
      )}
    </div>
  );
}
