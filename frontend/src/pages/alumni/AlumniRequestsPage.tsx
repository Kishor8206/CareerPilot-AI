import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import {
  Badge, Button, Card, CardContent, EmptyState, Field, Input, LoadingState, Modal, PageHeader,
  Select, Tabs, Textarea,
} from '@/components/ui';
import { apiGet, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDateTime } from '@/utils/format';

export default function AlumniRequestsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('PENDING');
  const [responding, setResponding] = React.useState<{ id: string; student: string; topic: string } | null>(null);

  const requests = useQuery({
    queryKey: ['alumni', 'requests', tab],
    queryFn: () => apiGet<Array<Record<string, any>>>(`/alumni/requests?status=${tab}`),
  });

  const reject = useMutation({
    mutationFn: (id: string) => apiPost(`/alumni/requests/${id}/respond`, { accept: false, message: 'Unable to take this session at the moment.' }),
    onSuccess: () => {
      toast.toast({ title: 'Request declined', variant: 'info' });
      queryClient.invalidateQueries({ queryKey: ['alumni'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Mentorship Requests" description="Accepting a request schedules the session and notifies the student immediately." />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'PENDING', label: 'Pending' },
          { value: 'ACCEPTED', label: 'Accepted' },
          { value: 'REJECTED', label: 'Declined' },
        ]}
      />

      {requests.isLoading ? (
        <LoadingState />
      ) : !requests.data?.length ? (
        <EmptyState icon={Inbox} title={`No ${tab.toLowerCase()} requests`} />
      ) : (
        <div className="space-y-3">
          {requests.data.map((request) => (
            <Card key={request._id}>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{request.studentUserId?.fullName ?? 'Student'}</p>
                      <Badge variant="muted">
                        {request.studentId?.department ?? ''} {request.studentId?.batch ?? ''}
                      </Badge>
                    </div>

                    <p className="mt-1 font-medium text-primary">{request.topic}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{request.message}</p>

                    {request.targetCompany && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Targeting {request.targetCompany}
                        {request.targetRole ? ` · ${request.targetRole}` : ''}
                      </p>
                    )}

                    {request.preferredSlots?.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Preferred times: {request.preferredSlots.map((s: string) => formatDateTime(s)).join(' · ')}
                      </p>
                    )}

                    <p className="mt-2 text-xs text-muted-foreground">Requested {formatDateTime(request.createdAt)}</p>
                  </div>

                  {request.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          setResponding({
                            id: request._id,
                            student: request.studentUserId?.fullName ?? 'the student',
                            topic: request.topic,
                          })
                        }
                      >
                        <Check className="size-4" />
                        Accept &amp; schedule
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => reject.mutate(request._id)}>
                        <X className="size-4" />
                        Decline
                      </Button>
                    </div>
                  )}

                  {request.status !== 'PENDING' && (
                    <Badge variant={request.status === 'ACCEPTED' ? 'success' : 'danger'}>{request.status}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {responding && (
        <ScheduleModal
          request={responding}
          onClose={() => setResponding(null)}
          onScheduled={() => {
            setResponding(null);
            queryClient.invalidateQueries({ queryKey: ['alumni'] });
          }}
          toast={toast}
        />
      )}
    </div>
  );
}

function ScheduleModal({
  request,
  onClose,
  onScheduled,
  toast,
}: {
  request: { id: string; student: string; topic: string };
  onClose: () => void;
  onScheduled: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [duration, setDuration] = React.useState(45);
  const [type, setType] = React.useState('MOCK_INTERVIEW');
  const [message, setMessage] = React.useState('');

  const accept = useMutation({
    mutationFn: () =>
      apiPost(`/alumni/requests/${request.id}/respond`, {
        accept: true,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: duration,
        type,
        message,
      }),
    onSuccess: () => {
      toast.success('Session scheduled', `${request.student} has been notified.`);
      onScheduled();
    },
    onError: (error) => toast.error('Could not schedule', error instanceof Error ? error.message : undefined),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Schedule with ${request.student}`}
      description={request.topic}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => accept.mutate()} loading={accept.isPending} disabled={!scheduledAt}>
            Accept &amp; schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Date and time" htmlFor="scheduledAt" required>
          <Input
            id="scheduledAt"
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Duration" htmlFor="duration">
            <Select id="duration" value={String(duration)} onChange={(e) => setDuration(Number(e.target.value))}>
              {[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </Select>
          </Field>

          <Field label="Session type" htmlFor="type">
            <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="MOCK_INTERVIEW">Mock interview</option>
              <option value="MENTORSHIP_CALL">Mentorship call</option>
              <option value="RESUME_REVIEW">Resume review</option>
            </Select>
          </Field>
        </div>

        <Field label="Message to the student" htmlFor="message">
          <Textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Anything they should prepare beforehand?"
          />
        </Field>
      </div>
    </Modal>
  );
}
