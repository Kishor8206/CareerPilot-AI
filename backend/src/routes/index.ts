import { Router } from 'express';
import { adminRouter } from './v1/admin.routes';
import { analyticsRouter } from './v1/analytics.routes';
import { assessmentRouter } from './v1/assessment.routes';
import { authRouter } from './v1/auth.routes';
import { codingRouter } from './v1/coding.routes';
import { companyRouter, jobRouter } from './v1/job.routes';
import { interviewRouter } from './v1/interview.routes';
import { alumniRouter, mentorshipRouter } from './v1/mentorship.routes';
import { notificationRouter, privacyRouter } from './v1/misc.routes';
import { careerRouter } from './v1/career.routes';
import { readinessRouter, recommendationRouter } from './v1/readiness.routes';
import { reportRouter } from './v1/report.routes';
import { resumeRouter } from './v1/resume.routes';
import { speechRouter } from './v1/speech.routes';
import { studentRouter } from './v1/student.routes';

/**
 * Versioned API router (§33), mounted at `env.API_PREFIX` (default `/api/v1`).
 * Adding `/api/v2` later means adding a sibling builder and leaving v1 intact.
 */
export function buildApiRouter(): Router {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/students', studentRouter);
  router.use('/resumes', resumeRouter);
  router.use('/companies', companyRouter);
  router.use('/jobs', jobRouter);
  router.use('/assessments', assessmentRouter);
  router.use('/coding', codingRouter);
  router.use('/interviews', interviewRouter);
  router.use('/speech', speechRouter);
  router.use('/readiness', readinessRouter);
  router.use('/recommendations', recommendationRouter);
  router.use('/career', careerRouter);
  router.use('/alumni', alumniRouter);
  router.use('/mentorship', mentorshipRouter);
  router.use('/analytics', analyticsRouter);
  router.use('/reports', reportRouter);
  router.use('/notifications', notificationRouter);
  router.use('/privacy', privacyRouter);
  router.use('/admin', adminRouter);

  /** Endpoint index, useful during a review and for smoke-testing. */
  router.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        version: 'v1',
        endpoints: [
          '/auth', '/students', '/resumes', '/companies', '/jobs', '/assessments',
          '/coding', '/interviews', '/speech', '/readiness', '/recommendations',
          '/career', '/alumni', '/mentorship', '/analytics', '/reports', '/notifications',
          '/privacy', '/admin',
        ],
      },
    });
  });

  return router;
}
