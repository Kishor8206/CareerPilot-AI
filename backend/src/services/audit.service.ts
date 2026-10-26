import type { Request } from 'express';
import { AuditLog } from '../models/AuditLog';
import { moduleLogger } from '../config/logger';

const log = moduleLogger('audit');

export interface AuditEntry {
  action: string;
  resource: string;
  resourceId?: string | null;
  status?: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
}

function clientIp(req?: Request): string | null {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.ip ?? null;
}

/**
 * Writes a security audit record (§29).
 *
 * Auditing is intentionally fire-and-forget: a logging failure must never break
 * the user-facing operation, but it is escalated to the application log so the
 * gap is visible.
 */
export async function audit(entry: AuditEntry, req?: Request): Promise<void> {
  try {
    await AuditLog.create({
      actorId: entry.actorId ?? req?.auth?.userId ?? null,
      actorEmail: entry.actorEmail ?? req?.auth?.email ?? null,
      actorRole: entry.actorRole ?? req?.auth?.role ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      ip: clientIp(req),
      userAgent: req?.get('user-agent')?.slice(0, 300) ?? null,
      status: entry.status ?? 'SUCCESS',
      metadata: entry.metadata ?? {},
    });
  } catch (error) {
    log.error({ err: error, action: entry.action }, 'Failed to write audit log');
  }
}

/** Well-known audit actions, kept as constants so queries stay reliable. */
export const AuditAction = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  REGISTER: 'auth.register',
  TOKEN_REFRESH: 'auth.token.refresh',
  PASSWORD_RESET_REQUEST: 'auth.password.reset_request',
  PASSWORD_RESET: 'auth.password.reset',
  PASSWORD_CHANGE: 'auth.password.change',
  PROFILE_UPDATE: 'profile.update',
  RESUME_UPLOAD: 'resume.upload',
  RESUME_DELETE: 'resume.delete',
  RESUME_ANALYZE: 'resume.analyze',
  ASSESSMENT_START: 'assessment.start',
  ASSESSMENT_SUBMIT: 'assessment.submit',
  INTERVIEW_START: 'interview.start',
  INTERVIEW_COMPLETE: 'interview.complete',
  READINESS_COMPUTE: 'readiness.compute',
  ALUMNI_VERIFY: 'admin.alumni.verify',
  ALUMNI_REJECT: 'admin.alumni.reject',
  USER_ROLE_CHANGE: 'admin.user.role_change',
  USER_STATUS_CHANGE: 'admin.user.status_change',
  USER_DELETE: 'admin.user.delete',
  CONFIG_UPDATE: 'admin.config.update',
  RAG_DOCUMENT_UPSERT: 'admin.rag.upsert',
  RAG_REINDEX: 'admin.rag.reindex',
  DATA_EXPORT: 'data.export',
  DATA_DELETION_REQUEST: 'privacy.deletion_request',
  MONITORING_REVIEW: 'monitoring.review',
  REPORT_DOWNLOAD: 'report.download',
  STUDENT_RECORD_ACCESS: 'staff.student_record.access',
} as const;
