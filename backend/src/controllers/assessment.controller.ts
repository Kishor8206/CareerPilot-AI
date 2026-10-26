import type { Request, Response } from 'express';
import { AttemptStatus, MonitoringEventType, UserRole } from '@careerpilot/shared';
import { Assessment } from '../models/Assessment';
import { AssessmentAttempt } from '../models/AssessmentAttempt';
import * as assessmentService from '../services/assessment.service';
import { recomputeReadiness } from '../services/apie.service';
import { AuditAction, audit } from '../services/audit.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, created, ok, paginated } from '../utils/response';

export const listAssessments = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; type?: string; difficulty?: string; companyId?: string };

  const filter: Record<string, unknown> = { active: true };
  if (query.type) filter.type = query.type;
  if (query.difficulty) filter.difficulty = query.difficulty;
  if (query.companyId) filter.companyId = query.companyId;

  const [items, total] = await Promise.all([
    Assessment.find(filter)
      .populate<{ companyId: { name: string } }>('companyId', 'name')
      .sort({ type: 1, difficulty: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Assessment.countDocuments(filter),
  ]);

  // Annotate with the student's own attempt history so the list doubles as a
  // progress view rather than an undifferentiated catalogue.
  const attempts = await AssessmentAttempt.aggregate([
    { $match: { studentId: req.studentId, assessmentId: { $in: items.map((a) => a._id) } } },
    { $group: { _id: '$assessmentId', attempts: { $sum: 1 }, bestScore: { $max: '$percentage' } } },
  ]);
  const byAssessment = new Map(attempts.map((a) => [String(a._id), a]));

  paginated(
    res,
    items.map((a) => ({
      ...a,
      id: a._id.toString(),
      attemptsUsed: byAssessment.get(a._id.toString())?.attempts ?? 0,
      bestScore: byAssessment.get(a._id.toString())?.bestScore ?? null,
    })),
    buildPaginationMeta(query.page, query.limit, total),
  );
});

/**
 * Starts or resumes an attempt.
 *
 * The response carries the server's authoritative `expiresAt` and `serverTime`
 * so the client can compute remaining time without trusting its own clock (§13).
 */
export const startAttempt = asyncHandler(async (req: Request, res: Response) => {
  const { attempt, assessment, resumed } = await assessmentService.startAttempt(
    req.params.id,
    req.studentId!,
    req.auth!.userId,
    { webcamConsent: req.body?.webcamConsent === true },
  );

  const questions = await assessmentService.getAttemptQuestions(attempt);

  await audit(
    { action: AuditAction.ASSESSMENT_START, resource: 'AssessmentAttempt', resourceId: attempt._id.toString(), metadata: { resumed } },
    req,
  );

  const payload = {
    attempt: {
      ...attempt.toJSON(),
      // Never leak the frozen id list beyond what the questions already reveal.
      questionIds: undefined,
    },
    assessment: {
      id: assessment._id.toString(),
      title: assessment.title,
      type: assessment.type,
      description: assessment.description,
      durationMinutes: assessment.durationMinutes,
      totalQuestions: questions.length,
      passingScore: assessment.passingScore,
      requiresFullscreen: assessment.requiresFullscreen,
      requiresWebcam: assessment.requiresWebcam,
    },
    questions,
    resumed,
    serverTime: Date.now(),
    expiresAt: attempt.expiresAt.toISOString(),
    remainingSeconds: Math.max(0, Math.floor((attempt.expiresAt.getTime() - Date.now()) / 1000)),
  };

  if (resumed) ok(res, payload);
  else created(res, payload);
});

/** Rehydrates an in-progress attempt after a refresh or reconnect (§13). */
export const getAttempt = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await assessmentService.getAttemptOwned(req.params.id, req.studentId!);
  const questions = await assessmentService.getAttemptQuestions(attempt);
  const assessment = await Assessment.findById(attempt.assessmentId).lean();

  ok(res, {
    attempt: attempt.toJSON(),
    assessment,
    questions,
    serverTime: Date.now(),
    remainingSeconds: Math.max(0, Math.floor((attempt.expiresAt.getTime() - Date.now()) / 1000)),
  });
});

export const autosave = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await assessmentService.getAttemptOwned(req.params.id, req.studentId!);
  const updated = await assessmentService.autosave(attempt, req.body);

  ok(res, {
    savedAt: updated.lastAutosaveAt?.toISOString(),
    autosaveCount: updated.autosaveCount,
    answeredCount: updated.answers.filter((a) => a.answer && a.answer.length).length,
    remainingSeconds: Math.max(0, Math.floor((updated.expiresAt.getTime() - Date.now()) / 1000)),
    serverTime: Date.now(),
  });
});

