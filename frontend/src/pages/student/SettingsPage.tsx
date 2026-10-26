import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, LoadingState,
  Modal, PageHeader, Tabs,
} from '@/components/ui';
import { apiDownload, apiGet, apiPost, ApiClientError } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/domain/Toast';
import { VoiceSettings } from '@/components/domain/VoiceSettings';

interface PrivacyPolicy {
  version: string;
  placeholder: boolean;
  summary: string;
  dataCollected: Array<{ category: string; items: string[]; purpose: string }>;
  aiProcessing: { provider: string; notice: string };
  monitoring: { notice: string; neverCollected: string[] };
  retention: Record<string, number>;
  yourRights: string[];
  contact: string;
}

export default function SettingsPage() {
  const toast = useToast();
  const { logout } = useAuthStore();
  const [tab, setTab] = React.useState('security');
  const [showDelete, setShowDelete] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');

  const policy = useQuery({ queryKey: ['privacy', 'policy'], queryFn: () => apiGet<PrivacyPolicy>('/privacy/policy') });

  const changePassword = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      apiPost('/auth/change-password', payload),
    onSuccess: async () => {
      toast.success('Password changed', 'You have been signed out of all devices.');
      await logout();
    },
    onError: (error) =>
      toast.error(
        'Could not change your password',
        error instanceof ApiClientError ? error.message : undefined,
      ),
  });

  const deleteAccount = useMutation({
    mutationFn: () => apiPost<{ message: string }>('/privacy/delete-account'),
    onSuccess: async (data) => {
      toast.toast({ title: 'Deletion requested', description: data.message, variant: 'info' });
      await logout();
    },
    onError: (error) => toast.error('Request failed', error instanceof Error ? error.message : undefined),
  });

  function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    changePassword.mutate({
      currentPassword: String(form.get('currentPassword')),
      newPassword: String(form.get('newPassword')),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings &amp; Privacy" description="Your account security and what the platform holds about you." />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'security', label: 'Security' },
          { value: 'voice', label: 'Voice' },
          { value: 'privacy', label: 'Privacy & data' },
        ]}
      />

      {tab === 'voice' && <VoiceSettings />}

      {tab === 'security' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="size-4" />Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitPassword} className="max-w-md space-y-4">
              <Field label="Current password" htmlFor="currentPassword" required>
                <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
              </Field>
              <Field
                label="New password"
                htmlFor="newPassword"
                required
                hint="At least 10 characters, with an uppercase letter, a lowercase letter and a digit."
              >
                <Input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" />
              </Field>
              <Alert variant="info">
                <p>Changing your password signs you out everywhere, including this device.</p>
              </Alert>
              <Button type="submit" loading={changePassword.isPending}>Change password</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === 'privacy' && (
        policy.isLoading ? <LoadingState /> : policy.data && (
          <div className="space-y-6">
            {policy.data.placeholder && (
              <Alert variant="warning" title="Placeholder policy">
                <p>
                  This privacy notice is a template supplied with the platform. An institution deploying
                  CareerPilot AI must review it with its own data-protection officer before going live.
                </p>
              </Alert>
            )}

            <Card>
              <CardHeader><CardTitle>What we collect and why</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{policy.data.summary}</p>
                {policy.data.dataCollected.map((group) => (
                  <div key={group.category} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{group.category}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{group.items.join(' · ')}</p>
                    <p className="mt-1 text-xs italic text-muted-foreground">Purpose: {group.purpose}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />Assessment monitoring</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{policy.data.monitoring.notice}</p>
                <div>
                  <p className="text-sm font-medium">Never collected or inferred</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {policy.data.monitoring.neverCollected.map((item) => (
                      <Badge key={item} variant="muted">{item}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>AI processing</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{policy.data.aiProcessing.notice}</p>
                <p className="mt-2 text-sm">
                  Current provider: <Badge variant="secondary">{policy.data.aiProcessing.provider}</Badge>
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Data retention</CardTitle></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {Object.entries(policy.data.retention).map(([key, days]) => (
                  <div key={key} className="rounded-md border border-border p-3 text-sm">
                    <p className="font-medium">{key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</p>
                    <p className="text-muted-foreground">{days} days</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Your data</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    apiDownload('/privacy/export', 'careerpilot-my-data.json').catch((e) =>
                      toast.error('Export failed', e?.message),
                    )
                  }
                >
                  <Download className="size-4" />
                  Export everything held about me
                </Button>
                <Button variant="destructive" onClick={() => setShowDelete(true)}>
                  <Trash2 className="size-4" />
                  Request account deletion
                </Button>
              </CardContent>
            </Card>
          </div>
        )
      )}

      <Modal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        title="Request account deletion"
        description="This locks your account immediately and cannot be undone by you."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteAccount.mutate()}
              loading={deleteAccount.isPending}
              disabled={confirmText !== 'DELETE'}
            >
              Request deletion
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert variant="danger" title="What happens next">
            <ul className="mt-1 list-inside list-disc space-y-1">
              <li>Your account is locked and you are signed out everywhere.</li>
              <li>Uploaded resume files are deleted immediately.</li>
              <li>
                Assessment and interview records are retained until the placement office completes the deletion,
                in line with institutional retention policy.
              </li>
            </ul>
          </Alert>

          <Field label="Type DELETE to confirm" htmlFor="confirm">
            <Input id="confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
