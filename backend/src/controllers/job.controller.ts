import type { Request, Response } from 'express';
import * as jobService from '../services/job.service';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, ok, paginated } from '../utils/response';

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; search?: string; industry?: string; tier?: string };
  const { items, total } = await jobService.listCompanies(query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await jobService.getCompanyDetail(req.params.id));
});

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await jobService.listRoles((req.query as { search?: string }).search));
});

export const listJobDescriptions = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; companyId?: string; roleId?: string };
  const { items, total } = await jobService.listJobDescriptions(query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

/** Matches the signed-in student against one job description (§9). */
export const matchJob = asyncHandler(async (req: Request, res: Response) => {
  const result = await jobService.matchStudentToJob(req.studentId!, req.body.jobDescriptionId, req.auth!.userId);
  ok(res, result);
});

/** Matches the student against every open role at one company. */
export const matchCompany = asyncHandler(async (req: Request, res: Response) => {
  const results = await jobService.matchStudentToCompany(req.studentId!, req.body.companyId, req.auth!.userId);
  ok(res, { matches: results, bestMatch: results[0] ?? null });
});
