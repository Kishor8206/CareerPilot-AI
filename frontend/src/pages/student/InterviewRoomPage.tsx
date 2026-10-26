import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Camera, CameraOff, Circle, Mic, MicOff, PhoneOff, Send, Video,
} from 'lucide-react';
import type { MentorshipSessionDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input,
  LoadingState, Modal, PageHeader, Select, Textarea,
} from '@/components/ui';
import { apiGet, apiPost, apiPut } from '@/services/api';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/domain/Toast';
import { formatDateTime } from '@/utils/format';
import { cn } from '@/utils/cn';

interface RoomPayload {
  session: MentorshipSessionDto;
  role: 'STUDENT' | 'ALUMNI' | 'OBSERVER';
  participants: {
    student: { name?: string; avatarUrl?: string | null };
    alumni: { name?: string; company?: string; designation?: string };
  };
  iceServers: RTCIceServer[];
  recordingConsent: boolean;
  canSubmitFeedback: boolean;
}

export default function InterviewRoomPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuthStore();

  const [consented, setConsented] = React.useState(false);
  const [chatInput, setChatInput] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [showFeedback, setShowFeedback] = React.useState(false);

  const room = useQuery({
    queryKey: ['mentorship', 'room', sessionId],
    queryFn: () => apiGet<RoomPayload>(`/mentorship/sessions/${sessionId}/room`),
  });

  const rtc = useWebRTC(
    room.data?.session.roomId ?? '',
    room.data?.iceServers ?? [],
    user?.fullName ?? 'Participant',
  );

  const localVideo = React.useRef<HTMLVideoElement>(null);
  const remoteVideo = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (localVideo.current && rtc.localStream) localVideo.current.srcObject = rtc.localStream;
  }, [rtc.localStream]);

  React.useEffect(() => {
    if (remoteVideo.current && rtc.remoteStream) remoteVideo.current.srcObject = rtc.remoteStream;
  }, [rtc.remoteStream]);

  React.useEffect(() => {
    if (room.data?.session.notes) setNotes(room.data.session.notes);
  }, [room.data?.session.notes]);

  const saveNotes = useMutation({
    mutationFn: () => apiPut(`/mentorship/sessions/${sessionId}/notes`, { notes }),
    onSuccess: () => toast.success('Notes saved'),
  });

  const endSession = useMutation({
    mutationFn: () => apiPost(`/mentorship/sessions/${sessionId}/end`),
    onSuccess: () => {
      rtc.leave();
      if (room.data?.canSubmitFeedback) setShowFeedback(true);
      else navigate(room.data?.role === 'ALUMNI' ? '/alumni/sessions' : '/mentorship');
    },
  });

  if (room.isLoading) return <LoadingState label="Opening the interview room…" />;
  if (room.error || !room.data) {
    return <ErrorState message={(room.error as Error)?.message} onRetry={() => room.refetch()} />;
  }

  const { session, role, participants } = room.data;
  const isAlumni = role === 'ALUMNI';
  const other = isAlumni ? participants.student : participants.alumni;

  /* ---- Consent gate (§15): nothing is captured before this ---- */
  if (!consented) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title="Join the interview room" description={session.type.replace(/_/g, ' ')} />

        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Session details</p>
              <p className="mt-1 text-muted-foreground">
                {other.name}
                {'company' in other && other.company ? ` · ${other.company}` : ''}
              </p>
              <p className="text-muted-foreground">
                {formatDateTime(session.scheduledAt)} · {session.durationMinutes} minutes
              </p>
            </div>

            <Alert variant="info" title="Camera and microphone consent">
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li><strong>Camera:</strong> streamed directly to the other participant so you can see each other.</li>
                <li><strong>Microphone:</strong> streamed directly to the other participant.</li>
                <li>
                  <strong>Recording:</strong>{' '}
                  {session.recordingConsent
                    ? 'This session will be recorded, and you will see a recording indicator throughout.'
                    : 'This session is NOT recorded. No audio or video is stored anywhere.'}
                </li>
                <li>Audio and video travel peer-to-peer and do not pass through CareerPilot AI servers.</li>
                <li>You can turn your camera or microphone off at any time during the call.</li>
              </ul>
            </Alert>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
              <Button
                onClick={async () => {
                  const stream = await rtc.startMedia();
                  setConsented(true);
                  await rtc.join();
                  if (!stream) {
                    toast.toast({
                      title: 'Joined without camera',
                      description: 'You can still use chat and hear the other participant.',
                      variant: 'info',
                    });
                  }
                }}
              >
                <Video className="size-4" />
                I consent — join with camera &amp; microphone
              </Button>
            </div>

            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground underline"
              onClick={async () => {
                setConsented(true);
                await rtc.join();
              }}
            >
              Join without camera or microphone (chat only)
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Interview room</h1>
          <p className="text-sm text-muted-foreground">
            With {other.name} · {session.type.replace(/_/g, ' ').toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Persistent capture indicator (§15) */}
          {rtc.mediaState.camera && (
            <Badge variant="danger" className="gap-1">
              <Circle className="size-2 fill-current" />
              Camera on
            </Badge>
          )}
          {rtc.mediaState.microphone && (
            <Badge variant="warning" className="gap-1">
              <Mic className="size-3" />
              Mic on
            </Badge>
          )}
          <Badge variant={rtc.connectionState === 'connected' ? 'success' : 'muted'}>
            {rtc.peerPresent ? rtc.connectionState : 'waiting for the other participant'}
          </Badge>
        </div>
      </div>

      {rtc.error && (
        <Alert variant="warning" title="Media issue">
          <p>{rtc.error}</p>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Video */}
        <div className="space-y-3 lg:col-span-2">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black">
            {rtc.remoteStream ? (
              <video ref={remoteVideo} autoPlay playsInline className="size-full object-cover" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Video className="size-8" />
                <p className="text-sm">Waiting for {other.name} to join…</p>
              </div>
            )}

            {!rtc.remoteMediaState.camera && rtc.remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm text-white">
                {other.name} has turned their camera off
              </div>
            )}

            {/* Local preview */}
            <div className="absolute bottom-3 right-3 aspect-video w-40 overflow-hidden rounded-md border-2 border-background bg-black">
              {rtc.localStream && rtc.mediaState.camera ? (
                <video ref={localVideo} autoPlay playsInline muted className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                  Camera off
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant={rtc.mediaState.microphone ? 'secondary' : 'destructive'}
              size="icon"
              onClick={rtc.toggleMicrophone}
              disabled={!rtc.localStream}
              aria-label={rtc.mediaState.microphone ? 'Mute microphone' : 'Unmute microphone'}
            >
              {rtc.mediaState.microphone ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </Button>

            <Button
              variant={rtc.mediaState.camera ? 'secondary' : 'destructive'}
              size="icon"
              onClick={rtc.toggleCamera}
              disabled={!rtc.localStream}
              aria-label={rtc.mediaState.camera ? 'Turn camera off' : 'Turn camera on'}
            >
              {rtc.mediaState.camera ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
            </Button>

            <Button variant="destructive" onClick={() => endSession.mutate()} loading={endSession.isPending}>
              <PhoneOff className="size-4" />
              End session
            </Button>
          </div>
        </div>

        {/* Chat + notes */}
        <div className="space-y-4">
          <Card className="flex h-80 flex-col">
            <CardHeader className="py-3"><CardTitle>Chat</CardTitle></CardHeader>
            <CardContent className="flex-1 space-y-2 overflow-y-auto scrollbar-thin p-4 pt-0">
              {rtc.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : (
                rtc.messages.map((entry, index) => (
                  <div key={index} className={cn('text-sm', entry.userId === user?.id && 'text-right')}>
                    <p className="text-xs text-muted-foreground">{entry.name}</p>
                    <p
                      className={cn(
                        'inline-block max-w-[85%] rounded-lg px-3 py-1.5',
                        entry.userId === user?.id ? 'bg-primary/10' : 'bg-secondary',
                      )}
                    >
                      {entry.message}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
            <div className="flex gap-2 border-t border-border p-3">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    rtc.sendMessage(chatInput);
                    setChatInput('');
                  }
                }}
                placeholder="Type a message…"
                aria-label="Chat message"
              />
              <Button
                size="icon"
                onClick={() => {
                  rtc.sendMessage(chatInput);
                  setChatInput('');
                }}
                aria-label="Send message"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle>Interview notes</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-0">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isAlumni ? 'Notes to inform your feedback…' : 'Notes for yourself…'}
                className="min-h-[120px]"
                aria-label="Interview notes"
              />
              <Button variant="outline" size="sm" onClick={() => saveNotes.mutate()} loading={saveNotes.isPending}>
                Save notes
              </Button>
            </CardContent>
          </Card>

          {room.data.canSubmitFeedback && (
            <Button className="w-full" onClick={() => setShowFeedback(true)}>
              Submit structured feedback
            </Button>
          )}
        </div>
      </div>

      {showFeedback && (
        <FeedbackModal
          sessionId={sessionId}
          onClose={() => setShowFeedback(false)}
          onSubmitted={() => {
            setShowFeedback(false);
            navigate('/alumni/sessions');
          }}
        />
      )}
    </div>
  );
}

/** Structured alumni feedback — the human half of the APIE loop (§19, §43). */
function FeedbackModal({
  sessionId,
  onClose,
  onSubmitted,
}: {
  sessionId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const toast = useToast();
  const [ratings, setRatings] = React.useState({
    technicalKnowledge: 5, communication: 5, problemSolving: 5, confidence: 5, roleSuitability: 5,
  });
  const [recommendation, setRecommendation] = React.useState('BORDERLINE');
  const [strengths, setStrengths] = React.useState('');
  const [improvements, setImprovements] = React.useState('');
  const [comments, setComments] = React.useState('');

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/alumni/sessions/${sessionId}/feedback`, {
        ...ratings,
        recommendation,
        strengths: strengths.split('\n').map((s) => s.trim()).filter(Boolean),
        improvements: improvements.split('\n').map((s) => s.trim()).filter(Boolean),
        comments,
      }),
    onSuccess: () => {
      toast.success('Feedback submitted', "It has been applied to the student's readiness score.");
      onSubmitted();
    },
    onError: (error) => toast.error('Could not submit feedback', error instanceof Error ? error.message : undefined),
  });

  const dimensions = [
    ['technicalKnowledge', 'Technical knowledge'],
    ['communication', 'Communication'],
    ['problemSolving', 'Problem solving'],
    ['confidence', 'Confidence in delivery'],
    ['roleSuitability', 'Suitability for the role'],
  ] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title="Interview feedback"
      description="Your assessment is weighted directly into this student's placement readiness score."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit.mutate()} loading={submit.isPending}>Submit feedback</Button>
        </>
      }
    >
      <div className="space-y-4">
        {dimensions.map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor={key} className="font-medium">{label}</label>
              <span className="tabular-nums text-muted-foreground">{ratings[key]} / 10</span>
            </div>
            <input
              id={key}
              type="range"
              min={0}
              max={10}
              value={ratings[key]}
              onChange={(e) => setRatings((r) => ({ ...r, [key]: Number(e.target.value) }))}
              className="w-full accent-[hsl(var(--primary))]"
            />
          </div>
        ))}

        <Field label="Overall recommendation" htmlFor="recommendation">
          <Select id="recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
            <option value="STRONG_HIRE">Strong hire</option>
            <option value="HIRE">Hire</option>
            <option value="BORDERLINE">Borderline</option>
            <option value="NEEDS_WORK">Needs work</option>
          </Select>
        </Field>

        <Field label="Strengths" htmlFor="strengths" hint="One per line.">
          <Textarea id="strengths" value={strengths} onChange={(e) => setStrengths(e.target.value)} />
        </Field>

        <Field label="Areas to improve" htmlFor="improvements" hint="One per line. Naming a specific technology creates a tracked skill gap.">
          <Textarea id="improvements" value={improvements} onChange={(e) => setImprovements(e.target.value)} />
        </Field>

        <Field label="Additional comments" htmlFor="comments">
          <Textarea id="comments" value={comments} onChange={(e) => setComments(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
