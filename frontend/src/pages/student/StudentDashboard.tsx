import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bot, Calendar, ClipboardCheck, Code2, FileText, MessageSquare, Target, TrendingUp, UserCircle,
} from 'lucide-react';
import type {
  AlumniFeedbackDto, MentorshipSessionDto, PlacementReadinessDto,
  RecommendationDto, SkillGapDto, StudentProfileDto,
} from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState,
  LoadingState, PageHeader, Progress,
} from '@/components/ui';
import { ComponentRadar, TrendChart } from '@/components/charts';
import {
  ModelDisclaimer, NextActionCard, ReadinessHero, SkillGapList, StatCard,
} from '@/components/domain/ScoreCards';
import { DsaProgressCard } from '@/components/domain/DsaProgress';
import { apiGet } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import { formatDateTime } from '@/utils/format';

interface DashboardData {
  profile: StudentProfileDto;
  readiness: PlacementReadinessDto | null;
  skillGaps: SkillGapDto[];
  recommendations: RecommendationDto[];
  trend: Array<{ date: string; score: number; band: string; components: Record<string, number> }>;
  upcomingSessions: MentorshipSessionDto[];
  recentFeedback: AlumniFeedbackDto[];
  nextAction: { title: string; route?: string; label?: string };
}

export function StudentDashboard() {
  const { user } = useAuthStore();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['student', 'dashboard'],
    queryFn: () => apiGet<DashboardData>('/students/me/dashboard'),
  });

  if (isLoading) return <LoadingState label="Loading your dashboard…" />;
  if (error || !data) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Your dashboard could not be loaded.'}
        onRetry={() => refetch()}
      />
    );
  }

  const { profile, readiness, skillGaps, recommendations, trend, upcomingSessions, recentFeedback } = data;

  const componentValue = (key: string) =>
    readiness?.components.find((c) => c.key === key)?.raw ?? null;

  const radarData = (readiness?.components ?? [])
    .filter((c) => c.raw !== null)
    .map((c) => ({ label: c.label.replace(/ .*/, ''), value: c.normalized }));

  const firstName = user?.fullName.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your placement readiness, updated automatically as you complete activities."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/readiness">
                <TrendingUp className="size-4" />
                Readiness detail
              </Link>
            </Button>
            <Button asChild>
              <Link to="/career">
                <Target className="size-4" />
                My career plan
              </Link>
            </Button>
          </>
        }
      />

      {/* Profile completion nudge: only shown while it is actionable. */}
      {profile.profileCompletion < 70 && (
        <Alert variant="warning" title={`Your profile is ${profile.profileCompletion}% complete`}>
          <p>
            A fuller profile produces a more accurate readiness score and better job matches. Missing details also
            block eligibility checks against your target companies.{' '}
            <Link to="/profile" className="font-medium text-primary hover:underline">
              Complete your profile
            </Link>
          </p>
        </Alert>
      )}

      {readiness ? (
        <ReadinessHero
          score={readiness.score}
          band={readiness.band}
          delta={readiness.delta}
          computedAt={readiness.computedAt}
          evidenceCoverage={(readiness as unknown as { evidenceCoverage?: number }).evidenceCoverage}
        />
      ) : (
        <Card className="p-6">
          <EmptyState
            icon={TrendingUp}
            title="No readiness score yet"
            message="Upload your resume or complete one assessment. Your Placement Readiness Score is computed automatically from your results."
            action={
              <Button asChild>
                <Link to="/resume">
                  <FileText className="size-4" />
                  Upload your resume
                </Link>
              </Button>
            }
          />
        </Card>
      )}

      {/* Component scores */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ATS / Resume" value={componentValue('resume')} icon={FileText} to="/resume" />
        <StatCard label="Coding" value={componentValue('coding')} icon={Code2} to="/coding" />
        <StatCard label="Technical Interview" value={componentValue('technical')} icon={Bot} to="/interview" />
        <StatCard label="HR Interview" value={componentValue('hr')} icon={UserCircle} to="/interview" />
        <StatCard label="Communication" value={componentValue('communication')} icon={MessageSquare} />
        <StatCard label="Aptitude" value={componentValue('aptitude')} icon={ClipboardCheck} to="/assessments" />
        <StatCard label="Academic" value={componentValue('academic')} icon={UserCircle} to="/profile" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DsaProgressCard showLink />

          <Card>
            <CardHeader>
              <CardTitle>Readiness over time</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart data={trend} />
            </CardContent>
          </Card>

          {radarData.length >= 3 && (
            <Card>
              <CardHeader>
                <CardTitle>Profile balance</CardTitle>
              </CardHeader>
              <CardContent>
                <ComponentRadar data={radarData} />
                <p className="mt-2 text-xs text-muted-foreground">
                  Only components with recorded evidence appear here. A lopsided shape shows where to focus next.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recommended actions</CardTitle>
            </CardHeader>
            <CardContent>
              {recommendations.length === 0 ? (
                <EmptyState
                  title="No recommendations yet"
                  message="Recommendations appear once your readiness has been computed."
                />
              ) : (
                <ul className="space-y-3">
                  {recommendations.map((rec, index) => (
                    <li key={rec.id ?? index} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-medium">{rec.title}</h4>
                            <Badge
                              variant={
                                rec.priority === 'CRITICAL' || rec.priority === 'HIGH'
                                  ? 'danger'
                                  : rec.priority === 'MEDIUM'
                                    ? 'warning'
                                    : 'info'
                              }
                            >
                              {rec.priority}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{rec.description}</p>
                          {rec.rationale && (
                            <p className="mt-1 text-xs italic text-muted-foreground">{rec.rationale}</p>
                          )}
                        </div>
                        {rec.actionRoute && (
                          <Button variant="outline" size="sm" asChild>
                            <Link to={rec.actionRoute}>{rec.actionLabel ?? 'Start'}</Link>
                          </Button>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Estimated effort: {rec.estimatedHours} hour(s)
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <NextActionCard
            title={data.nextAction.title}
            route={data.nextAction.route}
            label={data.nextAction.label}
          />

          <Card>
            <CardHeader>
              <CardTitle>Target companies &amp; roles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profile.targetCompanies.length === 0 && profile.targetRoles.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title="No targets set"
                  message="Choosing target companies and roles makes matching and interview practice company-specific."
                  action={
                    <Button size="sm" asChild>
                      <Link to="/job-matching">Choose targets</Link>
                    </Button>
                  }
                />
              ) : (
                <>
                  {profile.targetCompanies.length > 0 && (
                    <div>
                      <p className="label-muted mb-1.5">Companies</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.targetCompanies.map((company) => (
                          <Badge key={company} variant="secondary">{company}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {profile.targetRoles.length > 0 && (
                    <div>
                      <p className="label-muted mb-1.5">Roles</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.targetRoles.map((role) => (
                          <Badge key={role} variant="secondary">{role}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top skill gaps</CardTitle>
            </CardHeader>
            <CardContent>
              {skillGaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No open skill gaps detected against your current targets.
                </p>
              ) : (
                <SkillGapList gaps={skillGaps} limit={4} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming alumni sessions</CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingSessions.length === 0 ? (
                <EmptyState
                  icon={Calendar}
                  title="Nothing scheduled"
                  message="A mock interview with a verified alumnus adds human feedback to your readiness."
                  action={
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/alumni">Find a mentor</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-3">
                  {upcomingSessions.map((session) => (
                    <li key={session.id} className="rounded-lg border border-border p-3">
                      <p className="text-sm font-medium">{session.type.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(session.scheduledAt)}</p>
                      <Button variant="outline" size="sm" className="mt-2 w-full" asChild>
                        <Link to={`/mentorship/session/${session.id}`}>Open interview room</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {recentFeedback.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent alumni feedback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentFeedback.map((feedback) => (
                  <div key={feedback.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{feedback.overallScore}/100</span>
                      <Badge variant={feedback.recommendation === 'STRONG_HIRE' || feedback.recommendation === 'HIRE' ? 'success' : 'warning'}>
                        {feedback.recommendation.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <Progress value={feedback.overallScore} className="mt-2" tone="success" />
                    {feedback.comments && (
                      <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{feedback.comments}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {readiness && <ModelDisclaimer text={readiness.modelDisclaimer} />}
    </div>
  );
}

export default StudentDashboard;
