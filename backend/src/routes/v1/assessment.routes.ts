import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/assessment.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { assessmentListQuery, autosaveSchema, monitoringBatchSchema, startAttemptSchema } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const assessmentRouter = Router();

assessmentRouter.use(authenticate);

const student = [authorize(UserRole.STUDENT), requireStudentProfile] as const;

assessmentRouter.get('/', ...student, validate({ query: assessmentListQuery }), controller.listAssessments);
assessmentRouter.get('/attempts', ...student, controller.listAttempts);

assessmentRouter.post(
  '/:id/start',
  ...student,
  validate({ params: idParam, body: startAttemptSchema }),
  controller.startAttempt,
);

/* ---- In-progress attempt: recovery, autosave, monitoring, submit (§13) ---- */
assessmentRouter.get('/attempts/:id', ...student, validate({ params: idParam }), controller.getAttempt);

// Autosave is deliberately unthrottled: dropping a save to protect the server
// would cost the student their answers, which is the wrong trade.
assessmentRouter.put('/attempts/:id/autosave', ...student, validate({ params: idParam, body: autosaveSchema }), controller.autosave);

assessmentRouter.post('/attempts/:id/submit', ...student, validate({ params: idParam }), controller.submitAttempt);
assessmentRouter.get('/attempts/:id/result', ...student, validate({ params: idParam }), controller.getResult);

assessmentRouter.post(
  '/attempts/:id/monitoring',
  ...student,
  validate({ params: idParam, body: monitoringBatchSchema }),
  controller.recordMonitoring,
);

// Readable by the student (transparency, §30) and by staff for review (§14).
assessmentRouter.get('/attempts/:id/integrity', validate({ params: idParam }), requireStudentProfileIfStudent, controller.getIntegrity);

function requireStudentProfileIfStudent(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  if (req.auth?.role === UserRole.STUDENT) return requireStudentProfile(req, res, next);
  return next();
}
