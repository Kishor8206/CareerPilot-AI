import * as React from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Select } from '@/components/ui';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { useVoiceStore } from '@/store/voice.store';

const SAMPLE =
  'Tell me about a project you are proud of, and the hardest problem you had to solve in it.';

/**
 * Voice preferences (§11).
 *
 * Kept in Settings rather than buried in the interview: a student should be able
 * to pick a voice and reading pace calmly, and hear a sample, before they are in
 * the middle of a timed mock interview.
 */
export function VoiceSettings() {
  const {
    enabled, setEnabled, speakEnabled, setSpeakEnabled, micEnabled, setMicEnabled,
    autoListen, setAutoListen, voiceId, setVoiceId, rate, setRate, language, setLanguage,
  } = useVoiceStore();

  const speech = useSpeechSynthesis();
  const mic = useSpeechInput();

  const [micTestResult, setMicTestResult] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="size-4" />
            Voice mode
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Practise interviews by speaking, closer to the real thing.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={enabled ? 'default' : 'outline'} onClick={() => setEnabled(!enabled)} aria-pressed={enabled}>
              {enabled ? 'Voice mode is on' : 'Turn voice mode on'}
            </Button>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant={speech.supported ? 'success' : 'muted'}>
                {speech.supported ? 'Speech output available' : 'No speech output'}
              </Badge>
              <Badge variant={mic.supported ? 'success' : 'muted'}>
                {mic.supported
                  ? `Speech input available${mic.providerName === 'server' ? ' (server)' : ''}`
                  : 'No speech input'}
              </Badge>
            </div>
          </div>

          {!speech.supported && !mic.supported && (
            <Alert variant="info" title="Voice is not available in this browser">
              <p>
                {mic.capabilities?.reason ??
                  'This browser supports neither speech recognition nor speech synthesis. Everything still works by typing.'}
              </p>
            </Alert>
          )}

          {mic.capabilities?.provider === 'server' && (
            <Alert variant="info" title="Server transcription">
              <p>
                This browser has no built-in speech recognition, so recordings are transcribed by the server and
                then discarded. You will not see words appear live as you speak.
              </p>
            </Alert>
          )}

          {enabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={speakEnabled}
                  onChange={(e) => setSpeakEnabled(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Read questions aloud
                  <span className="block text-xs text-muted-foreground">
                    The interviewer and the discussion panel speak their turns.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={micEnabled}
                  onChange={(e) => setMicEnabled(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Answer by microphone
                  <span className="block text-xs text-muted-foreground">
                    Your transcript is always editable before it is submitted.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={autoListen}
                  onChange={(e) => setAutoListen(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  Start listening automatically after each question
                  <span className="block text-xs text-muted-foreground">
                    Closest to a real interview. Leave this off if you share a room, or prefer to press the
                    microphone yourself.
                  </span>
                </span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {speech.supported && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="size-4" />
              Interviewer voice
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Voice" htmlFor="voice">
                <Select
                  id="voice"
                  value={voiceId ?? ''}
                  onChange={(e) => setVoiceId(e.target.value || null)}
                  disabled={speech.voices.length === 0}
                >
                  <option value="">Browser default</option>
                  {speech.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} ({v.lang})
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Recognition language" htmlFor="language" hint="Match how you will speak.">
                <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="en-IN">English (India)</option>
                  <option value="en-US">English (United States)</option>
                  <option value="en-GB">English (United Kingdom)</option>
                  <option value="en-AU">English (Australia)</option>
                </Select>
              </Field>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="rate" className="font-medium">Speaking pace</label>
                <span className="tabular-nums text-muted-foreground">{rate.toFixed(2)}x</span>
              </div>
              <input
                id="rate"
                type="range"
                min={0.6}
                max={1.4}
                step={0.05}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
              />
              <p className="text-xs text-muted-foreground">
                Slightly below conversational pace helps when a question carries detail you need to hold on to.
              </p>
            </div>

            <Button
              variant="outline"
              onClick={() => void speech.speak(SAMPLE, { force: true })}
              loading={speech.speaking}
            >
              <Volume2 className="size-4" />
              {speech.speaking ? 'Playing…' : 'Hear a sample question'}
            </Button>

            {speech.error && (
              <Alert variant="warning" title="Playback issue">
                <p>{speech.error}</p>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {mic.supported && (
        <Card>
          <CardHeader><CardTitle>Test your microphone</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Check recognition before an interview rather than discovering a problem mid-answer.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant={mic.listening ? 'destructive' : 'outline'}
                onClick={() => {
                  if (mic.listening) {
                    mic.stop();
                    setMicTestResult(mic.finalTranscript || 'Nothing was picked up. Check your microphone.');
                  } else {
                    mic.reset();
                    setMicTestResult(null);
                    void mic.start();
                  }
                }}
              >
                <Mic className="size-4" />
                {mic.listening ? 'Stop and show what I heard' : 'Start microphone test'}
              </Button>

              {mic.listening && (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-28 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-destructive transition-all duration-100"
                      style={{ width: `${Math.round(mic.level * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">Say a few words…</span>
                </div>
              )}
            </div>

            {mic.listening && mic.transcript && (
              <p className="rounded-md bg-muted/50 p-3 text-sm">{mic.transcript}</p>
            )}

            {micTestResult && !mic.listening && (
              <Alert variant={mic.finalTranscript ? 'success' : 'warning'} title="Microphone test result">
                <p>{micTestResult}</p>
              </Alert>
            )}

            {mic.error && (
              <Alert variant="warning" title="Microphone issue">
                <p>{mic.error.message}</p>
                {mic.error.code === 'permission-denied' && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => void mic.requestPermission()}>
                    Grant microphone access
                  </Button>
                )}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Alert variant="info" title="How voice affects your assessment">
        <p>
          It does not. Only the words of your answer are evaluated, exactly as if you had typed them. Nothing
          about how your voice sounds — accent, tone, pace or pitch — is analysed or scored, and no audio is
          stored.
        </p>
      </Alert>
    </div>
  );
}
