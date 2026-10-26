import type { Types } from 'mongoose';
import {
  AgentName,
  DataProvenance,
  Difficulty,
  ErrorCode,
  InterviewMode,
  InterviewStatus,
  NotificationType,
} from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { Company } from '../models/Company';
import { InterviewEvaluation } from '../models/InterviewEvaluation';
import { InterviewQuestion } from '../models/InterviewQuestion';
import { InterviewResponse } from '../models/InterviewResponse';
import { InterviewSession, type IInterviewSession } from '../models/InterviewSession';
import { JobRole } from '../models/JobRole';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { StudentProfile } from '../models/StudentProfile';
import { ApiError } from '../utils/ApiError';
import { average, countFillerWords, round, wordCount } from '../utils/helpers';
import { aiClient } from './aiClient.service';
import { notify } from './notification.service';

const log = moduleLogger('interview');

export interface StartInterviewInput {
  studentId: Types.ObjectId;
  userId: string;
  mode: InterviewMode;
  companyId?: string;
  roleId?: string;
  difficulty?: Difficulty;
  plannedQuestions?: number;
  mediaConsent?: { camera: boolean; microphone: boolean; recording: boolean };
}

/**
 * Creates a session and generates its first question.
 *
 * The session records the weak components that steer question selection, so the
 * adaptation is reproducible after the fact rather than depending on whatever
 * the scores happened to be at generation time.
 */
export async function startInterview(input: StartInterviewInput): Promise<{
  session: IInterviewSession;
  question: Record<string, unknown>;
}> {
  const profile = await StudentProfile.findById(input.studentId);
  if (!profile) throw ApiError.notFound('Student profile');

  // Only one live interview at a time; an abandoned one is closed first.
  const active = await InterviewSession.findOne({
    studentId: input.studentId,
    status: InterviewStatus.IN_PROGRESS,
  });
  if (active) {
    active.status = InterviewStatus.ABANDONED;
    active.completedAt = new Date();
    await active.save();
    log.info({ sessionId: active._id.toString() }, 'Abandoned a stale interview session');
  }

  if ((input.mode === InterviewMode.COMPANY_SPECIFIC) && !input.companyId) {
    throw ApiError.badRequest('A company must be selected for a company-specific interview.');
  }

  const readiness = await PlacementReadiness.findOne({ studentId: input.studentId, isLatest: true })
    .select('components')
    .lean();

  // Components scoring under 55 become the focus areas (§11 adaptation).
  const weakComponents = ((readiness?.components ?? []) as Array<{ key: string; normalized: number; raw: number | null }>)
    .filter((c) => c.raw !== null && c.normalized < 55)
    .sort((a, b) => a.normalized - b.normalized)
    .map((c) => c.key);

  const resumeAnalysis =
    input.mode === InterviewMode.RESUME_BASED
      ? await ResumeAnalysis.findOne({ studentId: input.studentId }).sort({ createdAt: -1 }).select('_id').lean()
      : null;

  const session = await InterviewSession.create({
    studentId: input.studentId,
    userId: input.userId,
    mode: input.mode,
    status: InterviewStatus.IN_PROGRESS,
    companyId: input.companyId ?? null,
    roleId: input.roleId ?? null,
    resumeAnalysisId: resumeAnalysis?._id ?? null,
    difficulty: input.difficulty ?? Difficulty.MEDIUM,
    plannedQuestions: input.plannedQuestions ?? 8,
    currentIndex: 0,
    topicFocus: weakComponents,
    mediaConsent: {
      camera: input.mediaConsent?.camera ?? false,
      microphone: input.mediaConsent?.microphone ?? false,
      recording: input.mediaConsent?.recording ?? false,
      consentedAt: input.mediaConsent ? new Date() : null,
      retentionDays: 30,
      policyVersion: '1.0',
    },
    provenance: DataProvenance.REAL,
  });

  const question = await generateNextQuestion(session, []);
  return { session, question };
}

async function contextFor(session: IInterviewSession) {
  const [profile, company, role] = await Promise.all([
    StudentProfile.findById(session.studentId).select('skills projects summary').lean(),
    session.companyId ? Company.findById(session.companyId).select('name').lean() : null,
    session.roleId ? JobRole.findById(session.roleId).select('title interviewTopics').lean() : null,
  ]);

  return {
    skills: (profile?.skills ?? []).map((s) => s.name),
    projects: (profile?.projects ?? []).map((p) => `${p.title}: ${p.technologies.join(', ')}`),
    companyName: company?.name ?? null,
    companyId: session.companyId?.toString() ?? null,
    roleTitle: role?.title ?? null,
    roleId: session.roleId?.toString() ?? null,
    roleTopics: role?.interviewTopics ?? [],
  };
}

