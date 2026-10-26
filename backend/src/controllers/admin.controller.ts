import type { Request, Response } from 'express';
import { UserRole } from '@careerpilot/shared';
import { AIInteraction } from '../models/AIInteraction';
import { Company } from '../models/Company';
import { JobDescription } from '../models/JobDescription';
import { JobRole } from '../models/JobRole';
import { RAGDocument } from '../models/RAGDocument';
import { SystemConfiguration } from '../models/SystemConfiguration';
import { User } from '../models/User';
import * as adminService from '../services/admin.service';
import { aiClient } from '../services/aiClient.service';
import { AuditAction, audit } from '../services/audit.service';
import { configService } from '../services/config.service';
import { notifyMany } from '../services/notification.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, created, noContent, ok, paginated } from '../utils/response';
import { slugify } from '../utils/helpers';

export const dashboard = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await adminService.getAdminDashboard());
});

/* ---- Users ---- */

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as { page: number; limit: number; role?: UserRole; status?: string; search?: string };
  const { items, total } = await adminService.listUsers(query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

export const changeRole = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminService.changeUserRole(req.params.id, req.body.role, req.auth!.userId);
  await audit(
    { action: AuditAction.USER_ROLE_CHANGE, resource: 'User', resourceId: req.params.id, metadata: { role: req.body.role } },
    req,
  );
  ok(res, user.toJSON());
});

export const changeStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await adminService.changeUserStatus(req.params.id, req.body.status, req.auth!.userId);
  await audit(
    { action: AuditAction.USER_STATUS_CHANGE, resource: 'User', resourceId: req.params.id, metadata: { status: req.body.status } },
    req,
  );
  ok(res, user.toJSON());
});

/* ---- Alumni verification (§18) ---- */

export const listAlumniForVerification = asyncHandler(async (req: Request, res: Response) => {
  const { AlumniProfile } = await import('../models/AlumniProfile');
  const status = (req.query.status as string) || 'PENDING';

  const items = await AlumniProfile.find({ verificationStatus: status })
    .populate<{ userId: { fullName: string; email: string; createdAt: Date } }>('userId', 'fullName email createdAt')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  ok(res, items);
});

export const verifyAlumni = asyncHandler(async (req: Request, res: Response) => {
  const alumni = await adminService.setAlumniVerification(req.params.id, req.auth!.userId, {
    status: req.body.status,
    note: req.body.note,
  });

  await audit(
    {
      action: req.body.status === 'VERIFIED' ? AuditAction.ALUMNI_VERIFY : AuditAction.ALUMNI_REJECT,
      resource: 'AlumniProfile',
      resourceId: req.params.id,
      metadata: { status: req.body.status, note: req.body.note },
    },
    req,
  );

  ok(res, alumni.toJSON());
});

/* ---- Catalogue: companies, roles, job descriptions ---- */

export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.create({ ...req.body, slug: slugify(req.body.name), provenance: 'REAL' });
  await audit({ action: 'admin.company.create', resource: 'Company', resourceId: company._id.toString() }, req);
  created(res, company.toJSON());
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const company = await Company.findByIdAndUpdate(
    req.params.id,
    { $set: { ...req.body, ...(req.body.name ? { slug: slugify(req.body.name) } : {}) } },
    { new: true, runValidators: true },
  );
  if (!company) throw ApiError.notFound('Company');
  await audit({ action: 'admin.company.update', resource: 'Company', resourceId: req.params.id }, req);
  ok(res, company.toJSON());
});

export const createJobRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await JobRole.create({ ...req.body, slug: slugify(req.body.title), provenance: 'REAL' });
  await audit({ action: 'admin.role.create', resource: 'JobRole', resourceId: role._id.toString() }, req);
  created(res, role.toJSON());
});

export const updateJobRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await JobRole.findByIdAndUpdate(
    req.params.id,
    { $set: { ...req.body, ...(req.body.title ? { slug: slugify(req.body.title) } : {}) } },
    { new: true, runValidators: true },
  );
  if (!role) throw ApiError.notFound('Job role');
  ok(res, role.toJSON());
});

