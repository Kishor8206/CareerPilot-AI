import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/resume.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter, uploadLimiter } from '../../middleware/rateLimit';
import { uploadJobDescription, uploadResume } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import { analyzeResumeSchema } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const resumeRouter = Router();

resumeRouter.use(authenticate);

/* ---- Student-owned operations ---- */
const student = [authorize(UserRole.STUDENT), requireStudentProfile] as const;

resumeRouter.post('/upload', ...student, uploadLimiter, uploadResume, controller.upload);
resumeRouter.post('/jd/extract', ...student, uploadLimiter, uploadJobDescription, controller.extractJobDescription);
resumeRouter.get('/', ...student, controller.list);
resumeRouter.get('/analysis/latest', ...student, controller.latestAnalysis);
resumeRouter.get('/analysis/history', ...student, controller.history);

resumeRouter.post(
  '/:id/analyze',
  ...student,
  aiLimiter,
  validate({ params: idParam, body: analyzeResumeSchema }),
  controller.analyze,
);
resumeRouter.put('/:id/primary', ...student, validate({ params: idParam }), controller.setPrimary);
resumeRouter.delete('/:id', ...student, validate({ params: idParam }), controller.remove);

/* ---- Readable by the owner or by staff ---- */
resumeRouter.get('/analysis/:id', requireStudentProfileIfStudent, validate({ params: idParam }), controller.getAnalysis);
resumeRouter.get('/:id/download', requireStudentProfileIfStudent, validate({ params: idParam }), controller.download);

/**
 * Resolves the student profile for a student caller, but lets staff through
 * without one. The controllers then apply the ownership check themselves.
 */
function requireStudentProfileIfStudent(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (req.auth?.role === UserRole.STUDENT) {
    return requireStudentProfile(req, res, next);
  }
  return next();
}
