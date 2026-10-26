import { AccountStatus, AgentName, NotificationType, UserRole, VerificationStatus } from '@careerpilot/shared';
import type { AdminDashboardDto } from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { env } from '../config/env';
import { databaseInfo, pingDatabase } from '../config/database';
import { metrics } from '../middleware/requestContext';
import { AIInteraction } from '../models/AIInteraction';
import { AlumniProfile } from '../models/AlumniProfile';
import { Assessment } from '../models/Assessment';
import { AssessmentAttempt } from '../models/AssessmentAttempt';
import { AuditLog } from '../models/AuditLog';
import { CodingProblem } from '../models/CodingProblem';
import { Company } from '../models/Company';
import { JobDescription } from '../models/JobDescription';
import { JobRole } from '../models/JobRole';
import { MonitoringEvent } from '../models/MonitoringEvent';
import { RAGDocument } from '../models/RAGDocument';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { round } from '../utils/helpers';
import { aiClient } from './aiClient.service';
import { connectedUserCount } from '../sockets/emitter';
import { notify } from './notification.service';

const log = moduleLogger('admin');

/** Aggregated admin dashboard (§24) in a single round trip. */
export async function getAdminDashboard(): Promise<AdminDashboardDto> {
  const now = Date.now();
  const last7Days = new Date(now - 7 * 86_400_000);
  const last24h = new Date(now - 86_400_000);
  const last30Days = new Date(now - 30 * 86_400_000);

  const [
    usersByRole,
    activeUsers,
    newUsers,
    alumniByStatus,
    counts,
    aiTotals,
    aiRecent,
    aiByAgent,
    audit,
    highRiskAttempts,
    unreviewedEvents,
    dbPing,
    aiHealth,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    User.countDocuments({ lastLoginAt: { $gte: last7Days } }),
    User.countDocuments({ createdAt: { $gte: last30Days } }),
    AlumniProfile.aggregate([{ $group: { _id: '$verificationStatus', count: { $sum: 1 } } }]),
    Promise.all([
      Company.countDocuments(),
      JobRole.countDocuments(),
      JobDescription.countDocuments(),
      CodingProblem.countDocuments(),
      Assessment.countDocuments(),
      RAGDocument.countDocuments(),
    ]),
    AIInteraction.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    AIInteraction.countDocuments({ createdAt: { $gte: last24h } }),
    AIInteraction.aggregate([
      { $group: { _id: '$agent', count: { $sum: 1 }, avgLatencyMs: { $avg: '$latencyMs' }, failures: { $sum: { $cond: [{ $ne: ['$status', 'SUCCESS'] }, 1, 0] } } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    AuditLog.find().sort({ createdAt: -1 }).limit(25).lean(),
    AssessmentAttempt.countDocuments({ integrityRisk: 'HIGH', integrityReviewedBy: null }),
    MonitoringEvent.countDocuments({ severity: { $in: ['MEDIUM', 'HIGH'] }, reviewed: false }),
    pingDatabase(),
    aiClient.health(),
  ]);

  const roleMap = Object.fromEntries(usersByRole.map((r) => [String(r._id), r.count as number]));
  const alumniMap = Object.fromEntries(alumniByStatus.map((a) => [String(a._id), a.count as number]));
  const statusMap = Object.fromEntries(aiTotals.map((s) => [String(s._id), s.count as number]));

  const totalAi = Object.values(statusMap).reduce((a, b) => a + b, 0);
  const failedAi = (statusMap.FAILED ?? 0) + (statusMap.VALIDATION_ERROR ?? 0);

  return {
    users: {
      total: Object.values(roleMap).reduce((a, b) => a + b, 0),
      byRole: roleMap,
      activeLast7Days: activeUsers,
      newLast30Days: newUsers,
    },
    alumni: {
      total: Object.values(alumniMap).reduce((a, b) => a + b, 0),
      verified: alumniMap[VerificationStatus.VERIFIED] ?? 0,
      pending: alumniMap[VerificationStatus.PENDING] ?? 0,
      rejected: alumniMap[VerificationStatus.REJECTED] ?? 0,
    },
    catalog: {
      companies: counts[0],
      jobRoles: counts[1],
      jobDescriptions: counts[2],
      codingProblems: counts[3],
      assessments: counts[4],
      ragDocuments: counts[5],
    },
    ai: {
      totalInteractions: totalAi,
      last24h: aiRecent,
      failureRate: totalAi ? round((failedAi / totalAi) * 100, 2) : 0,
      byAgent: aiByAgent.map((a) => ({
        agent: String(a._id),
        count: a.count as number,
        avgLatencyMs: round(a.avgLatencyMs as number, 1),
        failures: a.failures as number,
      })),
      provider: env.AI_PROVIDER,
    },
    health: {
      status: !dbPing.ok ? 'DOWN' : aiHealth.ok ? 'OK' : 'DEGRADED',
      uptimeSeconds: Math.round(process.uptime()),
      version: env.VERSION,
      environment: env.NODE_ENV,
      checks: [
        { name: 'database', status: dbPing.ok ? 'OK' : 'DOWN', latencyMs: dbPing.latencyMs, detail: databaseInfo().inMemory ? 'in-memory (development)' : undefined },
        { name: 'ai-service', status: aiHealth.ok ? 'OK' : 'DOWN', latencyMs: aiHealth.latencyMs, detail: aiHealth.detail },
        { name: 'realtime', status: 'OK', detail: `${connectedUserCount()} connected socket(s)` },
        { name: 'api', status: 'OK', detail: `${metrics.snapshot().totalRequests} requests, ${metrics.snapshot().errorRate}% errors` },
      ],
      timestamp: new Date().toISOString(),
    },
    recentAudit: audit.map((a) => ({
      id: a._id.toString(),
      actorId: a.actorId?.toString() ?? null,
      actorEmail: a.actorEmail,
      actorRole: a.actorRole,
      action: a.action,
      resource: a.resource,
      resourceId: a.resourceId,
      ip: a.ip,
      userAgent: a.userAgent,
      status: a.status,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
    flagged: { highRiskAttempts, unreviewedEvents },
  };
}

/**
 * Verifies or rejects an alumni account (§18).
 *
 * Verification is the gate that lets an alumnus mentor students, so it is
 * deliberately a manual admin action with an audit trail - never automatic.
 */
export async function setAlumniVerification(
  alumniId: string,
  adminUserId: string,
  decision: { status: VerificationStatus; note?: string },
) {
  const alumni = await AlumniProfile.findById(alumniId);
  if (!alumni) throw ApiError.notFound('Alumni profile');

  alumni.verificationStatus = decision.status;
  alumni.verifiedBy = adminUserId as unknown as typeof alumni.verifiedBy;
  alumni.verifiedAt = new Date();
  alumni.verificationNote = decision.note ?? null;
  await alumni.save();

  const verified = decision.status === VerificationStatus.VERIFIED;
  await notify({
    userId: alumni.userId,
    type: NotificationType.ALUMNI_VERIFIED,
    title: verified ? 'Your alumni account has been verified' : 'Your alumni verification was not approved',
    body: verified
      ? 'You can now appear in student mentor searches and accept mentorship requests.'
      : decision.note || 'Please update your employment details and resubmit for verification.',
    link: '/alumni/profile',
    sendEmailToo: true,
  });

  log.info({ alumniId, status: decision.status }, 'Alumni verification updated');
  return alumni;
}

export async function listUsers(filters: { role?: UserRole; status?: string; search?: string; page: number; limit: number }) {
  const query: Record<string, unknown> = {};
  if (filters.role) query.role = filters.role;
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ fullName: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }];
  }

  const [items, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip((filters.page - 1) * filters.limit).limit(filters.limit).lean(),
    User.countDocuments(query),
  ]);

  return { items, total };
}

/**
 * Changes a user's role.
 *
 * Guarded so the last remaining administrator cannot be demoted, which would
 * lock everyone out of the admin console permanently.
 */
export async function changeUserRole(userId: string, role: UserRole, actorId: string) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
    const adminCount = await User.countDocuments({ role: UserRole.ADMIN, status: AccountStatus.ACTIVE });
    if (adminCount <= 1) {
      throw ApiError.conflict('You cannot remove the last administrator account.');
    }
  }
  if (user._id.toString() === actorId && role !== UserRole.ADMIN) {
    throw ApiError.conflict('You cannot remove your own administrator role.');
  }

  user.role = role;
  await user.save();
  return user;
}

