import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Database, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Field, Input,
  LoadingState, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Th,
} from '@/components/ui';
import { MultiLineChart, ScoreBarChart } from '@/components/charts';
import { apiDelete, apiGet, apiPost, apiPut } from '@/services/api';
import { useToast } from '@/components/domain/Toast';
import { formatDate } from '@/utils/format';

interface RagDocumentRow {
  _id: string;
  title: string;
  category: string;
  chunkCount: number;
  sourceUrls?: string[];
  indexedAt?: string | null;
}

const CATEGORIES = [
  'COMPANY_PROFILE', 'JOB_DESCRIPTION', 'ROLE_REQUIREMENTS', 'INTERVIEW_PREP',
  'CODING_PATTERN', 'HR_PREP', 'GD_TOPIC', 'CAREER_RESOURCE',
];

export default function AdminAiPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = React.useState('usage');
  const [editing, setEditing] = React.useState<Record<string, any> | null>(null);
  const [ragQuestion, setRagQuestion] = React.useState('');
  const [ragAnswer, setRagAnswer] = React.useState<Record<string, any> | null>(null);

  const usage = useQuery({
    queryKey: ['admin', 'ai', 'usage'],
    queryFn: () => apiGet<{ usage: Array<Record<string, any>>; agents: Record<string, any> | null; health: Record<string, any> }>('/admin/ai/usage'),
    enabled: tab === 'usage',
  });

  const rag = useQuery({
    queryKey: ['admin', 'rag'],
    queryFn: () => apiGet<{ documents: RagDocumentRow[]; vectorStore: Record<string, any> | null }>('/admin/rag'),
    enabled: tab === 'knowledge',
  });

  const config = useQuery({
    queryKey: ['admin', 'config'],
    queryFn: () => apiGet<Array<Record<string, any>>>('/admin/config'),
    enabled: tab === 'config',
  });

  const metrics = useQuery({
    queryKey: ['readiness', 'model-metrics'],
    queryFn: () => apiGet<Record<string, any>>('/readiness/model-metrics'),
    enabled: tab === 'model',
  });

  const reindex = useMutation({
    mutationFn: () => apiPost<{ indexed: number; failed: number }>('/admin/rag/reindex'),
    onSuccess: (data) => {
      toast.success('Knowledge base re-indexed', `${data.indexed} document(s) indexed, ${data.failed} failed.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'rag'] });
    },
    onError: (error) => toast.error('Re-index failed', error instanceof Error ? error.message : undefined),
  });

  const saveDocument = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing?._id ? apiPut(`/admin/rag/${editing._id}`, payload) : apiPost('/admin/rag', payload),
    onSuccess: () => {
      toast.success('Document saved and indexed');
      queryClient.invalidateQueries({ queryKey: ['admin', 'rag'] });
      setEditing(null);
    },
    onError: (error) => toast.error('Could not save', error instanceof Error ? error.message : undefined),
  });

  const deleteDocument = useMutation({
    mutationFn: (id: string) => apiDelete(`/admin/rag/${id}`),
    onSuccess: () => {
      toast.success('Document deleted');
      queryClient.invalidateQueries({ queryKey: ['admin', 'rag'] });
    },
  });

  const queryRag = useMutation({
    mutationFn: () => apiPost<Record<string, any>>('/admin/rag/query', { question: ragQuestion }),
    onSuccess: setRagAnswer,
    onError: (error) => toast.error('Query failed', error instanceof Error ? error.message : undefined),
  });

  const saveConfig = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => apiPut(`/admin/config/${key}`, { value }),
    onSuccess: () => {
      toast.success('Configuration updated');
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: (error) => toast.error('Could not update', error instanceof Error ? error.message : undefined),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI &amp; Knowledge Base"
        description="Agent usage, the RAG knowledge base, the readiness model, and the APIE scoring configuration."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'usage', label: 'Usage & agents' },
          { value: 'knowledge', label: 'Knowledge base' },
          { value: 'model', label: 'ML model' },
          { value: 'config', label: 'Configuration' },
        ]}
      />

      {tab === 'usage' && (
        usage.isLoading ? <LoadingState /> : (
          <div className="space-y-6">
            <Alert variant={usage.data?.health.ok ? 'success' : 'warning'} title="AI service status">
              <p>
                {usage.data?.health.ok
                  ? `Reachable in ${Math.round(usage.data.health.latencyMs)}ms.`
                  : `Unreachable: ${usage.data?.health.detail}. AI features are unavailable; the rest of the platform works normally.`}
              </p>
            </Alert>

            <Card>
              <CardHeader><CardTitle>AI calls over time</CardTitle></CardHeader>
              <CardContent>
                <MultiLineChart
                  data={usage.data?.usage ?? []}
                  xKey="date"
                  series={[
                    { key: 'total', name: 'Total calls' },
                    { key: 'failures', name: 'Failures' },
                  ]}
                />
              </CardContent>
            </Card>

            {usage.data?.agents && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bot className="size-4" />
                    Registered agents ({(usage.data.agents.agents as unknown[])?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(usage.data.agents.agents as Array<{ name: string; responsibility: string }>)?.map((agent) => (
                    <div key={agent.name} className="rounded-md border border-border p-3">
                      <p className="text-sm font-medium">{agent.name.replace(/_/g, ' ')}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{agent.responsibility}</p>
                    </div>
                  ))}

                  <div className="pt-2">
                    <p className="text-sm font-medium">Orchestrated workflows</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(usage.data.agents.workflows as Array<{ name: string }>)?.map((workflow) => (
                        <Badge key={workflow.name} variant="secondary">{workflow.name.replace(/_/g, ' ')}</Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )
      )}

      {tab === 'knowledge' && (
        rag.isLoading ? <LoadingState /> : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setEditing({})}>Add a document</Button>
              <Button variant="outline" onClick={() => reindex.mutate()} loading={reindex.isPending}>
                <RefreshCw className="size-4" />
                Re-index everything
              </Button>
              {rag.data?.vectorStore && (
                <span className="text-sm text-muted-foreground">
                  {String(rag.data.vectorStore.chunks)} chunks · {String(rag.data.vectorStore.provider)} store ·{' '}
                  {String(rag.data.vectorStore.embeddingProvider)} embeddings
                </span>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Search className="size-4" />Test a query</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={ragQuestion}
                    onChange={(e) => setRagQuestion(e.target.value)}
                    placeholder="What rounds does the hiring process include?"
                    className="min-w-[16rem] flex-1"
                    aria-label="Knowledge base question"
                  />
                  <Button onClick={() => queryRag.mutate()} loading={queryRag.isPending} disabled={ragQuestion.length < 5}>
                    Ask
                  </Button>
                </div>

                {ragAnswer && (
                  <div className="space-y-2 rounded-lg border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={ragAnswer.grounded ? 'success' : 'warning'}>
                        {ragAnswer.grounded ? 'Grounded in sources' : 'No verified sources'}
                      </Badge>
                      {ragAnswer.insufficientContext && <Badge variant="warning">Insufficient context</Badge>}
                    </div>
                    <p className="text-sm">{ragAnswer.answer}</p>
                    {(ragAnswer.sources as Array<Record<string, any>>)?.length > 0 && (
                      <div>
                        <p className="text-xs font-medium">Sources</p>
                        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                          {(ragAnswer.sources as Array<Record<string, any>>).map((source, index) => (
                            <li key={index}>
                              · {source.title} (chunk {source.chunkIndex}, score {source.score})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {!rag.data?.documents.length ? (
              <EmptyState icon={Database} title="No knowledge-base documents" message="Add documents so company-specific answers can be grounded in verified sources." />
            ) : (
              <Table>
                <thead>
                  <tr><Th>Title</Th><Th>Category</Th><Th>Chunks</Th><Th>Sourced</Th><Th>Indexed</Th><Th></Th></tr>
                </thead>
                <tbody>
                  {rag.data.documents.map((document) => (
                    <tr key={document._id}>
                      <Td className="font-medium">{document.title}</Td>
                      <Td><Badge variant="secondary">{String(document.category).replace(/_/g, ' ')}</Badge></Td>
                      <Td className="tabular-nums">{document.chunkCount}</Td>
                      <Td>
                        {/* Unsourced documents must not be cited as fact (§10) */}
                        <Badge variant={document.sourceUrls?.length ? 'success' : 'warning'}>
                          {document.sourceUrls?.length ? 'Sourced' : 'Unverified'}
                        </Badge>
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        {document.indexedAt ? formatDate(document.indexedAt) : 'Not indexed'}
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const full = await apiGet<Record<string, any>>(`/admin/rag/${document._id}`);
                              setEditing(full);
                            }}
                          >
                            Edit
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteDocument.mutate(document._id)} aria-label="Delete">
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        )
      )}

      {tab === 'model' && (
        metrics.isLoading ? <LoadingState /> : (
          <div className="space-y-6">
            {!metrics.data?.trained ? (
              <Alert variant="warning" title="No model trained">
                <p>{String(metrics.data?.message ?? 'Train the readiness model to enable ML predictions.')}</p>
                <p className="mt-2 font-mono text-xs">python -m app.ml.train</p>
              </Alert>
            ) : (
              <>
                <Alert variant={metrics.data.datasetProvenance === 'SYNTHETIC' ? 'warning' : 'info'} title={String(metrics.data.evaluationLabel)}>
                  <p>{String(metrics.data.disclaimer)}</p>
                </Alert>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ['Accuracy', metrics.data.accuracy],
                    ['Precision (macro)', metrics.data.precisionMacro],
                    ['Recall (macro)', metrics.data.recallMacro],
                    ['F1 (macro)', metrics.data.f1Macro],
                  ] as const).map(([label, value]) => (
                    <Card key={label} className="p-5">
                      <p className="label-muted">{label}</p>
                      <p className="stat-value">{(Number(value) * 100).toFixed(1)}%</p>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader><CardTitle>Feature importance</CardTitle></CardHeader>
                  <CardContent>
                    <ScoreBarChart
                      layout="vertical"
                      height={420}
                      data={(metrics.data.featureImportance as Array<{ feature: string; importance: number }>).map((f) => ({
                        label: f.feature,
                        value: f.importance * 100,
                      }))}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Confusion matrix</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <thead>
                        <tr>
                          <Th>Actual \ Predicted</Th>
                          {(metrics.data.labels as string[]).map((label) => <Th key={label}>{label.replace(/_/g, ' ')}</Th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {(metrics.data.confusionMatrix as number[][]).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            <Td className="font-medium">{(metrics.data.labels as string[])[rowIndex].replace(/_/g, ' ')}</Td>
                            {row.map((value, columnIndex) => (
                              <Td key={columnIndex} className={rowIndex === columnIndex ? 'font-semibold text-success' : 'text-muted-foreground'}>
                                {value}
                              </Td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle>Per-class performance</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <thead>
                        <tr><Th>Class</Th><Th>Precision</Th><Th>Recall</Th><Th>F1</Th><Th>Support</Th></tr>
                      </thead>
                      <tbody>
                        {(metrics.data.perClass as Array<Record<string, number | string>>).map((row) => (
                          <tr key={String(row.label)}>
                            <Td className="font-medium">{String(row.label).replace(/_/g, ' ')}</Td>
                            <Td className="tabular-nums">{(Number(row.precision) * 100).toFixed(1)}%</Td>
                            <Td className="tabular-nums">{(Number(row.recall) * 100).toFixed(1)}%</Td>
                            <Td className="tabular-nums">{(Number(row.f1) * 100).toFixed(1)}%</Td>
                            <Td className="tabular-nums">{String(row.support)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )
      )}

      {tab === 'config' && (
        config.isLoading ? <LoadingState /> : (
          <div className="space-y-4">
            <Alert variant="warning" title="These values change how every student is scored">
              <p>
                APIE weights must sum to 1.0 — the API rejects anything else. Changes take effect on the next
                readiness computation and are written to the audit log.
              </p>
            </Alert>

            {config.data?.map((entry) => (
              <ConfigCard key={entry.key} entry={entry} onSave={(value) => saveConfig.mutate({ key: entry.key, value })} pending={saveConfig.isPending} />
            ))}
          </div>
        )
      )}

      {editing && (
        <DocumentModal
          document={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => saveDocument.mutate(payload)}
          pending={saveDocument.isPending}
        />
      )}
    </div>
  );
}

function ConfigCard({
  entry,
  onSave,
  pending,
}: {
  entry: Record<string, any>;
  onSave: (value: unknown) => void;
  pending: boolean;
}) {
  const [text, setText] = React.useState(() => JSON.stringify(entry.value, null, 2));
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">{entry.key}</CardTitle>
          <Badge variant="secondary">{entry.category}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{entry.description}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null); }}
          className="min-h-[140px] font-mono text-xs"
          aria-label={`Value for ${entry.key}`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          size="sm"
          loading={pending}
          onClick={() => {
            try {
              onSave(JSON.parse(text));
            } catch {
              setError('That is not valid JSON.');
            }
          }}
        >
          <Save className="size-4" />
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function DocumentModal({
  document,
  onClose,
  onSave,
  pending,
}: {
  document: Record<string, any>;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  pending: boolean;
}) {
  // `document` arrives as a loose record, so each field is coerced explicitly
  // rather than inheriting `any` and losing checking inside the form.
  const [title, setTitle] = React.useState<string>(String(document.title ?? ''));
  const [category, setCategory] = React.useState<string>(String(document.category ?? 'CAREER_RESOURCE'));
  const [content, setContent] = React.useState<string>(String(document.content ?? ''));
  const [sources, setSources] = React.useState<string>(((document.sourceUrls ?? []) as string[]).join('\n'));

  return (
    <Modal
      open
      onClose={onClose}
      title={document._id ? 'Edit knowledge-base document' : 'Add a knowledge-base document'}
      description="Documents are chunked, embedded and indexed immediately after saving."
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() =>
              onSave({
                title,
                category,
                content,
                sourceUrls: sources.split('\n').map((s) => s.trim()).filter(Boolean),
              })
            }
            loading={pending}
            disabled={title.length < 3 || content.length < 50}
          >
            Save &amp; index
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="title" required>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Category" htmlFor="category" required>
          <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>

        <Field
          label="Source URLs"
          htmlFor="sources"
          hint="One per line. A document with no source is treated as unverified and is not cited as fact."
        >
          <Textarea id="sources" value={sources} onChange={(e) => setSources(e.target.value)} className="font-mono text-xs" />
        </Field>

        <Field label="Content" htmlFor="content" required hint="At least 50 characters.">
          <Textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[240px]" />
        </Field>
      </div>
    </Modal>
  );
}
