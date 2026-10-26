import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, MessageSquare, Video } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, EmptyState, LoadingState, PageHeader,
} from '@/components/ui';
import { apiGet } from '@/services/api';
import { formatDateTime } from '@/utils/format';

export default function AlumniSessionsPage() {
  const sessions = useQuery({
    queryKey: ['alumni', 'sessions'],
    queryFn: () => apiGet<Array<Record<string, any>>>('/alumni/sessions'),
  });

  const awaitingFeedback = sessions.data?.filter((s) => s.status === 'COMPLETED' && !s.feedbackId) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Sessions"
        description="Sessions you have scheduled, and the ones still waiting on your feedback."
      />

      {awaitingFeedback.length > 0 && (
        <Alert variant="warning" title={`${awaitingFeedback.length} session(s) need your feedback`}>
          <p>
            A completed session only affects a student's readiness once you submit structured feedback. Open the
            room to complete it.
          </p>
        </Alert>
      )}

      {sessions.isLoading ? (
        <LoadingState />
      ) : !sessions.data?.length ? (
        <EmptyState icon={Calendar} title="No sessions yet" message="Accepted mentorship requests appear here." />
      ) : (
        <div className="space-y-3">
          {sessions.data.map((session) => {
            const needsFeedback = session.status === 'COMPLETED' && !session.feedbackId;
            const joinable = session.status === 'SCHEDULED' || session.status === 'LIVE';

            return (
              <Card key={session._id}>
                <CardContent className="flex flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{session.studentUserId?.fullName ?? 'Student'}</p>
                      <Badge variant={session.status === 'COMPLETED' ? 'success' : session.status === 'CANCELLED' ? 'danger' : 'info'}>
                        {session.status}
                      </Badge>
                      {needsFeedback && <Badge variant="warning">Feedback pending</Badge>}
                    </div>

                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {String(session.type).replace(/_/g, ' ')} · {formatDateTime(session.scheduledAt)} ·{' '}
                      {session.durationMinutes} minutes
                    </p>

                    {session.studentId?.department && (
                      <p className="text-xs text-muted-foreground">
                        {session.studentId.department}
                        {session.studentId.rollNumber ? ` · ${session.studentId.rollNumber}` : ''}
                      </p>
                    )}

                    {session.agenda && <p className="mt-1 text-sm text-muted-foreground">{session.agenda}</p>}
                  </div>

                  {(joinable || needsFeedback) && (
                    <Button asChild variant={needsFeedback ? 'default' : 'outline'}>
                      <Link to={`/mentorship/session/${session._id}`}>
                        {needsFeedback ? <MessageSquare className="size-4" /> : <Video className="size-4" />}
                        {needsFeedback ? 'Give feedback' : 'Join room'}
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
