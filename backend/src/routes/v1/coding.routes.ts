import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/coding.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter, codeRunLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { codingListQuery, runCodeSchema, submissionListQuery } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const codingRouter = Router();

codingRouter.use(authenticate);

const student = [authorize(UserRole.STUDENT), requireStudentProfile] as const;

codingRouter.get('/problems', ...student, validate({ query: codingListQuery }), controller.listProblems);
codingRouter.get('/problems/:id', ...student, validate({ params: idParam }), controller.getProblem);
codingRouter.get('/sandbox', ...student, controller.sandboxStatus);

// "Run" judges the public test cases only; nothing is scored or stored.
codingRouter.post(
  '/problems/:id/run',
  ...student,
  codeRunLimiter,
  validate({ params: idParam, body: runCodeSchema }),
  controller.runCode,
);

// "Submit" judges public and hidden tests, stores the result and updates
// readiness. The AI limiter also applies because a submit requests an
// advisory static review after the verdict is final.
codingRouter.post(
  '/problems/:id/submit',
  ...student,
  codeRunLimiter,
  aiLimiter,
  validate({ params: idParam, body: runCodeSchema }),
  controller.submitCode,
);

codingRouter.get('/submissions', ...student, validate({ query: submissionListQuery }), controller.listSubmissions);
codingRouter.get('/progress', ...student, controller.progress);
codingRouter.get('/performance', ...student, controller.performance);
