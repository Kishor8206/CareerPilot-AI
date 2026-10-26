import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, FileText } from 'lucide-react';
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, LoadingState, PageHeader, Select,
} from '@/components/ui';
import { apiDownload, apiGet } from '@/services/api';
import { useToast } from '@/components/domain/Toast';

export default function PlacementReportsPage() {
  const toast = useToast();
  const [department, setDepartment] = React.useState('');
  const [batch, setBatch] = React.useState('');
  const [provenance, setProvenance] = React.useState('');
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const filters = useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: () => apiGet<{ departments: string[]; batches: string[] }>('/analytics/filters'),
  });

  async function download(type: string, filename: string) {
    setDownloading(type);
    try {
      await apiDownload(`/reports/institution/${type}`, filename, {
        department: department || undefined,
        batch: batch || undefined,
      });
      toast.success('Report downloaded');
    } catch (error) {
      toast.error('Download failed', error instanceof Error ? error.message : undefined);
    } finally {
      setDownloading(null);
    }
  }

  async function exportResearch(format: 'json' | 'csv') {
    setDownloading(`research-${format}`);
    try {
      await apiDownload('/analytics/research-export', `careerpilot-research.${format}`, {
        format,
        department: department || undefined,
        batch: batch || undefined,
        provenance: provenance || undefined,
      });
      toast.success('Dataset exported');
    } catch (error) {
      toast.error('Export failed', error instanceof Error ? error.message : undefined);
    } finally {
      setDownloading(null);
    }
  }

  if (filters.isLoading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader title="Reports &amp; Data Export" description="Institutional PDF reports and the pseudonymised research dataset." />

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="w-56" aria-label="Department">
            <option value="">All departments</option>
            {filters.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-48" aria-label="Batch">
            <option value="">All batches</option>
            {filters.data?.batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { type: 'INSTITUTION', label: 'Institution Placement Report', file: 'institution-report.pdf' },
          { type: 'DEPARTMENT', label: 'Department Report', file: 'department-report.pdf' },
          { type: 'SKILL_GAP', label: 'Skill Gap Report', file: 'skill-gap-report.pdf' },
        ].map((report) => (
          <Card key={report.type}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                {report.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => download(report.type, report.file)}
                loading={downloading === report.type}
              >
                <Download className="size-4" />
                Download PDF
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" />
            Research dataset export
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info" title="How this export protects students">
            <ul className="mt-1 list-inside list-disc space-y-1">
              <li>Each record carries a one-way hashed <code className="font-mono">anonymousId</code>, never a name, roll number or email.</li>
              <li>
                Every row is tagged with its provenance — <strong>DEMO</strong>, <strong>SYNTHETIC</strong> or{' '}
                <strong>REAL</strong> — so the three can never be silently mixed in analysis.
              </li>
              <li>Every export is written to the audit log.</li>
            </ul>
          </Alert>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label htmlFor="provenance" className="text-sm font-medium">Data provenance</label>
              <Select id="provenance" value={provenance} onChange={(e) => setProvenance(e.target.value)} className="w-52">
                <option value="">All provenance</option>
                <option value="REAL">Real evaluation data only</option>
                <option value="DEMO">Demo data only</option>
                <option value="SYNTHETIC">Synthetic data only</option>
              </Select>
            </div>

            <Button variant="outline" onClick={() => exportResearch('csv')} loading={downloading === 'research-csv'}>
              <Download className="size-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => exportResearch('json')} loading={downloading === 'research-json'}>
              <Download className="size-4" />
              Export JSON
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            The dataset includes component scores, activity counts, skill-gap counts, alumni feedback scores and
            the first-to-latest readiness improvement per student — the measures needed for research analysis.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
