import type { Request, Response } from 'express';
import * as careerService from '../services/career.service';
import { asyncHandler } from '../utils/asyncHandler';
import { created, ok } from '../utils/response';

/** Roles, skills and levels for the career form. */
export const getCatalogue = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await careerService.getCatalogue());
});

export const getPlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await careerService.getLatestPlan(req.studentId!);
  ok(res, { plan: plan ? plan.toJSON() : null });
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  ok(res, { history: await careerService.getHistory(req.studentId!) });
});

export const generatePlan = asyncHandler(async (req: Request, res: Response) => {
  const plan = await careerService.generatePlan(req.studentId!, req.auth!.userId, req.body);
  created(res, { plan: plan.toJSON() });
});

export const recordProgress = asyncHandler(async (req: Request, res: Response) => {
  const plan = await careerService.recordProgress(req.studentId!, req.auth!.userId, req.body);
  ok(res, { plan: plan.toJSON() });
});
