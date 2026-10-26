import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/job.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { companyListQuery, jobListQuery, matchCompanySchema, matchJobSchema } from '../../validators';
import { idParam } from '../../validators/common.validator';

export const companyRouter = Router();
export const jobRouter = Router();

companyRouter.use(authenticate);
jobRouter.use(authenticate);

/* ---- Catalogue: readable by any signed-in user ---- */
companyRouter.get('/', validate({ query: companyListQuery }), controller.listCompanies);
companyRouter.get('/:id', validate({ params: idParam }), controller.getCompany);

jobRouter.get('/roles', controller.listRoles);
jobRouter.get('/descriptions', validate({ query: jobListQuery }), controller.listJobDescriptions);

/* ---- Matching: students only, and AI-rate-limited (§9) ---- */
const student = [authorize(UserRole.STUDENT), requireStudentProfile, aiLimiter] as const;

jobRouter.post('/match', ...student, validate({ body: matchJobSchema }), controller.matchJob);
jobRouter.post('/match/company', ...student, validate({ body: matchCompanySchema }), controller.matchCompany);
