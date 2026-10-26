import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Save, Target } from 'lucide-react';
import type { CompanyDto, JobDescriptionDto, JobMatchResult, JobRoleDto, StudentProfileDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, Progress, Select, Tabs,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { apiGet, apiGetPaginated, apiPost, apiPut } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

export default function JobMatchingPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = React.useState('match');
  const [selectedJd, setSelectedJd] = React.useState('');
  const [result, setResult] = React.useState<JobMatchResult | null>(null);
  const [targetCompanies, setTargetCompanies] = React.useState<string[]>([]);
  const [targetRoles, setTargetRoles] = React.useState<string[]>([]);

  const profile = useQuery({ queryKey: ['student', 'profile'], queryFn: () => apiGet<StudentProfileDto>('/students/me') });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => apiGetPaginated<CompanyDto>('/companies', { limit: 60 }) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => apiGet<JobRoleDto[]>('/jobs/roles') });
  const jobs = useQuery({
    queryKey: ['jobs', 'descriptions'],
    queryFn: () => apiGetPaginated<JobDescriptionDto>('/jobs/descriptions', { limit: 60 }),
  });

  const match = useMutation({
    mutationFn: (jobDescriptionId: string) => apiPost<JobMatchResult>('/jobs/match', { jobDescriptionId }),
    onSuccess: setResult,
    onError: (error) => toast.error('Matching failed', error instanceof Error ? error.message : undefined),
  });

  const saveTargets = useMutation({
    mutationFn: () =>
      apiPut('/students/me/targets', {
        companyIds: targetCompanies,
        roleIds: targetRoles,
        companyNames: [],
        roleTitles: [],
      }),
    onSuccess: async () => {
      toast.success('Targets saved', 'Your readiness and career plan now reflect these targets.');
      await queryClient.invalidateQueries({ queryKey: ['student'] });
      await queryClient.invalidateQueries({ queryKey: ['readiness'] });
    },
    onError: (error) => toast.error('Could not save targets', error instanceof Error ? error.message : undefined),
  });

  if (profile.isLoading) return <LoadingState />;
  if (profile.error) return <ErrorState message={(profile.error as Error).message} onRetry={() => profile.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job &amp; Company Matching"
        description="Score your profile against a specific opening, see exactly which skills are missing, and get a prioritised preparation plan."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'match', label: 'Match against a role' },
          { value: 'targets', label: 'My targets' },
          { value: 'companies', label: 'Companies', count: companies.data?.items.length },
        ]}
      />

      {tab === 'match' && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 p-5">
              <div className="min-w-[18rem] flex-1 space-y-1.5">
                <label htmlFor="jd" className="text-sm font-medium">Select an opening</label>
                <Select id="jd" value={selectedJd} onChange={(e) => setSelectedJd(e.target.value)}>
                  <option value="">Choose a job description…</option>
                  {jobs.data?.items.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </Select>
              </div>
              <Button onClick={() => match.mutate(selectedJd)} disabled={!selectedJd} loading={match.isPending}>
                <Target className="size-4" />
                Run match
              </Button>
            </CardContent>
          </Card>

          {match.isPending && <LoadingState label="Comparing your profile against the job description…" />}

          {result && (
            <div className="space-y-6">
              <Card>
                <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row">
                  <div className="text-center">
                    <p className={cn(
                      'text-5xl font-semibold tabular-nums',
                      scoreTone(result.matchScore) === 'success' ? 'text-success'
                        : scoreTone(result.matchScore) === 'warning' ? 'text-warning' : 'text-destructive',
                    )}>
                      {Math.round(result.matchScore)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Match score</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="font-medium">{result.roleTitle} · {result.companyName}</p>
                    <Progress value={result.matchScore} tone={scoreTone(result.matchScore) === 'muted' ? 'primary' : scoreTone(result.matchScore)} />
                    <p className="text-sm text-muted-foreground">{result.verdict}</p>
                  </div>
                </CardContent>
              </Card>

              {(result as unknown as { eligible?: boolean; eligibilityNotes?: string[] }).eligible === false && (
                <Alert variant="warning" title="Eligibility criteria not met">
                  <ul className="list-inside list-disc">
                    {(result as unknown as { eligibilityNotes?: string[] }).eligibilityNotes?.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Card>
                <CardHeader><CardTitle>Score components</CardTitle></CardHeader>
                <CardContent>
                  <ScoreBarChart
                    layout="vertical"
                    height={220}
                    colorByValue
                    data={[
                      { label: 'Required skill coverage', value: result.requiredCoverage },
                      { label: 'Preferred skill coverage', value: result.preferredCoverage },
                      { label: 'Profile / JD similarity', value: result.semanticSimilarity },
                      { label: 'Eligibility fit', value: (result as unknown as { eligibilityScore?: number }).eligibilityScore ?? 0 },
                    ]}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-success">Skills you have ({result.matchingSkills.length})</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {result.matchingSkills.map((skill) => <Badge key={skill} variant="success">{skill}</Badge>)}
                    {!result.matchingSkills.length && <p className="text-sm text-muted-foreground">None matched.</p>}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-destructive">Missing required ({result.missingSkills.length})</CardTitle></CardHeader>
                  <CardContent className="flex flex-wrap gap-1.5">
                    {result.missingSkills.map((skill) => <Badge key={skill} variant="danger">{skill}</Badge>)}
                    {!result.missingSkills.length && <p className="text-sm text-muted-foreground">Nothing missing.</p>}
                  </CardContent>
                </Card>
              </div>

              {result.preparationPlan.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Preparation plan</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {result.preparationPlan.map((item, index) => (
                      <div key={index} className="rounded-lg border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="font-medium">{item.focus}</h4>
                          <Badge variant={item.priority === 'CRITICAL' || item.priority === 'HIGH' ? 'danger' : 'warning'}>
                            {item.priority}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>
                        <p className="mt-1 text-xs text-muted-foreground">~{item.estimatedHours} hours</p>
                        {item.resources.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                            {item.resources.map((resource, i) => <li key={i}>· {resource}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'targets' && (
        <Card>
          <CardHeader>
            <CardTitle>Choose your target companies and roles</CardTitle>
            <p className="text-sm text-muted-foreground">
              Targets make interview practice company-specific and drive which skill gaps are flagged.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="mb-2 text-sm font-medium">Current targets</p>
              <div className="flex flex-wrap gap-1.5">
                {[...profile.data!.targetCompanies, ...profile.data!.targetRoles].map((item) => (
                  <Badge key={item} variant="secondary">{item}</Badge>
                ))}
                {!profile.data!.targetCompanies.length && !profile.data!.targetRoles.length && (
                  <p className="text-sm text-muted-foreground">None set yet.</p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Companies</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {companies.data?.items.map((company) => {
                  const selected = targetCompanies.includes(company.id);
                  return (
                    <button
                      key={company.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setTargetCompanies((current) =>
                          selected ? current.filter((id) => id !== company.id) : [...current, company.id],
                        )
                      }
                      className={cn(
                        'rounded-lg border p-3 text-left text-sm transition-colors',
                        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-accent',
                      )}
                    >
                      <p className="font-medium">{company.name}</p>
                      <p className="text-xs text-muted-foreground">{company.industry}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Roles</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {roles.data?.map((role) => {
                  const selected = targetRoles.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setTargetRoles((current) =>
                          selected ? current.filter((id) => id !== role.id) : [...current, role.id],
                        )
                      }
                      className={cn(
                        'rounded-lg border p-3 text-left text-sm transition-colors',
                        selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-accent',
                      )}
                    >
                      <p className="font-medium">{role.title}</p>
                      <p className="text-xs text-muted-foreground">{role.family}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <Button onClick={() => saveTargets.mutate()} loading={saveTargets.isPending} disabled={!targetCompanies.length && !targetRoles.length}>
              <Save className="size-4" />
              Save targets
            </Button>
          </CardContent>
        </Card>
      )}

      {tab === 'companies' && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {companies.data?.items.map((company) => (
            <Card key={company.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{company.name}</CardTitle>
                  <Badge variant="muted">{company.tier?.replace(/_/g, ' ')}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{company.industry}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {company.description && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{company.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {(company as unknown as { openRoles?: number }).openRoles ?? 0} open role(s)
                </p>
                {/* Unsourced recruitment data is labelled rather than presented as fact (§10) */}
                {(company.recruitmentPattern?.sources?.length ?? 0) === 0 && (
                  <Badge variant="warning">Recruitment info unverified</Badge>
                )}
              </CardContent>
            </Card>
          ))}
          {!companies.data?.items.length && (
            <EmptyState icon={Building2} title="No companies yet" message="Ask an administrator to add companies." className="md:col-span-3" />
          )}
        </div>
      )}
    </div>
  );
}
