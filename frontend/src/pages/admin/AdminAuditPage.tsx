import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input,
  LoadingState, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Th,
} from '@/components/ui';
import { apiGetPaginated, apiGet, apiPost } from '@/services/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/domain/Toast';
import { formatDateTime } from '@/utils/format';

export default function AdminAuditPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('audit');
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [reviewing, setReviewing] = React.useState<string | null>(null);

  const logs = useQuery({
    queryKey: ['admin', 'audit', page, action, statusFilter],
    queryFn: () =>
      apiGetPaginated<Record<string, any>>('/admin/audit', {
        page, limit: 50,
        action: action || undefined,
        status: statusFilter || undefined,
      }),
    enabled: tab === 'audit',
  });

  const flagged = useQuery({
    queryKey: ['admin', 'flagged'],
    queryFn: () => apiGet<{ attempts: Array<Record<string, any>>; events: Array<Record<string, any>>; note: string }>('/admin/flagged'),
    enabled: tab === 'flagged',
  });

  const review = useMutation({
    mutationFn: ({ id, note, clear }: { id: string; note: string; clear: boolean }) =>
      apiPost(`/admin/flagged/attempts/${id}/review`, { note, clear }),
    onSuccess: () => {
      toast.success('Review recorded');
      queryClient.invalidateQueries({ queryKey: ['admin', 'flagged'] });
      setReviewing(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit &amp; Moderation" description="The security audit trail and anything awaiting a human decision." />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'audit', label: 'Audit log' },
          { value: 'flagged', label: 'Flagged for review', count: flagged.data?.attempts.length },
        ]}
      />

      {tab === 'audit' && (
        <>
          <Card>
            <CardContent className="flex flex-wrap gap-3 p-4">
              <Input
                placeholder="Filter by action, e.g. auth.login.failure"
                value={action}
                onChange={(e) => { setAction(e.target.value); setPage(1); }}
                className="max-w-sm font-mono text-xs"
                aria-label="Filter by action"
              />
              <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-40" aria-label="Filter by status">
                <option value="">All statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILURE">Failure</option>
              </Select>
            </CardContent>
          </Card>

          {logs.isLoading ? (
            <LoadingState />
          ) : !logs.data?.items.length ? (
            <EmptyState title="No audit entries match" />
          ) : (
            <>
              <Table>
                <thead>
                  <tr><Th>When</Th><Th>Action</Th><Th>Actor</Th><Th>Resource</Th><Th>Status</Th><Th>IP</Th></tr>
                </thead>
                <tbody>
                  {logs.data.items.map((entry) => (
                    <tr key={entry._id}>
                      <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</Td>
                      <Td className="font-mono text-xs">{entry.action}</Td>
                      <Td>
                        <p className="text-sm">{entry.actorEmail ?? '—'}</p>
                        {entry.actorRole && <p className="text-xs text-muted-foreground">{entry.actorRole}</p>}
                      </Td>
                      <Td className="text-sm text-muted-foreground">
                        {entry.resource}
                        {entry.resourceId && <span className="block font-mono text-xs">{String(entry.resourceId).slice(0, 12)}…</span>}
                      </Td>
                      <Td>
                        <Badge variant={entry.status === 'SUCCESS' ? 'success' : 'danger'}>{entry.status}</Badge>
                      </Td>
                      <Td className="font-mono text-xs text-muted-foreground">{entry.ip ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {logs.data.items.length} of {logs.data.meta.total} entries
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page >= logs.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'flagged' && (
        flagged.isLoading ? <LoadingState /> : (
          <div className="space-y-4">
            <Alert variant="info" title="These require your judgement">
              <p>{flagged.data?.note}</p>
            </Alert>

            {!flagged.data?.attempts.length ? (
              <EmptyState icon={ShieldCheck} title="Nothing flagged" message="No assessment attempts currently need review." />
            ) : (
              <div className="space-y-3">
                {flagged.data.attempts.map((attempt) => (
                  <Card key={attempt._id}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2">
                          <AlertTriangle className="size-4 text-warning" />
                          {attempt.assessmentId?.title ?? 'Assessment'}
                        </CardTitle>
                        <Badge variant={attempt.integrityRisk === 'HIGH' ? 'danger' : 'warning'}>
                          {attempt.integrityRisk} risk
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {attempt.studentId?.rollNumber ?? 'Student'} · {attempt.studentId?.department ?? ''} ·{' '}
                        scored {Math.round(attempt.percentage ?? 0)}%
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {attempt.monitoringEventCount} integrity signal(s) recorded. The result stands unless you
                        decide otherwise — consider whether an innocent explanation fits before acting.
                      </p>
                      <Button size="sm" variant="outline" onClick={() => setReviewing(attempt._id)}>
                        Record a review decision
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {reviewing && (
        <ReviewModal
          onClose={() => setReviewing(null)}
          onSubmit={(note, clear) => review.mutate({ id: reviewing, note, clear })}
          pending={review.isPending}
        />
      )}
    </div>
  );
}

function ReviewModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (note: string, clear: boolean) => void;
  pending: boolean;
}) {
  const [note, setNote] = React.useState('');
  const [clear, setClear] = React.useState(true);

  return (
    <Modal
      open
      onClose={onClose}
      title="Record your review decision"
      description="Your note is visible to the student in their assessment result."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(note, clear)} loading={pending} disabled={note.trim().length < 5}>
            Save decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Review note" htmlFor="note" required hint="Explain what you concluded and why.">
          <Textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Student reported using a screen reader, which explains the focus changes. No further action."
          />
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} className="mt-1" />
          <span>
            Clear the integrity flag on this attempt
            <span className="block text-xs text-muted-foreground">
              Leave unchecked to record your review while keeping the flag visible.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
