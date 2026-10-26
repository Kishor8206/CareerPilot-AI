import type { Types } from 'mongoose';
import {
  AttemptStatus,
  DataProvenance,
  ErrorCode,
  MonitoringEventType,
  NotificationType,
  RiskLevel,
} from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { Assessment, type IAssessment } from '../models/Assessment';
import { AssessmentAttempt, type IAssessmentAttempt } from '../models/AssessmentAttempt';
import { AssessmentQuestion } from '../models/AssessmentQuestion';
import { MonitoringEvent } from '../models/MonitoringEvent';
import { StudentProfile } from '../models/StudentProfile';
import { ApiError } from '../utils/ApiError';
import { addMinutes, percentage, round } from '../utils/helpers';
import { configService } from './config.service';
import { notify } from './notification.service';

const log = moduleLogger('assessment');

/** Grace window: a submission arriving fractionally after expiry is accepted. */
const SUBMIT_GRACE_SECONDS = 30;

/**
 * Starts an attempt.
 *
 * Question order is frozen at start and stored on the attempt, which is what
 * makes refresh-recovery deterministic: reloading the page must show the same
 * paper in the same order, not a fresh random selection (§13).
 */
export async function startAttempt(
  assessmentId: string,
  studentId: Types.ObjectId,
  userId: string,
  options: { webcamConsent?: boolean } = {},
): Promise<{ attempt: IAssessmentAttempt; assessment: IAssessment; resumed: boolean }> {
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment || !assessment.active) {
    throw ApiError.notFound('Assessment');
  }

  // Session recovery: an unexpired in-progress attempt is resumed, never
  // replaced. This is what protects a student who refreshed or lost network.
  const existing = await AssessmentAttempt.findOne({
    studentId,
    assessmentId: assessment._id,
    status: AttemptStatus.IN_PROGRESS,
  });

  if (existing) {
    if (existing.expiresAt.getTime() > Date.now()) {
      existing.resumeCount += 1;
      await existing.save();

      await recordMonitoringEvent({
        attemptId: existing._id,
        studentId,
        userId,
        type: MonitoringEventType.SESSION_RESUMED,
        explanation: 'The student resumed an in-progress attempt, for example after a page refresh.',
      });

      log.info({ attemptId: existing._id.toString() }, 'Resumed an in-progress attempt');
      return { attempt: existing, assessment, resumed: true };
    }

    // Expired while away: auto-submit what was saved rather than discarding it.
    await submitAttempt(existing, { autoSubmitted: true });
  }

  if (assessment.maxAttempts > 0) {
    const used = await AssessmentAttempt.countDocuments({
      studentId,
      assessmentId: assessment._id,
      status: { $in: [AttemptStatus.SUBMITTED, AttemptStatus.EVALUATED] },
    });
    if (used >= assessment.maxAttempts) {
      throw ApiError.forbidden(
        `You have used all ${assessment.maxAttempts} permitted attempt(s) for this assessment.`,
      );
    }
  }

  if (assessment.requiresWebcam && !options.webcamConsent) {
    throw new ApiError(
      403,
      ErrorCode.CONSENT_REQUIRED,
      'This assessment uses webcam-based integrity monitoring. Explicit consent is required before you can begin.',
    );
  }

  const questions = await selectQuestions(assessment);
  if (!questions.length) {
    throw ApiError.badRequest('This assessment has no questions configured yet. Please contact the placement office.');
  }

  const attempt = await AssessmentAttempt.create({
    assessmentId: assessment._id,
    studentId,
    userId,
    assessmentType: assessment.type,
    status: AttemptStatus.IN_PROGRESS,
    questionIds: questions.map((q) => q._id),
    answers: questions.map((q) => ({
      questionId: q._id,
      answer: null,
      markedForReview: false,
      timeSpentSeconds: 0,
    })),
    startedAt: new Date(),
    // Server-authoritative deadline. The client timer is display only.
    expiresAt: addMinutes(new Date(), assessment.durationMinutes),
    durationMinutes: assessment.durationMinutes,
    fullscreenRequired: assessment.requiresFullscreen,
    webcamConsent: Boolean(options.webcamConsent),
    provenance: DataProvenance.REAL,
  });

  await StudentProfile.updateOne({ _id: studentId }, { $set: { lastActivityAt: new Date() } });

  log.info({ attemptId: attempt._id.toString(), assessmentId }, 'Assessment attempt started');
  return { attempt, assessment, resumed: false };
}

