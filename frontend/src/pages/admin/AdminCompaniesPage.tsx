import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import type { CompanyDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, EmptyState, Field, Input, LoadingState, Modal,
  PageHeader, Select, Table, Td, Textarea, Th,
} from '@/components/ui';
import { apiGetPaginated, apiPatch, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

const TIERS = ['TIER_1', 'TIER_2', 'TIER_3', 'PRODUCT', 'SERVICE', 'STARTUP'];

export default function AdminCompaniesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = React.useState<Record<string, any> | null>(null);

  const companies = useQuery({
    queryKey: ['companies', 'admin'],
    queryFn: () => apiGetPaginated<CompanyDto>('/companies', { limit: 100 }),
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing?.id ? apiPatch(`/admin/companies/${editing.id}`, payload) : apiPost('/admin/companies', payload),
    onSuccess: () => {
      toast.success('Company saved');
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      setEditing(null);
    },
    onError: (error) => toast.error('Could not save', error instanceof Error ? error.message : undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        description="The company catalogue students target and match against."
        actions={<Button onClick={() => setEditing({})}><Plus className="size-4" />Add a company</Button>}
      />

      <Alert variant="info" title="Recruitment information and sourcing">
        <p>
          A company whose recruitment pattern has no source URL is labelled <strong>unverified</strong> across the
          platform, and the RAG layer refuses to present it as fact. Add an official source before relying on it.
        </p>
      </Alert>

      {companies.isLoading ? (
        <LoadingState />
      ) : !companies.data?.items.length ? (
        <EmptyState icon={Building2} title="No companies yet" action={<Button onClick={() => setEditing({})}>Add the first company</Button>} />
      ) : (
        <Table>
          <thead>
            <tr><Th>Company</Th><Th>Industry</Th><Th>Tier</Th><Th>Open roles</Th><Th>Recruitment info</Th><Th>Data</Th><Th></Th></tr>
          </thead>
          <tbody>
            {companies.data.items.map((company) => (
              <tr key={company.id}>
                <Td className="font-medium">{company.name}</Td>
                <Td className="text-muted-foreground">{company.industry}</Td>
                <Td><Badge variant="secondary">{company.tier?.replace(/_/g, ' ')}</Badge></Td>
                <Td className="tabular-nums">{(company as unknown as { openRoles?: number }).openRoles ?? 0}</Td>
                <Td>
                  <Badge variant={(company.recruitmentPattern?.sources?.length ?? 0) > 0 ? 'success' : 'warning'}>
                    {(company.recruitmentPattern?.sources?.length ?? 0) > 0 ? 'Sourced' : 'Unverified'}
                  </Badge>
                </Td>
                <Td>
                  {company.provenance !== 'REAL' && <Badge variant="muted">{company.provenance}</Badge>}
                </Td>
                <Td>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(company)}>Edit</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <CompanyModal
          company={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => save.mutate(payload)}
          pending={save.isPending}
        />
      )}
    </div>
  );
}

function CompanyModal({
  company,
  onClose,
  onSave,
  pending,
}: {
  company: Record<string, any>;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  // Explicitly typed: `company` arrives as a loose record, so without this
  // every field would widen to `any` and lose checking inside the form.
  interface CompanyForm {
    name: string; industry: string; tier: string; website: string;
    headquarters: string; description: string; minCgpa: string; maxBacklogs: string;
    rounds: string; sources: string;
  }

  const [form, setForm] = React.useState<CompanyForm>({
    name: String(company.name ?? ''),
    industry: String(company.industry ?? ''),
    tier: String(company.tier ?? 'SERVICE'),
    website: String(company.website ?? ''),
    headquarters: String(company.headquarters ?? ''),
    description: String(company.description ?? ''),
    minCgpa: company.recruitmentPattern?.eligibility?.minCgpa != null ? String(company.recruitmentPattern.eligibility.minCgpa) : '',
    maxBacklogs: company.recruitmentPattern?.eligibility?.maxBacklogs != null ? String(company.recruitmentPattern.eligibility.maxBacklogs) : '',
    rounds: ((company.recruitmentPattern?.rounds ?? []) as Array<{ name: string }>).map((r) => r.name).join('\n'),
    sources: ((company.recruitmentPattern?.sources ?? []) as string[]).join('\n'),
  });

  function set(key: keyof CompanyForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={company.id ? `Edit ${company.name}` : 'Add a company'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={pending}
            disabled={!form.name || !form.industry}
            onClick={() =>
              onSave({
                name: form.name,
                industry: form.industry,
                tier: form.tier,
                website: form.website || undefined,
                headquarters: form.headquarters || undefined,
                description: form.description || undefined,
                recruitmentPattern: {
                  rounds: form.rounds.split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name })),
                  eligibility: {
                    minCgpa: form.minCgpa ? Number(form.minCgpa) : undefined,
                    maxBacklogs: form.maxBacklogs ? Number(form.maxBacklogs) : undefined,
                    allowedDepartments: [],
                  },
                  sources: form.sources.split('\n').map((s) => s.trim()).filter(Boolean),
                },
                active: true,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" required>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Industry" htmlFor="industry" required>
            <Input id="industry" value={form.industry} onChange={(e) => set('industry', e.target.value)} />
          </Field>
          <Field label="Tier" htmlFor="tier">
            <Select id="tier" value={form.tier} onChange={(e) => set('tier', e.target.value)}>
              {TIERS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Headquarters" htmlFor="headquarters">
            <Input id="headquarters" value={form.headquarters} onChange={(e) => set('headquarters', e.target.value)} />
          </Field>
          <Field label="Website" htmlFor="website">
            <Input id="website" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          </Field>
        </div>

        <Field label="Description" htmlFor="description">
          <Textarea id="description" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum CGPA" htmlFor="minCgpa">
            <Input id="minCgpa" type="number" step="0.1" min={0} max={10} value={form.minCgpa} onChange={(e) => set('minCgpa', e.target.value)} />
          </Field>
          <Field label="Maximum backlogs" htmlFor="maxBacklogs">
            <Input id="maxBacklogs" type="number" min={0} value={form.maxBacklogs} onChange={(e) => set('maxBacklogs', e.target.value)} />
          </Field>
        </div>

        <Field label="Recruitment rounds" htmlFor="rounds" hint="One per line, in order.">
          <Textarea id="rounds" value={form.rounds} onChange={(e) => set('rounds', e.target.value)} placeholder={'Online Assessment\nTechnical Interview\nHR Interview'} />
        </Field>

        <Field
          label="Source URLs"
          htmlFor="sources"
          hint="One per line. Without a source, the recruitment information is labelled unverified everywhere it appears."
        >
          <Textarea id="sources" value={form.sources} onChange={(e) => set('sources', e.target.value)} className="font-mono text-xs" />
        </Field>
      </div>
    </Modal>
  );
}
