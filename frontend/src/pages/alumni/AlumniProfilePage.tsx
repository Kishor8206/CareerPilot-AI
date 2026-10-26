import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, LoadingState,
  PageHeader, Select, Textarea,
} from '@/components/ui';
import { apiGet, apiPatch } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function AlumniProfilePage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const profile = useQuery({ queryKey: ['alumni', 'me'], queryFn: () => apiGet<Record<string, any>>('/alumni/me') });
  const [draft, setDraft] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    if (profile.data) setDraft(profile.data);
  }, [profile.data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPatch('/alumni/me', payload),
    onSuccess: async () => {
      toast.success('Profile saved');
      await queryClient.invalidateQueries({ queryKey: ['alumni'] });
    },
    onError: (error) => toast.error('Could not save', error instanceof Error ? error.message : undefined),
  });

  if (profile.isLoading) return <LoadingState />;

  function set(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const availability = (draft.availability ?? []) as Array<{ dayOfWeek: number; startTime: string; endTime: string; timezone: string }>;
  const verified = draft.verificationStatus === 'VERIFIED';

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Mentor Profile"
        description="Students see this profile when searching for a mentor."
      />

      <Alert variant={verified ? 'success' : 'warning'} title={`Verification: ${String(draft.verificationStatus ?? '').replace(/_/g, ' ')}`}>
        {verified ? (
          <p className="flex items-center gap-1.5">
            <ShieldCheck className="size-4" />
            Your employment has been verified. You appear in student mentor searches.
          </p>
        ) : (
          <p>
            An administrator must verify your employment before you appear in student searches or can accept
            mentorship requests. Complete your company, designation and work email to speed this up.
          </p>
        )}
        {draft.verificationNote && <p className="mt-1 text-xs">Note: {draft.verificationNote}</p>}
      </Alert>

      <Card>
        <CardHeader><CardTitle>Professional details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName">
              <Input id="fullName" value={draft.fullName ?? ''} onChange={(e) => set('fullName', e.target.value)} />
            </Field>
            <Field label="Company" htmlFor="company" required>
              <Input id="company" value={draft.company ?? ''} onChange={(e) => set('company', e.target.value)} />
            </Field>
            <Field label="Designation" htmlFor="designation" required>
              <Input id="designation" value={draft.designation ?? ''} onChange={(e) => set('designation', e.target.value)} />
            </Field>
            <Field label="Domain" htmlFor="domain" required>
              <Input id="domain" value={draft.domain ?? ''} onChange={(e) => set('domain', e.target.value)} />
            </Field>
            <Field label="Years of experience" htmlFor="experienceYears">
              <Input id="experienceYears" type="number" min={0} value={draft.experienceYears ?? 0} onChange={(e) => set('experienceYears', Number(e.target.value))} />
            </Field>
            <Field label="Graduation year" htmlFor="graduationYear">
              <Input id="graduationYear" type="number" value={draft.graduationYear ?? ''} onChange={(e) => set('graduationYear', Number(e.target.value))} />
            </Field>
            <Field label="Department" htmlFor="department">
              <Input id="department" value={draft.department ?? ''} onChange={(e) => set('department', e.target.value)} />
            </Field>
            <Field label="LinkedIn" htmlFor="linkedin">
              <Input id="linkedin" value={draft.linkedinUrl ?? ''} onChange={(e) => set('linkedinUrl', e.target.value)} />
            </Field>
          </div>

          <Field label="Bio" htmlFor="bio" hint="What can students expect from a session with you?">
            <Textarea id="bio" value={draft.bio ?? ''} onChange={(e) => set('bio', e.target.value)} className="min-h-[100px]" />
          </Field>

          <Field label="Areas of expertise" htmlFor="expertise" hint="Comma-separated.">
            <Input
              id="expertise"
              value={(draft.expertise ?? []).join(', ')}
              onChange={(e) => set('expertise', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              placeholder="System Design, Data Structures, AWS"
            />
          </Field>

          <Field label="Skills" htmlFor="skills" hint="Comma-separated.">
            <Input
              id="skills"
              value={(draft.skills ?? []).join(', ')}
              onChange={(e) => set('skills', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </Field>

          <Button
            onClick={() =>
              save.mutate({
                fullName: draft.fullName, company: draft.company, designation: draft.designation,
                domain: draft.domain, experienceYears: draft.experienceYears, graduationYear: draft.graduationYear,
                department: draft.department, linkedinUrl: draft.linkedinUrl || undefined, bio: draft.bio,
                expertise: draft.expertise, skills: draft.skills,
              })
            }
            loading={save.isPending}
          >
            <Save className="size-4" />
            Save profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Mentoring availability</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Accepting new mentees" htmlFor="accepting" className="w-56">
              <Select
                id="accepting"
                value={draft.acceptingMentees ? 'yes' : 'no'}
                onChange={(e) => set('acceptingMentees', e.target.value === 'yes')}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>

            <Field label="Maximum sessions per month" htmlFor="maxMentees" className="w-56">
              <Input
                id="maxMentees"
                type="number"
                min={0}
                max={100}
                value={draft.maxMenteesPerMonth ?? 5}
                onChange={(e) => set('maxMenteesPerMonth', Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Weekly slots</p>
            {availability.map((slot, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                <Select
                  value={String(slot.dayOfWeek)}
                  onChange={(e) =>
                    set('availability', availability.map((s, i) => (i === index ? { ...s, dayOfWeek: Number(e.target.value) } : s)))
                  }
                  className="w-36"
                  aria-label="Day of week"
                >
                  {DAYS.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
                </Select>
                <Input
                  type="time"
                  value={slot.startTime}
                  onChange={(e) => set('availability', availability.map((s, i) => (i === index ? { ...s, startTime: e.target.value } : s)))}
                  className="w-32"
                  aria-label="Start time"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={slot.endTime}
                  onChange={(e) => set('availability', availability.map((s, i) => (i === index ? { ...s, endTime: e.target.value } : s)))}
                  className="w-32"
                  aria-label="End time"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => set('availability', availability.filter((_, i) => i !== index))}
                  aria-label="Remove slot"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set('availability', [...availability, { dayOfWeek: 6, startTime: '10:00', endTime: '12:00', timezone: 'Asia/Kolkata' }])
              }
            >
              <Plus className="size-4" />
              Add a slot
            </Button>
          </div>

          <Button
            onClick={() =>
              save.mutate({
                acceptingMentees: draft.acceptingMentees,
                maxMenteesPerMonth: draft.maxMenteesPerMonth,
                availability: draft.availability,
              })
            }
            loading={save.isPending}
          >
            <Save className="size-4" />
            Save availability
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Employment verification</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <p>
              Changing these details returns your account to pending review, because the claim an administrator
              previously verified would no longer be the claim being made.
            </p>
          </Alert>

          <Field label="Work email" htmlFor="workEmail" hint="A company-domain address makes verification straightforward.">
            <Input
              id="workEmail"
              type="email"
              value={draft.employmentProof?.workEmail ?? ''}
              onChange={(e) => set('employmentProof', { ...draft.employmentProof, workEmail: e.target.value })}
            />
          </Field>

          <Field label="Employee ID (optional)" htmlFor="employeeId">
            <Input
              id="employeeId"
              value={draft.employmentProof?.employeeId ?? ''}
              onChange={(e) => set('employmentProof', { ...draft.employmentProof, employeeId: e.target.value })}
            />
          </Field>

          <Button
            variant="outline"
            onClick={() => save.mutate({ employmentProof: draft.employmentProof })}
            loading={save.isPending}
          >
            Submit for verification
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