/** Generates and persists the next question for a session. */
export async function generateNextQuestion(
  session: IInterviewSession,
  recentScores: number[],
): Promise<Record<string, unknown>> {
  const context = await contextFor(session);
  const asked = await InterviewQuestion.find({ sessionId: session._id }).select('question').lean();

  const payload = {
    sessionId: session._id.toString(),
    mode: session.mode,
    index: session.currentIndex,
    difficulty: session.difficulty,
    plannedQuestions: session.plannedQuestions,
    companyName: context.companyName,
    companyId: context.companyId,
    roleTitle: context.roleTitle,
    roleId: context.roleId,
    skills: context.skills,
    projects: context.projects,
    topicFocus: [...session.topicFocus, ...context.roleTopics],
    askedQuestions: asked.map((q) => q.question),
    recentScores,
    weakComponents: session.topicFocus,
  };

  const result = await aiClient.post<typeof payload, Record<string, any>>('/ai/interview/generate', payload, {
    userId: session.userId.toString(),
    studentId: session.studentId.toString(),
    agent: AgentName.TECHNICAL_INTERVIEW,
    operation: 'interview.generate',
  });

  const data = result.data;

  const question = await InterviewQuestion.create({
    sessionId: session._id,
    index: session.currentIndex,
    question: data.question,
    category: data.category ?? session.mode,
    topic: data.topic ?? 'general',
    difficulty: data.difficulty ?? session.difficulty,
    expectedPoints: data.expectedPoints ?? [],
    sources: data.sources ?? [],
    generatedBy: `${session.mode}_INTERVIEW_AGENT`,
  });

  // Record the difficulty decision so the adaptation trail is inspectable.
  if (data.difficulty && data.difficulty !== session.difficulty) {
    session.difficultyTrail.push({
      index: session.currentIndex,
      difficulty: data.difficulty,
      reason: data.difficultyReason ?? 'Adapted from recent answer scores.',
    });
    session.difficulty = data.difficulty;
  }
  await session.save();

  return {
    id: question._id.toString(),
    index: question.index,
    question: question.question,
    category: question.category,
    topic: question.topic,
    difficulty: question.difficulty,
    sources: question.sources,
    difficultyReason: data.difficultyReason ?? '',
    // `expectedPoints` is deliberately withheld until the answer is submitted.
  };
}

export interface SubmitAnswerInput {
  session: IInterviewSession;
  questionId: string;
  transcript: string;
  inputMode: 'TEXT' | 'SPEECH';
  durationSeconds: number;
}

/**
 * Scores an answer and returns the next question (or the final report).
 *
 * Delivery signals are measured here in Node as well as in the AI service; the
 * measured values are authoritative, so the score cannot drift on a provider's
 * estimate of how many words the student wrote.
 */