export const createJobDescription = asyncHandler(async (req: Request, res: Response) => {
  // Derive ATS keywords at ingestion so the matcher does not recompute per query.
  const atsKeywords = [...new Set([...req.body.requiredSkills, ...req.body.preferredSkills])];

  const jd = await JobDescription.create({
    ...req.body,
    atsKeywords,
    provenance: 'REAL',
    createdBy: req.auth!.userId,
  });

  await audit({ action: 'admin.jd.create', resource: 'JobDescription', resourceId: jd._id.toString() }, req);
  created(res, jd.toJSON());
});

export const updateJobDescription = asyncHandler(async (req: Request, res: Response) => {
  const update: Record<string, unknown> = { ...req.body };
  if (req.body.requiredSkills || req.body.preferredSkills) {
    update.atsKeywords = [...new Set([...(req.body.requiredSkills ?? []), ...(req.body.preferredSkills ?? [])])];
  }

  const jd = await JobDescription.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!jd) throw ApiError.notFound('Job description');
  ok(res, jd.toJSON());
});

/* ---- Knowledge base / RAG (§10) ---- */

export const listRagDocuments = asyncHandler(async (req: Request, res: Response) => {
  const documents = await RAGDocument.find()
    .select('-content')
    .populate<{ companyId: { name: string } }>('companyId', 'name')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();

  const stats = await aiClient.get<Record<string, unknown>>('/ai/rag/stats').catch(() => null);
  ok(res, { documents, vectorStore: stats });
});

export const getRagDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await RAGDocument.findById(req.params.id).lean();
  if (!document) throw ApiError.notFound('Knowledge base document');
  ok(res, document);
});

/**
 * Creates or updates a knowledge-base document and indexes it immediately, so
 * the vector store never lags behind what an admin just saved.
 */
export const upsertRagDocument = asyncHandler(async (req: Request, res: Response) => {
  const payload = { ...req.body, provenance: 'REAL', createdBy: req.auth!.userId };

  const document = req.params.id
    ? await RAGDocument.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true })
    : await RAGDocument.create(payload);

  if (!document) throw ApiError.notFound('Knowledge base document');

  let indexed: Record<string, unknown> | null = null;
  try {
    const result = await aiClient.post<Record<string, unknown>, { chunkCount: number }>(
      '/ai/rag/ingest',
      {
        documentId: document._id.toString(),
        title: document.title,
        content: document.content,
        category: document.category,
        companyId: document.companyId?.toString(),
        roleId: document.roleId?.toString(),
        tags: document.tags,
        provenance: document.provenance,
        sourceUrls: document.sourceUrls,
      },
      { userId: req.auth!.userId, agent: 'RAG', operation: 'rag.ingest' },
    );
    indexed = result.data;
    document.chunkCount = result.data.chunkCount;
    document.indexedAt = new Date();
    await document.save();
  } catch (error) {
    // Saved but not indexed: report it honestly so the admin can re-index.
    await audit(
      { action: AuditAction.RAG_DOCUMENT_UPSERT, resource: 'RAGDocument', resourceId: document._id.toString(), status: 'FAILURE', metadata: { reason: (error as Error).message } },
      req,
    );
    ok(res, {
      document: document.toJSON(),
      indexed: null,
      warning: 'The document was saved but could not be indexed because the AI service is unavailable. Use "Re-index" once it is back.',
    });
    return;
  }

  await audit({ action: AuditAction.RAG_DOCUMENT_UPSERT, resource: 'RAGDocument', resourceId: document._id.toString() }, req);
  ok(res, { document: document.toJSON(), indexed });
});

export const deleteRagDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await RAGDocument.findByIdAndDelete(req.params.id);
  if (!document) throw ApiError.notFound('Knowledge base document');

  await aiClient
    .post(`/ai/rag/documents/${req.params.id}`, {}, { userId: req.auth!.userId, agent: 'RAG', operation: 'rag.delete' })
    .catch(() => null);

  await audit({ action: 'admin.rag.delete', resource: 'RAGDocument', resourceId: req.params.id }, req);
  noContent(res);
});

