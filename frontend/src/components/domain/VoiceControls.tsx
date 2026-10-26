import * as React from 'react';
import {
  AlertCircle, Loader2, Mic, MicOff, Pencil, RotateCcw, Volume2, VolumeX,
} from 'lucide-react';
import { Alert, Badge, Button, Textarea } from '@/components/ui';
import { useVoiceStore } from '@/store/voice.store';
import type { RecognitionError, SpeechCapabilities } from '@/services/speech';
import { cn } from '@/utils/cn';

/**
 * Shared voice UI for the interview experience (§11).
 *
 * Kept in one place so every voice surface shows identical microphone states,
 * identical error wording and identical fallbacks.
 */

/* ------------------------------------------------------------------ */
/* Speaking / listening indicator                                      */
/* ------------------------------------------------------------------ */

/**
 * Animated bars showing who currently holds the floor.
 *
 * This is the single most useful affordance in a voice interface: without it
 * the student cannot tell whether the system is talking, waiting, or has
 * silently failed.
 */
export function SpeechIndicator({
  state,
  level = 0,
  label,
  className,
}: {
  state: 'idle' | 'speaking' | 'listening' | 'thinking';
  level?: number;
  label?: string;
  className?: string;
}) {
  const config = {
    speaking: { tone: 'bg-primary', text: 'text-primary', default: 'AI is speaking' },
    listening: { tone: 'bg-destructive', text: 'text-destructive', default: 'Listening…' },
    thinking: { tone: 'bg-warning', text: 'text-warning', default: 'Thinking…' },
    idle: { tone: 'bg-muted-foreground/40', text: 'text-muted-foreground', default: 'Ready' },
  }[state];

  // While listening the bars follow the real input level, so the student can
  // see the microphone is actually picking them up.
  const heights =
    state === 'listening'
      ? [0.35, 0.7, 1, 0.6, 0.4].map((factor) => Math.max(0.18, Math.min(1, level * factor * 1.8)))
      : state === 'speaking'
        ? [0.5, 0.85, 0.65, 0.95, 0.55]
        : [0.25, 0.25, 0.25, 0.25, 0.25];

  return (
    <div className={cn('flex items-center gap-2.5', className)} role="status" aria-live="polite">
      <div className="flex h-6 items-end gap-[3px]" aria-hidden>
        {heights.map((height, index) => (
          <span
            key={index}
            className={cn(
              'w-[3px] rounded-full transition-all duration-150',
              config.tone,
              state === 'speaking' && 'animate-pulse',
            )}
            style={{
              height: `${Math.round(height * 100)}%`,
              animationDelay: state === 'speaking' ? `${index * 110}ms` : undefined,
            }}
          />
        ))}
      </div>
      <span className={cn('text-sm font-medium', config.text)}>{label ?? config.default}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice mode toggle                                                   */
/* ------------------------------------------------------------------ */

export function VoiceModeToggle({
  capabilities,
  onEnable,
  compact = false,
}: {
  capabilities: SpeechCapabilities | null;
  onEnable?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const { enabled, setEnabled, speakEnabled, setSpeakEnabled } = useVoiceStore();

  const canSpeak = capabilities?.synthesis ?? false;
  const canListen = capabilities?.recognition ?? false;
  const unavailable = !canSpeak && !canListen;

  if (unavailable) {
    return (
      <Badge variant="muted" className="gap-1.5">
        <MicOff className="size-3" />
        Voice unavailable
      </Badge>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size={compact ? 'sm' : 'default'}
        variant={enabled ? 'default' : 'outline'}
        onClick={async () => {
          if (!enabled) await onEnable?.();
          setEnabled(!enabled);
        }}
        aria-pressed={enabled}
      >
        {enabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
        {enabled ? 'Voice mode on' : 'Enable voice mode'}
      </Button>

      {enabled && canSpeak && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => setSpeakEnabled(!speakEnabled)}
          aria-pressed={speakEnabled}
          aria-label={speakEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
          title={speakEnabled ? 'Mute AI voice' : 'Unmute AI voice'}
        >
          {speakEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Microphone button                                                   */
/* ------------------------------------------------------------------ */

export function MicButton({
  listening,
  starting,
  disabled,
  onStart,
  onStop,
  level = 0,
  className,
}: {
  listening: boolean;
  starting?: boolean;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  level?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      disabled={disabled || starting}
      aria-label={listening ? 'Stop recording' : 'Start recording your answer'}
      aria-pressed={listening}
      className={cn(
        'relative flex size-14 shrink-0 items-center justify-center rounded-full transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        listening
          ? 'bg-destructive text-destructive-foreground shadow-lg'
          : 'bg-primary text-primary-foreground hover:bg-primary/90',
        className,
      )}
    >
      {/* Ring scales with input level, so "is it hearing me?" is answered visually. */}
      {listening && (
        <span
          className="absolute inset-0 rounded-full bg-destructive/30 transition-transform duration-100"
          style={{ transform: `scale(${1 + Math.min(0.55, level * 0.8)})` }}
          aria-hidden
        />
      )}
      {starting ? (
        <Loader2 className="size-6 animate-spin" />
      ) : listening ? (
        <MicOff className="relative size-6" />
      ) : (
        <Mic className="relative size-6" />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript editor                                                   */
/* ------------------------------------------------------------------ */

/**
 * The transcript, always editable before submission.
 *
 * Recognition mistakes are inevitable, and a student must never be scored on a
 * word they did not say. The interim phrase is shown greyed so it reads as
 * provisional rather than as text the system has committed to.
 */
export function TranscriptEditor({
  value,
  interim,
  onChange,
  listening,
  liveTranscript,
  placeholder,
  minWords,
  className,
  disabled,
  id = 'voice-transcript',
  label = 'Your answer',
}: {
  value: string;
  interim?: string;
  onChange: (value: string) => void;
  listening: boolean;
  liveTranscript?: boolean;
  placeholder?: string;
  minWords?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Pencil className="size-3" aria-hidden />
          You can edit this before submitting
        </span>
      </div>

      <div className="relative">
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={
            placeholder ??
            (listening
              ? liveTranscript
                ? 'Listening — your words will appear here…'
                : 'Recording… your transcript appears when you stop.'
              : 'Type your answer, or press the microphone to speak it.')
          }
          className={cn('min-h-[160px] transition-colors', listening && 'border-destructive/50 ring-1 ring-destructive/20')}
        />

        {/* Interim text sits below the box rather than inside it, so it can never
            be mistaken for confirmed content the student has approved. */}
        {listening && interim && (
          <p className="mt-1.5 text-sm italic text-muted-foreground" aria-live="polite">
            {interim}…
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {words} word{words === 1 ? '' : 's'}
        </span>
        {minWords !== undefined && words > 0 && words < minWords && (
          <span className="text-warning">
            Quite short — aim for at least {minWords} words so your reasoning comes through.
          </span>
        )}
        {words > 260 && <span className="text-warning">Running long — lead with your conclusion.</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Error and permission states                                         */
/* ------------------------------------------------------------------ */

export function SpeechErrorNotice({
  error,
  onRetry,
  onRequestPermission,
  onUseText,
}: {
  error: RecognitionError | null;
  onRetry?: () => void;
  onRequestPermission?: () => void;
  onUseText?: () => void;
}) {
  if (!error) return null;

  // A dismissed permission is not a failure worth shouting about — the student
  // simply needs to know the way forward.
  const variant = error.code === 'no-speech' || error.code === 'aborted' ? 'info' : 'warning';

  return (
    <Alert variant={variant} title={error.code === 'no-speech' ? 'No speech detected' : 'Microphone issue'}>
      <p>{error.message}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {error.code === 'permission-denied' && onRequestPermission && (
          <Button size="sm" variant="outline" onClick={onRequestPermission}>
            <Mic className="size-3.5" />
            Grant microphone access
          </Button>
        )}
        {!error.requiresUserAction && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            Try again
          </Button>
        )}
        {onUseText && (
          <Button size="sm" variant="ghost" onClick={onUseText}>
            Type instead
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** First-run explainer, shown once before the microphone is ever opened. */
export function VoiceOnboarding({
  capabilities,
  onAccept,
  onDecline,
}: {
  capabilities: SpeechCapabilities | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const serverSide = capabilities?.provider === 'server';

  return (
    <Alert variant="info" title="Practise this interview by voice">
      <p>
        The interviewer can read each question aloud, and you can answer by speaking instead of typing —
        closer to a real interview, where you have to think and speak at the same time.
      </p>

      <ul className="mt-2 list-inside list-disc space-y-1">
        <li>Your transcript is always shown and editable before it is submitted.</li>
        <li>
          {serverSide
            ? 'Your recording is sent to this deployment’s transcription service, transcribed, and discarded. It is never stored.'
            : 'Speech is recognised by your browser, on your device. No audio is uploaded or stored.'}
        </li>
        <li>Scoring is unchanged: only the words of your answer are evaluated, never how your voice sounds.</li>
        <li>You can switch back to typing at any point.</li>
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={onAccept}>
          <Mic className="size-3.5" />
          Enable voice mode
        </Button>
        <Button size="sm" variant="ghost" onClick={onDecline}>
          Continue with typing
        </Button>
      </div>
    </Alert>
  );
}

/** Compact notice explaining what the current provider can and cannot do. */
export function SpeechProviderNotice({ capabilities }: { capabilities: SpeechCapabilities | null }) {
  if (!capabilities?.recognition) return null;
  if (capabilities.provider !== 'server') return null;

  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
      <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
      This browser has no built-in speech recognition, so your recording is transcribed on the server when you
      stop. You will not see words appear as you speak.
    </p>
  );
}