export const submitAttempt = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await assessmentService.getAttemptOwned(req.params.id, req.studentId!);

  // Save whatever the client is holding before grading, so a final unsaved
  // answer is never lost at submit time.
  if (req.body?.answers?.length) {
    await assessmentService.autosave(attempt, req.body).catch(() => attempt);
  }

  const submitted = await assessmentService.submitAttempt(attempt);

  await audit(
    {
      action: AuditAction.ASSESSMENT_SUBMIT,
      resource: 'AssessmentAttempt',
      resourceId: submitted._id.toString(),
      metadata: { percentage: submitted.percentage, integrityRisk: submitted.integrityRisk },
    },
    req,
  );

  // Feedback loop (§43): the score updates readiness.
  const readiness = await recomputeReadiness(req.studentId!, 'ASSESSMENT_SUBMITTED').catch(() => null);

  ok(res, { attempt: submitted.toJSON(), readiness });
});

/** Result view, including the correct answers now that grading is complete. */
export const getResult = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await assessmentService.getAttemptOwned(req.params.id, req.studentId!);

  if (attempt.status === AttemptStatus.IN_PROGRESS) {
    throw ApiError.badRequest('This attempt is still in progress. Submit it to see your result.');
  }

  const { AssessmentQuestion } = await import('../models/AssessmentQuestion');
  const questions = await AssessmentQuestion.find({ _id: { $in: attempt.questionIds } }).lean();
  const byId = new Map(questions.map((q) => [q._id.toString(), q]));
  const assessment = await Assessment.findById(attempt.assessmentId).lean();

  ok(res, {
    attempt: attempt.toJSON(),
    assessment,
    review: attempt.answers.map((answer) => {
      const question = byId.get(answer.questionId.toString());
      return {
        questionId: answer.questionId.toString(),
        prompt: question?.prompt,
        options: question?.options,
        topic: question?.topic,
        difficulty: question?.difficulty,
        marks: question?.marks,
        yourAnswer: answer.answer,
        correctAnswer: question?.correctAnswer,
        explanation: question?.explanation,
        isCorrect: answer.isCorrect,
        awardedMarks: answer.awardedMarks,
        timeSpentSeconds: answer.timeSpentSeconds,
      };
    }),
    integrity: await assessmentService.integritySummary(attempt),
  });
});

export const listAttempts = asyncHandler(async (req: Request, res: Response) => {
  const attempts = await AssessmentAttempt.find({ studentId: req.studentId })
    .populate<{ assessmentId: { title: string; type: string } }>('assessmentId', 'title type difficulty')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  ok(res, attempts);
});

/**
 * Records integrity signals from the client (§14).
 *
 * The endpoint accepts a batch because the browser buffers events while offline
 * and flushes them on reconnect.
 */
export const recordMonitoring = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await assessmentService.getAttemptOwned(req.params.id, req.studentId!);

  const events = await Promise.all(
    (req.body.events as Array<{ type: MonitoringEventType; metadata?: Record<string, unknown> }>).map((event) =>
      assessmentService.recordMonitoringEvent({
        attemptId: attempt._id,
        studentId: req.studentId!,
        userId: req.auth!.userId,
        type: event.type,
        metadata: event.metadata,
      }),
    ),
  );

  const risk = await assessmentService.recomputeIntegrityRisk(attempt._id);

  ok(res, {
    recorded: events.length,
    integrityRisk: risk,
    // Shown to the student: monitoring is transparent, never covert (§30).
    notice:
      risk === 'LOW'
        ? null
        : 'Some activity during this assessment has been flagged for review. This is not an accusation - a ' +
          'reviewer will look at the context before any decision is made.',
  });
});

/** Staff view of an attempt's integrity signals. */
export const getIntegrity = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await AssessmentAttempt.findById(req.params.id);
  if (!attempt) throw ApiError.notFound('Assessment attempt');

  const isOwner = attempt.studentId.toString() === req.studentId?.toString();
  const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
  if (!isOwner && !staff.includes(req.auth!.role)) {
    throw ApiError.forbidden('You can only view your own assessment integrity report.');
  }

  ok(res, await assessmentService.integritySummary(attempt));
});