export async function submitAnswer(input: SubmitAnswerInput): Promise<{
  evaluation: Record<string, unknown>;
  nextQuestion: Record<string, unknown> | null;
  completed: boolean;
  report: Record<string, unknown> | null;
}> {
  const { session } = input;

  if (session.status !== InterviewStatus.IN_PROGRESS) {
    throw new ApiError(409, ErrorCode.INTERVIEW_NOT_ACTIVE, 'This interview session is no longer active.');
  }

  const question = await InterviewQuestion.findOne({ _id: input.questionId, sessionId: session._id });
  if (!question) throw ApiError.notFound('Interview question');

  const existing = await InterviewResponse.findOne({ sessionId: session._id, questionId: question._id });
  if (existing) {
    throw ApiError.conflict('You have already answered this question.');
  }

  const words = wordCount(input.transcript);
  const fillers = countFillerWords(input.transcript);

  const payload = {
    question: question.question,
    answer: input.transcript,
    expectedPoints: question.expectedPoints,
    mode: session.mode,
    difficulty: question.difficulty,
    topic: question.topic,
    durationSeconds: input.durationSeconds,
    // `inputMode` is deliberately NOT sent to the evaluator (§11, §12).
    //
    // The evaluator needs the words and nothing else. Telling it the answer was
    // spoken invites a model to treat it differently — to excuse disfluency, or
    // to penalise it — and either way a student's score would depend on how they
    // chose to answer rather than on what they said. Withholding the field makes
    // that guarantee structural instead of relying on the prompt to ignore it.
    // It is still persisted on the response record below, for analytics.
  };

  const result = await aiClient.post<typeof payload, Record<string, any>>('/ai/interview/evaluate', payload, {
    userId: session.userId.toString(),
    studentId: session.studentId.toString(),
    agent: AgentName.TECHNICAL_INTERVIEW,
    operation: 'interview.evaluate',
  });

  const evaluation = result.data;

  await InterviewResponse.create({
    sessionId: session._id,
    questionId: question._id,
    studentId: session.studentId,
    transcript: input.transcript,
    inputMode: input.inputMode,
    durationSeconds: input.durationSeconds,
    wordCount: words,
    fillerWordCount: fillers,
    fillerWordRate: words ? round(fillers / words, 4) : 0,
    evaluation,
    submittedAt: new Date(),
  });

  session.currentIndex += 1;
  session.durationSeconds += input.durationSeconds;
  await session.save();

  const completed = session.currentIndex >= session.plannedQuestions;

  if (completed) {
    const report = await completeInterview(session);
    return { evaluation, nextQuestion: null, completed: true, report };
  }

  const responses = await InterviewResponse.find({ sessionId: session._id }).select('evaluation').lean();
  const recentScores = responses
    .map((r) => (r.evaluation as { overall?: number } | null)?.overall)
    .filter((v): v is number => Number.isFinite(v));

  const nextQuestion = await generateNextQuestion(session, recentScores);
  return { evaluation, nextQuestion, completed: false, report: null };
}

/** Aggregates per-answer scores into the final report (§11). */
export async function completeInterview(session: IInterviewSession): Promise<Record<string, unknown>> {
  const responses = await InterviewResponse.find({ sessionId: session._id })
    .populate<{ questionId: { question: string } }>('questionId', 'question')
    .lean();

  const evaluations = responses
    .map((r) => r.evaluation as Record<string, number | string[]> | null)
    .filter((e): e is Record<string, any> => Boolean(e));

  const dimension = (key: string) => round(average(evaluations.map((e) => Number(e[key] ?? 0))), 2);

  const overall = dimension('overall');
  const communication = dimension('communication');
  const structure = dimension('structure');
  const technical = round(average([dimension('correctness'), dimension('completeness')]), 2);

  // Confidence indicator: objective delivery signals only (§12). Derived from
  // response length adequacy and filler-word rate, never from affect.
  const totalWords = responses.reduce((sum, r) => sum + r.wordCount, 0);
  const totalFillers = responses.reduce((sum, r) => sum + r.fillerWordCount, 0);
  const fillerRate = totalWords ? totalFillers / totalWords : 0;
  const adequateLength = responses.filter((r) => r.wordCount >= 40 && r.wordCount <= 260).length;
  const lengthRatio = responses.length ? adequateLength / responses.length : 0;
  const confidenceIndicator = round(Math.max(0, Math.min(100, lengthRatio * 60 + (1 - Math.min(1, fillerRate * 12)) * 40)), 2);

  const strengths = [...new Set(evaluations.flatMap((e) => (e.strengths as string[]) ?? []))].slice(0, 6);
  const weaknesses = [...new Set(evaluations.flatMap((e) => (e.improvements as string[]) ?? []))].slice(0, 6);

  const evaluation = await InterviewEvaluation.findOneAndUpdate(
    { sessionId: session._id },
    {
      $set: {
        studentId: session.studentId,
        mode: session.mode,
        overallScore: overall,
        technicalScore: technical,
        communicationScore: communication,
        structureScore: structure,
        confidenceIndicatorScore: confidenceIndicator,
        questionsAnswered: responses.length,
        strengths,
        weaknesses,
        recommendations: buildRecommendations(overall, communication, structure, fillerRate, lengthRatio),
        perQuestion: responses.map((r) => ({
          // `questionId` is populated with the question document here.
          questionId: (r.questionId as unknown as { _id?: unknown })?._id ?? r.questionId,
          question: (r.questionId as unknown as { question?: string })?.question ?? '',
          score: Number((r.evaluation as { overall?: number } | null)?.overall ?? 0),
          feedback: String((r.evaluation as { explanation?: string } | null)?.explanation ?? ''),
        })),
        summary:
          `You answered ${responses.length} question(s) in this ${session.mode.toLowerCase().replace(/_/g, ' ')} ` +
          `interview, scoring ${overall}/100 overall. Technical content scored ${technical}/100 and ` +
          `communication ${communication}/100.`,
      },
    },
    { upsert: true, new: true },
  );

  session.status = InterviewStatus.COMPLETED;
  session.completedAt = new Date();
  session.evaluationId = evaluation._id;
  await session.save();

  await notify({
    userId: session.userId,
    type: NotificationType.INTERVIEW_COMPLETED,
    title: 'Your mock interview report is ready',
    body: `You scored ${overall}/100 across ${responses.length} question(s). Open the report to see per-question feedback.`,
    link: `/interview/report/${session._id.toString()}`,
    metadata: { sessionId: session._id.toString(), score: overall },
  });

  // The readiness recomputation closes the §43 feedback loop. It is best-effort:
  // the report the student just earned must not be lost if APIE is unavailable.
  const { recomputeReadiness } = await import('./apie.service');
  await recomputeReadiness(session.studentId, 'INTERVIEW_COMPLETED').catch(() => null);

  log.info({ sessionId: session._id.toString(), overall }, 'Interview completed');
  return evaluation.toJSON();
}

