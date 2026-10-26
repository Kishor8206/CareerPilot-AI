import type { Request, Response } from 'express';
import * as codingService from '../services/coding.service';
import { codeExecutor } from '../services/codeExecution.service';
import { recomputeReadiness } from '../services/apie.service';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, ok, paginated } from '../utils/response';

export const listProblems = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as codingService.ProblemFilters;
  const { items, total } = await codingService.listProblems(query, req.studentId);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

export const getProblem = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await codingService.getProblem(req.params.id));
});

/** Whether the sandbox can run code right now, so the UI can say so up front. */
export const sandboxStatus = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await codeExecutor.status());
});

/** "Run": executes the public test cases only. Nothing is scored or stored. */
export const runCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await codingService.runCode({
    problemId: req.params.id,
    studentId: req.studentId!,
    userId: req.auth!.userId,
    language: req.body.language,
    code: req.body.code,
  });
  ok(res, result);
});

/** "Submit": judges against public and hidden tests, stores the result, updates readiness. */
export const submitCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await codingService.submitCode({
    problemId: req.params.id,
    studentId: req.studentId!,
    userId: req.auth!.userId,
    language: req.body.language,
    code: req.body.code,
    attemptId: req.body.attemptId,
  });

  // Readiness only moves when the code really ran. A submission the sandbox
  // could not execute says nothing about the student.
  let readiness = null;
  if (result.execution.executed) {
    readiness = await recomputeReadiness(req.studentId!, 'CODING_SUBMITTED').catch(() => null);
  }

  ok(res, { ...result, readiness });
});

export const listSubmissions = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await codingService.listSubmissions(req.studentId!, req.query.problemId as string | undefined));
});

export const progress = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await codingService.dsaProgress(req.studentId!));
});

export const performance = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await codingService.codingPerformance(req.studentId!));
});
