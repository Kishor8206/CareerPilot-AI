import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, Play, Video } from 'lucide-react';
import { Difficulty, InterviewMode } from '@careerpilot/shared';
import type { CompanyDto, JobRoleDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field,
  LoadingState, PageHeader, Select, Table, Td, Th,
} from '@/components/ui';
import { apiGet, apiGetPaginated, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate, scoreTone } from '@/utils/format';

const MODES: Array<{ value: InterviewMode; label: string; description: string }> = [
  { value: InterviewMode.TECHNICAL, label: 'Technical', description: 'Data structures, CS fundamentals and your projects.' },
  { value: InterviewMode.HR, label: 'HR', description: 'Motivation, self-assessment and organisational fit.' },
  { value: InterviewMode.BEHAVIORAL, label: 'Behavioural', description: 'STAR-format questions on teamwork and resilience.' },
  { value: InterviewMode.COMPANY_SPECIFIC, label: 'Company-specific', description: 'Grounded in what the knowledge base holds about a company.' },
  { value: InterviewMode.ROLE_SPECIFIC, label: 'Role-specific', description: 'Targeted at the requirements of one role.' },
  { value: InterviewMode.RESUME_BASED, label: 'Resume-based', description: 'Probes the technologies on your own resume.' },
];

export default function InterviewPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = React.useState<InterviewMode>(InterviewMode.TECHNICAL);
  const [companyId, setCompanyId] = React.useState('');
  const [roleId, setRoleId] = React.useState('');
  const [difficulty, setDifficulty] = React.useState<Difficulty>(Difficulty.MEDIUM);
  const [questionCount, setQuestionCount] = React.useState(8);

  const sessions = useQuery({
    queryKey: ['interviews', 'sessions'],
    queryFn: () => apiGet<Array<Record<string, any>>>('/interviews/sessions'),
  });
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => apiGetPaginated<CompanyDto>('/companies', { limit: 50 }),
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => apiGet<JobRoleDto[]>('/jobs/roles') });

  const start = useMutation({
    mutationFn: () =>
      apiPost<{ session: { id: string } }>('/interviews/start', {
        mode,
        companyId: companyId || undefined,
        roleId: roleId || undefined,
        difficulty,
        plannedQuestions: questionCount,
      }),
    onSuccess: (data) => navigate(`/interview/session/${data.session.id}`),
    onError: (error) => toast.error('Could not start the interview', error instanceof Error ? error.message : undefined),
  });

  const needsCompany = mode === InterviewMode.COMPANY_SPECIFIC;
  const completed = sessions.data?.filter((s) => s.status === 'COMPLETED') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Mock Interview"
        description="An adaptive interview that changes difficulty based on how you answer, and gives explainable feedback on every response."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Start a new interview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MODES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  aria-pressed={mode === option.value}
                  className={
                    mode === option.value
                      ? 'rounded-lg border border-primary bg-primary/5 p-3 text-left ring-1 ring-primary'
                      : 'rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent'
                  }
                >
                  <p className="text-sm font-medium">{option.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Company" htmlFor="company" required={needsCompany}>
                <Select id="company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">{needsCompany ? 'Select a company' : 'Any company'}</option>
                  {companies.data?.items.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Target role" htmlFor="role">
                <Select id="role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">Any role</option>
                  {roles.data?.map((role) => (
                    <option key={role.id} value={role.id}>{role.title}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Starting difficulty" htmlFor="difficulty" hint="It adapts as you answer.">
                <Select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value={Difficulty.EASY}>Easy</option>
                  <option value={Difficulty.MEDIUM}>Medium</option>
                  <option value={Difficulty.HARD}>Hard</option>
                </Select>
              </Field>
            </div>

            <Field label="Number of questions" htmlFor="count">
              <Select id="count" value={String(questionCount)} onChange={(e) => setQuestionCount(Number(e.target.value))}>
                {[5, 8, 10, 12, 15].map((n) => (
                  <option key={n} value={n}>{n} questions</option>
                ))}
              </Select>
            </Field>

            {needsCompany && !companyId && (
              <Alert variant="warning">
                <p>Select a company for a company-specific interview.</p>
              </Alert>
            )}

            <Alert variant="info" title="How this interview is evaluated">
              <p>
                Answers are scored on relevance, correctness, completeness, communication and structure, plus
                objective delivery signals such as answer length and filler-word rate. Nothing about your
                personality, emotions or appearance is assessed.
              </p>
            </Alert>

            <Button
              className="w-full"
              onClick={() => start.mutate()}
              loading={start.isPending}
              disabled={needsCompany && !companyId}
            >
              <Play className="size-4" />
              Start interview
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Practise with a human</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              AI practice builds fluency. A live mock interview with a verified alumnus catches what automated
              scoring cannot, and their feedback is weighted directly into your readiness score.
            </p>
            <Button variant="outline" className="w-full" asChild>
              <Link to="/alumni">
                <Video className="size-4" />
                Find an alumni mentor
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Past interviews</CardTitle></CardHeader>
        <CardContent>
          {sessions.isLoading ? (
            <LoadingState />
          ) : completed.length === 0 ? (
            <EmptyState icon={Bot} title="No completed interviews yet" message="Your reports will appear here." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Mode</Th>
                  <Th>Company / role</Th>
                  <Th>Score</Th>
                  <Th>Date</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {completed.map((session) => {
                  const score = session.evaluationId?.overallScore as number | undefined;
                  const tone = scoreTone(score);
                  return (
                    <tr key={session.id ?? session._id}>
                      <Td><Badge variant="secondary">{String(session.mode).replace(/_/g, ' ')}</Badge></Td>
                      <Td className="text-muted-foreground">
                        {session.companyId?.name ?? '—'}
                        {session.roleId?.title ? ` · ${session.roleId.title}` : ''}
                      </Td>
                      <Td>
                        <span className={tone === 'success' ? 'font-semibold text-success' : tone === 'warning' ? 'font-semibold text-warning' : 'font-semibold text-destructive'}>
                          {score !== undefined ? Math.round(score) : '—'}
                        </span>
                      </Td>
                      <Td className="text-muted-foreground">{formatDate(session.completedAt ?? session.createdAt)}</Td>
                      <Td>
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/interview/report/${session.id ?? session._id}`}>View report</Link>
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
