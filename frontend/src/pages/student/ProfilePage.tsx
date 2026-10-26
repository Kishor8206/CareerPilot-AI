import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { SkillCategory } from '@careerpilot/shared';
import type { StudentProfileDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, Field, Input,
  LoadingState, PageHeader, Progress, Select, Tabs, Textarea,
} from '@/components/ui';
import { apiGet, apiPatch, ApiClientError } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('basics');

  const profile = useQuery({
    queryKey: ['student', 'profile'],
    queryFn: () => apiGet<StudentProfileDto>('/students/me'),
  });

  const [draft, setDraft] = React.useState<Partial<StudentProfileDto>>({});
  const [newSkill, setNewSkill] = React.useState({ name: '', category: SkillCategory.PROGRAMMING_LANGUAGE as string });

  React.useEffect(() => {
    if (profile.data) setDraft(profile.data);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPatch<StudentProfileDto>('/students/me', payload),
    onSuccess: async () => {
      toast.success('Profile saved');
      await queryClient.invalidateQueries({ queryKey: ['student'] });
      await queryClient.invalidateQueries({ queryKey: ['readiness'] });
    },
    onError: (error) => toast.error('Could not save', error instanceof Error ? error.message : undefined),
  });

  if (profile.isLoading) return <LoadingState />;
  if (profile.error || !profile.data) {
    return <ErrorState message={(profile.error as Error)?.message} onRetry={() => profile.refetch()} />;
  }

  function set<K extends keyof StudentProfileDto>(key: K, value: StudentProfileDto[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveBasics() {
    save.mutate({
      fullName: draft.fullName,
      rollNumber: draft.rollNumber,
      department: draft.department,
      degree: draft.degree,
      batch: draft.batch,
      section: draft.section,
      graduationYear: draft.graduationYear,
      cgpa: draft.cgpa,
      backlogs: draft.backlogs,
      phone: draft.phone,
      location: draft.location,
      headline: draft.headline,
      summary: draft.summary,
      linkedinUrl: draft.linkedinUrl || undefined,
      githubUrl: draft.githubUrl || undefined,
      portfolioUrl: draft.portfolioUrl || undefined,
    });
  }

  function addSkill() {
    if (!newSkill.name.trim()) return;
    const skills = [
      ...(draft.skills ?? []),
      { name: newSkill.name.trim(), category: newSkill.category as never, proficiency: 60, source: 'SELF' as const, verified: false },
    ];
    set('skills', skills);
    setNewSkill({ name: '', category: SkillCategory.PROGRAMMING_LANGUAGE });
    save.mutate({ skills });
  }

  function removeSkill(name: string) {
    const skills = (draft.skills ?? []).filter((s) => s.name !== name);
    set('skills', skills);
    save.mutate({ skills });
  }

  const error = save.error instanceof ApiClientError ? save.error : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Your profile drives readiness scoring, job matching and eligibility checks. Completeness matters."
      />

      <Card>
        <CardContent className="space-y-2 p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Profile completion</span>
            <span className="tabular-nums">{profile.data.profileCompletion}%</span>
          </div>
          <Progress value={profile.data.profileCompletion} tone={profile.data.profileCompletion >= 70 ? 'success' : 'warning'} />
          {profile.data.profileCompletion < 100 && (
            <p className="text-xs text-muted-foreground">
              A CGPA, at least five skills, one project and a primary resume together account for most of the
              remaining percentage.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="danger" title="Save failed">
          <p>{error.message}</p>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'basics', label: 'Basic details' },
          { value: 'skills', label: 'Skills', count: draft.skills?.length },
          { value: 'education', label: 'Education', count: draft.education?.length },
          { value: 'experience', label: 'Projects & experience', count: (draft.projects?.length ?? 0) + (draft.experience?.length ?? 0) },
        ]}
      />

      {tab === 'basics' && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="fullName">
                <Input id="fullName" value={draft.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} />
              </Field>
              <Field label="Roll number" htmlFor="rollNumber">
                <Input id="rollNumber" value={draft.rollNumber ?? ''} onChange={(e) => set('rollNumber', e.target.value)} />
              </Field>
              <Field label="Department" htmlFor="department">
                <Input id="department" value={draft.department ?? ''} onChange={(e) => set('department', e.target.value)} />
              </Field>
              <Field label="Degree" htmlFor="degree">
                <Input id="degree" value={draft.degree ?? ''} onChange={(e) => set('degree', e.target.value)} placeholder="B.Tech" />
              </Field>
              <Field label="Batch" htmlFor="batch">
                <Input id="batch" value={draft.batch ?? ''} onChange={(e) => set('batch', e.target.value)} placeholder="2021-2025" />
              </Field>
              <Field label="Section" htmlFor="section">
                <Input id="section" value={draft.section ?? ''} onChange={(e) => set('section', e.target.value)} />
              </Field>
              <Field label="Graduation year" htmlFor="graduationYear">
                <Input id="graduationYear" type="number" value={draft.graduationYear ?? ''} onChange={(e) => set('graduationYear', Number(e.target.value))} />
              </Field>
              <Field
                label="CGPA (out of 10)"
                htmlFor="cgpa"
                hint="Most campus recruiters apply a hard CGPA cut-off, so this is required for eligibility checks."
              >
                <Input id="cgpa" type="number" step="0.01" min={0} max={10} value={draft.cgpa ?? ''} onChange={(e) => set('cgpa', Number(e.target.value))} />
              </Field>
              <Field label="Active backlogs" htmlFor="backlogs">
                <Input id="backlogs" type="number" min={0} value={draft.backlogs ?? 0} onChange={(e) => set('backlogs', Number(e.target.value))} />
              </Field>
              <Field label="Phone" htmlFor="phone">
                <Input id="phone" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="LinkedIn" htmlFor="linkedin">
                <Input id="linkedin" value={draft.linkedinUrl ?? ''} onChange={(e) => set('linkedinUrl', e.target.value)} placeholder="https://linkedin.com/in/…" />
              </Field>
              <Field label="GitHub" htmlFor="github">
                <Input id="github" value={draft.githubUrl ?? ''} onChange={(e) => set('githubUrl', e.target.value)} placeholder="https://github.com/…" />
              </Field>
            </div>

            <Field label="Headline" htmlFor="headline" hint="One line summarising who you are professionally.">
              <Input id="headline" maxLength={160} value={draft.headline ?? ''} onChange={(e) => set('headline', e.target.value)} />
            </Field>

            <Field label="Summary" htmlFor="summary">
              <Textarea id="summary" maxLength={2000} value={draft.summary ?? ''} onChange={(e) => set('summary', e.target.value)} className="min-h-[120px]" />
            </Field>

            <Button onClick={saveBasics} loading={save.isPending}>
              <Save className="size-4" />
              Save changes
            </Button>
          </CardContent>
        </Card>
      )}

      {tab === 'skills' && (
        <Card>
          <CardHeader><CardTitle>Skills</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(draft.skills ?? []).map((skill) => (
                <span
                  key={skill.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-sm"
                >
                  {skill.name}
                  {skill.verified && <Badge variant="success">Verified</Badge>}
                  <button type="button" onClick={() => removeSkill(skill.name)} aria-label={`Remove ${skill.name}`}>
                    <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </span>
              ))}
              {!draft.skills?.length && <p className="text-sm text-muted-foreground">No skills added yet.</p>}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Add a skill" htmlFor="skillName" className="flex-1 min-w-[12rem]">
                <Input
                  id="skillName"
                  value={newSkill.name}
                  onChange={(e) => setNewSkill((s) => ({ ...s, name: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addSkill()}
                  placeholder="React"
                />
              </Field>
              <Field label="Category" htmlFor="skillCategory" className="w-56">
                <Select id="skillCategory" value={newSkill.category} onChange={(e) => setNewSkill((s) => ({ ...s, category: e.target.value }))}>
                  {Object.values(SkillCategory).map((category) => (
                    <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>
                  ))}
                </Select>
              </Field>
              <Button onClick={addSkill}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            <Alert variant="info">
              <p>
                Skills marked <strong>Verified</strong> were confirmed by your resume analysis. Uploading a resume
                is the fastest way to populate this list accurately.
              </p>
            </Alert>
          </CardContent>
        </Card>
      )}

      {tab === 'education' && (
        <Card>
          <CardHeader><CardTitle>Education</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(draft.education ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No education entries. These are filled in automatically when you analyse a resume.
              </p>
            ) : (
              draft.education!.map((entry, index) => (
                <div key={index} className="rounded-lg border border-border p-3">
                  <p className="font-medium">{entry.degree}</p>
                  <p className="text-sm text-muted-foreground">
                    {entry.institution}
                    {entry.fieldOfStudy ? ` · ${entry.fieldOfStudy}` : ''}
                    {entry.cgpa ? ` · CGPA ${entry.cgpa}` : ''}
                    {entry.endYear ? ` · ${entry.endYear}` : ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'experience' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Projects ({draft.projects?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(draft.projects ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects yet. Analysing a resume imports them.</p>
              ) : (
                draft.projects!.map((project, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{project.title}</p>
                    {project.description && <p className="mt-0.5 text-sm text-muted-foreground">{project.description}</p>}
                    {project.technologies?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {project.technologies.map((tech) => <Badge key={tech} variant="muted">{tech}</Badge>)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Experience ({draft.experience?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(draft.experience ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No experience entries yet.</p>
              ) : (
                draft.experience!.map((entry, index) => (
                  <div key={index} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{entry.role}</p>
                    <p className="text-sm text-muted-foreground">
                      {entry.company} · {entry.type?.replace(/_/g, ' ').toLowerCase()}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader><CardTitle>Certifications ({draft.certifications?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(draft.certifications ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No certifications yet.</p>
              ) : (
                draft.certifications!.map((cert, index) => (
                  <Badge key={index} variant="secondary">
                    {cert.name}{cert.issuer ? ` · ${cert.issuer}` : ''}
                  </Badge>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
