import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import type { AlumniFeedbackDto } from '@careerpilot/shared';
import {
  Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, LoadingState, PageHeader, Progress,
} from '@/components/ui';
import { apiGet } from '@/services/api';
import { formatDate } from '@/utils/format';

export default function AlumniFeedbackPage() {
  const feedback = useQuery({
    queryKey: ['alumni', 'feedback'],
    queryFn: () => apiGet<Array<AlumniFeedbackDto & { studentId?: { department?: string; rollNumber?: string } }>>('/alumni/feedback'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback I Have Given"
        description="Each of these was applied to the student's placement readiness score."
      />

      {feedback.isLoading ? (
        <LoadingState />
      ) : !feedback.data?.length ? (
        <EmptyState icon={MessageSquare} title="No feedback given yet" message="After conducting a mock interview, your structured feedback appears here." />
      ) : (
        <div className="space-y-4">
          {feedback.data.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    {item.studentId?.department ?? 'Student'}
                    {item.studentId?.rollNumber ? ` · ${item.studentId.rollNumber}` : ''}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.recommendation === 'STRONG_HIRE' || item.recommendation === 'HIRE' ? 'success' : 'warning'}>
                      {item.recommendation.replace(/_/g, ' ')}
                    </Badge>
                    {item.appliedToApie && <Badge variant="info">Applied to readiness</Badge>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</p>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-semibold tabular-nums">{item.overallScore}</span>
                  <Progress value={item.overallScore} tone="success" className="flex-1" />
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  {([
                    ['Technical', item.technicalKnowledge],
                    ['Communication', item.communication],
                    ['Problem solving', item.problemSolving],
                    ['Confidence', item.confidence],
                    ['Role fit', item.roleSuitability],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border p-2 text-center">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="font-semibold tabular-nums">{value}/10</p>
                    </div>
                  ))}
                </div>

                {item.comments && <p className="rounded-md bg-muted/50 p-3 text-sm">{item.comments}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