function buildRecommendations(
  overall: number,
  communication: number,
  structure: number,
  fillerRate: number,
  lengthRatio: number,
): string[] {
  const recommendations: string[] = [];

  if (overall < 50) {
    recommendations.push(
      'Revise the fundamentals for the topics you were asked about, then retake this interview to measure the change.',
    );
  }
  if (structure < 60) {
    recommendations.push(
      'Structure each answer explicitly: state your position, give one concrete example, then state the outcome.',
    );
  }
  if (communication < 60) {
    recommendations.push('Practise saying your answers aloud. Written fluency does not transfer automatically to speech.');
  }
  if (fillerRate > 0.04) {
    recommendations.push(
      `Filler words made up about ${Math.round(fillerRate * 100)}% of your words. A short silent pause reads as more confident than "um".`,
    );
  }
  if (lengthRatio < 0.5) {
    recommendations.push('Aim for 60-150 words per answer: long enough for reasoning and an example, short enough to stay sharp.');
  }
  if (!recommendations.length) {
    recommendations.push('Strong performance. Raise the difficulty, or run a company-specific interview for your top target.');
  }

  return recommendations;
}

export async function getSessionOwned(sessionId: string, studentId: Types.ObjectId): Promise<IInterviewSession> {
  const session = await InterviewSession.findOne({ _id: sessionId, studentId });
  if (!session) throw ApiError.notFound('Interview session');
  return session;
}

export async function getSessionDetail(session: IInterviewSession) {
  const [questions, responses, evaluation] = await Promise.all([
    InterviewQuestion.find({ sessionId: session._id }).sort({ index: 1 }).lean(),
    InterviewResponse.find({ sessionId: session._id }).lean(),
    session.evaluationId ? InterviewEvaluation.findById(session.evaluationId).lean() : null,
  ]);

  const responseByQuestion = new Map(responses.map((r) => [r.questionId.toString(), r]));

  return {
    session: session.toJSON(),
    questions: questions.map((q) => ({
      ...q,
      id: q._id.toString(),
      response: responseByQuestion.get(q._id.toString()) ?? null,
    })),
    evaluation,
  };
}

export async function abandonInterview(session: IInterviewSession): Promise<IInterviewSession> {
  if (session.status !== InterviewStatus.IN_PROGRESS) return session;

  const answered = await InterviewResponse.countDocuments({ sessionId: session._id });

  // A partially completed interview is still worth scoring: discarding four
  // answered questions because the student ran out of time would be wasteful.
  if (answered > 0) {
    await completeInterview(session);
    return session;
  }

  session.status = InterviewStatus.ABANDONED;
  session.completedAt = new Date();
  await session.save();
  return session;
}

export async function listSessions(studentId: Types.ObjectId, limit = 20) {
  return InterviewSession.find({ studentId })
    .populate<{ companyId: { name: string } }>('companyId', 'name')
    .populate<{ roleId: { title: string } }>('roleId', 'title')
    .populate<{ evaluationId: { overallScore: number } }>('evaluationId', 'overallScore technicalScore communicationScore')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
