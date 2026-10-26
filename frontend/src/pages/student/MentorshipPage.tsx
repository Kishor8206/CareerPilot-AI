import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, GraduationCap, Star, Video } from 'lucide-react';
import type { AlumniFeedbackDto, MentorshipRequestDto } from '@careerpilot/shared';
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState, PageHeader,
  Progress, Tabs,
} from '@/components/ui';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDateTime } from '@/utils/format';

export default function MentorshipPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('sessions');

  const requests = useQuery({ queryKey: ['mentorship', 'requests'], queryFn: () => apiGet<MentorshipRequestDto[]>('/mentorship/requests') });
  const sessions = useQuery({ queryKey: ['mentorship', 'sessions'], queryFn: () => apiGet<Array<Record<string, any>>>('/mentorship/sessions') });
  const feedback = useQuery({ queryKey: ['mentorship', 'feedback'], queryFn: () => apiGet<AlumniFeedbackDto[]>('/mentorship/feedback') });

  const rate = useMutation({
    mutationFn: ({ sessionId, rating }: { sessionId: string; rating: number }) =>
      apiPost(`/mentorship/sessions/${sessionId}/rate`, { rating }),
    onSuccess: () => {
      toast.success('Thank you for rating your mentor');
      queryClient.invalidateQueries({ queryKey: ['mentorship'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Mentorship"
        description="Your requests, scheduled sessions and the feedback alumni have given you."
        actions={<Button asChild><Link to="/alumni"><GraduationCap className="size-4" />Find a mentor</Link></Button>}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'sessions', label: 'Sessions', count: sessions.data?.length },
          { value: 'requests', label: 'Requests', count: requests.data?.length },
          { value: 'feedback', label: 'Feedback received', count: feedback.data?.length },
        ]}
      />

      {tab === 'sessions' && (
        sessions.isLoading ? <LoadingState /> :
        !sessions.data?.length ? (
          <EmptyState icon={Calendar} title="No sessions yet" message="Once a mentor accepts your request, the session appears here with a link to the interview room." />
        ) : (
          <div className="space-y-3">
            {sessions.data.map((session) => {
              const upcoming = session.status === 'SCHEDULED' || session.status === 'LIVE';
              return (
                <Card key={session._id ?? session.id}>
                  <CardContent className="flex flex-wrap items-center gap-4 p-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{String(session.type).replace(/_/g, ' ')}</p>
                        <Badge variant={session.status === 'COMPLETED' ? 'success' : session.status === 'CANCELLED' ? 'danger' : 'info'}>
                          {session.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {session.alumniUserId?.fullName ?? 'Mentor'}
                        {session.alumniId?.company ? ` · ${session.alumniId.company}` : ''}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateTime(session.scheduledAt)} · {session.durationMinutes} minutes
                      </p>
                    </div>

                    {upcoming && (
                      <Button asChild>
                        <Link to={`/mentorship/session/${session._id ?? session.id}`}>
                          <Video className="size-4" />
                          Join room
                        </Link>
                      </Button>
                    )}

                    {session.status === 'COMPLETED' && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Rate your mentor:</span>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => rate.mutate({ sessionId: session._id ?? session.id, rating: value })}
                            aria-label={`Rate ${value} out of 5`}
                            className="p-0.5"
                          >
                            <Star className="size-4 text-muted-foreground hover:fill-warning hover:text-warning" />
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      {tab === 'requests' && (
        requests.isLoading ? <LoadingState /> :
        !requests.data?.length ? (
          <EmptyState title="No requests sent yet" action={<Button asChild><Link to="/alumni">Find a mentor</Link></Button>} />
        ) : (
          <div className="space-y-3">
            {requests.data.map((request) => (
              <Card key={request.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{request.topic}</p>
                        <Badge
                          variant={
                            request.status === 'ACCEPTED' ? 'success'
                              : request.status === 'REJECTED' ? 'danger'
                                : request.status === 'PENDING' ? 'warning' : 'muted'
                          }
                        >
                          {request.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{request.message}</p>
                      {request.responseMessage && (
                        <p className="mt-2 rounded-md bg-muted/50 p-2 text-sm">
                          <strong>Mentor's reply:</strong> {request.responseMessage}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(request.createdAt)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'feedback' && (
        feedback.isLoading ? <LoadingState /> :
        !feedback.data?.length ? (
          <EmptyState title="No feedback yet" message="After a mock interview, your mentor's structured feedback appears here and is weighted into your readiness score." />
        ) : (
          <div className="space-y-4">
            {feedback.data.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle>{item.alumniCompany ?? 'Mentor feedback'}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.recommendation === 'STRONG_HIRE' || item.recommendation === 'HIRE' ? 'success' : 'warning'}>
                        {item.recommendation.replace(/_/g, ' ')}
                      </Badge>
                      {item.appliedToApie && <Badge variant="info">Applied to readiness</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-semibold tabular-nums">{item.overallScore}</span>
                    <Progress value={item.overallScore} tone="success" className="flex-1" />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                    {([
                      ['Technical', item.technicalKnowledge],
                      ['Communication', item.communication],
                      ['Problem solving', item.problemSolving],
                      ['Confidence', item.confidence],
                      ['Role fit', item.roleSuitability],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-md border border-border p-2 text-center">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                        <p className="font-semibold tabular-nums">{value}/10</p>
                      </div>
                    ))}
                  </div>

                  {item.strengths.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-success">Strengths</p>
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {item.strengths.map((s, i) => <li key={i}>· {s}</li>)}
                      </ul>
                    </div>
                  )}

                  {item.improvements.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-warning">To improve</p>
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {item.improvements.map((s, i) => <li key={i}>· {s}</li>)}
                      </ul>
                    </div>
                  )}

                  {item.comments && <p className="rounded-md bg-muted/50 p-3 text-sm">{item.comments}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
