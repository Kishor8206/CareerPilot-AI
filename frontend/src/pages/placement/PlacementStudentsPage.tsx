import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search, Users } from 'lucide-react';
import type { StudentSummaryRow } from '@careerpilot/shared';
import {
  Badge, Button, Card, CardContent, EmptyState, ErrorState, Input, LoadingState, PageHeader,
  Select, Table, Td, Th,
} from '@/components/ui';
import { apiDownload, apiGet, apiGetPaginated } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { BAND_LABEL, formatRelative, scoreTone } from '@/utils/format';
import { cn } from '@/utils/cn';

export default function PlacementStudentsPage() {
  const toast = useToast();
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [band, setBand] = React.useState('');
  const [sort, setSort] = React.useState('prs');

  const filters = useQuery({
    queryKey: ['analytics', 'filters'],
    queryFn: () => apiGet<{ departments: string[]; batches: string[]; bands: string[] }>('/analytics/filters'),
  });

  const students = useQuery({
    queryKey: ['placement', 'students', page, search, department, band, sort],
    queryFn: () =>
      apiGetPaginated<StudentSummaryRow>('/students', {
        page,
        limit: 25,
        search: search || undefined,
        department: department || undefined,
        band: band || undefined,
        sort,
        order: sort === 'name' ? 'asc' : 'desc',
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Every student's readiness at a glance. Records you open are recorded in the audit log."
      />

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[16rem] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name or roll number…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              aria-label="Search students"
            />
          </div>

          <Select value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} className="w-52" aria-label="Department">
            <option value="">All departments</option>
            {filters.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>

          <Select value={band} onChange={(e) => { setBand(e.target.value); setPage(1); }} className="w-52" aria-label="Readiness band">
            <option value="">All readiness bands</option>
            {filters.data?.bands.map((b) => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
          </Select>

          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44" aria-label="Sort by">
            <option value="prs">Sort by readiness</option>
            <option value="name">Sort by name</option>
            <option value="cgpa">Sort by CGPA</option>
            <option value="recent">Sort by recent activity</option>
          </Select>
        </CardContent>
      </Card>

      {students.isLoading ? (
        <LoadingState />
      ) : students.error ? (
        <ErrorState message={(students.error as Error).message} onRetry={() => students.refetch()} />
      ) : !students.data?.items.length ? (
        <EmptyState icon={Users} title="No students found" message="Try clearing the filters." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Department</Th>
                <Th>CGPA</Th>
                <Th>Readiness</Th>
                <Th>Band</Th>
                <Th>ATS</Th>
                <Th>Coding</Th>
                <Th>Gaps</Th>
                <Th>Last active</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {students.data.items.map((student) => {
                const tone = scoreTone(student.prs);
                return (
                  <tr key={student.studentId} className="hover:bg-accent/50">
                    <Td>
                      <p className="font-medium">{student.fullName}</p>
                      <p className="text-xs text-muted-foreground">{student.rollNumber ?? '—'}</p>
                    </Td>
                    <Td className="text-muted-foreground">{student.department ?? '—'}</Td>
                    <Td className="tabular-nums">{student.cgpa ?? '—'}</Td>
                    <Td>
                      <span className={cn(
                        'font-semibold tabular-nums',
                        tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
                      )}>
                        {student.prs !== null ? Math.round(student.prs) : '—'}
                      </span>
                    </Td>
                    <Td>
                      {student.band ? (
                        <Badge variant={student.band === 'AT_RISK' ? 'danger' : student.band === 'NEEDS_IMPROVEMENT' ? 'warning' : 'success'}>
                          {BAND_LABEL[student.band]}
                        </Badge>
                      ) : (
                        <Badge variant="muted">Not assessed</Badge>
                      )}
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{student.atsScore !== null ? Math.round(student.atsScore) : '—'}</Td>
                    <Td className="tabular-nums text-muted-foreground">{student.codingScore !== null ? Math.round(student.codingScore) : '—'}</Td>
                    <Td className="tabular-nums">{student.skillGapCount}</Td>
                    <Td className="text-xs text-muted-foreground">{formatRelative(student.lastActivityAt)}</Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          apiDownload(
                            `/reports/student/${student.studentId}/performance`,
                            `${student.fullName}-performance.pdf`,
                          ).catch((e) => toast.error('Download failed', e?.message))
                        }
                      >
                        <Download className="size-3.5" />
                        Report
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {students.data.items.length} of {students.data.meta.total} students
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= students.data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
