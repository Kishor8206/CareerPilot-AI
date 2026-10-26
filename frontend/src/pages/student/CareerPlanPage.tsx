import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, ExternalLink, Plus, ShieldCheck, Sparkles, Target, Trash2 } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field, Input,
  LoadingState, PageHeader, Progress, Select, Tabs,
} from '@/components/ui';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate } from '@/utils/format';

type Level = 'beginner' | 'intermediate' | 'advanced';
type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

interface SkillGap { skill: string; current_level: string; required_level: string; priority: Priority; reason: string }
interface Phase { phase: string; skills: string[]; objectives: string[]; estimated_hours: number; prerequisites: string[]; completion_criteria: string[] }
interface Project { title: string; skills: string[]; difficulty: string; reason: string }
interface Resource {
  resource_id: string; title: string; provider: string; resource_type: string; url: string;
  skill_ids: string[]; difficulty: string[]; duration: number | null; verification_status: string; last_verified: string | null;
}
interface CareerPlanDoc {
  id: string;
  targetRole: string;
  plan: {
    target_role: string; readiness_summary: string; skill_gap: SkillGap[]; roadmap: Phase[];
    study_plan: Array<{ week: number; tasks: string[] }>; projects: Project[]; interview_preparation: string[]; resource_ids: string[];
  };
  resources: Resource[];
  resourcesBySkill?: SkillResources[];
  dailyPlan: Array<{ week: number; days: Array<{ day: number; tasks: string[] }> }>;
  readiness: { percent: number; requirements_met: number; requirements_total: number; met_skills: string[]; unrecognised_skills: string[] };
  schedule: { weekly_hours: number; weeks_needed: number; deadline_weeks: number | null; fits_deadline: boolean; deferred: Array<{ skill: string }> };
  inference: { provider: string; degraded: boolean; repairs: string[] };
  completedSkills: string[];
  disclaimer: string;
  createdAt: string;
}
interface SkillResources {
  skill: string; priority: Priority; current_level: string; required_level: string;
  courses_and_docs: Resource[]; videos: Resource[];
}
interface Catalogue { roles: Array<{ name: string; description: string }>; skills: string[] }

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'skills', label: 'Skill gaps' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'study-plan', label: 'Study plan' },
  { value: 'projects', label: 'Projects & interview' },
  { value: 'resources', label: 'Resources' },
  { value: 'progress', label: 'Progress' },
];
const PRIORITY_VARIANT: Record<Priority, 'danger' | 'warning' | 'muted'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'muted' };
const RESOURCE_LABEL: Record<string, string> = {
  documentation: 'Documentation', free_course: 'Free course', practice_platform: 'Practice', book: 'Book',
  youtube_video: 'Video', tutorial: 'Tutorial',
};

/** How the plan was produced, stated plainly so a fallback is never mistaken for the model. */
function producedBy(inference: CareerPlanDoc['inference']): { label: string; detail: string } {
  if (inference.provider === 'deterministic') {
    return inference.degraded
      ? { label: 'Rule-based planner (fallback)', detail: 'The career model was unavailable, so the rule-based planner produced this plan.' }
      : { label: 'Rule-based planner', detail: 'Produced by the rule-based planner from the career knowledge base.' };
  }
  return inference.repairs.length
    ? { label: 'Career model, corrected', detail: `Written by the career model; ${inference.repairs.length} part(s) were corrected against the knowledge base.` }
    : { label: 'Career model', detail: 'Written by the fine-tuned career model and checked against the knowledge base.' };
}

