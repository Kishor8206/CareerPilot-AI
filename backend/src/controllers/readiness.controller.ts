import type { Request, Response } from 'express';
import { UserRole } from '@careerpilot/shared';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { Recommendation } from '../models/Recommendation';
import { SkillGap } from '../models/SkillGap';
import { StudentProfile } from '../models/StudentProfile';
import * as apieService from '../services/apie.service';
import { AuditAction, audit } from '../services/audit.service';
import { aiClient } from '../services/aiClient.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

/** Resolves which student the caller may read: themselves, or any for staff. */
async function resolveStudentId(req: Request) {
  const requested = (req.query.studentId as string | undefined) ?? (req.params.studentId as string | undefined);
  if (!requested) return req.studentId!;

  const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
  if (!staff.includes(req.auth!.role) && requested !== req.studentId?.toString()) {
    throw ApiError.forbidden('You can only view your own readiness.');
  }

  const profile = await StudentProfile.findById(requested).select('_id');
  if (!profile) throw ApiError.notFound('Student profile');

  if (staff.includes(req.auth!.role)) {
    await audit({ action: AuditAction.STUDENT_RECORD_ACCESS, resource: 'PlacementReadiness', resourceId: requested }, req);
  }
  return profile._id;
}

export const getReadiness = asyncHandler(async (req: Request, res: Response) => {
  const studentId = await resolveStudentId(req);
  const readiness = await apieService.getLatestReadiness(studentId);

  if (!readiness) {
    ok(res, {
      readiness: null,
      message:
        'No readiness score yet. Upload your resume or complete an assessment, and your Placement Readiness ' +
        'Score will be computed automatically.',
    });
    return;
  }

  const [gaps, recommendations] = await Promise.all([
    SkillGap.find({ studentId, resolved: false }).sort({ severity: 1, gap: -1 }).lean(),
    Recommendation.find({ studentId, status: 'ACTIVE' }).sort({ priority: 1 }).lean(),
  ]);

  ok(res, { readiness, skillGaps: gaps, recommendations });
});

/** Forces a recomputation. Rate-limited by the AI limiter on the route. */
export const recompute = asyncHandler(async (req: Request, res: Response) => {
  const result = await apieService.recomputeReadiness(req.studentId!, 'MANUAL');

  if (!result) {
    throw ApiError.serviceUnavailable(
      'Readiness could not be recomputed because the AI service is unavailable. Your existing score is unchanged.',
    );
  }

  await audit({ action: AuditAction.READINESS_COMPUTE, resource: 'PlacementReadiness', metadata: { score: result.score } }, req);
  ok(res, result);
});

export const getTrend = asyncHandler(async (req: Request, res: Response) => {
  const studentId = await resolveStudentId(req);
  ok(res, await apieService.getReadinessTrend(studentId, 30));
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const studentId = await resolveStudentId(req);
  const history = await PlacementReadiness.find({ studentId })
    .sort({ computedAt: -1 })
    .limit(50)
    .select('score band computedAt trigger delta mlPrediction')
    .lean();
  ok(res, history);
});

export const getSkillGaps = asyncHandler(async (req: Request, res: Response) => {
  const studentId = await resolveStudentId(req);
  const includeResolved = req.query.includeResolved === 'true';
  const filter: Record<string, unknown> = { studentId };
  if (!includeResolved) filter.resolved = false;

  ok(res, await SkillGap.find(filter).sort({ resolved: 1, severity: 1, gap: -1 }).lean());
});

export const getRecommendations = asyncHandler(async (req: Request, res: Response) => {
  const studentId = await resolveStudentId(req);
  ok(res, await Recommendation.find({ studentId, status: 'ACTIVE' }).sort({ priority: 1, createdAt: -1 }).lean());
});

export const updateRecommendation = asyncHandler(async (req: Request, res: Response) => {
  const status = req.body.status as 'COMPLETED' | 'DISMISSED';

  const recommendation = await Recommendation.findOneAndUpdate(
    { _id: req.params.id, studentId: req.studentId },
    { $set: { status, completedAt: status === 'COMPLETED' ? new Date() : null } },
    { new: true },
  );

  if (!recommendation) throw ApiError.notFound('Recommendation');
  ok(res, recommendation.toJSON());
});

/** ML model metrics, always labelled with the dataset provenance (§7, §42). */
export const getModelMetrics = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await aiClient.get<Record<string, unknown>>('/ai/ml/metrics');
  ok(res, metrics);
});