export async function changeUserStatus(userId: string, status: AccountStatus, actorId: string) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  if (user._id.toString() === actorId && status !== AccountStatus.ACTIVE) {
    throw ApiError.conflict('You cannot suspend your own account.');
  }
  if (user.role === UserRole.ADMIN && status === AccountStatus.SUSPENDED) {
    const adminCount = await User.countDocuments({ role: UserRole.ADMIN, status: AccountStatus.ACTIVE });
    if (adminCount <= 1) throw ApiError.conflict('You cannot suspend the last active administrator.');
  }

  user.status = status;
  await user.save();

  if (status === AccountStatus.SUSPENDED) {
    // Revoke live sessions immediately rather than waiting for token expiry.
    const { revokeAllUserTokens } = await import('./token.service');
    await revokeAllUserTokens(userId, 'ACCOUNT_SUSPENDED');
  }

  return user;
}

export async function listAuditLogs(filters: {
  action?: string;
  actorId?: string;
  resource?: string;
  status?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}) {
  const query: Record<string, unknown> = {};
  if (filters.action) query.action = filters.action;
  if (filters.actorId) query.actorId = filters.actorId;
  if (filters.resource) query.resource = filters.resource;
  if (filters.status) query.status = filters.status;
  if (filters.from || filters.to) {
    query.createdAt = {
      ...(filters.from ? { $gte: new Date(filters.from) } : {}),
      ...(filters.to ? { $lte: new Date(filters.to) } : {}),
    };
  }

  const [items, total] = await Promise.all([
    AuditLog.find(query).sort({ createdAt: -1 }).skip((filters.page - 1) * filters.limit).limit(filters.limit).lean(),
    AuditLog.countDocuments(query),
  ]);

  return { items, total };
}