export const reindexKnowledgeBase = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.reindexKnowledgeBase(req.auth!.userId);
  await audit({ action: AuditAction.RAG_REINDEX, resource: 'RAGDocument', metadata: result as Record<string, unknown> }, req);
  ok(res, result);
});

export const queryKnowledgeBase = asyncHandler(async (req: Request, res: Response) => {
  const result = await aiClient.post<Record<string, unknown>, Record<string, unknown>>(
    '/ai/rag/query',
    req.body,
    { userId: req.auth!.userId, agent: 'RAG', operation: 'rag.query' },
  );
  ok(res, result.data);
});

/* ---- AI configuration & observability ---- */

export const listConfig = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await configService.listAll());
});

export const updateConfig = asyncHandler(async (req: Request, res: Response) => {
  const key = req.params.key;
  const existing = await SystemConfiguration.findOne({ key });

  if (!existing) throw ApiError.notFound(`Configuration key "${key}"`);
  if (!existing.editable) throw ApiError.forbidden('This configuration value is not editable at runtime.');

  // APIE weights must sum to 1, or every score silently shifts scale.
  if (key === 'apie.weights') {
    const value = req.body.value as Record<string, number>;
    const sum = Object.values(value).reduce((a, b) => a + Number(b), 0);
    if (Math.abs(sum - 1) > 0.001) {
      throw ApiError.badRequest(`APIE weights must sum to 1.0. The submitted weights sum to ${sum.toFixed(3)}.`);
    }
  }

  await configService.set(key, req.body.value, req.auth!.userId);
  await audit({ action: AuditAction.CONFIG_UPDATE, resource: 'SystemConfiguration', resourceId: key, metadata: { value: req.body.value } }, req);

  ok(res, await SystemConfiguration.findOne({ key }).lean());
});

export const aiUsage = asyncHandler(async (req: Request, res: Response) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days ?? 14)));
  const [usage, agents, health] = await Promise.all([
    adminService.getAiUsage(days),
    aiClient.get<Record<string, unknown>>('/ai/agents').catch(() => null),
    aiClient.health(),
  ]);
  ok(res, { usage, agents, health });
});

export const aiInteractions = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(100, Number(req.query.limit ?? 50));

  const filter: Record<string, unknown> = {};
  if (req.query.agent) filter.agent = req.query.agent;
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    AIInteraction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIInteraction.countDocuments(filter),
  ]);

  paginated(res, items, buildPaginationMeta(page, limit, total));
});

/* ---- Audit & moderation ---- */

export const auditLogs = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as Parameters<typeof adminService.listAuditLogs>[0];
  const { items, total } = await adminService.listAuditLogs(query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

export const flaggedContent = asyncHandler(async (_req: Request, res: Response) => {
  ok(res, await adminService.listFlaggedContent());
});

export const reviewIntegrity = asyncHandler(async (req: Request, res: Response) => {
  const attempt = await adminService.reviewAttemptIntegrity(
    req.params.id,
    req.auth!.userId,
    req.body.note,
    req.body.clear,
  );

  await audit(
    { action: AuditAction.MONITORING_REVIEW, resource: 'AssessmentAttempt', resourceId: req.params.id, metadata: { cleared: req.body.clear } },
    req,
  );

  ok(res, attempt.toJSON());
});

/* ---- Announcements ---- */

export const announce = asyncHandler(async (req: Request, res: Response) => {
  const users = await User.find({ role: { $in: req.body.roles }, status: 'ACTIVE' }).select('_id').lean();

  const sent = await notifyMany(
    users.map((u) => u._id),
    {
      type: 'ANNOUNCEMENT',
      title: req.body.title,
      body: req.body.body,
      link: req.body.link,
      sendEmailToo: req.body.sendEmail,
    },
  );

  await audit({ action: 'admin.announcement', resource: 'Notification', metadata: { recipients: sent, roles: req.body.roles } }, req);
  ok(res, { recipients: sent });
});
