import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import { z } from 'zod';
import * as controller from '../../controllers/readiness.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { idParam } from '../../validators/common.validator';

export const readinessRouter = Router();
export const recommendationRouter = Router();

readinessRouter.use(authenticate);
recommendationRouter.use(authenticate);

/**
 * Staff may pass `?studentId=` to view a specific student; the controller
 * enforces that a student may only ever read their own record.
 */
function studentOrStaff(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (req.auth?.role === UserRole.STUDENT) return requireStudentProfile(req, res, next);
  return next();
}

/* ---- Readiness (§6, §22) ---- */
readinessRouter.get('/', studentOrStaff, controller.getReadiness);
readinessRouter.get('/trend', studentOrStaff, controller.getTrend);
readinessRouter.get('/history', studentOrStaff, controller.getHistory);
readinessRouter.get('/skill-gaps', studentOrStaff, controller.getSkillGaps);
readinessRouter.get('/model-metrics', controller.getModelMetrics);

readinessRouter.post(
  '/recompute',
  authorize(UserRole.STUDENT),
  requireStudentProfile,
  aiLimiter,
  controller.recompute,
);

/* ---- Recommendations ---- */
recommendationRouter.get('/', studentOrStaff, controller.getRecommendations);
recommendationRouter.patch(
  '/:id',
  authorize(UserRole.STUDENT),
  requireStudentProfile,
  validate({ params: idParam, body: z.object({ status: z.enum(['COMPLETED', 'DISMISSED']) }) }),
  controller.updateRecommendation,
);
