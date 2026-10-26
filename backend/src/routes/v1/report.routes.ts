import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/report.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { reportQuery } from '../../validators';
import { objectId } from '../../validators/common.validator';
import { z } from 'zod';

export const reportRouter = Router();

reportRouter.use(authenticate);

reportRouter.get('/', controller.availableReports);

/* ---- Institutional reports (§26). Declared before the `:type` route ---- */
reportRouter.get(
  '/institution/:type',
  authorize(UserRole.PLACEMENT_OFFICER, UserRole.ADMIN),
  controller.downloadInstitutionReport,
);

reportRouter.get(
  '/student/:studentId/performance',
  authorize(UserRole.PLACEMENT_OFFICER, UserRole.ADMIN),
  validate({ params: z.object({ studentId: objectId }) }),
  controller.downloadStudentPerformance,
);

/**
 * Student report download. Staff may add `?studentId=` to fetch another
 * student's report; the controller enforces that permission.
 */
reportRouter.get(
  '/:type',
  (req, res, next) => (req.auth?.role === UserRole.STUDENT ? requireStudentProfile(req, res, next) : next()),
  validate({ query: reportQuery }),
  controller.downloadStudentReport,
);