async function selectQuestions(assessment: IAssessment) {
  const pool = await AssessmentQuestion.find({ assessmentId: assessment._id, active: true }).select('_id').lean();

  if (!assessment.randomizeQuestions || pool.length <= assessment.totalQuestions) {
    return pool.slice(0, assessment.totalQuestions);
  }

  // Fisher-Yates over the pool so retakes genuinely differ.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, assessment.totalQuestions);
}

/**
 * Returns the paper as the student may see it.
 * `correctAnswer` and `explanation` are projected out at the database level, so
 * they cannot leak through a serialisation mistake further up the stack.
 */
export async function getAttemptQuestions(attempt: IAssessmentAttempt) {
  const questions = await AssessmentQuestion.find({ _id: { $in: attempt.questionIds } })
    .select('-correctAnswer -explanation')
    .lean();

  const byId = new Map(questions.map((q) => [q._id.toString(), q]));

  // Preserve the frozen order rather than MongoDB's return order, and expose
  // `id` explicitly: `.lean()` documents do not carry the `id` virtual, so the
  // client would otherwise receive only `_id`.
  return attempt.questionIds
    .map((id) => byId.get(id.toString()))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => ({ ...q, id: q._id.toString() }));
}

export async function getAttemptOwned(attemptId: string, studentId: Types.ObjectId): Promise<IAssessmentAttempt> {
  const attempt = await AssessmentAttempt.findOne({ _id: attemptId, studentId });
  if (!attempt) throw ApiError.notFound('Assessment attempt');
  return attempt;
}

export interface AutosavePayload {
  answers: Array<{ questionId: string; answer: string | string[] | null; markedForReview?: boolean; timeSpentSeconds?: number }>;
}

/**
 * Persists in-progress answers (§13 autosave).
 *
 * Answers are merged, never replaced wholesale, so a partial autosave from one
 * tab cannot wipe answers saved from another.
 */
export async function autosave(attempt: IAssessmentAttempt, payload: AutosavePayload): Promise<IAssessmentAttempt> {
  assertInProgress(attempt);

  const validIds = new Set(attempt.questionIds.map((id) => id.toString()));
  const byQuestion = new Map(attempt.answers.map((a) => [a.questionId.toString(), a]));

  for (const incoming of payload.answers) {
    if (!validIds.has(incoming.questionId)) continue; // ignore unknown ids
    const target = byQuestion.get(incoming.questionId);
    if (!target) continue;

    if (incoming.answer !== undefined) {
      target.answer = incoming.answer === null ? null : Array.isArray(incoming.answer) ? incoming.answer : [incoming.answer];
      target.answeredAt = target.answer ? new Date() : null;
    }
    if (incoming.markedForReview !== undefined) target.markedForReview = incoming.markedForReview;
    if (incoming.timeSpentSeconds !== undefined) {
      target.timeSpentSeconds = Math.max(target.timeSpentSeconds, Math.min(incoming.timeSpentSeconds, 86_400));
    }
  }

  attempt.lastAutosaveAt = new Date();
  attempt.autosaveCount += 1;
  await attempt.save();

  return attempt;
}

function assertInProgress(attempt: IAssessmentAttempt): void {
  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    throw new ApiError(
      409,
      ErrorCode.ASSESSMENT_ALREADY_SUBMITTED,
      'This attempt has already been submitted and can no longer be modified.',
    );
  }
  if (attempt.expiresAt.getTime() + SUBMIT_GRACE_SECONDS * 1000 < Date.now()) {
    throw new ApiError(
      410,
      ErrorCode.ASSESSMENT_EXPIRED,
      'The time limit for this assessment has passed. Your saved answers have been submitted automatically.',
    );
  }
}

export interface SubmitOptions {
  autoSubmitted?: boolean;
}

/**
 * Grades and finalises an attempt.
 *
 * Grading is server-side only and reads `correctAnswer` directly from the
 * question bank, so a manipulated client cannot influence the score.
 */
