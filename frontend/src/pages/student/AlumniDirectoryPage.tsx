import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Building2, Search, Send, ShieldCheck, Star, Users } from 'lucide-react';
import type { AlumniProfileDto } from '@careerpilot/shared';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, Field,
  Input, LoadingState, Modal, PageHeader, Tabs, Textarea,
} from '@/components/ui';
import { apiGet, apiGetPaginated, apiPost } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { initials } from '@/utils/format';

interface MentorMatch {
  alumniId: string; fullName: string; company: string; designation: string;
  matchScore: number; reasons: string[]; coveredGaps: string[]; suggestedTopics: string[];
}

export default function AlumniDirectoryPage() {
  const toast = useToast();
  const [tab, setTab] = React.useState('recommended');
  const [search, setSearch] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [requestTarget, setRequestTarget] = React.useState<{ id: string; name: string } | null>(null);

  const recommended = useQuery({
    queryKey: ['alumni', 'recommended'],
    queryFn: () => apiGet<{ matches: MentorMatch[]; note: string }>('/alumni/recommended'),
    enabled: tab === 'recommended',
  });

  const directory = useQuery({
    queryKey: ['alumni', 'search', search, company],
    queryFn: () =>
      apiGetPaginated<AlumniProfileDto>('/alumni/search', {
        limit: 40,
        search: search || undefined,
        company: company || undefined,
      }),
    enabled: tab === 'directory',
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find a Mentor"
        description="Only alumni whose employment has been verified by an administrator appear here."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'recommended', label: 'Recommended for you' },
          { value: 'directory', label: 'Browse all' },
        ]}
      />

      {tab === 'recommended' && (
        recommended.isLoading ? (
          <LoadingState label="Matching you with mentors…" />
        ) : recommended.error ? (
          <ErrorState message={(recommended.error as Error).message} onRetry={() => recommended.refetch()} />
        ) : !recommended.data?.matches.length ? (
          <EmptyState icon={Users} title="No matches yet" message={recommended.data?.note} />
        ) : (
          <>
            <Alert variant="info"><p>{recommended.data.note}</p></Alert>
            <div className="grid gap-4 md:grid-cols-2">
              {recommended.data.matches.map((match) => (
                <Card key={match.alumniId}>
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {initials(match.fullName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="truncate">{match.fullName}</CardTitle>
                        <p className="truncate text-sm text-muted-foreground">
                          {match.designation} · {match.company}
                        </p>
                      </div>
                      <Badge variant="success">{Math.round(match.matchScore)}% match</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {match.reasons.map((reason, i) => <li key={i}>· {reason}</li>)}
                    </ul>

                    {match.suggestedTopics.length > 0 && (
                      <div>
                        <p className="text-xs font-medium">Suggested topics</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {match.suggestedTopics.map((topic) => (
                            <Badge key={topic} variant="secondary">{topic}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Button
                      className="w-full"
                      onClick={() => setRequestTarget({ id: match.alumniId, name: match.fullName })}
                    >
                      <Send className="size-4" />
                      Request a mock interview
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )
      )}

      {tab === 'directory' && (
        <>
          <Card>
            <CardContent className="flex flex-wrap gap-3 p-4">
              <div className="relative min-w-[16rem] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by expertise or domain…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search mentors"
                />
              </div>
              <Input
                className="max-w-xs"
                placeholder="Filter by company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                aria-label="Filter by company"
              />
            </CardContent>
          </Card>

          {directory.isLoading ? (
            <LoadingState />
          ) : !directory.data?.items.length ? (
            <EmptyState icon={Users} title="No verified mentors found" message="Try clearing the filters." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {directory.data.items.map((alumni) => (
                <Card key={alumni.id}>
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {initials(alumni.fullName)}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="truncate">{alumni.fullName}</CardTitle>
                        <p className="truncate text-sm text-muted-foreground">{alumni.designation}</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="secondary" className="gap-1">
                        <Building2 className="size-3" />
                        {alumni.company}
                      </Badge>
                      <Badge variant="success" className="gap-1">
                        <ShieldCheck className="size-3" />
                        Verified
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {alumni.experienceYears} years' experience · {alumni.domain}
                    </p>

                    {alumni.averageRating > 0 && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Star className="size-3 fill-warning text-warning" />
                        {alumni.averageRating}/5 across {alumni.sessionsConducted} session(s)
                      </p>
                    )}

                    {alumni.bio && <p className="line-clamp-3 text-sm text-muted-foreground">{alumni.bio}</p>}

                    {alumni.expertise.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {alumni.expertise.slice(0, 4).map((item) => (
                          <Badge key={item} variant="muted">{item}</Badge>
                        ))}
                      </div>
                    )}

                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={!alumni.acceptingMentees}
                      onClick={() => setRequestTarget({ id: alumni.id, name: alumni.fullName })}
                    >
                      {alumni.acceptingMentees ? 'Request mentorship' : 'Not accepting mentees'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {requestTarget && (
        <RequestModal target={requestTarget} onClose={() => setRequestTarget(null)} toast={toast} />
      )}
    </div>
  );
}

function RequestModal({
  target,
  onClose,
  toast,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [topic, setTopic] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [slots, setSlots] = React.useState<string[]>(['']);

  const submit = useMutation({
    mutationFn: () =>
      apiPost('/mentorship/request', {
        alumniId: target.id,
        topic,
        message,
        preferredSlots: slots.filter(Boolean).map((s) => new Date(s).toISOString()),
      }),
    onSuccess: () => {
      toast.success('Request sent', `${target.name} has been notified.`);
      onClose();
    },
    onError: (error) => toast.error('Could not send the request', error instanceof Error ? error.message : undefined),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Request a session with ${target.name}`}
      description="Be specific about what you want help with — mentors accept focused requests far more often."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={topic.length < 3 || message.length < 10}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Topic" htmlFor="topic" required>
          <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Mock technical interview for a backend role" />
        </Field>

        <Field label="Message" htmlFor="message" required hint="At least 10 characters.">
          <Textarea
            id="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Explain where you are, what you have already practised, and what you want from this session."
            className="min-h-[120px]"
          />
        </Field>

        <Field label="Preferred times" htmlFor="slot-0" hint="Optional. Offering slots makes acceptance faster.">
          <div className="space-y-2">
            {slots.map((slot, index) => (
              <Input
                key={index}
                id={`slot-${index}`}
                type="datetime-local"
                value={slot}
                onChange={(e) =>
                  setSlots((current) => current.map((s, i) => (i === index ? e.target.value : s)))
                }
              />
            ))}
            {slots.length < 3 && (
              <Button variant="outline" size="sm" onClick={() => setSlots((s) => [...s, ''])}>
                Add another time
              </Button>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
