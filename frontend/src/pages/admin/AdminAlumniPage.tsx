import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldCheck, X } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, EmptyState, Field, LoadingState, Modal, PageHeader,
  Tabs, Textarea,
} from '@/components/ui';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate } from '@/utils/format';

export default function AdminAlumniPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('PENDING');
  const [reviewing, setReviewing] = React.useState<{ id: string; name: string; approve: boolean } | null>(null);

  const alumni = useQuery({
    queryKey: ['admin', 'alumni', tab],
    queryFn: () => apiGet<Array<Record<string, any>>>(`/admin/alumni?status=${tab}`),
  });

  const verify = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note: string }) =>
      apiPost(`/admin/alumni/${id}/verify`, { status, note }),
    onSuccess: (_, variables) => {
      toast.success(variables.status === 'VERIFIED' ? 'Alumnus verified' : 'Verification rejected');
      queryClient.invalidateQueries({ queryKey: ['admin'] });
      setReviewing(null);
    },
    onError: (error) => toast.error('Could not update verification', error instanceof Error ? error.message : undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alumni Verification"
        description="Only verified alumni appear in student searches and can conduct mock interviews."
      />

      <Alert variant="info" title="What verification means">
        <p>
          Verifying an account confirms you have satisfied yourself that this person works where they claim.
          Their feedback is weighted into students' readiness scores, so the check matters. Every decision is
          recorded in the audit log against your account.
        </p>
      </Alert>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'PENDING', label: 'Pending' },
          { value: 'VERIFIED', label: 'Verified' },
          { value: 'REJECTED', label: 'Rejected' },
        ]}
      />

      {alumni.isLoading ? (
        <LoadingState />
      ) : !alumni.data?.length ? (
        <EmptyState icon={ShieldCheck} title={`No ${tab.toLowerCase()} alumni`} />
      ) : (
        <div className="space-y-3">
          {alumni.data.map((profile) => (
            <Card key={profile._id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{profile.userId?.fullName ?? 'Alumni'}</p>
                      <Badge
                        variant={
                          profile.verificationStatus === 'VERIFIED' ? 'success'
                            : profile.verificationStatus === 'REJECTED' ? 'danger' : 'warning'
                        }
                      >
                        {profile.verificationStatus}
                      </Badge>
                    </div>

                    <p className="text-sm text-muted-foreground">
                      {profile.designation} · {profile.company} · {profile.experienceYears} years
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {profile.domain}
                      {profile.department ? ` · ${profile.department}` : ''}
                      {profile.graduationYear ? ` · Class of ${profile.graduationYear}` : ''}
                    </p>

                    <div className="mt-2 rounded-md bg-muted/50 p-3 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Employment evidence
                      </p>
                      <p className="mt-1">
                        Account email: {profile.userId?.email ?? '—'}
                      </p>
                      <p>Work email: {profile.employmentProof?.workEmail ?? 'Not supplied'}</p>
                      <p>Employee ID: {profile.employmentProof?.employeeId ?? 'Not supplied'}</p>
                      {profile.linkedinUrl && (
                        <p className="break-all">
                          LinkedIn:{' '}
                          <a href={profile.linkedinUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                            {profile.linkedinUrl}
                          </a>
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Registered {formatDate(profile.userId?.createdAt)}
                      </p>
                    </div>

                    {profile.bio && <p className="mt-2 text-sm text-muted-foreground">{profile.bio}</p>}
                    {profile.verificationNote && (
                      <p className="mt-1 text-xs italic text-muted-foreground">Note: {profile.verificationNote}</p>
                    )}
                  </div>

                  {profile.verificationStatus !== 'VERIFIED' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => setReviewing({ id: profile._id, name: profile.userId?.fullName ?? 'this alumnus', approve: true })}
                      >
                        <Check className="size-4" />
                        Verify
                      </Button>
                      {profile.verificationStatus !== 'REJECTED' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReviewing({ id: profile._id, name: profile.userId?.fullName ?? 'this alumnus', approve: false })}
                        >
                          <X className="size-4" />
                          Reject
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {reviewing && (
        <ReviewModal
          target={reviewing}
          onClose={() => setReviewing(null)}
          onSubmit={(note) =>
            verify.mutate({ id: reviewing.id, status: reviewing.approve ? 'VERIFIED' : 'REJECTED', note })
          }
          pending={verify.isPending}
        />
      )}
    </div>
  );
}

function ReviewModal({
  target,
  onClose,
  onSubmit,
  pending,
}: {
  target: { name: string; approve: boolean };
  onClose: () => void;
  onSubmit: (note: string) => void;
  pending: boolean;
}) {
  const [note, setNote] = React.useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title={target.approve ? `Verify ${target.name}` : `Reject ${target.name}`}
      description={
        target.approve
          ? 'They will appear in student mentor searches and can accept mentorship requests.'
          : 'They will be told what to correct before resubmitting.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={target.approve ? 'default' : 'destructive'}
            onClick={() => onSubmit(note)}
            loading={pending}
            disabled={!target.approve && note.trim().length < 5}
          >
            {target.approve ? 'Verify' : 'Reject'}
          </Button>
        </>
      }
    >
      <Field
        label={target.approve ? 'Verification note (optional)' : 'Reason for rejection'}
        htmlFor="note"
        required={!target.approve}
        hint={target.approve ? 'Record how you confirmed employment.' : 'The alumnus sees this, so be specific and actionable.'}
      >
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={target.approve ? 'Confirmed via work email domain and LinkedIn profile.' : 'Please supply a work email on your company domain.'}
        />
      </Field>
    </Modal>
  );
}