export async function submitAttempt(
  attempt: IAssessmentAttempt,
  options: SubmitOptions = {},
): Promise<IAssessmentAttempt> {
  if (attempt.status !== AttemptStatus.IN_PROGRESS) {
    throw new ApiError(
      409,
      ErrorCode.ASSESSMENT_ALREADY_SUBMITTED,
      'This attempt has already been submitted.',
    );
  }

  const questions = await AssessmentQuestion.find({ _id: { $in: attempt.questionIds } }).lean();
  const byId = new Map(questions.map((q) => [q._id.toString(), q]));

  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  const topicTally = new Map<string, { correct: number; total: number }>();

  for (const answer of attempt.answers) {
    const question = byId.get(answer.questionId.toString());
    if (!question) continue;

    maxScore += question.marks;

    const tally = topicTally.get(question.topic) ?? { correct: 0, total: 0 };
    tally.total += 1;

    const given = (answer.answer ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean).sort();
    const expected = (question.correctAnswer ?? []).map((v) => String(v).trim().toLowerCase()).sort();

    // MULTI_SELECT requires an exact set match; partial credit would reward
    // shotgunning every option.
    const isCorrect = expected.length > 0 && given.length === expected.length && given.every((v, i) => v === expected[i]);

    answer.isCorrect = isCorrect;
    if (isCorrect) {
      answer.awardedMarks = question.marks;
      score += question.marks;
      correctCount += 1;
      tally.correct += 1;
    } else {
      // Negative marking applies only to an attempted-and-wrong answer.
      const penalty = given.length > 0 ? question.negativeMarks : 0;
      answer.awardedMarks = -penalty;
      score -= penalty;
    }

    topicTally.set(question.topic, tally);
  }

  score = Math.max(0, score);
  const pct = maxScore > 0 ? round((score / maxScore) * 100, 2) : 0;

  attempt.status = AttemptStatus.EVALUATED;
  attempt.submittedAt = new Date();
  attempt.score = round(score, 2);
  attempt.maxScore = maxScore;
  attempt.percentage = pct;
  attempt.correctCount = correctCount;
  attempt.topicBreakdown = [...topicTally.entries()].map(([topic, t]) => ({
    topic,
    correct: t.correct,
    total: t.total,
    percentage: percentage(t.correct, t.total),
  }));

  const assessment = await Assessment.findById(attempt.assessmentId).select('passingScore title').lean();
  attempt.passed = pct >= (assessment?.passingScore ?? 40);

  await attempt.save();
  await recomputeIntegrityRisk(attempt._id);

  await notify({
    userId: attempt.userId,
    type: NotificationType.ASSESSMENT_COMPLETED,
    title: `Assessment ${options.autoSubmitted ? 'auto-submitted' : 'completed'}: ${assessment?.title ?? ''}`.trim(),
    body: `You scored ${pct}% (${correctCount} of ${attempt.answers.length} correct).${
      options.autoSubmitted ? ' Your saved answers were submitted automatically when the time expired.' : ''
    }`,
    link: `/assessments/result/${attempt._id.toString()}`,
    metadata: { attemptId: attempt._id.toString(), percentage: pct },
  });

  log.info(
    { attemptId: attempt._id.toString(), percentage: pct, autoSubmitted: options.autoSubmitted },
    'Assessment submitted and graded',
  );

  return attempt;
}