export default function CareerPlanPage() {
  const { tab = 'overview' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [targetRole, setTargetRole] = React.useState('');
  const [hoursPerDay, setHoursPerDay] = React.useState(2);
  const [daysPerWeek, setDaysPerWeek] = React.useState(5);
  const [deadlineWeeks, setDeadlineWeeks] = React.useState('');
  const [experienceLevel, setExperienceLevel] = React.useState('STUDENT');
  const [learningStyle, setLearningStyle] = React.useState('');
  const [useProfileSkills, setUseProfileSkills] = React.useState(true);
  const [useAts, setUseAts] = React.useState(true);
  const [skills, setSkills] = React.useState<Array<{ skill: string; level: Level }>>([]);
  const [newSkill, setNewSkill] = React.useState('');
  const [newLevel, setNewLevel] = React.useState<Level>('beginner');
  const [week, setWeek] = React.useState(1);

  const catalogue = useQuery({ queryKey: ['career-catalogue'], queryFn: () => apiGet<Catalogue>('/career/catalogue'), staleTime: Infinity });
  const current = useQuery({ queryKey: ['career-plan'], queryFn: () => apiGet<{ plan: CareerPlanDoc | null }>('/career/plan') });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['career-plan'] });
  const generate = useMutation({
    mutationFn: () => apiPost('/career/plan', {
      targetRole, hoursPerDay, daysPerWeek, experienceLevel, useAts,
      deadlineWeeks: deadlineWeeks ? Number(deadlineWeeks) : null,
      learningStyle: learningStyle || null,
      ...(useProfileSkills ? {} : { skills }),
    }),
    onSuccess: () => { toast.success('Career plan generated'); refresh(); navigate('/career/overview'); },
    onError: (error) => toast.error('Could not generate the plan', error instanceof Error ? error.message : undefined),
  });
  const complete = useMutation({
    mutationFn: (skill: string) => apiPost('/career/progress', { completedSkills: [skill] }),
    onSuccess: (_d, skill) => { toast.success(`${skill} marked complete`, 'Your plan was updated.'); refresh(); },
    onError: (error) => toast.error('Could not record progress', error instanceof Error ? error.message : undefined),
  });

  React.useEffect(() => {
    const doc = current.data?.plan;
    if (doc && !targetRole) setTargetRole(doc.targetRole);
  }, [current.data, targetRole]);

  if (current.isLoading || catalogue.isLoading) return <LoadingState label="Loading your career plan…" />;
  if (current.error) return <ErrorState message={(current.error as Error).message} onRetry={() => current.refetch()} />;

  const doc = current.data?.plan ?? null;
  const roles = catalogue.data?.roles ?? [];
  const canGenerate = Boolean(targetRole) && (useProfileSkills || skills.length > 0) && !generate.isPending;

  const addSkill = () => {
    const name = newSkill.trim();
    if (!name || skills.some((s) => s.skill.toLowerCase() === name.toLowerCase())) return;
    setSkills([...skills, { skill: name, level: newLevel }]);
    setNewSkill('');
  };

  const form = (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Target className="size-4" />{doc ? 'Update your plan' : 'Build your career plan'}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Target role" required htmlFor="role">
            <Select id="role" value={targetRole} onChange={(e) => setTargetRole(e.target.value)}>
              <option value="">Select a role…</option>
              {roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
            </Select>
          </Field>
          <Field label="Hours per day" htmlFor="hpd">
            <Select id="hpd" value={String(hoursPerDay)} onChange={(e) => setHoursPerDay(Number(e.target.value))}>
              {[1, 1.5, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'hour' : 'hours'}</option>)}
            </Select>
          </Field>
          <Field label="Days per week" htmlFor="dpw">
            <Select id="dpw" value={String(daysPerWeek)} onChange={(e) => setDaysPerWeek(Number(e.target.value))}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} days</option>)}
            </Select>
          </Field>
          <Field label="Deadline" hint="Optional" htmlFor="deadline">
            <Select id="deadline" value={deadlineWeeks} onChange={(e) => setDeadlineWeeks(e.target.value)}>
              <option value="">No deadline</option>
              {[4, 8, 12, 16, 20, 24].map((n) => <option key={n} value={n}>{n} weeks</option>)}
            </Select>
          </Field>
          <Field label="Where you are now" htmlFor="exp">
            <Select id="exp" value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)}>
              <option value="STUDENT">Student</option>
              <option value="FRESH_GRADUATE">Fresh graduate</option>
              <option value="ENTRY_LEVEL">Entry-level job</option>
              <option value="MID_LEVEL">A few years of experience</option>
              <option value="CAREER_SWITCHER">Switching careers</option>
            </Select>
          </Field>
          <Field label="Preferred resources" hint="Optional" htmlFor="style">
            <Select id="style" value={learningStyle} onChange={(e) => setLearningStyle(e.target.value)}>
              <option value="">No preference</option>
              <option value="video">Videos</option>
              <option value="reading">Reading</option>
              <option value="hands-on">Hands-on practice</option>
              <option value="course">Courses</option>
            </Select>
          </Field>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useProfileSkills} onChange={(e) => setUseProfileSkills(e.target.checked)} />
            Use the skills on my profile
          </label>
          {!useProfileSkills && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Skill" htmlFor="skill" className="min-w-48 flex-1">
                  <Input id="skill" list="career-skills" value={newSkill} onChange={(e) => setNewSkill(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} placeholder="e.g. JavaScript" />
                </Field>
                <datalist id="career-skills">{(catalogue.data?.skills ?? []).map((s) => <option key={s} value={s} />)}</datalist>
                <Field label="Level" htmlFor="level">
                  <Select id="level" value={newLevel} onChange={(e) => setNewLevel(e.target.value as Level)}>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </Select>
                </Field>
                <Button type="button" variant="outline" onClick={addSkill}><Plus className="size-4" />Add</Button>
              </div>
              {skills.length === 0
                ? <p className="text-sm text-muted-foreground">Add at least one skill, or leave the list empty by ticking the box above.</p>
                : (
                  <ul className="flex flex-wrap gap-2">
                    {skills.map((s) => (
                      <li key={s.skill} className="flex items-center gap-1.5 rounded-full border border-border py-1 pl-3 pr-1 text-sm">
                        {s.skill} <span className="text-muted-foreground">· {s.level}</span>
                        <button type="button" aria-label={`Remove ${s.skill}`} className="rounded-full p-1 hover:bg-accent"
                          onClick={() => setSkills(skills.filter((x) => x.skill !== s.skill))}><Trash2 className="size-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useAts} onChange={(e) => setUseAts(e.target.checked)} />
            Use my latest resume analysis to prioritise missing skills
          </label>
        </div>

        <Button onClick={() => generate.mutate()} disabled={!canGenerate}>
          <Sparkles className="size-4" />{generate.isPending ? 'Generating…' : doc ? 'Regenerate plan' : 'Generate plan'}
        </Button>
      </CardContent>
    </Card>
  );

  if (!doc) {
    return (
      <div className="space-y-6">
        <PageHeader title="Career Plan" description="A personalised path to your target role: skill gaps, a phased roadmap, a study plan that fits your time, projects, interview preparation and verified resources." />
        {form}
        <EmptyState icon={Target} title="No career plan yet" message="Choose a target role and how much time you have, then generate your plan." />
      </div>
    );
  }

  const { plan, readiness, schedule, resources } = doc;
  const origin = producedBy(doc.inference);
  const weekPlan = plan.study_plan.find((w) => w.week === week) ?? plan.study_plan[0];
  const dayPlan = doc.dailyPlan.find((w) => w.week === weekPlan?.week);
  const resourcesBySkill = (skill: string) => resources.filter((r) => r.skill_ids.includes(skill));

  return (
    <div className="space-y-6">
      <PageHeader title={`Career Plan: ${plan.target_role}`}
        description={`Generated ${formatDate(doc.createdAt)} · ${origin.label}`} />
      <Tabs tabs={TABS.map((t) => (t.value === 'skills' ? { ...t, count: plan.skill_gap.length } : t))} value={tab}
        onChange={(value) => navigate(`/career/${value}`)} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><CardContent className="space-y-2 p-5">
              <p className="text-sm text-muted-foreground">Readiness for this role</p>
              <p className="text-3xl font-semibold">{readiness.percent}%</p>
              <Progress value={readiness.percent} tone={readiness.percent >= 60 ? 'success' : readiness.percent >= 35 ? 'warning' : 'danger'} />
              <p className="text-xs text-muted-foreground">{readiness.requirements_met} of {readiness.requirements_total} skill requirements met</p>
            </CardContent></Card>
            <Card><CardContent className="space-y-2 p-5">
              <p className="text-sm text-muted-foreground">Time</p>
              <p className="text-3xl font-semibold">{schedule.weeks_needed} weeks</p>
              <p className="text-xs text-muted-foreground">at {schedule.weekly_hours} hours a week{schedule.deadline_weeks ? ` · deadline ${schedule.deadline_weeks} weeks` : ''}</p>
            </CardContent></Card>
            <Card><CardContent className="space-y-2 p-5">
              <p className="text-sm text-muted-foreground">Skill gaps</p>
              <p className="text-3xl font-semibold">{plan.skill_gap.length}</p>
              <p className="text-xs text-muted-foreground">{plan.skill_gap.filter((g) => g.priority === 'HIGH').length} high priority</p>
            </CardContent></Card>
          </div>
          <Card><CardContent className="space-y-3 p-5">
            <p className="text-sm leading-relaxed">{plan.readiness_summary}</p>
            <p className="text-xs text-muted-foreground">{origin.detail}</p>
          </CardContent></Card>
          {schedule.deadline_weeks && !schedule.fits_deadline && (
            <Alert variant="warning" title="Your deadline is not achievable at this pace">
              This plan needs about {schedule.weeks_needed} weeks. Add study hours or extend the deadline, then regenerate.
            </Alert>
          )}
          {schedule.deferred.length > 0 && (
            <Alert variant="info" title="Deferred to fit your deadline">{schedule.deferred.map((d) => d.skill).join(', ')}</Alert>
          )}
          {readiness.unrecognised_skills.length > 0 && (
            <Alert variant="info" title="Skills we could not match">
              {readiness.unrecognised_skills.join(', ')} — these were not used in the plan.
            </Alert>
          )}
          {form}
        </div>
      )}

      {tab === 'skills' && (
        <div className="space-y-3">
          {plan.skill_gap.length === 0 && <EmptyState icon={CheckCircle2} title="No skill gaps" message="You meet every skill requirement for this role." />}
          {plan.skill_gap.map((gap) => (
            <Card key={gap.skill}><CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium">{gap.skill}</p>
                <p className="text-sm text-muted-foreground">{gap.reason}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{gap.current_level} → {gap.required_level}</Badge>
                <Badge variant={PRIORITY_VARIANT[gap.priority]}>{gap.priority} priority</Badge>
              </div>
            </CardContent></Card>
          ))}
        </div>
      )}

      {tab === 'roadmap' && (
        <ol className="space-y-4">
          {plan.roadmap.map((phase, index) => (
            <li key={phase.phase}><Card>
              <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>Phase {index + 1}: {phase.phase}</span>
                <Badge variant="muted">{phase.estimated_hours} hours</Badge>
              </CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-1.5">{phase.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                {phase.prerequisites.length > 0 && <p className="text-muted-foreground">Builds on: {phase.prerequisites.join(', ')}</p>}
                <div>
                  <p className="font-medium">Objectives</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{phase.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
                </div>
                <div>
                  <p className="font-medium">You have finished this phase when you can</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{phase.completion_criteria.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              </CardContent>
            </Card></li>
          ))}
        </ol>
      )}

      {tab === 'study-plan' && weekPlan && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="week" className="text-sm font-medium">Week</label>
            <Select id="week" className="w-40" value={String(weekPlan.week)} onChange={(e) => setWeek(Number(e.target.value))}>
              {plan.study_plan.map((w) => <option key={w.week} value={w.week}>Week {w.week}</option>)}
            </Select>
            <span className="text-sm text-muted-foreground">{plan.study_plan.length} weeks · up to {schedule.weekly_hours} hours each</span>
          </div>
          <Card>
            <CardHeader><CardTitle>Week {weekPlan.week}</CardTitle></CardHeader>
            <CardContent><ul className="list-disc space-y-1 pl-5 text-sm">{weekPlan.tasks.map((t) => <li key={t}>{t}</li>)}</ul></CardContent>
          </Card>
          {dayPlan ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dayPlan.days.map((d) => (
                <Card key={d.day}><CardContent className="space-y-1.5 p-4">
                  <p className="text-sm font-medium">Day {d.day}</p>
                  <ul className="space-y-1 text-sm text-muted-foreground">{d.tasks.map((t) => <li key={t}>{t}</li>)}</ul>
                </CardContent></Card>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">A day-by-day breakdown is shown for the first four weeks.</p>}
        </div>
      )}

      {tab === 'projects' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Projects</h2>
            {plan.projects.map((p) => (
              <Card key={p.title}><CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{p.title}</p><Badge variant="muted">{p.difficulty}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{p.reason}</p>
                <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}</div>
              </CardContent></Card>
            ))}
          </div>
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Interview preparation</h2>
            <Card><CardContent className="p-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">{plan.interview_preparation.map((t) => <li key={t}>{t}</li>)}</ol>
            </CardContent></Card>
          </div>
        </div>
      )}

      {tab === 'resources' && (
        <div className="space-y-4">
          <Alert variant="info" title="How resources are chosen">
            For each skill gap: the best matching documentation or course, and the best matching videos. Every link was checked by
            CareerPilot before being shown. Videos are search results that passed an availability check, not endorsements.
          </Alert>
          {(doc.resourcesBySkill ?? []).length === 0 && resources.length === 0 && (
            <EmptyState icon={BookOpen} title="No resources for these skills yet" />
          )}
          {(doc.resourcesBySkill ?? []).map((group) => (
            <Card key={group.skill}>
              <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>{group.skill}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{group.current_level} → {group.required_level}</Badge>
                  <Badge variant={PRIORITY_VARIANT[group.priority]}>{group.priority} priority</Badge>
                </span>
              </CardTitle></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                {([['Courses and documentation', group.courses_and_docs], ['Videos', group.videos]] as const).map(([heading, items]) => (
                  <div key={heading} className="space-y-2">
                    <p className="text-sm font-medium">{heading}</p>
                    {items.length === 0
                      ? <p className="text-sm text-muted-foreground">No checked resource for this skill yet.</p>
                      : (
                        <ul className="space-y-2">
                          {items.map((r) => (
                            <li key={r.resource_id} className="space-y-0.5">
                              <a href={r.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-start gap-1.5 text-sm font-medium text-primary hover:underline">
                                <span>{r.title}</span><ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                              </a>
                              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                                <span>{r.provider}</span>
                                <span>· {RESOURCE_LABEL[r.resource_type] ?? r.resource_type}</span>
                                {r.duration ? <span>· {r.duration} min</span> : null}
                                {r.verification_status === 'verified' && (
                                  <span className="inline-flex items-center gap-1 text-success"><ShieldCheck className="size-3" />checked</span>
                                )}
                              </p>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'progress' && (
        <div className="space-y-4">
          <Card><CardContent className="space-y-2 p-5">
            <p className="text-sm text-muted-foreground">Mark a skill complete when you have met its completion criteria. Your plan is rebuilt so it moves on to what comes next.</p>
            {doc.completedSkills.length > 0 && (
              <p className="text-sm">Completed so far: <span className="font-medium">{doc.completedSkills.join(', ')}</span></p>
            )}
          </CardContent></Card>
          {plan.skill_gap.map((gap) => (
            <Card key={gap.skill}><CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{gap.skill}</p>
                <p className="text-sm text-muted-foreground">
                  Target: {gap.required_level}{resourcesBySkill(gap.skill).length ? ` · ${resourcesBySkill(gap.skill).length} resource(s)` : ''}
                </p>
              </div>
              <Button variant="outline" disabled={complete.isPending} onClick={() => complete.mutate(gap.skill)}>
                <CheckCircle2 className="size-4" />Mark complete
              </Button>
            </CardContent></Card>
          ))}
          {plan.skill_gap.length === 0 && <EmptyState icon={CheckCircle2} title="Nothing left to complete" message="You have no outstanding skill gaps for this role." />}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{doc.disclaimer}</p>
    </div>
  );
}
