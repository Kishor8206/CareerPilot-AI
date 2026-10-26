import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Editor from '@monaco-editor/react';
import { ArrowLeft, Check, Clock, Cpu, Lightbulb, Play, RotateCcw, Send, X } from 'lucide-react';
import { DSA_LANGUAGES, submissionStatusLabel } from '@careerpilot/shared';
import type {
  CodeExecutionResult, CodeReviewDto, CodeSandboxStatusDto, CodingProblemDto, CodingSubmissionDto, DsaLanguageId,
  TestCaseResult,
} from '@careerpilot/shared';
import { Alert, Badge, Button, Card, ErrorState, LoadingState, Select, Tabs } from '@/components/ui';
import { DifficultyBadge, VerdictBadge } from '@/components/domain/DsaProgress';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/format';

interface RunResponse {
  execution: CodeExecutionResult;
}

interface SubmitResponse extends RunResponse {
  score: number;
  submission: CodingSubmissionDto;
  aiReview: CodeReviewDto | null;
}

/** What the Results tab is currently showing. */
interface Outcome {
  mode: 'run' | 'submit';
  execution: CodeExecutionResult;
  aiReview: CodeReviewDto | null;
}

const LANGUAGE_KEY = 'careerpilot-dsa-language';
const codeKey = (problemId: string, language: string) => `careerpilot-dsa-code:${problemId}:${language}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Saving a draft is a convenience; the editor still works without it.
  }
}

const formatMemory = (kb: number) => (kb > 0 ? `${(kb / 1024).toFixed(1)} MB` : '—');

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function CodeBlock({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <pre
      className={cn(
        'overflow-x-auto whitespace-pre-wrap break-words rounded-md p-3 font-mono text-xs',
        tone === 'danger' ? 'bg-destructive/5 text-destructive' : 'bg-muted',
      )}
    >
      {children}
    </pre>
  );
}

function InputList({ inputs }: { inputs: Array<{ name: string; value: string }> }) {
  return (
    <div className="space-y-2">
      {inputs.map((input) => (
        <div key={input.name}>
          <p className="mb-1 text-xs text-muted-foreground">{input.name} =</p>
          <CodeBlock>{input.value}</CodeBlock>
        </div>
      ))}
    </div>
  );
}

function CaseSelector({
  count, selected, onSelect, state,
}: {
  count: number;
  selected: number;
  onSelect: (index: number) => void;
  state?: (index: number) => boolean | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }, (_, index) => {
        const passed = state?.(index);
        return (
          <button
            key={index}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={selected === index}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              selected === index ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {passed === true && <Check className="size-3 text-success" aria-label="Passed" />}
            {passed === false && <X className="size-3 text-destructive" aria-label="Failed" />}
            Case {index + 1}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom panel tabs                                                   */
/* ------------------------------------------------------------------ */

function TestCasesTab({ problem }: { problem: CodingProblemDto }) {
  const [selected, setSelected] = React.useState(0);
  const testCase = problem.testCases[selected];

  if (!testCase) return <p className="text-sm text-muted-foreground">This problem has no public test cases.</p>;

  return (
    <div className="space-y-3">
      <CaseSelector count={problem.testCases.length} selected={selected} onSelect={setSelected} />
      <InputList inputs={testCase.inputs} />
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Expected output</p>
        <CodeBlock>{testCase.expected}</CodeBlock>
      </div>
      <p className="text-xs text-muted-foreground">
        <strong>Run</strong> checks your code against these {problem.testCases.length} public test cases.{' '}
        <strong>Submit</strong> also judges it on {problem.hiddenTestCount} hidden test cases, whose inputs are not shown.
      </p>
    </div>
  );
}

function ConsoleTab({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) {
    return <p className="text-sm text-muted-foreground">Run your code to see what it prints. Output from print statements appears here.</p>;
  }
  const { execution } = outcome;
  if (!execution.executed) {
    return <p className="text-sm text-muted-foreground">Your code was not run, so there is no output.</p>;
  }
  if (execution.compileOutput) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-destructive">Compiler output</p>
        <CodeBlock tone="danger">{execution.compileOutput}</CodeBlock>
      </div>
    );
  }

  const visible = execution.results.filter((result) => !result.hidden);
  const withOutput = visible.filter((result) => result.stdout || result.stderr);
  if (!withOutput.length) {
    return <p className="text-sm text-muted-foreground">Your program did not print anything for the public test cases.</p>;
  }

  return (
    <div className="space-y-4">
      {withOutput.map((result) => (
        <div key={result.index} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Case {result.index + 1}</p>
          {result.stdout && <CodeBlock>{result.stdout}</CodeBlock>}
          {result.stderr && <CodeBlock tone="danger">{result.stderr}</CodeBlock>}
        </div>
      ))}
      {outcome.mode === 'submit' && (
        <p className="text-xs text-muted-foreground">Output from hidden test cases is not shown.</p>
      )}
    </div>
  );
}

function PublicCaseDetail({ result }: { result: TestCaseResult }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <VerdictBadge status={result.status} />
        <span className="text-xs text-muted-foreground">{result.executionTimeMs} ms</span>
      </div>
      {result.inputs && <InputList inputs={result.inputs} />}
      {result.status !== 'TIME_LIMIT_EXCEEDED' && result.status !== 'MEMORY_LIMIT_EXCEEDED' && result.status !== 'RUNTIME_ERROR' && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Your output</p>
          <CodeBlock tone={result.passed ? undefined : 'danger'}>{result.actual ?? '(nothing returned)'}</CodeBlock>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Expected output</p>
        <CodeBlock>{result.expected}</CodeBlock>
      </div>
      {result.stderr && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Error</p>
          <CodeBlock tone="danger">{result.stderr}</CodeBlock>
        </div>
      )}
    </div>
  );
}

function StaticAnalysis({ review }: { review: CodeReviewDto }) {
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-labelledby="static-analysis-heading">
      <div>
        <h3 id="static-analysis-heading" className="text-sm font-semibold">Static Code Analysis</h3>
        <p className="text-xs text-muted-foreground">
          An advisory AI review of your source code. It does not run your code and has no effect on the verdict above.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {review.complexityEstimate && (
          <>
            <Badge variant="info">Estimated time: {review.complexityEstimate.time}</Badge>
            <Badge variant="info">Estimated space: {review.complexityEstimate.space}</Badge>
          </>
        )}
        {typeof review.readabilityScore === 'number' && (
          <Badge variant="muted">Readability {Math.round(review.readabilityScore)}/100</Badge>
        )}
        {(review.detectedPatterns ?? []).map((pattern) => (
          <Badge key={pattern} variant="outline">{pattern}</Badge>
        ))}
      </div>
      {(review.suggestions ?? []).length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {review.suggestions.map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      )}
      {review.disclaimer && <p className="text-xs italic text-muted-foreground">{review.disclaimer}</p>}
    </section>
  );
}

function ResultsTab({ outcome, pending }: { outcome: Outcome | null; pending: 'run' | 'submit' | null }) {
  const [selected, setSelected] = React.useState(0);
  React.useEffect(() => {
    const firstFailure = outcome?.execution.results.find((result) => !result.hidden && !result.passed);
    setSelected(firstFailure?.index ?? 0);
  }, [outcome]);

  if (pending) {
    return <LoadingState label={pending === 'run' ? 'Running your code on the public test cases…' : 'Judging your submission on all test cases…'} />;
  }
  if (!outcome) {
    return <p className="text-sm text-muted-foreground">Run or submit your code to see the result here.</p>;
  }

  const { execution, mode } = outcome;
  const publicResults = execution.results.filter((result) => !result.hidden);
  const hiddenResults = execution.results.filter((result) => result.hidden);
  const notRun = execution.totalCount - execution.results.length;
  const current = publicResults.find((result) => result.index === selected) ?? publicResults[0];

  return (
    <div className="space-y-5">
      <section className="space-y-4" aria-labelledby="execution-result-heading">
        <div>
          <h3 id="execution-result-heading" className="text-sm font-semibold">Code Execution Result</h3>
          <p className="text-xs text-muted-foreground">
            {mode === 'run'
              ? 'From running your code on the public test cases. Not saved.'
              : 'From the judge, which ran your code on the public and hidden test cases. This is your verdict.'}
          </p>
        </div>

        {!execution.executed ? (
          <Alert variant="warning" title="Your code was not run">
            <p>{execution.message ?? 'The code sandbox is unavailable.'}</p>
            <p>No verdict or score has been recorded for it.</p>
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span
                className={cn('text-lg font-semibold', execution.status === 'ACCEPTED' ? 'text-success' : 'text-destructive')}
              >
                {submissionStatusLabel(execution.status)}
              </span>
              <span className="text-sm text-muted-foreground">
                {execution.passedCount} / {execution.totalCount} test cases passed
              </span>
              {execution.status !== 'COMPILATION_ERROR' && (
                <>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden /> {execution.runtimeMs} ms
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Cpu className="size-3.5" aria-hidden /> {formatMemory(execution.peakMemoryKb)}
                  </span>
                </>
              )}
            </div>

            {execution.message && <p className="text-sm text-muted-foreground">{execution.message}</p>}

            {execution.compileOutput && <CodeBlock tone="danger">{execution.compileOutput}</CodeBlock>}

            {publicResults.length > 0 && current && (
              <div className="space-y-3">
                <CaseSelector
                  count={publicResults.length}
                  selected={publicResults.indexOf(current)}
                  onSelect={(position) => setSelected(publicResults[position].index)}
                  state={(position) => publicResults[position]?.passed}
                />
                <PublicCaseDetail result={current} />
              </div>
            )}

            {mode === 'submit' && (hiddenResults.length > 0 || notRun > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Hidden test cases</p>
                <div className="flex flex-wrap gap-2">
                  {hiddenResults.map((result, position) => (
                    <span
                      key={result.index}
                      title={`${submissionStatusLabel(result.status)} · ${result.executionTimeMs} ms`}
                      className={cn(
                        'flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                        result.passed ? 'border-success/40 text-success' : 'border-destructive/40 text-destructive',
                      )}
                    >
                      {result.passed ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                      Hidden {position + 1}
                      <span className="sr-only">{result.passed ? 'passed' : submissionStatusLabel(result.status)}</span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  The inputs and expected outputs of hidden test cases are not shown.
                  {notRun > 0 && ` ${notRun} test case${notRun === 1 ? ' was' : 's were'} not run after the failure above.`}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {mode === 'submit' && outcome.aiReview && <StaticAnalysis review={outcome.aiReview} />}
    </div>
  );
}

function SubmissionsTab({
  submissions, loading, onLoadCode,
}: {
  submissions: CodingSubmissionDto[] | undefined;
  loading: boolean;
  onLoadCode: (submission: CodingSubmissionDto) => void;
}) {
  if (loading) return <LoadingState label="Loading submissions…" />;
  if (!submissions?.length) {
    return <p className="text-sm text-muted-foreground">You have not submitted a solution to this problem yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 pr-4 font-medium">Language</th>
            <th className="pb-2 pr-4 font-medium">Passed</th>
            <th className="pb-2 pr-4 font-medium">Runtime</th>
            <th className="pb-2 pr-4 font-medium">Memory</th>
            <th className="pb-2 pr-4 font-medium">Submitted</th>
            <th className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((submission) => (
            <tr key={submission.id} className="border-t border-border">
              <td className="py-2 pr-4"><VerdictBadge status={submission.status} /></td>
              <td className="py-2 pr-4">{DSA_LANGUAGES.find((l) => l.id === submission.language)?.label ?? submission.language}</td>
              <td className="py-2 pr-4 tabular-nums">{submission.passedCount} / {submission.totalCount}</td>
              <td className="py-2 pr-4 tabular-nums">{submission.runtimeMs} ms</td>
              <td className="py-2 pr-4 tabular-nums">{formatMemory(submission.memoryKb)}</td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">{formatDateTime(submission.createdAt)}</td>
              <td className="py-2 text-right">
                <Button variant="ghost" size="sm" onClick={() => onLoadCode(submission)}>Load code</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CodingProblemPage() {
  const { problemId = '' } = useParams();
  const toast = useToast();
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const [language, setLanguage] = React.useState<DsaLanguageId>(() => {
    const stored = readStorage(LANGUAGE_KEY);
    return DSA_LANGUAGES.some((l) => l.id === stored) ? (stored as DsaLanguageId) : 'python';
  });
  const [code, setCode] = React.useState('');
  const [leftTab, setLeftTab] = React.useState('description');
  const [bottomTab, setBottomTab] = React.useState('testcases');
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const problem = useQuery({
    queryKey: ['coding', 'problem', problemId],
    queryFn: () => apiGet<CodingProblemDto>(`/coding/problems/${problemId}`),
  });

  const sandbox = useQuery({
    queryKey: ['coding', 'sandbox'],
    queryFn: () => apiGet<CodeSandboxStatusDto>('/coding/sandbox'),
    staleTime: 30_000,
  });

  const submissions = useQuery({
    queryKey: ['coding', 'submissions', problemId],
    queryFn: () => apiGet<CodingSubmissionDto[]>('/coding/submissions', { problemId }),
    enabled: Boolean(problemId),
  });

  const data = problem.data;

  // A problem may not offer the language last used elsewhere.
  React.useEffect(() => {
    if (data && !data.supportedLanguages.includes(language)) setLanguage(data.supportedLanguages[0]);
  }, [data, language]);

  // Load this problem's draft for the selected language, or its starter code.
  React.useEffect(() => {
    if (!data) return;
    setCode(readStorage(codeKey(data.id, language)) ?? data.starterCode[language] ?? '');
  }, [data, language]);

  // A new problem starts with a clean results panel.
  React.useEffect(() => {
    setOutcome(null);
    setBottomTab('testcases');
    setLeftTab('description');
  }, [problemId]);

  const updateCode = (value: string) => {
    setCode(value);
    if (data) writeStorage(codeKey(data.id, language), value);
  };

  const changeLanguage = (next: DsaLanguageId) => {
    setLanguage(next);
    writeStorage(LANGUAGE_KEY, next);
  };

  const resetCode = () => {
    if (!data) return;
    if (!window.confirm('Replace your code with the starter code for this language?')) return;
    writeStorage(codeKey(data.id, language), null);
    setCode(data.starterCode[language] ?? '');
  };

  const loadSubmission = (submission: CodingSubmissionDto) => {
    if (!data) return;
    if (!window.confirm('Replace the code in the editor with this submission?')) return;
    const submissionLanguage = submission.language as DsaLanguageId;
    writeStorage(codeKey(data.id, submissionLanguage), submission.code);
    if (submissionLanguage === language) setCode(submission.code);
    else changeLanguage(submissionLanguage);
  };

  const run = useMutation({
    mutationFn: () => apiPost<RunResponse>(`/coding/problems/${problemId}/run`, { language, code }),
    onMutate: () => setBottomTab('results'),
    onSuccess: (response) => setOutcome({ mode: 'run', execution: response.execution, aiReview: null }),
    onError: (error) => toast.error('Run failed', error instanceof Error ? error.message : undefined),
  });

  const submit = useMutation({
    mutationFn: () => apiPost<SubmitResponse>(`/coding/problems/${problemId}/submit`, { language, code }),
    onMutate: () => setBottomTab('results'),
    onSuccess: (response) => {
      setOutcome({ mode: 'submit', execution: response.execution, aiReview: response.aiReview });
      void queryClient.invalidateQueries({ queryKey: ['coding', 'submissions', problemId] });
      void queryClient.invalidateQueries({ queryKey: ['coding', 'progress'] });
      void queryClient.invalidateQueries({ queryKey: ['coding', 'problems'] });
      void queryClient.invalidateQueries({ queryKey: ['student', 'dashboard'] });

      const { execution } = response;
      if (!execution.executed) toast.error('Not executed', execution.message);
      else if (execution.status === 'ACCEPTED') toast.success('Accepted', `All ${execution.totalCount} test cases passed.`);
      else toast.toast({ title: submissionStatusLabel(execution.status), description: `${execution.passedCount} / ${execution.totalCount} test cases passed.`, variant: 'info' });
    },
    onError: (error) => toast.error('Submission failed', error instanceof Error ? error.message : undefined),
  });

  if (problem.isLoading) return <LoadingState />;
  if (problem.error || !data) {
    return <ErrorState message={(problem.error as Error)?.message ?? 'Problem not found.'} onRetry={() => problem.refetch()} />;
  }

  const pending: 'run' | 'submit' | null = run.isPending ? 'run' : submit.isPending ? 'submit' : null;
  const busy = pending !== null;
  const empty = !code.trim();
  const monacoLanguage = DSA_LANGUAGES.find((l) => l.id === language)?.monaco ?? 'plaintext';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link to="/coding"><ArrowLeft className="size-4" />Problems</Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{data.title}</h1>
        <DifficultyBadge difficulty={data.difficulty} />
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((tag) => (
            <Badge key={tag} variant="muted">{tag}</Badge>
          ))}
        </div>
      </div>

      {sandbox.data && !sandbox.data.available && (
        <Alert variant="warning" title="Code execution is currently unavailable">
          <p>{sandbox.data.reason} Run and Submit will report that your code was not executed.</p>
        </Alert>
      )}

      <div className="grid gap-4 lg:h-[calc(100vh-13rem)] lg:min-h-[640px] lg:grid-cols-2">
        {/* Left: problem */}
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <Tabs
            value={leftTab}
            onChange={setLeftTab}
            className="px-2"
            tabs={[
              { value: 'description', label: 'Description' },
              { value: 'hints', label: 'Hints', count: data.hints.length },
            ]}
          />
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin">
            {leftTab === 'description' && (
              <>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.description}</p>

                {data.examples.map((example, index) => (
                  <div key={index} className="space-y-1">
                    <p className="text-sm font-semibold">Example {index + 1}</p>
                    <div className="space-y-1 rounded-md border-l-2 border-border bg-muted/40 p-3 font-mono text-xs">
                      <p><span className="font-sans font-medium">Input:</span> {example.input}</p>
                      <p><span className="font-sans font-medium">Output:</span> {example.output}</p>
                      {example.explanation && (
                        <p className="font-sans text-muted-foreground"><span className="font-medium text-foreground">Explanation:</span> {example.explanation}</p>
                      )}
                    </div>
                  </div>
                ))}

                {data.constraints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Constraints</p>
                    <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-muted-foreground">
                      {data.constraints.map((constraint) => (
                        <li key={constraint}>{constraint}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Time limit {data.timeLimitMs / 1000} s · Memory limit {data.memoryLimitMb} MB. Interpreted languages are given a proportionally longer time limit.
                </p>
              </>
            )}

            {leftTab === 'hints' && (
              data.hints.length ? (
                <div className="space-y-2">
                  {data.hints.map((hint, index) => (
                    <div key={index} className="flex gap-2 rounded-md border border-border p-3 text-sm">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      <p>{hint}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No hints are available for this problem.</p>
              )
            )}
          </div>
        </Card>

        {/* Right: editor above, results below */}
        <div className="flex min-h-0 flex-col gap-4">
          <Card className="flex min-h-[320px] flex-[3] flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <Select
                  value={language}
                  onChange={(e) => changeLanguage(e.target.value as DsaLanguageId)}
                  className="h-8 w-36"
                  aria-label="Programming language"
                  disabled={busy}
                >
                  {DSA_LANGUAGES.filter((option) => data.supportedLanguages.includes(option.id)).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </Select>
                <Button variant="ghost" size="sm" onClick={resetCode} disabled={busy} title="Reset to starter code">
                  <RotateCcw className="size-4" />
                  Reset
                </Button>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={busy || empty}>
                  <Play className="size-4" />
                  {run.isPending ? 'Running…' : 'Run'}
                </Button>
                <Button variant="success" size="sm" onClick={() => submit.mutate()} loading={submit.isPending} disabled={busy || empty}>
                  <Send className="size-4" />
                  {submit.isPending ? 'Judging…' : 'Submit'}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <Editor
                height="100%"
                language={monacoLanguage}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={code}
                onChange={(value) => updateCode(value ?? '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  readOnly: busy,
                }}
                loading={<LoadingState label="Loading editor…" />}
              />
            </div>
          </Card>

          <Card className="flex min-h-[260px] flex-[2] flex-col overflow-hidden">
            <Tabs
              value={bottomTab}
              onChange={setBottomTab}
              className="px-2"
              tabs={[
                { value: 'testcases', label: 'Test Cases', count: data.testCases.length },
                { value: 'console', label: 'Console' },
                { value: 'results', label: 'Results' },
                { value: 'submissions', label: 'Submissions', count: submissions.data?.length },
              ]}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
              {bottomTab === 'testcases' && <TestCasesTab problem={data} />}
              {bottomTab === 'console' && <ConsoleTab outcome={outcome} />}
              {bottomTab === 'results' && <ResultsTab outcome={outcome} pending={pending} />}
              {bottomTab === 'submissions' && (
                <SubmissionsTab submissions={submissions.data} loading={submissions.isLoading} onLoadCode={loadSubmission} />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
