import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Calendar, MessageSquare, Star, Video } from 'lucide-react';
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader,
} from '@/components/ui';
import { apiGet } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import { formatDateTime } from '@/utils/format';

interface AlumniDashboardData {
  profile: Record<string, any> | null;
  stats: {
    pendingRequests: number; upcomingSessions: number; completedSessions: number;
    feedbackGiven: number; averageRating: number; verificationStatus: string;
  };
  upcoming: Array<Record<string, any>>;
  pendingFeedback: number;
}

export default function AlumniDashboard() {
  const { user } = useAuthStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['alumni', 'dashboard'],
    queryFn: () => apiGet<AlumniDashboardData>('/alumni/dashboard'),
    retry: false,
  });

  // An unverified alumnus is refused the dashboard by the API; explain why
  // rather than showing a bare error.
  if (error && (error as { code?: string }).code === 'ALUMNI_NOT_VERIFIED') {
    return (
      <div className="space-y-6">
        <PageHeader title="Alumni Dashboard" />
        <Alert variant="warning" title="Your account is awaiting verification">
          <p>
            An administrator reviews employment details before an alumni account can mentor students. Until then
            you will not appear in student searches and cannot accept requests.
          </p>
          <p className="mt-2">
            Making sure your company, designation and work email are complete helps the review go through
            quickly.
          </p>
        </Alert>
        <Button asChild><Link to="/alumni/profile">Complete my profile</Link></Button>
      </div>
    );
  }

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;

  const { stats, upcoming } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.fullName.split(' ')[0] ?? 'mentor'}`}
        description="Students you mentor receive feedback that is weighted directly into their placement readiness."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <p className="label-muted">Pending requests</p>
          <p className="stat-value">{stats.pendingRequests}</p>
          {stats.pendingRequests > 0 && (
            <Link to="/alumni/requests" className="mt-1 inline-block text-xs text-primary hover:underline">
              Review them
            </Link>
          )}
        </Card>
        <Card className="p-5">
          <p className="label-muted">Upcoming sessions</p>
          <p className="stat-value">{stats.upcomingSessions}</p>
        </Card>
        <Card className="p-5">
          <p className="label-muted">Sessions completed</p>
          <p className="stat-value text-success">{stats.completedSessions}</p>
        </Card>
        <Card className="p-5">
          <p className="label-muted">Average rating</p>
          <p className="stat-value flex items-center gap-1">
            {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}
            {stats.averageRating > 0 && <Star className="size-4 fill-warning text-warning" />}
          </p>
        </Card>
      </div>

      {data.pendingFeedback > 0 && (
        <Alert variant="warning" title={`${data.pendingFeedback} session(s) awaiting your feedback`}>
          <div className="flex flex-wrap items-center gap-3">
            <p>
              Your structured feedback is what feeds the student's readiness score. Without it, the session has
              no measurable effect.
            </p>
            <Button size="sm" asChild><Link to="/alumni/sessions">Give feedback</Link></Button>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>Upcoming sessions</CardTitle></CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="Nothing scheduled"
              message="Accepted mentorship requests appear here with a link to the interview room."
              action={
                stats.pendingRequests > 0 && (
                  <Button size="sm" asChild><Link to="/alumni/requests">Review requests</Link></Button>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {upcoming.map((session) => (
                <div key={session._id} className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{session.studentUserId?.fullName ?? 'Student'}</p>
                    <p className="text-sm text-muted-foreground">
                      {String(session.type).replace(/_/g, ' ')} · {formatDateTime(session.scheduledAt)}
                    </p>
                    {session.agenda && <p className="mt-0.5 text-sm text-muted-foreground">{session.agenda}</p>}
                  </div>
                  <Button asChild>
                    <Link to={`/mentorship/session/${session._id}`}>
                      <Video className="size-4" />
                      Join room
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Button variant="outline" asChild><Link to="/alumni/requests"><Bell className="size-4" />Requests</Link></Button>
        <Button variant="outline" asChild><Link to="/alumni/sessions"><Calendar className="size-4" />Sessions</Link></Button>
        <Button variant="outline" asChild><Link to="/alumni/feedback"><MessageSquare className="size-4" />Feedback given</Link></Button>
      </div>
    </div>
  );
}
