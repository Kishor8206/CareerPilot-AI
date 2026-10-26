import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Check, ChevronLeft, ChevronRight, Cloud, CloudOff, Flag, Loader2,
  Maximize2, ShieldAlert, WifiOff,
} from 'lucide-react';
import type { AssessmentAttemptDto, AssessmentQuestionDto } from '@careerpilot/shared';
import { Alert, Badge, Button, ErrorState, LoadingState, Modal } from '@/components/ui';
import { useAssessmentSession, type AnswerState } from '@/hooks/useAssessmentSession';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDuration } from '@/utils/format';
import { cn } from '@/utils/cn';

interface AttemptPayload {
  // `answers` is narrowed from the DTO's `string | string[] | null`: the API
  // always persists an array or null, and the runner relies on that.
  attempt: Omit<AssessmentAttemptDto, 'answers'> & {
    answers: Array<{ questionId: string; answer: string[] | null; markedForReview: boolean; timeSpentSeconds: number }>;
  };
  assessment: { id: string; title: string; type: string; durationMinutes: number; requiresFullscreen: boolean; requiresWebcam: boolean; passingScore: number };
  questions: AssessmentQuestionDto[];
  remainingSeconds: number;
  serverTime: number;
}

/**
 * Full-screen assessment mode (§13).
 *
 * Rendered outside the application shell: no sidebar, no header, nothing to
 * navigate away with by accident. The timer is server-authoritative, answers
 * autosave continuously, and integrity signals are captured transparently.
 */
export default function AssessmentRunnerPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assessment', 'attempt', attemptId],
    queryFn: () => apiGet<AttemptPayload>(`/assessments/attempts/${attemptId}`),
    // The attempt is fetched once; all subsequent state is local plus autosave.
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) return <LoadingState label="Preparing your assessment…" className="min-h-screen" />;
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          title="This assessment could not be opened"
          message={error instanceof Error ? error.message : 'The attempt was not found or has already been submitted.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return <Runner payload={data} attemptId={attemptId} onExit={() => navigate('/assessments')} toast={toast} />;
}

