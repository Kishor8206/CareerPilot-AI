import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { AccountStatus, UserRole } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, EmptyState, Input, LoadingState, PageHeader, Select,
  Table, Td, Th,
} from '@/components/ui';
import { apiGetPaginated, apiPatch } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { useAuthStore } from '@/store/auth.store';
import { formatDate, formatRelative } from '@/utils/format';

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user: currentUser } = useAuthStore();

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [role, setRole] = React.useState('');
  const [status, setStatus] = React.useState('');

  const users = useQuery({
    queryKey: ['admin', 'users', page, search, role, status],
    queryFn: () =>
      apiGetPaginated<Record<string, any>>('/admin/users', {
        page, limit: 25,
        search: search || undefined,
        role: role || undefined,
        status: status || undefined,
      }),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, newRole }: { id: string; newRole: string }) => apiPatch(`/admin/users/${id}/role`, { role: newRole }),
    onSuccess: () => {
      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error('Could not change the role', error instanceof Error ? error.message : undefined),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: string }) => apiPatch(`/admin/users/${id}/status`, { status: newStatus }),
    onSuccess: () => {
      toast.success('Status updated', 'Suspending an account signs it out immediately.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error('Could not change the status', error instanceof Error ? error.message : undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Manage roles and account status. Every change is written to the audit log." />

      <Alert variant="info">
        <p>
          Suspending an account revokes its sessions immediately rather than waiting for the token to expire.
          The last active administrator cannot be demoted or suspended.
        </p>
      </Alert>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search users"
            />
          </div>
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="w-48" aria-label="Filter by role">
            <option value="">All roles</option>
            {Object.values(UserRole).map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48" aria-label="Filter by status">
            <option value="">All statuses</option>
            {Object.values(AccountStatus).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </CardContent>
      </Card>

      {users.isLoading ? (
        <LoadingState />
      ) : !users.data?.items.length ? (
        <EmptyState icon={Users} title="No users found" />
      ) : (
        <>
          <Table>
            <thead>
              <tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Verified</Th><Th>Last login</Th><Th>Joined</Th></tr>
            </thead>
            <tbody>
              {users.data.items.map((entry) => {
                const isSelf = entry._id === currentUser?.id;
                return (
                  <tr key={entry._id}>
                    <Td>
                      <p className="font-medium">
                        {entry.fullName}
                        {isSelf && <Badge variant="info" className="ml-2">You</Badge>}
                        {entry.isDemoAccount && <Badge variant="muted" className="ml-2">Demo</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{entry.email}</p>
                    </Td>
                    <Td>
                      <Select
                        value={entry.role}
                        onChange={(e) => changeRole.mutate({ id: entry._id, newRole: e.target.value })}
                        className="w-44"
                        disabled={isSelf}
                        aria-label={`Role for ${entry.fullName}`}
                      >
                        {Object.values(UserRole).map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </Select>
                    </Td>
                    <Td>
                      <Select
                        value={entry.status}
                        onChange={(e) => changeStatus.mutate({ id: entry._id, newStatus: e.target.value })}
                        className="w-44"
                        disabled={isSelf}
                        aria-label={`Status for ${entry.fullName}`}
                      >
                        {Object.values(AccountStatus).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </Select>
                    </Td>
                    <Td>
                      <Badge variant={entry.emailVerified ? 'success' : 'muted'}>
                        {entry.emailVerified ? 'Yes' : 'No'}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-muted-foreground">{formatRelative(entry.lastLoginAt)}</Td>
                    <Td className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {users.data.items.length} of {users.data.meta.total} users
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= users.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
