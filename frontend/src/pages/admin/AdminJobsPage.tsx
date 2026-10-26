import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus } from 'lucide-react';
import type { CompanyDto, JobDescriptionDto, JobRoleDto } from '@careerpilot/shared';
import {
  Badge, Button, Card, CardContent, EmptyState, Field, Input, LoadingState, Modal, PageHeader,
  Select, Table, Tabs, Td, Textarea, Th,
} from '@/components/ui';
import { apiGet, apiGetPaginated, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

export default function AdminJobsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('jobs');
  const [creating, setCreating] = React.useState<'job' | 'role' | null>(null);

  const jobs = useQuery({
    queryKey: ['jobs', 'descriptions', 'admin'],
    queryFn: () => apiGetPaginated<JobDescriptionDto>('/jobs/descriptions', { limit: 100 }),
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => apiGet<JobRoleDto[]>('/jobs/roles') });
  const companies = useQuery({ queryKey: ['companies'], queryFn: () => apiGetPaginated<CompanyDto>('/companies', { limit: 100 }) });

  const createJob = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost('/admin/jobs', payload),
    onSuccess: () => {
      toast.success('Job description created');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setCreating(null);
    },
    onError: (error) => toast.error('Could not create', error instanceof Error ? error.message : undefined),
  });

  const createRole = useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiPost('/admin/roles', payload),
    onSuccess: () => {
      toast.success('Role created');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setCreating(null);
    },
    onError: (error) => toast.error('Could not create', error instanceof Error ? error.message : undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Job Descriptions &amp; Roles"
        description="The openings students match against, and the role definitions that drive skill-gap detection."
        actions={
          <Button onClick={() => setCreating(tab === 'jobs' ? 'job' : 'role')}>
            <Plus className="size-4" />
            Add {tab === 'jobs' ? 'a job description' : 'a role'}
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'jobs', label: 'Job descriptions', count: jobs.data?.items.length },
          { value: 'roles', label: 'Roles', count: roles.data?.length },
        ]}
      />

      {tab === 'jobs' && (
        jobs.isLoading ? <LoadingState /> :
        !jobs.data?.items.length ? (
          <EmptyState icon={Briefcase} title="No job descriptions yet" />
        ) : (
          <Table>
            <thead>
              <tr><Th>Title</Th><Th>Company</Th><Th>Role</Th><Th>Required skills</Th><Th>Package</Th><Th>Data</Th></tr>
            </thead>
            <tbody>
              {jobs.data.items.map((job) => (
                <tr key={job.id}>
                  <Td className="font-medium">{job.title}</Td>
                  <Td className="text-muted-foreground">{(job as unknown as { companyId?: { name?: string } }).companyId?.name ?? '—'}</Td>
                  <Td className="text-muted-foreground">{(job as unknown as { roleId?: { title?: string } }).roleId?.title ?? '—'}</Td>
                  <Td className="max-w-xs truncate text-xs text-muted-foreground">{job.requiredSkills.join(', ')}</Td>
                  <Td className="tabular-nums">{job.packageLpa ? `${job.packageLpa} LPA` : '—'}</Td>
                  <Td>{job.provenance !== 'REAL' && <Badge variant="muted">{job.provenance}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      )}

      {tab === 'roles' && (
        roles.isLoading ? <LoadingState /> :
        !roles.data?.length ? (
          <EmptyState icon={Briefcase} title="No roles yet" />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {roles.data.map((role) => (
              <Card key={role.id}>
                <CardContent className="space-y-2 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{role.title}</p>
                    <Badge variant="secondary">{role.family}</Badge>
                  </div>
                  {role.description && <p className="text-sm text-muted-foreground">{role.description}</p>}
                  <div>
                    <p className="text-xs font-medium">Core skills</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {role.coreSkills.map((skill) => <Badge key={skill} variant="muted">{skill}</Badge>)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {creating === 'job' && (
        <JobModal
          companies={companies.data?.items ?? []}
          roles={roles.data ?? []}
          onClose={() => setCreating(null)}
          onSave={(payload) => createJob.mutate(payload)}
          pending={createJob.isPending}
        />
      )}

      {creating === 'role' && (
        <RoleModal
          onClose={() => setCreating(null)}
          onSave={(payload) => createRole.mutate(payload)}
          pending={createRole.isPending}
        />
      )}
    </div>
  );
}

function JobModal({
  companies, roles, onClose, onSave, pending,
}: {
  companies: CompanyDto[];
  roles: JobRoleDto[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [form, setForm] = React.useState({
    companyId: '', roleId: '', title: '', location: '', packageLpa: '',
    descriptionText: '', requiredSkills: '', preferredSkills: '',
  });

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const valid = form.companyId && form.roleId && form.title && form.descriptionText.length >= 50;

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a job description"
      description="Required skills drive matching and skill-gap detection, so be precise."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={pending}
            disabled={!valid}
            onClick={() =>
              onSave({
                companyId: form.companyId,
                roleId: form.roleId,
                title: form.title,
                location: form.location || undefined,
                packageLpa: form.packageLpa ? Number(form.packageLpa) : undefined,
                descriptionText: form.descriptionText,
                requiredSkills: form.requiredSkills.split(',').map((s) => s.trim()).filter(Boolean),
                preferredSkills: form.preferredSkills.split(',').map((s) => s.trim()).filter(Boolean),
                responsibilities: [],
                qualifications: [],
                active: true,
              })
            }
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" htmlFor="companyId" required>
            <Select id="companyId" value={form.companyId} onChange={(e) => set('companyId', e.target.value)}>
              <option value="">Select…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Role" htmlFor="roleId" required>
            <Select id="roleId" value={form.roleId} onChange={(e) => set('roleId', e.target.value)}>
              <option value="">Select…</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Title" htmlFor="title" required>
          <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Software Developer - Amazon" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location" htmlFor="location">
            <Input id="location" value={form.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label="Package (LPA)" htmlFor="packageLpa">
            <Input id="packageLpa" type="number" step="0.1" value={form.packageLpa} onChange={(e) => set('packageLpa', e.target.value)} />
          </Field>
        </div>

        <Field label="Required skills" htmlFor="requiredSkills" required hint="Comma-separated. These carry the most weight in matching.">
          <Input id="requiredSkills" value={form.requiredSkills} onChange={(e) => set('requiredSkills', e.target.value)} placeholder="Java, SQL, Data Structures" />
        </Field>

        <Field label="Preferred skills" htmlFor="preferredSkills" hint="Comma-separated.">
          <Input id="preferredSkills" value={form.preferredSkills} onChange={(e) => set('preferredSkills', e.target.value)} />
        </Field>

        <Field label="Description" htmlFor="descriptionText" required hint="At least 50 characters.">
          <Textarea
            id="descriptionText"
            value={form.descriptionText}
            onChange={(e) => set('descriptionText', e.target.value)}
            className="min-h-[160px]"
          />
        </Field>
      </div>
    </Modal>
  );
}

function RoleModal({
  onClose, onSave, pending,
}: {
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  const [form, setForm] = React.useState({ title: '', family: '', description: '', coreSkills: '', interviewTopics: '' });

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a role"
      description="Core skills define the role's requirements and drive skill-gap detection for students targeting it."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={pending}
            disabled={!form.title || !form.family}
            onClick={() =>
              onSave({
                title: form.title,
                family: form.family,
                description: form.description || undefined,
                coreSkills: form.coreSkills.split(',').map((s) => s.trim()).filter(Boolean),
                interviewTopics: form.interviewTopics.split(',').map((s) => s.trim()).filter(Boolean),
                active: true,
              })
            }
          >
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="title" required>
          <Input id="title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Backend Engineer" />
        </Field>
        <Field label="Family" htmlFor="family" required>
          <Input id="family" value={form.family} onChange={(e) => set('family', e.target.value)} placeholder="Engineering" />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Core skills" htmlFor="coreSkills" hint="Comma-separated. A student missing these gets a skill gap.">
          <Input id="coreSkills" value={form.coreSkills} onChange={(e) => set('coreSkills', e.target.value)} />
        </Field>
        <Field label="Interview topics" htmlFor="interviewTopics" hint="Comma-separated. Biases interview question selection.">
          <Input id="interviewTopics" value={form.interviewTopics} onChange={(e) => set('interviewTopics', e.target.value)} placeholder="dsa, system-design, dbms" />
        </Field>
      </div>
    </Modal>
  );
}
