import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/student.controller';
import { authenticate, authorize, requireStudentProfile } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParam } from '../../validators/common.validator';
import { setTargetsSchema, studentListQuery, updateProfileSchema } from '../../validators/student.validator';

export const studentRouter = Router();

studentRouter.use(authenticate);

/* ---- Student's own profile ---- */
studentRouter.get('/me', authorize(UserRole.STUDENT), controller.getMyProfile);
studentRouter.patch('/me', authorize(UserRole.STUDENT), validate({ body: updateProfileSchema }), controller.updateMyProfile);
studentRouter.put('/me/targets', authorize(UserRole.STUDENT), validate({ body: setTargetsSchema }), controller.setTargets);
studentRouter.get('/me/dashboard', authorize(UserRole.STUDENT), requireStudentProfile, controller.getDashboard);

/* ---- Staff: cohort listing (§23) ---- */
studentRouter.get(
  '/',
  authorize(UserRole.PLACEMENT_OFFICER, UserRole.ADMIN),
  validate({ query: studentListQuery }),
  controller.listStudents,
);

// Kept last so it does not shadow the literal `/me` routes above.
studentRouter.get('/:id', validate({ params: idParam }), controller.getStudentById);
