import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState, PageHeader,
  Select,
} from '@/components/ui';
import { apiDownload, apiGet } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

interface ReportOption {
  type: string;
  label: string;
  needsRef?: boolean;
  refLabel?: string;
}

export default function ReportsPage() {
  const toast = useToast();
  const [refs, setRefs] = React.useState<Record<string, string>>({});
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const available = useQuery({
    queryKey: ['reports', 'available'],
    queryFn: () => apiGet<{ student: ReportOption[]; institutional: ReportOption[] }>('/reports'),
  });

  // Sessions are needed to fill the "which interview" selector.
  const interviews = useQuery({
    queryKey: ['interviews', 'sessions'],
    queryFn: () => apiGet<Array<Record<string, any>>>('/interviews/sessions'),
  });

  async function download(option: ReportOption) {
    const ref = refs[option.type];
    if (option.needsRef && !ref) {
      toast.error('Select a session', `Choose which ${option.refLabel?.toLowerCase() ?? 'session'} to report on.`);
      return;
    }

    setDownloading(option.type);
    try {
      await apiDownload(
        `/reports/${option.type}`,
        `${option.type.toLowerCase().replace(/_/g, '-')}.pdf`,
        ref ? { ref } : undefined,
      );
      toast.success('Report downloaded');
    } catch (error) {
      toast.error(
        'Download failed',
        error instanceof Error ? error.message : 'The report could not be generated.',
      );
    } finally {
      setDownloading(null);
    }
  }

  if (available.isLoading) return <LoadingState />;

  const completedInterviews = interviews.data?.filter((s) => s.status === 'COMPLETED') ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Download a PDF of any analysis. Every report carries the model disclaimer, so it stays honest out of context."
      />

      <Alert variant="info">
        <p>
          Reports are generated on demand from your current data. A report you downloaded earlier reflects the
          scores as they were at that moment.
        </p>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        {available.data?.student.map((option) => {
          const sessions =
            option.type === 'INTERVIEW' ? completedInterviews
                : [];

          const unavailable = option.needsRef && sessions.length === 0;

          return (
            <Card key={option.type}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  {option.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {option.needsRef && (
                  <Select
                    value={refs[option.type] ?? ''}
                    onChange={(e) => setRefs((current) => ({ ...current, [option.type]: e.target.value }))}
                    aria-label={option.refLabel}
                    disabled={unavailable}
                  >
                    <option value="">
                      {unavailable ? `No completed ${option.refLabel?.toLowerCase()} yet` : `Select a ${option.refLabel?.toLowerCase()}…`}
                    </option>
                    {sessions.map((session) => (
                      <option key={session._id ?? session.id} value={session._id ?? session.id}>
                        {option.type === 'INTERVIEW'
                          ? `${String(session.mode).replace(/_/g, ' ')} · ${new Date(session.completedAt ?? session.createdAt).toLocaleDateString()}`
                          : `${String(session.topic).slice(0, 50)} · ${new Date(session.completedAt).toLocaleDateString()}`}
                      </option>
                    ))}
                  </Select>
                )}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => download(option)}
                  loading={downloading === option.type}
                  disabled={unavailable}
                >
                  <Download className="size-4" />
                  Download PDF
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!available.data?.student.length && (
        <EmptyState icon={FileText} title="No reports available" />
      )}
    </div>
  );
}