/**
 * Re-indexes the RAG knowledge base into the vector store (§10).
 * The index is cleared first so documents deleted from MongoDB do not linger
 * in the vector store and keep being cited.
 */
export async function reindexKnowledgeBase(userId: string) {
  const documents = await RAGDocument.find({ active: true }).lean();

  await aiClient.post('/ai/rag/clear', {}, { userId, agent: 'RAG', operation: 'rag.clear' });

  if (!documents.length) {
    return { indexed: 0, failed: 0, message: 'No active knowledge-base documents to index.' };
  }

  const payload = {
    documents: documents.map((doc) => ({
      documentId: doc._id.toString(),
      title: doc.title,
      content: doc.content,
      category: doc.category,
      companyId: doc.companyId?.toString(),
      roleId: doc.roleId?.toString(),
      tags: doc.tags,
      provenance: doc.provenance,
    })),
  };

  const result = await aiClient.post<typeof payload, { indexed: number; failed: number; results: Array<{ documentId: string; chunkCount: number }>; stats: unknown }>(
    '/ai/rag/ingest/bulk',
    payload,
    { userId, agent: 'RAG', operation: 'rag.reindex' },
  );

  const now = new Date();
  for (const item of result.data.results ?? []) {
    await RAGDocument.updateOne(
      { _id: item.documentId },
      { $set: { chunkCount: item.chunkCount, indexedAt: now, indexVersion: env.VERSION } },
    );
  }

  log.info({ indexed: result.data.indexed, failed: result.data.failed }, 'Knowledge base re-indexed');
  return result.data;
}

/** AI usage over time, for the admin console's usage chart. */
export async function getAiUsage(days = 14) {
  const since = new Date(Date.now() - days * 86_400_000);

  const daily = await AIInteraction.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: 1 },
        failures: { $sum: { $cond: [{ $ne: ['$status', 'SUCCESS'] }, 1, 0] } },
        avgLatencyMs: { $avg: '$latencyMs' },
        tokensPrompt: { $sum: '$tokensPrompt' },
        tokensCompletion: { $sum: '$tokensCompletion' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return daily.map((d) => ({
    date: String(d._id),
    total: d.total as number,
    failures: d.failures as number,
    avgLatencyMs: round(d.avgLatencyMs as number, 1),
    tokensPrompt: d.tokensPrompt as number,
    tokensCompletion: d.tokensCompletion as number,
  }));
}

/** Flagged assessments and monitoring events awaiting human review (§14). */
export async function listFlaggedContent() {
  const [attempts, events] = await Promise.all([
    AssessmentAttempt.find({ integrityRisk: { $in: ['MEDIUM', 'HIGH'] }, integrityReviewedBy: null })
      .populate<{ studentId: { rollNumber?: string; department?: string } }>('studentId', 'rollNumber department')
      .populate<{ assessmentId: { title: string } }>('assessmentId', 'title')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    MonitoringEvent.find({ severity: { $in: ['MEDIUM', 'HIGH'] }, reviewed: false })
      .sort({ occurredAt: -1 })
      .limit(100)
      .lean(),
  ]);

  return {
    attempts,
    events,
    note:
      'These items are flagged for human review only. No result has been invalidated automatically, and a ' +
      'monitoring signal is not by itself evidence of misconduct.',
  };
}

export async function reviewAttemptIntegrity(attemptId: string, reviewerId: string, note: string, clear: boolean) {
  const attempt = await AssessmentAttempt.findById(attemptId);
  if (!attempt) throw ApiError.notFound('Assessment attempt');

  attempt.integrityReviewedBy = reviewerId as unknown as typeof attempt.integrityReviewedBy;
  attempt.integrityReviewNote = note;
  if (clear) attempt.integrityRisk = 'LOW' as typeof attempt.integrityRisk;
  await attempt.save();

  await MonitoringEvent.updateMany(
    { attemptId: attempt._id, reviewed: false },
    { $set: { reviewed: true, reviewedBy: reviewerId, reviewNote: note } },
  );

  return attempt;
}

export { AgentName };
