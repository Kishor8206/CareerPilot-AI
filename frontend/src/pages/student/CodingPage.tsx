import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleDot, Code2, X } from 'lucide-react';
import { Difficulty, DSA_TAGS } from '@careerpilot/shared';
import type { CodeSandboxStatusDto, CodingProblemSummaryDto } from '@careerpilot/shared';
import {
  Alert, Button, Card, CardContent, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select,
  Table, Td, Th,
} from '@/components/ui';
import { DifficultyBadge, DsaProgressCard } from '@/components/domain/DsaProgress';
import { apiGet, apiGetPaginated } from '@/services/api';
import { cn } from '@/utils/cn';

type StatusFilter = '' | CodingProblemSummaryDto['status'];

const STATUS_LABEL: Record<CodingProblemSummaryDto['status'], string> = {
  SOLVED: 'Solved',
  ATTEMPTED: 'Attempted',
  TODO: 'Not started',
};

function StatusIcon({ status }: { status: CodingProblemSummaryDto['status'] }) {
  if (status === 'SOLVED') return <CheckCircle2 className="size-4 text-success" aria-label="Solved" />;
  if (status === 'ATTEMPTED') return <CircleDot className="size-4 text-warning" aria-label="Attempted" />;
  return <Circle className="size-4 text-muted-foreground/50" aria-label="Not started" />;
}

export default function CodingPage() {
  const [difficulty, setDifficulty] = React.useState('');
  const [status, setStatus] = React.useState<StatusFilter>('');
  const [search, setSearch] = React.useState('');
  const [tags, setTags] = React.useState<string[]>([]);

  // Wait for a pause in typing before querying, so each keystroke is not a request.
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const problems = useQuery({
    queryKey: ['coding', 'problems', difficulty, debouncedSearch, tags],
    queryFn: () =>
      apiGetPaginated<CodingProblemSummaryDto>('/coding/problems', {
        limit: 100,
        difficulty: difficulty || undefined,
        search: debouncedSearch || undefined,
        tags: tags.length ? tags.join(',') : undefined,
      }),
    placeholderData: (previous) => previous,
  });

  const sandbox = useQuery({
    queryKey: ['coding', 'sandbox'],
    queryFn: () => apiGet<CodeSandboxStatusDto>('/coding/sandbox'),
    staleTime: 30_000,
  });

  const toggleTag = (tag: string) =>
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));

  const hasFilters = Boolean(difficulty || status || search || tags.length);
  const clearFilters = () => {
    setDifficulty('');
    setStatus('');
    setSearch('');
    setTags([]);
  };

  const rows = (problems.data?.items ?? []).filter((problem) => !status || problem.status === status);

  return (
    <div className="space-y-6">
      <PageHeader
        title="DSA Practice"
        description="Solve data-structure and algorithm problems in Python, C++, Java or JavaScript. Your code runs in an isolated sandbox and is judged against public and hidden test cases."
      />

      {sandbox.data && !sandbox.data.available && (
        <Alert variant="warning" title="Code execution is currently unavailable">
          <p>
            {sandbox.data.reason} You can still read problems and write code, but Run and Submit will not execute it
            until the sandbox is available.
          </p>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  placeholder="Search problems…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full sm:max-w-xs"
                  aria-label="Search problems"
                />
                <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-40" aria-label="Filter by difficulty">
                  <option value="">All difficulties</option>
                  <option value={Difficulty.EASY}>Easy</option>
                  <option value={Difficulty.MEDIUM}>Medium</option>
                  <option value={Difficulty.HARD}>Hard</option>
                </Select>
                <Select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-40" aria-label="Filter by status">
                  <option value="">Any status</option>
                  <option value="SOLVED">Solved</option>
                  <option value="ATTEMPTED">Attempted</option>
                  <option value="TODO">Not started</option>
                </Select>
                {hasFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="size-4" />
                    Clear filters
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by topic">
                {DSA_TAGS.map((tag) => {
                  const active = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {problems.isLoading ? (
            <LoadingState />
          ) : problems.error ? (
            <ErrorState message={(problems.error as Error).message} onRetry={() => problems.refetch()} />
          ) : !rows.length ? (
            <EmptyState
              icon={Code2}
              title="No problems match"
              message={hasFilters ? 'No problem matches these filters. Try removing one.' : 'No problems are available yet. Ask an administrator to load the problem bank.'}
              action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th className="w-12">Status</Th>
                    <Th>Title</Th>
                    <Th>Difficulty</Th>
                    <Th>Topics</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((problem) => (
                    <tr key={problem.id} className="hover:bg-accent/50">
                      <Td title={STATUS_LABEL[problem.status]}>
                        <StatusIcon status={problem.status} />
                      </Td>
                      <Td>
                        <Link to={`/coding/${problem.id}`} className="font-medium text-primary hover:underline">
                          {problem.title}
                        </Link>
                      </Td>
                      <Td>
                        <DifficultyBadge difficulty={problem.difficulty} />
                      </Td>
                      <Td className="text-xs text-muted-foreground">{problem.tags.join(' · ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Showing {rows.length} of {problems.data?.meta?.total ?? rows.length} problems.
              </p>
            </>
          )}
        </div>

        <DsaProgressCard className="h-fit" />
      </div>
    </div>
  );
}