function Runner({
  payload,
  attemptId,
  onExit,
  toast,
}: {
  payload: AttemptPayload;
  attemptId: string;
  onExit: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const navigate = useNavigate();
  const { assessment, questions } = payload;

  const [answers, setAnswers] = React.useState<Map<string, AnswerState>>(() => {
    const initial = new Map<string, AnswerState>();
    for (const question of questions) {
      const saved = payload.attempt.answers.find((a) => a.questionId === question.id);
      initial.set(question.id, {
        questionId: question.id,
        answer: saved?.answer ?? null,
        markedForReview: saved?.markedForReview ?? false,
        timeSpentSeconds: saved?.timeSpentSeconds ?? 0,
      });
    }
    return initial;
  });

  const [index, setIndex] = React.useState(0);
  const [showSubmit, setShowSubmit] = React.useState(false);
  const [showStart, setShowStart] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [fullscreenRefused, setFullscreenRefused] = React.useState(false);

  const questionEnteredAt = React.useRef(Date.now());
  const submittedRef = React.useRef(false);

  const handleExpire = React.useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    toast.error('Time is up', 'Your saved answers are being submitted automatically.');
    void submitAttempt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const session = useAssessmentSession({
    attemptId,
    expiresAt: payload.attempt.expiresAt,
    serverTime: payload.serverTime,
    requiresFullscreen: assessment.requiresFullscreen,
    onExpire: handleExpire,
  });

  const current = questions[index];
  const answeredCount = [...answers.values()].filter((a) => a.answer && a.answer.length > 0).length;
  const reviewCount = [...answers.values()].filter((a) => a.markedForReview).length;

  /** Records time on the question being left, so per-question timing is real. */
  const commitTimeSpent = React.useCallback(
    (questionId: string) => {
      const elapsed = Math.round((Date.now() - questionEnteredAt.current) / 1000);
      questionEnteredAt.current = Date.now();
      if (elapsed <= 0) return;

      setAnswers((previous) => {
        const next = new Map(previous);
        const entry = next.get(questionId);
        if (entry) {
          const updated = { ...entry, timeSpentSeconds: entry.timeSpentSeconds + elapsed };
          next.set(questionId, updated);
          session.queueAutosave(updated);
        }
        return next;
      });
    },
    [session],
  );

  function goTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= questions.length || nextIndex === index) return;
    commitTimeSpent(questions[index].id);
    setIndex(nextIndex);
  }

  function setAnswer(questionId: string, value: string, multi: boolean) {
    setAnswers((previous) => {
      const next = new Map(previous);
      const entry = next.get(questionId)!;

      let updatedAnswer: string[] | null;
      if (multi) {
        const currentValues = entry.answer ?? [];
        updatedAnswer = currentValues.includes(value)
          ? currentValues.filter((v) => v !== value)
          : [...currentValues, value];
        if (updatedAnswer.length === 0) updatedAnswer = null;
      } else {
        // Selecting the same option again clears it, so a student can undo.
        updatedAnswer = entry.answer?.[0] === value ? null : [value];
      }

      const updated = { ...entry, answer: updatedAnswer };
      next.set(questionId, updated);
      session.queueAutosave(updated);
      return next;
    });
  }

  function toggleReview(questionId: string) {
    setAnswers((previous) => {
      const next = new Map(previous);
      const entry = next.get(questionId)!;
      const updated = { ...entry, markedForReview: !entry.markedForReview };
      next.set(questionId, updated);
      session.queueAutosave(updated);
      return next;
    });
  }

  async function submitAttempt(automatic = false) {
    if (submitting) return;
    setSubmitting(true);
    submittedRef.current = true;

    try {
      commitTimeSpent(questions[index].id);
      // Flush everything before grading, so no answer is lost at the boundary.
      await session.flushAutosave();
      await session.flushMonitoring();

      await apiPost(`/assessments/attempts/${attemptId}/submit`, {
        answers: [...answers.values()].map((a) => ({
          questionId: a.questionId,
          answer: a.answer,
          markedForReview: a.markedForReview,
          timeSpentSeconds: a.timeSpentSeconds,
        })),
      });

      await session.exitFullscreen();
      if (!automatic) toast.success('Assessment submitted', 'Your result is ready.');
      navigate(`/assessments/result/${attemptId}`, { replace: true });
    } catch (caught) {
      submittedRef.current = false;
      setSubmitting(false);
      toast.error(
        'Submission failed',
        caught instanceof Error ? caught.message : 'Your answers are still saved. Please try again.',
      );
    }
  }

  async function handleStart() {
    if (assessment.requiresFullscreen) {
      const entered = await session.enterFullscreen();
      if (!entered) setFullscreenRefused(true);
    }
    setShowStart(false);
    questionEnteredAt.current = Date.now();
  }

  const timeIsCritical = session.remainingSeconds <= 60;
  const timeIsLow = session.remainingSeconds <= 300;

  /* ---- Pre-start consent and instructions ---- */
  if (showStart) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-xl space-y-4 rounded-lg border border-border bg-card p-6">
          <div>
            <h1 className="text-xl font-semibold">{assessment.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {questions.length} questions · {assessment.durationMinutes} minutes · pass mark{' '}
              {assessment.passingScore}%
            </p>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">Before you begin</p>
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>The timer runs on the server and continues even if you close this tab.</li>
              <li>Your answers save automatically as you work.</li>
              <li>If you refresh or lose connection, you can resume exactly where you left off.</li>
              {assessment.requiresFullscreen && <li>This assessment runs in full-screen mode.</li>}
            </ul>
          </div>

          {/* Monitoring is disclosed up front, never covertly (§14, §30). */}
          <Alert variant="info" title="What is monitored during this assessment">
            <p>
              To protect assessment integrity, the platform records when the window leaves full screen, when the
              tab is hidden, and paste events. You can see every recorded signal in your result afterwards.
            </p>
            <p className="mt-2">
              These signals are advisory. They never invalidate your result automatically — a person reviews the
              context before any decision. Nothing about your appearance, identity or emotions is analysed.
            </p>
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onExit}>
              Cancel
            </Button>
            <Button onClick={handleStart}>
              <Maximize2 className="size-4" />
              Start assessment
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background no-select">
      {/* Header: title, progress, timer, status indicators */}
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="text-sm font-semibold">CareerPilot AI</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">{assessment.title}</span>

          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            Question {index + 1} / {questions.length}
          </span>

          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-sm font-semibold tabular-nums',
              timeIsCritical
                ? 'animate-pulse bg-destructive text-destructive-foreground'
                : timeIsLow
                  ? 'bg-warning/15 text-warning'
                  : 'bg-secondary text-secondary-foreground',
            )}
            role="timer"
            aria-live={timeIsLow ? 'assertive' : 'off'}
            aria-label={`Time remaining: ${formatDuration(session.remainingSeconds)}`}
          >
            {formatDuration(session.remainingSeconds)}
          </div>

          {/* Save status */}
          <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
            {session.saveStatus === 'saving' && <><Loader2 className="size-3 animate-spin" /> Saving…</>}
            {session.saveStatus === 'saved' && <><Cloud className="size-3 text-success" /> Saved</>}
            {session.saveStatus === 'pending' && <><Cloud className="size-3" /> Unsaved</>}
            {session.saveStatus === 'error' && <><CloudOff className="size-3 text-destructive" /> Retrying…</>}
            {session.saveStatus === 'offline' && <><CloudOff className="size-3 text-warning" /> Offline</>}
          </span>

          {!session.online && (
            <Badge variant="warning" className="gap-1">
              <WifiOff className="size-3" />
              Offline
            </Badge>
          )}
        </div>

        <div className="h-1 w-full bg-secondary">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
      </header>

      {/* Non-blocking warnings */}
      <div className="space-y-2 px-4 pt-3 sm:px-6">
        {assessment.requiresFullscreen && !session.isFullscreen && !fullscreenRefused && (
          <Alert variant="warning" title="You have left full-screen mode">
            <div className="flex flex-wrap items-center gap-3">
              <p>This has been recorded. Returning to full screen keeps your integrity indicator clean.</p>
              <Button size="sm" variant="outline" onClick={() => void session.enterFullscreen()}>
                <Maximize2 className="size-3.5" />
                Re-enter full screen
              </Button>
            </div>
          </Alert>
        )}

        {fullscreenRefused && (
          <Alert variant="info" title="Full-screen mode is unavailable">
            <p>
              Your browser refused full-screen mode. The assessment continues normally — this has been noted so it
              is not mistaken for you leaving deliberately.
            </p>
          </Alert>
        )}

        {!session.online && (
          <Alert variant="warning" title="You are offline">
            <p>
              Your answers are being kept locally and will be saved as soon as your connection returns. Keep
              working — nothing has been lost.
            </p>
          </Alert>
        )}

        {session.integrityNotice && (
          <Alert variant="warning" title="Integrity signals recorded">
            <p>{session.integrityNotice}</p>
          </Alert>
        )}
      </div>

      {/* Question and navigator */}
      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:flex-row">
        <main className="flex-1">
          <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{current.topic}</Badge>
              <Badge variant="outline">{current.difficulty}</Badge>
              <Badge variant="muted">{current.marks} mark{current.marks === 1 ? '' : 's'}</Badge>
              {answers.get(current.id)?.markedForReview && (
                <Badge variant="warning" className="gap-1">
                  <Flag className="size-3" />
                  Marked for review
                </Badge>
              )}
            </div>

            <h2 className="text-base font-medium leading-relaxed sm:text-lg">{current.prompt}</h2>

            <div className="mt-6 space-y-2" role="group" aria-label="Answer options">
              {(current.options ?? []).map((option) => {
                const selected = answers.get(current.id)?.answer?.includes(option.key) ?? false;
                const multi = current.type === 'MULTI_SELECT';

                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setAnswer(current.id, option.key, multi)}
                    aria-pressed={selected}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/40 hover:bg-accent',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center border text-xs font-semibold',
                        multi ? 'rounded' : 'rounded-full',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {selected ? <Check className="size-3.5" /> : option.key}
                    </span>
                    <span className="text-sm leading-relaxed">{option.text}</span>
                  </button>
                );
              })}
            </div>

            {current.type === 'SHORT_ANSWER' && (
              <textarea
                className="mt-4 min-h-[120px] w-full rounded-md border border-input bg-background p-3 text-sm"
                placeholder="Type your answer…"
                value={answers.get(current.id)?.answer?.[0] ?? ''}
                onChange={(e) => {
                  setAnswers((previous) => {
                    const next = new Map(previous);
                    const entry = next.get(current.id)!;
                    const updated = { ...entry, answer: e.target.value ? [e.target.value] : null };
                    next.set(current.id, updated);
                    session.queueAutosave(updated);
                    return next;
                  });
                }}
              />
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}>
              <ChevronLeft className="size-4" />
              Previous
            </Button>

            <Button variant="outline" onClick={() => toggleReview(current.id)}>
              <Flag className="size-4" />
              {answers.get(current.id)?.markedForReview ? 'Unmark' : 'Mark for review'}
            </Button>

            {index < questions.length - 1 ? (
              <Button className="ml-auto" onClick={() => goTo(index + 1)}>
                Next
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button className="ml-auto" onClick={() => setShowSubmit(true)}>
                Submit assessment
              </Button>
            )}
          </div>
        </main>

        {/* Question navigator */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-semibold">Question navigator</h3>

            <div className="mt-3 grid grid-cols-8 gap-1.5 lg:grid-cols-5">
              {questions.map((question, questionIndex) => {
                const entry = answers.get(question.id);
                const answered = Boolean(entry?.answer?.length);
                const marked = entry?.markedForReview;

                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => goTo(questionIndex)}
                    aria-label={`Question ${questionIndex + 1}${answered ? ', answered' : ', not answered'}${marked ? ', marked for review' : ''}`}
                    aria-current={questionIndex === index}
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-md border text-xs font-medium transition-colors',
                      questionIndex === index && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
                      answered
                        ? 'border-success bg-success/15 text-success'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {questionIndex + 1}
                    {marked && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-warning" />}
                  </button>
                );
              })}
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Answered</dt>
                <dd className="font-medium tabular-nums text-success">{answeredCount} / {questions.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Marked for review</dt>
                <dd className="font-medium tabular-nums">{reviewCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Integrity signals</dt>
                <dd
                  className={cn(
                    'font-medium tabular-nums',
                    session.integrityRisk === 'HIGH'
                      ? 'text-destructive'
                      : session.integrityRisk === 'MEDIUM'
                        ? 'text-warning'
                        : 'text-muted-foreground',
                  )}
                >
                  {session.monitoringEventCount}
                </dd>
              </div>
            </dl>

            <Button className="mt-4 w-full" onClick={() => setShowSubmit(true)}>
              Submit assessment
            </Button>
          </div>
        </aside>
      </div>

      {/* Submit confirmation (§13) */}
      <Modal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title="Submit this assessment?"
        description="You cannot change your answers after submitting."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowSubmit(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button onClick={() => void submitAttempt()} loading={submitting}>
              Submit now
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <dt className="label-muted">Answered</dt>
              <dd className="stat-value text-success">{answeredCount} / {questions.length}</dd>
            </div>
            <div className="rounded-lg border border-border p-3">
              <dt className="label-muted">Time remaining</dt>
              <dd className="stat-value font-mono">{formatDuration(session.remainingSeconds)}</dd>
            </div>
          </dl>

          {answeredCount < questions.length && (
            <Alert variant="warning" title={`${questions.length - answeredCount} question(s) unanswered`}>
              <p>Unanswered questions score zero. You still have time to go back and complete them.</p>
            </Alert>
          )}

          {reviewCount > 0 && (
            <Alert variant="info" title={`${reviewCount} question(s) marked for review`}>
              <p>You flagged these to revisit. Submitting now leaves them as they are.</p>
            </Alert>
          )}

          {session.integrityRisk !== 'LOW' && (
            <Alert variant="warning" title="Integrity signals were recorded">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <p>
                  Some activity during this assessment has been flagged for human review. Your result is not
                  affected automatically, and you can see exactly what was recorded in your report.
                </p>
              </div>
            </Alert>
          )}
        </div>
      </Modal>
    </div>
  );
}
