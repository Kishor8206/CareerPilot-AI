import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/interview.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { startInterviewSchema, submitAnswerSchema } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const interviewRouter = Router();

interviewRouter.use(authenticate);

const student = [authorize(UserRole.STUDENT), requireStudentProfile] as const;

// Every interview turn calls the AI service twice (evaluate + generate), so the
// AI limiter guards the whole surface.
interviewRouter.post('/start', ...student, aiLimiter, validate({ body: startInterviewSchema }), controller.start);
interviewRouter.get('/sessions', ...student, controller.listSessions);
interviewRouter.get('/sessions/:id', ...student, validate({ params: idParam }), controller.getSession);

interviewRouter.post(
  '/sessions/:id/answer',
  ...student,
  aiLimiter,
  validate({ params: idParam, body: submitAnswerSchema }),
  controller.submitAnswer,
);

interviewRouter.post('/sessions/:id/end', ...student, validate({ params: idParam }), controller.end);
interviewRouter.get('/sessions/:id/report', ...student, validate({ params: idParam }), controller.getReport);
