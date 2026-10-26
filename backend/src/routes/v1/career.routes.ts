import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import { z } from 'zod';
import * as controller from '../../controllers/career.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';

/**
 * Career roadmap intelligence: skill gaps, phased roadmap, study plan,
 * projects, interview preparation and verified learning resources.
 *
 * Students only, and always for their own profile. Separate from the ATS
 * routes; an ATS result is only ever passed in as context.
 */
export const careerRouter = Router();

careerRouter.use(authenticate, authorize(UserRole.STUDENT), requireStudentProfile);

const level = z.enum(['beginner', 'intermediate', 'advanced']);

const generateSchema = z.object({
  targetRole: z.string().trim().min(2).max(120),
  hoursPerDay: z.coerce.number().min(0.5).max(12),
  daysPerWeek: z.coerce.number().int().min(1).max(7),
  deadlineWeeks: z.coerce.number().int().min(1).max(104).nullish(),
  experienceLevel: z.enum(['STUDENT', 'FRESH_GRADUATE', 'ENTRY_LEVEL', 'MID_LEVEL', 'CAREER_SWITCHER']).default('STUDENT'),
  learningStyle: z.enum(['video', 'reading', 'hands-on', 'course']).nullish(),
  skills: z.array(z.object({ skill: z.string().trim().min(1).max(80), level })).max(60).optional(),
  useAts: z.boolean().default(true),
});

const progressSchema = z
  .object({
    completedSkills: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
    completedProjects: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
  })
  .refine((v) => (v.completedSkills?.length ?? 0) + (v.completedProjects?.length ?? 0) > 0, {
    message: 'Provide at least one completed skill or project.',
  });

careerRouter.get('/catalogue', controller.getCatalogue);
careerRouter.get('/plan', controller.getPlan);
careerRouter.get('/history', controller.getHistory);
careerRouter.post('/plan', aiLimiter, validate({ body: generateSchema }), controller.generatePlan);
careerRouter.post('/progress', aiLimiter, validate({ body: progressSchema }), controller.recordProgress);
