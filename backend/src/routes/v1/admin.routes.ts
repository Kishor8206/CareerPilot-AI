import { Router } from 'express';
import { UserRole } from '@careerpilot/shared';
import { z } from 'zod';
import * as controller from '../../controllers/admin.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { aiLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import {
  announcementSchema,
  auditQuery,
  changeRoleSchema,
  changeStatusSchema,
  companySchema,
  configUpdateSchema,
  jobDescriptionSchema,
  jobRoleSchema,
  ragDocumentSchema,
  ragQuerySchema,
  reviewIntegritySchema,
  userListQuery,
  verifyAlumniSchema,
} from '../../validators';
import { idParam } from '../../validators/common.validator';

export const adminRouter = Router();

// Every route here is administrator-only.
adminRouter.use(authenticate, authorize(UserRole.ADMIN));

/* ---- Dashboard (§24) ---- */
adminRouter.get('/dashboard', controller.dashboard);

/* ---- Users ---- */
adminRouter.get('/users', validate({ query: userListQuery }), controller.listUsers);
adminRouter.patch('/users/:id/role', validate({ params: idParam, body: changeRoleSchema }), controller.changeRole);
adminRouter.patch('/users/:id/status', validate({ params: idParam, body: changeStatusSchema }), controller.changeStatus);

/* ---- Alumni verification (§18) ---- */
adminRouter.get('/alumni', controller.listAlumniForVerification);
adminRouter.post('/alumni/:id/verify', validate({ params: idParam, body: verifyAlumniSchema }), controller.verifyAlumni);

/* ---- Catalogue ---- */
adminRouter.post('/companies', validate({ body: companySchema }), controller.createCompany);
adminRouter.patch('/companies/:id', validate({ params: idParam, body: companySchema.partial() }), controller.updateCompany);

adminRouter.post('/roles', validate({ body: jobRoleSchema }), controller.createJobRole);
adminRouter.patch('/roles/:id', validate({ params: idParam, body: jobRoleSchema.partial() }), controller.updateJobRole);

adminRouter.post('/jobs', validate({ body: jobDescriptionSchema }), controller.createJobDescription);
adminRouter.patch('/jobs/:id', validate({ params: idParam, body: jobDescriptionSchema.partial() }), controller.updateJobDescription);

/* ---- Knowledge base / RAG (§10) ---- */
adminRouter.get('/rag', controller.listRagDocuments);
adminRouter.get('/rag/:id', validate({ params: idParam }), controller.getRagDocument);
adminRouter.post('/rag', validate({ body: ragDocumentSchema }), controller.upsertRagDocument);
adminRouter.put('/rag/:id', validate({ params: idParam, body: ragDocumentSchema }), controller.upsertRagDocument);
adminRouter.delete('/rag/:id', validate({ params: idParam }), controller.deleteRagDocument);
adminRouter.post('/rag/reindex', controller.reindexKnowledgeBase);
adminRouter.post('/rag/query', aiLimiter, validate({ body: ragQuerySchema }), controller.queryKnowledgeBase);

/* ---- AI configuration & observability ---- */
adminRouter.get('/config', controller.listConfig);
adminRouter.put(
  '/config/:key',
  validate({ params: z.object({ key: z.string().max(80) }), body: configUpdateSchema }),
  controller.updateConfig,
);
adminRouter.get('/ai/usage', controller.aiUsage);
adminRouter.get('/ai/interactions', controller.aiInteractions);

/* ---- Audit & moderation ---- */
adminRouter.get('/audit', validate({ query: auditQuery }), controller.auditLogs);
adminRouter.get('/flagged', controller.flaggedContent);
adminRouter.post(
  '/flagged/attempts/:id/review',
  validate({ params: idParam, body: reviewIntegritySchema }),
  controller.reviewIntegrity,
);

/* ---- Announcements ---- */
adminRouter.post('/announce', validate({ body: announcementSchema }), controller.announce);
