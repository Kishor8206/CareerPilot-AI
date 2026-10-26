import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Star, Trash2, Upload, X } from 'lucide-react';
import type { JobDescriptionDto, ResumeAnalysisDto, ResumeDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, Progress, Select, Tabs, Textarea,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { ModelDisclaimer } from '@/components/domain/ScoreCards';
import { apiDelete, apiDownload, apiGet, apiGetPaginated, apiPost, apiPut, apiUpload, ApiClientError } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate, formatRelative, scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

const MAX_MB = 5;
const JD_MIN_CHARS = 80;
const JD_MAX_CHARS = 20_000;

/** A resume's identifier, whichever field the response carried it in. */
function resumeIdOf(resume: ResumeDto): string {
  return resume.id ?? (resume as unknown as { _id?: string })._id ?? '';
}

/** What the resume is compared against. */
type JdMode = 'none' | 'catalogue' | 'custom';

interface ExtractedJd {
  text: string;
  characters: number;
  recognisedSkills: string[];
  filename: string;
}

const JD_MODES: Array<{ value: JdMode; label: string }> = [
  { value: 'none', label: 'No comparison' },
  { value: 'catalogue', label: 'Predefined job' },
  { value: 'custom', label: 'My own job description' },
];

export default function ResumePage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = React.useState('analysis');
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const [jdMode, setJdMode] = React.useState<JdMode>('none');
  const [targetJd, setTargetJd] = React.useState('');
  const [customJd, setCustomJd] = React.useState('');
  const [customJdTitle, setCustomJdTitle] = React.useState('');
  const [jdFile, setJdFile] = React.useState<{ name: string; skills: string[] } | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const jdFileInput = React.useRef<HTMLInputElement>(null);

  const resumes = useQuery({ queryKey: ['resumes'], queryFn: () => apiGet<ResumeDto[]>('/resumes') });
  const analysis = useQuery({
    queryKey: ['resume', 'analysis', 'latest'],
    queryFn: () => apiGet<ResumeAnalysisDto | null>('/resumes/analysis/latest'),
  });
  const jobs = useQuery({
    queryKey: ['jobs', 'descriptions'],
    queryFn: () => apiGetPaginated<JobDescriptionDto>('/jobs/descriptions', { limit: 50 }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<ResumeDto>('/resumes/upload', file, 'resume', setUploadProgress),
    onSuccess: async (resume) => {
      setUploadProgress(null);
      toast.success('Resume uploaded', 'Running the analysis now…');
      await queryClient.invalidateQueries({ queryKey: ['resumes'] });
      startAnalysis(resumeIdOf(resume));
    },
    onError: (error) => {
      setUploadProgress(null);
      toast.error('Upload failed', error instanceof Error ? error.message : undefined);
    },
  });

  const analyze = useMutation({
    mutationFn: (resumeId: string) =>
      apiPost<{ analysis: ResumeAnalysisDto }>(`/resumes/${resumeId}/analyze`, {
        ...comparisonPayload(),
        applyToProfile: true,
      }),
    onSuccess: async () => {
      toast.success('Analysis complete', 'Your ATS score and readiness have been updated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['resume'] }),
        queryClient.invalidateQueries({ queryKey: ['student', 'dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['readiness'] }),
      ]);
      setTab('analysis');
    },
    onError: (error) => {
      const message =
        error instanceof ApiClientError && error.code === 'AI_SERVICE_UNAVAILABLE'
          ? 'The AI analysis service is not reachable. Your resume is saved — try again once it is running.'
          : error instanceof Error
            ? error.message
            : 'The analysis could not be completed.';
      toast.error('Analysis failed', message);
    },
  });

  const setPrimary = useMutation({
    mutationFn: (resumeId: string) => apiPut(`/resumes/${resumeId}/primary`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resumes'] }),
  });

  const remove = useMutation({
    mutationFn: (resumeId: string) => apiDelete(`/resumes/${resumeId}`),
    onSuccess: () => {
      toast.success('Resume deleted');
      queryClient.invalidateQueries({ queryKey: ['resumes'] });
      queryClient.invalidateQueries({ queryKey: ['resume'] });
    },
  });

  const extractJd = useMutation({
    mutationFn: (file: File) => apiUpload<ExtractedJd>('/resumes/jd/extract', file, 'jd'),
    onSuccess: (result) => {
      setCustomJd(result.text);
      setJdFile({ name: result.filename, skills: result.recognisedSkills });
      toast.success('Job description loaded', 'Review the text below, then analyse your resume against it.');
    },
    onError: (error) => toast.error('Could not read that file', error instanceof Error ? error.message : undefined),
  });

  const customJdLength = customJd.trim().length;

  /** The job description part of an analysis request, from the current selection. */
  function comparisonPayload(): Record<string, string | undefined> {
    if (jdMode === 'catalogue') return { jobDescriptionId: targetJd || undefined };
    if (jdMode === 'custom') {
      return { jobDescriptionText: customJd.trim(), jobDescriptionLabel: customJdTitle.trim() || undefined };
    }
    return {};
  }

  /** Explains what is missing from the comparison choice, or null when it is ready. */
  function comparisonProblem(): string | null {
    if (jdMode === 'catalogue' && !targetJd) return 'Choose a job to compare against, or switch to "No comparison".';
    if (jdMode === 'custom' && customJdLength < JD_MIN_CHARS) {
      return `Paste or upload the job description first (at least ${JD_MIN_CHARS} characters), or switch to "No comparison".`;
    }
    return null;
  }

  function startAnalysis(resumeId: string) {
    if (!resumeId) {
      toast.error('Analysis could not start', 'This resume could not be identified. Refresh the page and try again.');
      return;
    }
    const problem = comparisonProblem();
    if (problem) {
      toast.error('Job description needed', problem);
      return;
    }
    analyze.mutate(resumeId);
  }

  function handleJdFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error('File too large', `Please upload a file under ${MAX_MB} MB.`);
      return;
    }
    extractJd.mutate(file);
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = comparisonProblem();
    if (problem) {
      toast.error('Job description needed', problem);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error('File too large', `Please upload a file under ${MAX_MB} MB.`);
      return;
    }
    upload.mutate(file);
  }

  const report = analysis.data;
  const primary = resumes.data?.find((r) => r.isPrimary);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resume &amp; ATS Analysis"
        description="Upload your resume to extract your profile, score it against applicant-tracking criteria, and see exactly what to fix."
        actions={
          report && (
            <Button
              variant="outline"
              onClick={() =>
                apiDownload('/reports/RESUME_ANALYSIS', 'resume-report.pdf').catch((error) =>
                  toast.error('Download failed', error?.message),
                )
              }
            >
              <Download className="size-4" />
              Download report
            </Button>
          )
        }
      />

      {/* Upload */}
      <Card>
        <CardContent className="p-5">
          <div
            className="rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <Upload className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Drop your resume here, or choose a file</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX or TXT · maximum {MAX_MB} MB</p>

            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,text/plain"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => fileInput.current?.click()} loading={upload.isPending}>
                Choose file
              </Button>

            </div>

            {uploadProgress !== null && (
              <div className="mx-auto mt-4 max-w-xs">
                <Progress value={uploadProgress} />
                <p className="mt-1 text-xs text-muted-foreground">Uploading… {uploadProgress}%</p>
              </div>
            )}
          </div>

          {/* What to compare the resume against */}
          <div className="mt-5 space-y-3">
            <div>
              <p className="text-sm font-medium">Compare against a job description (optional)</p>
              <p className="text-xs text-muted-foreground">
                Your ATS score is always computed. A job description adds keyword coverage: which of its skills your
                resume shows and which are missing.
              </p>
            </div>

            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Job description to compare against">
              {JD_MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  role="radio"
                  aria-checked={jdMode === mode.value}
                  onClick={() => setJdMode(mode.value)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                    jdMode === mode.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {jdMode === 'catalogue' && (
              jobs.data && jobs.data.items.length > 0 ? (
                <Select
                  value={targetJd}
                  onChange={(e) => setTargetJd(e.target.value)}
                  className="w-full sm:w-auto sm:min-w-[20rem]"
                  aria-label="Predefined job description"
                >
                  <option value="">Choose a job…</option>
                  {jobs.data.items.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">No predefined job descriptions are available yet.</p>
              )
            )}

            {jdMode === 'custom' && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={jdFileInput}
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      handleJdFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => jdFileInput.current?.click()} loading={extractJd.isPending}>
                    <Paperclip className="size-4" />
                    Upload JD file
                  </Button>
                  <span className="text-xs text-muted-foreground">PDF, DOCX or TXT · or paste the text below</span>
                  {(customJd || jdFile) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={() => {
                        setCustomJd('');
                        setJdFile(null);
                      }}
                    >
                      <X className="size-4" />
                      Clear
                    </Button>
                  )}
                </div>

                <input
                  type="text"
                  value={customJdTitle}
                  onChange={(e) => setCustomJdTitle(e.target.value.slice(0, 120))}
                  placeholder="Job title or company (optional), e.g. SDE Intern at Acme"
                  aria-label="Job title or company"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                <Textarea
                  value={customJd}
                  onChange={(e) => {
                    setCustomJd(e.target.value.slice(0, JD_MAX_CHARS));
                    // Edited text no longer matches what was read from the file.
                    if (jdFile) setJdFile({ ...jdFile, skills: [] });
                  }}
                  rows={8}
                  placeholder="Paste the full job description here: responsibilities, required skills, preferred skills…"
                  aria-label="Job description text"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {jdFile ? `Loaded from ${jdFile.name}. ` : ''}
                    Your job description is used for this analysis only and is not saved.
                  </span>
                  <span className={cn('tabular-nums', customJdLength > 0 && customJdLength < JD_MIN_CHARS && 'text-destructive')}>
                    {customJdLength.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()} characters
                    {customJdLength > 0 && customJdLength < JD_MIN_CHARS && ` · at least ${JD_MIN_CHARS} needed`}
                  </span>
                </div>

                {jdFile && jdFile.skills.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Skills recognised in this job description ({jdFile.skills.length})</p>
                    <div className="flex flex-wrap gap-1.5">
                      {jdFile.skills.map((skill) => (
                        <Badge key={skill} variant="muted">{skill}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {jdMode !== 'none' && primary && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => startAnalysis(resumeIdOf(primary))}
                loading={analyze.isPending}
                disabled={Boolean(comparisonProblem())}
              >
                Analyse my current resume against this job
              </Button>
            )}
          </div>

          {analyze.isPending && (
            <Alert variant="info" title="Analysis in progress" className="mt-4">
              <p>
                Extracting text, detecting sections, matching skills and scoring against ATS criteria. This
                usually takes a few seconds.
              </p>
            </Alert>
          )}
        </CardContent>
      </Card>

      {resumes.isLoading ? (
        <LoadingState />
      ) : resumes.error ? (
        <ErrorState message={(resumes.error as Error).message} onRetry={() => resumes.refetch()} />
      ) : (
        <>
          {/* Uploaded files */}
          {resumes.data && resumes.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Your resumes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {resumes.data.map((resume) => (
                  <div
                    key={resumeIdOf(resume)}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{resume.originalName}</p>
                      <p className="text-xs text-muted-foreground">
                        v{resume.version} · {(resume.sizeBytes / 1024).toFixed(0)} KB ·{' '}
                        {formatRelative(resume.createdAt)}
                      </p>
                    </div>

                    {resume.isPrimary && <Badge variant="success">Primary</Badge>}
                    {resume.parseStatus === 'FAILED' && <Badge variant="danger">Parse failed</Badge>}

                    <div className="flex gap-1">
                      {!resume.isPrimary && (
                        <Button variant="ghost" size="icon" onClick={() => setPrimary.mutate(resumeIdOf(resume))} aria-label="Set as primary">
                          <Star className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => apiDownload(`/resumes/${resumeIdOf(resume)}/download`, resume.originalName)}
                        aria-label="Download"
                      >
                        <Download className="size-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => startAnalysis(resumeIdOf(resume))} loading={analyze.isPending}>
                        Re-analyse
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove.mutate(resumeIdOf(resume))} aria-label="Delete">
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Analysis */}
          {!report ? (
            <Card className="p-6">
              <EmptyState
                icon={FileText}
                title="No analysis yet"
                message={
                  primary
                    ? 'Your resume is uploaded. Run an analysis to get your ATS score.'
                    : 'Upload a resume to see your ATS score, extracted skills and specific improvements.'
                }
                action={
                  primary && (
                    <Button onClick={() => startAnalysis(resumeIdOf(primary))} loading={analyze.isPending}>
                      Analyse now
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row">
                  <div className="text-center">
                    <p
                      className={cn(
                        'text-5xl font-semibold tabular-nums',
                        scoreTone(report.atsScore) === 'success'
                          ? 'text-success'
                          : scoreTone(report.atsScore) === 'warning'
                            ? 'text-warning'
                            : 'text-destructive',
                      )}
                    >
                      {Math.round(report.atsScore)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">ATS score</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    <Progress
                      value={report.atsScore}
                      tone={scoreTone(report.atsScore) === 'muted' ? 'primary' : scoreTone(report.atsScore)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Analysed {formatDate(report.createdAt)} · engine v{report.engineVersion}
                      {report.jobDescriptionSource && report.jobMatchScore !== null && report.jobMatchScore !== undefined && (
                        <> · keyword coverage {Math.round(report.jobMatchScore)}%</>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {report.jobDescriptionSource
                        ? `Compared against: ${report.jobDescriptionLabel ?? 'a job description'}${report.jobDescriptionSource === 'CUSTOM' ? ' (your own job description)' : ''}`
                        : 'Not compared against a job description.'}
                    </p>
                    {report.jobDescriptionSource && report.matchedKeywords.length + report.missingKeywords.length === 0 && (
                      <p className="text-sm text-warning">
                        No known skills were recognised in that job description, so keyword coverage could not be measured.
                        Check that the text lists the required skills.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'analysis', label: 'Score breakdown' },
                  { value: 'extracted', label: 'Extracted profile' },
                  { value: 'keywords', label: 'Keywords' },
                  { value: 'improve', label: 'How to improve' },
                ]}
              />

              {tab === 'analysis' && (
                <Card>
                  <CardContent className="space-y-6 p-5">
                    <ScoreBarChart
                      layout="vertical"
                      height={340}
                      colorByValue
                      data={report.breakdown.map((item) => ({
                        label: item.criterion,
                        value: (item.score / item.maxScore) * 100,
                      }))}
                    />
                    <div className="space-y-3">
                      {report.breakdown.map((item) => (
                        <div key={item.criterion} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium">{item.criterion}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {item.score} / {item.maxScore}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {tab === 'extracted' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle>Contact details</CardTitle></CardHeader>
                    <CardContent className="space-y-1.5 text-sm">
                      <p><span className="text-muted-foreground">Name:</span> {report.parsed.name ?? 'Not detected'}</p>
                      <p><span className="text-muted-foreground">Email:</span> {report.parsed.email ?? 'Not detected'}</p>
                      <p><span className="text-muted-foreground">Phone:</span> {report.parsed.phone ?? 'Not detected'}</p>
                      {report.parsed.links?.length > 0 && (
                        <p className="break-all"><span className="text-muted-foreground">Links:</span> {report.parsed.links.join(', ')}</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>Skills detected ({report.parsed.skills?.length ?? 0})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1.5">
                        {(report.parsed.skills ?? []).map((skill) => (
                          <Badge key={skill} variant="secondary">{skill}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>Education</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {(report.parsed.education ?? []).length === 0 ? (
                        <p className="text-muted-foreground">No education entries detected.</p>
                      ) : (
                        report.parsed.education.map((entry, i) => (
                          <div key={i} className="rounded-md border border-border p-2">
                            <p className="font-medium">{entry.degree}</p>
                            <p className="text-xs text-muted-foreground">
                              {entry.institution}
                              {entry.cgpa ? ` · CGPA ${entry.cgpa}` : ''}
                              {entry.endYear ? ` · ${entry.endYear}` : ''}
                            </p>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle>Projects &amp; experience</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      {(report.parsed.projects ?? []).map((project, i) => (
                        <div key={i} className="rounded-md border border-border p-2">
                          <p className="font-medium">{project.title}</p>
                          {project.technologies?.length > 0 && (
                            <p className="text-xs text-muted-foreground">{project.technologies.join(', ')}</p>
                          )}
                        </div>
                      ))}
                      {(report.parsed.internships ?? []).map((entry, i) => (
                        <div key={`internship-${i}`} className="rounded-md border border-border p-2">
                          <p className="font-medium">{entry.role} · {entry.company}</p>
                          <p className="text-xs text-muted-foreground">Internship</p>
                        </div>
                      ))}
                      {!report.parsed.projects?.length && !report.parsed.internships?.length && (
                        <p className="text-muted-foreground">No projects or internships detected.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {tab === 'keywords' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle className="text-success">Matched keywords</CardTitle></CardHeader>
                    <CardContent>
                      {report.matchedKeywords.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Analyse your resume against a job description to see keyword matching.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {report.matchedKeywords.map((keyword) => (
                            <Badge key={keyword} variant="success">{keyword}</Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-destructive">Missing keywords</CardTitle></CardHeader>
                    <CardContent>
                      {report.missingKeywords.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No missing keywords detected.</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {report.missingKeywords.map((keyword) => (
                              <Badge key={keyword} variant="danger">{keyword}</Badge>
                            ))}
                          </div>
                          <Alert variant="warning" className="mt-4">
                            <p>
                              Do not simply paste these into a skills list. Add a project bullet that shows the
                              skill being used and the result it produced — that is what survives a human read.
                            </p>
                          </Alert>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {tab === 'improve' && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle className="text-success">Strengths</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {report.strengths.map((item, i) => (
                          <li key={i} className="flex gap-2"><span className="text-success">✓</span>{item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="text-destructive">Areas to fix</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {report.weaknesses.map((item, i) => (
                          <li key={i} className="flex gap-2"><span className="text-destructive">!</span>{item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="md:col-span-2">
                    <CardHeader><CardTitle>Formatting recommendations</CardTitle></CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm">
                        {report.formattingRecommendations.map((item, i) => (
                          <li key={i} className="flex gap-2 text-muted-foreground"><span>·</span>{item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  {report.jobSpecificRecommendations.length > 0 && (
                    <Card className="md:col-span-2">
                      <CardHeader><CardTitle>Job-specific recommendations</CardTitle></CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm">
                          {report.jobSpecificRecommendations.map((item, i) => (
                            <li key={i} className="flex gap-2 text-muted-foreground"><span>·</span>{item}</li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              <ModelDisclaimer text="This ATS score is a rule-based approximation produced by CareerPilot AI to help you improve your resume. It is not the output of any specific employer's applicant-tracking system." />
            </>
          )}
        </>
      )}
    </div>
  );
}
