import type { Request, Response } from 'express';
import { InterviewSession } from '../models/InterviewSession';
import { AuditAction, audit } from '../services/audit.service';
import * as interviewService from '../services/interview.service';
import { asyncHandler } from '../utils/asyncHandler';
import { created, ok } from '../utils/response';

export const start = asyncHandler(async (req: Request, res: Response) => {
  const { session, question } = await interviewService.startInterview({
    studentId: req.studentId!,
    userId: req.auth!.userId,
    mode: req.body.mode,
    companyId: req.body.companyId,
    roleId: req.body.roleId,
    difficulty: req.body.difficulty,
    plannedQuestions: req.body.plannedQuestions,
    mediaConsent: req.body.mediaConsent,
  });

  await audit(
    { action: AuditAction.INTERVIEW_START, resource: 'InterviewSession', resourceId: session._id.toString(), metadata: { mode: session.mode } },
    req,
  );

  created(res, {
    session: session.toJSON(),
    question,
    // Surfaced so the UI can show a persistent recording indicator (§15).
    mediaConsent: session.mediaConsent,
  });
});

export const submitAnswer = asyncHandler(async (req: Request, res: Response) => {
  const session = await interviewService.getSessionOwned(req.params.id, req.studentId!);

  const result = await interviewService.submitAnswer({
    session,
    questionId: req.body.questionId,
    transcript: req.body.transcript,
    inputMode: req.body.inputMode,
    durationSeconds: req.body.durationSeconds,
  });

  if (result.completed) {
    await audit(
      { action: AuditAction.INTERVIEW_COMPLETE, resource: 'InterviewSession', resourceId: session._id.toString() },
      req,
    );
  }

  ok(res, result);
});

export const getSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await interviewService.getSessionOwned(req.params.id, req.studentId!);
  ok(res, await interviewService.getSessionDetail(session));
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await interviewService.listSessions(req.studentId!));
});

/**
 * Ends an interview early. A partially answered session is still scored, so a
 * student who ran out of time keeps the feedback they earned.
 */
export const end = asyncHandler(async (req: Request, res: Response) => {
  const session = await interviewService.getSessionOwned(req.params.id, req.studentId!);
  const updated = await interviewService.abandonInterview(session);
  const detail = await interviewService.getSessionDetail(updated);
  ok(res, detail);
});

export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const session = await InterviewSession.findOne({ _id: req.params.id, studentId: req.studentId });
  if (!session) {
    ok(res, null);
    return;
  }
  ok(res, await interviewService.getSessionDetail(session));
});
