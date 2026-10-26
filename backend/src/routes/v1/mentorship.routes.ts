import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import * as controller from '../../controllers/mentorship.controller';
import { authenticate, authorize, requireAlumniProfile, requireStudentProfile } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import {
  alumniFeedbackSchema,
  alumniSearchQuery,
  mentorshipRequestSchema,
  rateMentorSchema,
  respondRequestSchema,
  sessionNotesSchema,
  updateAlumniProfileSchema,
} from '../../validators';
import { idParam } from '../../validators/common.validator';

export const alumniRouter = Router();
export const mentorshipRouter = Router();

alumniRouter.use(authenticate);
mentorshipRouter.use(authenticate);

/* ------------------------------------------------------------------ */
/* Alumni discovery - students search VERIFIED mentors only (§18)      */
/* ------------------------------------------------------------------ */

alumniRouter.get('/search', validate({ query: alumniSearchQuery }), controller.searchAlumni);
alumniRouter.get(
  '/recommended',
  authorize(UserRole.STUDENT),
  requireStudentProfile,
  aiLimiter,
  controller.recommendMentors,
);

/* ---- Alumni's own account ---- */
// `mustBeVerified: false` so an unverified alumnus can still see and complete
// their own profile - otherwise verification would be impossible to achieve.
alumniRouter.get('/me', authorize(UserRole.ALUMNI), controller.getMyAlumniProfile);
alumniRouter.patch(
  '/me',
  authorize(UserRole.ALUMNI),
  validate({ body: updateAlumniProfileSchema }),
  controller.updateMyAlumniProfile,
);

const verifiedAlumni = [authorize(UserRole.ALUMNI), requireAlumniProfile({ mustBeVerified: true })] as const;

alumniRouter.get('/dashboard', ...verifiedAlumni, controller.alumniDashboard);
alumniRouter.get('/requests', ...verifiedAlumni, controller.alumniRequests);
alumniRouter.post(
  '/requests/:id/respond',
  ...verifiedAlumni,
  validate({ params: idParam, body: respondRequestSchema }),
  controller.respondToRequest,
);
alumniRouter.get('/sessions', ...verifiedAlumni, controller.alumniSessions);
alumniRouter.post(
  '/sessions/:id/feedback',
  ...verifiedAlumni,
  validate({ params: idParam, body: alumniFeedbackSchema }),
  controller.submitFeedback,
);
alumniRouter.get('/feedback', ...verifiedAlumni, controller.alumniFeedbackHistory);

// Kept last so it does not shadow `/me`, `/search`, `/dashboard`.
alumniRouter.get('/:id', validate({ params: idParam }), controller.getAlumniProfile);

/* ------------------------------------------------------------------ */
/* Mentorship - student side                                           */
/* ------------------------------------------------------------------ */

const student = [authorize(UserRole.STUDENT), requireStudentProfile] as const;

mentorshipRouter.post('/request', ...student, validate({ body: mentorshipRequestSchema }), controller.requestMentorship);
mentorshipRouter.get('/requests', ...student, controller.myRequests);
mentorshipRouter.get('/sessions', ...student, controller.mySessions);
mentorshipRouter.get('/feedback', ...student, controller.myFeedback);
mentorshipRouter.post(
  '/sessions/:id/rate',
  ...student,
  validate({ params: idParam, body: rateMentorSchema }),
  controller.rateMentor,
);

/* ---- Live interview room: both participants (§19) ---- */
mentorshipRouter.get('/sessions/:id/room', validate({ params: idParam }), controller.getSessionRoom);
mentorshipRouter.put(
  '/sessions/:id/notes',
  validate({ params: idParam, body: sessionNotesSchema }),
  controller.updateSessionNotes,
);
mentorshipRouter.post('/sessions/:id/end', validate({ params: idParam }), controller.endSession);
