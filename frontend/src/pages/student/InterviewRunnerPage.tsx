import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bot, Check, Clock, RotateCcw, Send, StopCircle, Volume2,
} from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState,
  Modal, Progress,
} from '@/components/ui';
import {
  MicButton, SpeechErrorNotice, SpeechIndicator, SpeechProviderNotice, TranscriptEditor,
  VoiceModeToggle, VoiceOnboarding,
} from '@/components/domain/VoiceControls';
import { apiGet, apiPost } from '@/services/api';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useVoiceStore } from '@/store/voice.store';
import { useToast } from '@/components/domain/Toast';
import { detectSpeechCapabilities } from '@/services/speech';
import { formatDuration, scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

interface Question {
  id: string; index: number; question: string; category: string; topic: string;
  difficulty: string; difficultyReason?: string;
  sources?: Array<{ title: string; score: number; category: string }>;
}

interface Evaluation {
  relevance: number; correctness: number; completeness: number; communication: number;
  structure: number; overall: number; strengths: string[]; improvements: string[];
  explanation: string; missedPoints: string[];
  deliverySignals: { wordCount: number; fillerWordRate: number; responseLengthVerdict: string; clarityScore: number };
  disclaimer: string;
}

/** Where the student is in the ask → listen → review → evaluate cycle. */
type Phase = 'presenting' | 'answering' | 'reviewing' | 'submitting' | 'feedback';

/** Answers survive a refresh here, so a lost tab never costs a spoken answer. */
const draftKey = (sessionId: string, questionId: string) => `cp-interview-draft:${sessionId}:${questionId}`;

export default function InterviewRunnerPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const voice = useVoiceStore();

  const [question, setQuestion] = React.useState<Question | null>(null);
  const [answer, setAnswer] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>('presenting');
  const [lastEvaluation, setLastEvaluation] = React.useState<Evaluation | null>(null);
  const [answeredCount, setAnsweredCount] = React.useState(0);
  const [_recentScores, setRecentScores] = React.useState<number[]>([]);
  const [showEnd, setShowEnd] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  const questionStartedAt = React.useRef(Date.now());
  const feedbackRef = React.useRef<HTMLDivElement>(null);

  const speech = useSpeechSynthesis();

  const mic = useSpeechInput({
    silenceTimeoutMs: 8000,
    maxDurationMs: 180_000,
    onFinal: () => {
      // Silence ended the recording: move to review so the student can correct
      // the transcript rather than having it submitted from under them.
      setPhase('reviewing');
    },
  });

  const session = useQuery({
    queryKey: ['interview', 'session', sessionId],
    queryFn: () =>
      apiGet<{ session: Record<string, any>; questions: Array<Question & { response?: unknown }> }>(
        `/interviews/sessions/${sessionId}`,
      ),
    staleTime: Infinity,
  });

  /* ---- Session recovery: resume at the first unanswered question ---- */
  React.useEffect(() => {
    if (!session.data) return;

    const questions = session.data.questions;
    const answered = questions.filter((q) => q.response);
    const pending = questions.find((q) => !q.response) ?? null;

    setAnsweredCount(answered.length);
    setRecentScores(
      answered
        .map((q) => (q.response as { evaluation?: { overall?: number } } | undefined)?.evaluation?.overall)
        .filter((v): v is number => Number.isFinite(v)),
    );
    setQuestion(pending);

    // Restore an in-progress answer that a refresh would otherwise have lost.
    if (pending) {
      const draft = localStorage.getItem(draftKey(sessionId, pending.id));
      if (draft) {
        setAnswer(draft);
        setPhase('reviewing');
        toast.toast({
          title: 'Draft answer restored',
          description: 'Your unsent answer was recovered after the page reloaded.',
          variant: 'info',
        });
      }
    }
  }, [session.data, sessionId, toast]);

  /* ---- Elapsed timer ---- */
  React.useEffect(() => {
    const startedAt = session.data?.session?.startedAt
      ? new Date(session.data.session.startedAt).getTime()
      : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session.data?.session?.startedAt]);

  /* ---- Voice onboarding, offered once ---- */
  React.useEffect(() => {
    void detectSpeechCapabilities().then((caps) => {
      if (!voice.onboarded && (caps.recognition || caps.synthesis)) setShowOnboarding(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Persist the draft as the student writes or speaks ---- */
  React.useEffect(() => {
    if (!question) return;
    if (answer.trim()) localStorage.setItem(draftKey(sessionId, question.id), answer);
    else localStorage.removeItem(draftKey(sessionId, question.id));
  }, [answer, question, sessionId]);

  /* ---- Speak each new question, then optionally open the mic ---- */
  const askQuestion = React.useCallback(
    async (next: Question) => {
      setPhase('presenting');
      questionStartedAt.current = Date.now();

      if (voice.enabled && voice.speakEnabled && speech.supported) {
        await speech.speak(next.question);
      }

      // Auto-listen only when the student asked for it: opening a microphone
      // unannounced is startling and, in a shared room, intrusive.
      if (voice.enabled && voice.micEnabled && voice.autoListen && mic.supported) {
        setPhase('answering');
        await mic.start();
      } else {
        setPhase('answering');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voice.enabled, voice.speakEnabled, voice.micEnabled, voice.autoListen, speech.supported, mic.supported],
  );

  // Speak a question the moment it arrives, including the first one.
  const spokenRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!question || spokenRef.current === question.id) return;
    spokenRef.current = question.id;
    void askQuestion(question);
  }, [question, askQuestion]);

  /* ---- Mic transcript flows into the editable answer ---- */
  React.useEffect(() => {
    if (mic.finalTranscript) setAnswer(mic.finalTranscript);
  }, [mic.finalTranscript]);

  const submit = useMutation({
    mutationFn: () =>
      apiPost<{ evaluation: Evaluation; nextQuestion: Question | null; completed: boolean }>(
        `/interviews/sessions/${sessionId}/answer`,
        {
          questionId: question!.id,
          transcript: answer.trim(),
          inputMode: mic.usedSpeech ? 'SPEECH' : 'TEXT',
          durationSeconds: Math.round((Date.now() - questionStartedAt.current) / 1000),
        },
      ),
    onSuccess: async (data) => {
      localStorage.removeItem(draftKey(sessionId, question!.id));

      setLastEvaluation(data.evaluation);
      setAnsweredCount((count) => count + 1);
      setRecentScores((scores) => [...scores, data.evaluation.overall]);
      setAnswer('');
      mic.reset();
      setPhase('feedback');

      // Bring the feedback into view: on a laptop it lands below the fold.
      requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));

      if (data.completed) {
        toast.success('Interview complete', 'Your full report is ready.');
        setTimeout(() => navigate(`/interview/report/${sessionId}`, { replace: true }), 1200);
      } else {
        setQuestion(data.nextQuestion);
      }
    },
    onError: (error) => {
      setPhase('reviewing');
      toast.error(
        'Could not submit your answer',
        error instanceof Error
          ? `${error.message} Your answer is still here — try again.`
          : 'Your answer is still here — try again.',
      );
    },
  });

  const end = useMutation({
    mutationFn: () => apiPost(`/interviews/sessions/${sessionId}/end`),
    onSuccess: () => {
      speech.stop();
      mic.cancel();
      toast.toast({ title: 'Interview ended', description: 'Answered questions were still scored.' });
      navigate(`/interview/report/${sessionId}`, { replace: true });
    },
  });

  // Stop any audio when leaving the page.
  React.useEffect(() => () => { speech.stop(); mic.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (session.isLoading) return <LoadingState label="Loading your interview…" />;
  if (session.error || !session.data) {
    return <ErrorState message={(session.error as Error)?.message} onRetry={() => session.refetch()} />;
  }

  const meta = session.data.session;
  const planned = Number(meta.plannedQuestions ?? 8);
  const progress = (answeredCount / planned) * 100;
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  const indicatorState: 'idle' | 'speaking' | 'listening' | 'thinking' =
    speech.speaking ? 'speaking'
      : mic.listening ? 'listening'
        : submit.isPending ? 'thinking'
          : 'idle';

  async function startRecording() {
    setPhase('answering');
    await mic.start();
  }

  function stopRecording() {
    mic.stop();
    setPhase('reviewing');
  }

  /** Discards the recorded answer and lets the student say it again. */
  function retakeAnswer() {
    mic.reset();
    setAnswer('');
    setPhase('answering');
    if (question) localStorage.removeItem(draftKey(sessionId, question.id));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header: mode, progress, timer */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {String(meta.mode).replace(/_/g, ' ')} interview
          </h1>
          <p className="text-sm text-muted-foreground">
            Question {Math.min(answeredCount + 1, planned)} of {planned}
            {meta.companyId?.name ? ` · ${meta.companyId.name}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted" className="gap-1.5 font-mono tabular-nums">
            <Clock className="size-3" />
            {formatDuration(elapsed)}
          </Badge>
          <VoiceModeToggle
            capabilities={mic.capabilities}
            compact
            onEnable={async () => {
              if (mic.capabilities?.permission !== 'granted') await mic.requestPermission();
            }}
          />
          <Button variant="outline" size="sm" onClick={() => setShowEnd(true)}>
            <StopCircle className="size-4" />
            End
          </Button>
        </div>
      </div>

      <Progress value={progress} />

      {showOnboarding && (
        <VoiceOnboarding
          capabilities={mic.capabilities}
          onAccept={async () => {
            setShowOnboarding(false);
            voice.markOnboarded();
            const granted = await mic.requestPermission();
            voice.setEnabled(true);
            if (granted && question) void speech.speak(question.question);
          }}
          onDecline={() => {
            setShowOnboarding(false);
            voice.markOnboarded();
          }}
        />
      )}

      {/* The question */}
      {question ? (
        <Card className={cn('transition-colors', speech.speaking && 'border-primary/50 ring-1 ring-primary/20')}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="size-4" />
              </span>
              <Badge variant="secondary">{question.topic}</Badge>
              <Badge variant="outline">{question.difficulty}</Badge>
              {question.sources && question.sources.length > 0 && (
                <Badge variant="info">Grounded in {question.sources.length} source(s)</Badge>
              )}

              <div className="ml-auto flex items-center gap-2">
                {voice.enabled && <SpeechIndicator state={indicatorState} level={mic.level} />}
                {speech.supported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void speech.replay()}
                    disabled={speech.speaking}
                    title="Replay the question"
                  >
                    <Volume2 className="size-4" />
                    {speech.speaking ? 'Speaking…' : 'Replay'}
                  </Button>
                )}
              </div>
            </div>

            <CardTitle className="mt-2 text-lg leading-relaxed">{question.question}</CardTitle>

            {question.difficultyReason && (
              <p className="text-xs italic text-muted-foreground">{question.difficultyReason}</p>
            )}
          </CardHeader>

          <CardContent className="space-y-4">
            {speech.error && (
              <Alert variant="info" title="Audio playback issue">
                <p>{speech.error}</p>
              </Alert>
            )}

            <SpeechErrorNotice
              error={mic.error}
              onRetry={() => void mic.start()}
              onRequestPermission={() => void mic.requestPermission()}
              onUseText={() => { mic.reset(); setPhase('reviewing'); }}
            />

            <TranscriptEditor
              value={answer}
              interim={mic.interimTranscript}
              onChange={(value) => { setAnswer(value); if (phase === 'answering' && !mic.listening) setPhase('reviewing'); }}
              listening={mic.listening}
              liveTranscript={mic.liveTranscript}
              minWords={40}
              disabled={submit.isPending}
              label="Your answer"
            />

            <SpeechProviderNotice capabilities={mic.capabilities} />

            {mic.stoppedBySilence && !mic.listening && answer.trim() && (
              <Alert variant="info" title="Recording stopped after a pause">
                <p>
                  Check the transcript above, correct anything the recogniser got wrong, then submit — or
                  record again to replace it.
                </p>
              </Alert>
            )}

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {voice.enabled && voice.micEnabled && mic.supported && (
                <>
                  <MicButton
                    listening={mic.listening}
                    starting={mic.starting}
                    disabled={submit.isPending}
                    level={mic.level}
                    onStart={() => void startRecording()}
                    onStop={stopRecording}
                  />
                  <div className="text-sm">
                    <p className="font-medium">
                      {mic.listening ? 'Recording — press to stop' : 'Press to answer by voice'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {mic.listening
                        ? 'Recording stops automatically after a long pause.'
                        : 'You can edit the transcript before submitting.'}
                    </p>
                  </div>
                </>
              )}

              <div className="ml-auto flex flex-wrap gap-2">
                {mic.usedSpeech && answer.trim() && !mic.listening && (
                  <Button variant="outline" onClick={retakeAnswer} disabled={submit.isPending}>
                    <RotateCcw className="size-4" />
                    Retake
                  </Button>
                )}
                <Button
                  onClick={() => { setPhase('submitting'); submit.mutate(); }}
                  loading={submit.isPending}
                  disabled={!answer.trim() || mic.listening}
                >
                  <Send className="size-4" />
                  Submit answer
                </Button>
              </div>
            </div>

            {words > 0 && words < 15 && !mic.listening && (
              <Alert variant="warning" title="That answer is very short">
                <p>
                  Interviewers score reasoning, not just recall. Even when unsure, say what you do know and how
                  you would find the rest.
                </p>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : submit.isPending ? (
        <LoadingState label="Evaluating your answer and preparing the next question…" />
      ) : (
        <LoadingState label="Preparing the next question…" />
      )}

      {/* Feedback on the previous answer */}
      {lastEvaluation && (
        <Card ref={feedbackRef}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4" />
              Feedback on your last answer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <span
                className={cn(
                  'text-3xl font-semibold tabular-nums',
                  scoreTone(lastEvaluation.overall) === 'success' ? 'text-success'
                    : scoreTone(lastEvaluation.overall) === 'warning' ? 'text-warning' : 'text-destructive',
                )}
              >
                {Math.round(lastEvaluation.overall)}
              </span>
              <div className="flex-1">
                <Progress
                  value={lastEvaluation.overall}
                  tone={scoreTone(lastEvaluation.overall) === 'muted' ? 'primary' : scoreTone(lastEvaluation.overall)}
                />
                <p className="mt-1 text-xs text-muted-foreground">{lastEvaluation.explanation}</p>
              </div>
              {speech.supported && voice.enabled && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void speech.speak(lastEvaluation.explanation, { force: true })}
                  title="Read this feedback aloud"
                >
                  <Volume2 className="size-4" />
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                ['Relevance', lastEvaluation.relevance],
                ['Correctness', lastEvaluation.correctness],
                ['Completeness', lastEvaluation.completeness],
                ['Communication', lastEvaluation.communication],
                ['Structure', lastEvaluation.structure],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="font-semibold tabular-nums">{Math.round(value)}</p>
                </div>
              ))}
            </div>

            {lastEvaluation.strengths.length > 0 && (
              <div>
                <p className="text-sm font-medium text-success">What worked</p>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {lastEvaluation.strengths.map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lastEvaluation.improvements.length > 0 && (
              <div>
                <p className="text-sm font-medium text-warning">What to improve</p>
                <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {lastEvaluation.improvements.map((item, i) => (
                    <li key={i} className="flex gap-2"><span className="text-warning">·</span>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Objective delivery signals only (§12) */}
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Delivery signals</p>
              <p className="mt-1">
                {lastEvaluation.deliverySignals.wordCount} words ·{' '}
                {(lastEvaluation.deliverySignals.fillerWordRate * 100).toFixed(1)}% filler words ·{' '}
                length {lastEvaluation.deliverySignals.responseLengthVerdict.replace(/_/g, ' ').toLowerCase()} ·{' '}
                clarity {Math.round(lastEvaluation.deliverySignals.clarityScore)}
              </p>
              <p className="mt-1">
                Measured from the words of your answer. Speaking rather than typing does not change your score,
                and nothing about how your voice sounds is assessed.
              </p>
            </div>

            <p className="text-xs italic text-muted-foreground">{lastEvaluation.disclaimer}</p>
          </CardContent>
        </Card>
      )}

      <Modal
        open={showEnd}
        onClose={() => setShowEnd(false)}
        title="End this interview?"
        description="Questions you have already answered will still be scored."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowEnd(false)}>Keep going</Button>
            <Button variant="destructive" onClick={() => end.mutate()} loading={end.isPending}>
              End interview
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          You have answered {answeredCount} of {planned} questions. Ending now produces a report based on those
          answers — nothing you have completed is lost.
        </p>
      </Modal>
    </div>
  );
}
