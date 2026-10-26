import type { Request, Response } from 'express';
import { ReportType, UserRole } from '@careerpilot/shared';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { AuditAction, audit } from '../services/audit.service';
import * as reportService from '../services/report.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(buffer);
}

/** Student report download. Staff may pass `studentId` to fetch another's. */
export const downloadStudentReport = asyncHandler(async (req: Request, res: Response) => {
  const type = req.params.type.toUpperCase();
  const builder = reportService.REPORT_BUILDERS[type];

  if (!builder) {
    throw ApiError.badRequest(
      `Unknown report type "${req.params.type}". Available: ${Object.keys(reportService.REPORT_BUILDERS).join(', ')}.`,
    );
  }

  let studentId = req.studentId!;
  const requested = req.query.studentId as string | undefined;

  if (requested && requested !== studentId?.toString()) {
    const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
    if (!staff.includes(req.auth!.role)) {
      throw ApiError.forbidden('You can only download your own reports.');
    }
    const profile = await StudentProfile.findById(requested).select('_id');
    if (!profile) throw ApiError.notFound('Student profile');
    studentId = profile._id;
  }

  const buffer = await builder(studentId, req.query.ref as string | undefined);

  const profile = await StudentProfile.findById(studentId).select('userId').lean();
  const user = profile ? await User.findById(profile.userId).select('fullName').lean() : null;

  await audit(
    { action: AuditAction.REPORT_DOWNLOAD, resource: 'Report', resourceId: type, metadata: { studentId: studentId.toString() } },
    req,
  );

  sendPdf(res, buffer, reportService.reportFilename(type, user?.fullName));
});

/** Institution and department reports for the placement office. */
export const downloadInstitutionReport = asyncHandler(async (req: Request, res: Response) => {
  const filters = { department: req.query.department as string | undefined, batch: req.query.batch as string | undefined };
  const type = req.params.type.toUpperCase();

  let buffer: Buffer;
  switch (type) {
    case ReportType.INSTITUTION:
    case ReportType.DEPARTMENT:
      buffer = await reportService.buildInstitutionReport(filters);
      break;
    case ReportType.SKILL_GAP:
      buffer = await reportService.buildSkillGapReport(filters);
      break;
    default:
      throw ApiError.badRequest(
        `Unknown institutional report type "${req.params.type}". Available: INSTITUTION, DEPARTMENT, SKILL_GAP.`,
      );
  }

  await audit({ action: AuditAction.REPORT_DOWNLOAD, resource: 'InstitutionReport', resourceId: type, metadata: filters }, req);
  sendPdf(res, buffer, reportService.reportFilename(type, filters.department ?? 'institution'));
});

/** Staff download of an individual student's performance report. */
export const downloadStudentPerformance = asyncHandler(async (req: Request, res: Response) => {
  const profile = await StudentProfile.findById(req.params.studentId).select('_id userId');
  if (!profile) throw ApiError.notFound('Student profile');

  const buffer = await reportService.buildStudentPerformanceReport(profile._id);
  const user = await User.findById(profile.userId).select('fullName').lean();

  await audit(
    { action: AuditAction.REPORT_DOWNLOAD, resource: 'StudentPerformanceReport', resourceId: req.params.studentId },
    req,
  );

  sendPdf(res, buffer, reportService.reportFilename(ReportType.STUDENT_PERFORMANCE, user?.fullName));
});

/** Lists the report types the caller can currently generate. */
export const availableReports = asyncHandler(async (req: Request, res: Response) => {
  const studentReports = [
    { type: ReportType.RESUME_ANALYSIS, label: 'Resume Analysis Report', needsRef: false },
    { type: ReportType.ATS, label: 'ATS Report', needsRef: false },
    { type: ReportType.PLACEMENT_READINESS, label: 'Placement Readiness Report', needsRef: false },
    { type: ReportType.INTERVIEW, label: 'Interview Report', needsRef: true, refLabel: 'Interview session' },
    { type: ReportType.CODING, label: 'Coding Assessment Report', needsRef: false },
    { type: ReportType.ALUMNI_FEEDBACK, label: 'Alumni Feedback Report', needsRef: false },
  ];

  const staffReports = [
    { type: ReportType.INSTITUTION, label: 'Institution Placement Report' },
    { type: ReportType.DEPARTMENT, label: 'Department Report' },
    { type: ReportType.SKILL_GAP, label: 'Skill Gap Report' },
    { type: ReportType.STUDENT_PERFORMANCE, label: 'Student Performance Report' },
  ];

  const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
  ok(res, {
    student: studentReports,
    institutional: staff.includes(req.auth!.role) ? staffReports : [],
  });
});
