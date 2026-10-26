import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, Database, ShieldCheck, Users } from 'lucide-react';
import type { AdminDashboardDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState,
  PageHeader, Table, Td, Th,
} from '@/components/ui';
import { ScoreBarChart } from '@/components/charts';
import { apiGet } from '@/services/api';
import { formatRelative } from '@/utils/format';

export default function AdminDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => apiGet<AdminDashboardDto>('/admin/dashboard'),
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingState label="Loading system overview…" />;
  if (error || !data) return <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />;

  const healthTone = data.health.status === 'OK' ? 'success' : data.health.status === 'DEGRADED' ? 'warning' : 'danger';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Dashboard"
        description="System health, usage and anything awaiting a human decision."
        actions={<Badge variant={healthTone}>System {data.health.status}</Badge>}
      />

      {data.alumni.pending > 0 && (
        <Alert variant="warning" title={`${data.alumni.pending} alumni awaiting verification`}>
          <div className="flex flex-wrap items-center gap-3">
            <p>Unverified alumni cannot mentor students or appear in search until you review them.</p>
            <Button size="sm" asChild><Link to="/admin/alumni">Review now</Link></Button>
          </div>
        </Alert>
      )}

      {(data.flagged.highRiskAttempts > 0 || data.flagged.unreviewedEvents > 0) && (
        <Alert variant="warning" title="Integrity signals awaiting review">
          <p>
            {data.flagged.highRiskAttempts} high-risk attempt(s) and {data.flagged.unreviewedEvents} unreviewed
            monitoring event(s). No result has been invalidated automatically — a person must decide.
          </p>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-muted">Total users</p>
              <p className="stat-value">{data.users.total}</p>
              <p className="mt-1 text-xs text-muted-foreground">{data.users.activeLast7Days} active this week</p>
            </div>
            <Users className="size-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-muted">Verified alumni</p>
              <p className="stat-value text-success">{data.alumni.verified}</p>
              <p className="mt-1 text-xs text-muted-foreground">{data.alumni.pending} pending</p>
            </div>
            <ShieldCheck className="size-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-muted">AI calls (24h)</p>
              <p className="stat-value">{data.ai.last24h}</p>
              <p className="mt-1 text-xs text-muted-foreground">{data.ai.failureRate}% failure rate</p>
            </div>
            <Bot className="size-5 text-muted-foreground" />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="label-muted">Knowledge base</p>
              <p className="stat-value">{data.catalog.ragDocuments}</p>
              <p className="mt-1 text-xs text-muted-foreground">indexed documents</p>
            </div>
            <Database className="size-5 text-muted-foreground" />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="size-4" />System health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.health.checks.map((check) => (
              <div key={check.name} className="flex items-center justify-between rounded-md border border-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{check.name}</p>
                  {check.detail && <p className="truncate text-xs text-muted-foreground">{check.detail}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {check.latencyMs !== undefined && (
                    <span className="text-xs tabular-nums text-muted-foreground">{Math.round(check.latencyMs)}ms</span>
                  )}
                  <Badge variant={check.status === 'OK' ? 'success' : check.status === 'DEGRADED' ? 'warning' : 'danger'}>
                    {check.status}
                  </Badge>
                </div>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">
              Uptime {Math.round(data.health.uptimeSeconds / 60)} minutes · v{data.health.version} ·{' '}
              {data.health.environment}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Users by role</CardTitle></CardHeader>
          <CardContent>
            <ScoreBarChart
              layout="vertical"
              height={220}
              data={Object.entries(data.users.byRole).map(([role, count]) => ({
                label: role.replace(/_/g, ' '),
                value: count,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Content catalogue</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {Object.entries(data.catalog).map(([key, value]) => (
              <div key={key} className="rounded-md border border-border p-3">
                <p className="label-muted">{key.replace(/([A-Z])/g, ' $1')}</p>
                <p className="stat-value">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>AI usage by agent</CardTitle></CardHeader>
          <CardContent>
            {data.ai.byAgent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No AI calls recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {data.ai.byAgent.slice(0, 8).map((agent) => (
                  <div key={agent.agent} className="flex items-center justify-between rounded-md border border-border p-2.5 text-sm">
                    <span className="truncate font-medium">{agent.agent.replace(/_/g, ' ')}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {agent.count} calls · {Math.round(agent.avgLatencyMs)}ms avg
                      {agent.failures > 0 && <span className="text-destructive"> · {agent.failures} failed</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Provider: {data.ai.provider}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent audit activity</CardTitle>
            <Button variant="ghost" size="sm" asChild><Link to="/admin/audit">View full log</Link></Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr><Th>Action</Th><Th>Actor</Th><Th>Resource</Th><Th>Status</Th><Th>When</Th></tr>
            </thead>
            <tbody>
              {data.recentAudit.slice(0, 12).map((entry) => (
                <tr key={entry.id}>
                  <Td className="font-mono text-xs">{entry.action}</Td>
                  <Td className="text-muted-foreground">{entry.actorEmail ?? '—'}</Td>
                  <Td className="text-muted-foreground">{entry.resource}</Td>
                  <Td>
                    <Badge variant={entry.status === 'SUCCESS' ? 'success' : 'danger'}>{entry.status}</Badge>
                  </Td>
                  <Td className="text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