/** Auto-submits every attempt whose deadline has passed (§13 timer expiry). */
export async function expireOverdueAttempts(): Promise<number> {
  const overdue = await AssessmentAttempt.find({
    status: AttemptStatus.IN_PROGRESS,
    expiresAt: { $lt: new Date(Date.now() - SUBMIT_GRACE_SECONDS * 1000) },
  });

  let count = 0;
  for (const attempt of overdue) {
    try {
      await submitAttempt(attempt, { autoSubmitted: true });
      count += 1;
    } catch (error) {
      log.error({ err: error, attemptId: attempt._id.toString() }, 'Failed to auto-submit an expired attempt');
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* Assessment integrity monitoring (§14)                               */
/* ------------------------------------------------------------------ */

export interface MonitoringInput {
  attemptId?: Types.ObjectId;
  interviewSessionId?: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: string | Types.ObjectId;
  type: MonitoringEventType;
  explanation?: string;
  metadata?: Record<string, unknown>;
}

const EVENT_EXPLANATIONS: Record<string, string> = {
  [MonitoringEventType.FULLSCREEN_EXIT]: 'The assessment window left full-screen mode.',
  [MonitoringEventType.FULLSCREEN_ENTER]: 'The assessment window returned to full-screen mode.',
  [MonitoringEventType.TAB_HIDDEN]: 'The browser tab was hidden, which usually means another tab or app was opened.',
  [MonitoringEventType.TAB_VISIBLE]: 'The browser tab became visible again.',
  [MonitoringEventType.WINDOW_BLUR]: 'The assessment window lost focus.',
  [MonitoringEventType.WINDOW_FOCUS]: 'The assessment window regained focus.',
  [MonitoringEventType.COPY]: 'Content was copied from the assessment page.',
  [MonitoringEventType.PASTE]: 'Content was pasted into an answer field.',
  [MonitoringEventType.INACTIVITY]: 'No interaction was recorded for an extended period.',
  [MonitoringEventType.RAPID_ANSWER]: 'Several answers were submitted unusually quickly.',
  [MonitoringEventType.NETWORK_OFFLINE]: 'The network connection was lost. Answers continued to be saved locally.',
  [MonitoringEventType.NETWORK_ONLINE]: 'The network connection was restored.',
  [MonitoringEventType.MULTIPLE_SESSION]: 'The same attempt appears to have been opened in more than one place.',
  [MonitoringEventType.FACE_NOT_DETECTED]: 'No face was detected by the consented webcam check.',
  [MonitoringEventType.MULTIPLE_FACES]: 'More than one person was detected by the consented webcam check.',
  [MonitoringEventType.CAMERA_UNAVAILABLE]: 'The webcam became unavailable during the assessment.',
  [MonitoringEventType.SESSION_RESUMED]: 'The attempt was resumed, for example after a page refresh.',
};

/**
 * Records an integrity signal.
 *
 * These are advisory. Nothing here fails a student; the accumulated score moves
 * an attempt to MEDIUM or HIGH so a human reviews it (§14).
 */
export async function recordMonitoringEvent(input: MonitoringInput) {
  const severityMap = await configService.getMonitoringSeverity();
  const severity = (severityMap[input.type] ?? RiskLevel.LOW) as RiskLevel;

  const event = await MonitoringEvent.create({
    attemptId: input.attemptId ?? null,
    interviewSessionId: input.interviewSessionId ?? null,
    studentId: input.studentId,
    userId: input.userId,
    type: input.type,
    severity,
    explanation: input.explanation ?? EVENT_EXPLANATIONS[input.type] ?? 'An integrity signal was recorded.',
    occurredAt: new Date(),
    metadata: input.metadata ?? {},
  });

  if (input.attemptId) {
    await AssessmentAttempt.updateOne({ _id: input.attemptId }, { $inc: { monitoringEventCount: 1 } });
    await recomputeIntegrityRisk(input.attemptId);
  }

  return event;
}

/**
 * Recomputes an attempt's overall integrity indicator from accumulated points.
 *
 * A single MEDIUM signal never reaches HIGH on its own: brief tab switches
 * happen for innocent reasons, and the design deliberately requires a pattern.
 */
export async function recomputeIntegrityRisk(attemptId: Types.ObjectId): Promise<RiskLevel> {
  const [events, thresholds] = await Promise.all([
    MonitoringEvent.find({ attemptId }).select('severity').lean(),
    configService.getMonitoringThresholds(),
  ]);

  const points = events.reduce(
    (total, event) => total + (thresholds.severityPoints[event.severity as RiskLevel] ?? 1),
    0,
  );

  const risk: RiskLevel =
    points >= thresholds.highScore ? RiskLevel.HIGH : points >= thresholds.mediumScore ? RiskLevel.MEDIUM : RiskLevel.LOW;

  await AssessmentAttempt.updateOne({ _id: attemptId }, { $set: { integrityRisk: risk } });
  return risk;
}

export async function getMonitoringEvents(attemptId: Types.ObjectId) {
  return MonitoringEvent.find({ attemptId }).sort({ occurredAt: 1 }).lean();
}

/**
 * Builds the integrity summary shown to reviewers, with an explicit statement
 * that the signals are advisory and require human judgement.
 */
export async function integritySummary(attempt: IAssessmentAttempt) {
  const [events, thresholds] = await Promise.all([
    MonitoringEvent.find({ attemptId: attempt._id }).sort({ occurredAt: 1 }).lean(),
    configService.getMonitoringThresholds(),
  ]);

  const byType = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] ?? 0) + 1;
    return acc;
  }, {});

  const points = events.reduce((total, e) => total + (thresholds.severityPoints[e.severity as RiskLevel] ?? 1), 0);

  return {
    risk: attempt.integrityRisk,
    points,
    thresholds: { medium: thresholds.mediumScore, high: thresholds.highScore },
    eventCount: events.length,
    byType,
    events,
    reviewed: Boolean(attempt.integrityReviewedBy),
    reviewNote: attempt.integrityReviewNote,
    disclaimer:
      'These signals indicate conditions worth a human review. They are not proof of misconduct, and no ' +
      'result is invalidated automatically. A reviewer must consider context before any action is taken.',
  };
}
