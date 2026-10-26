import type { Request, Response } from 'express';
import { UserRole } from '@careerpilot/shared';
import { Resume } from '../models/Resume';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { AuditAction, audit } from '../services/audit.service';
import * as resumeService from '../services/resume.service';
import { recomputeReadiness } from '../services/apie.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { created, noContent, ok } from '../utils/response';

export const upload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest('No resume file was received. Attach a PDF, DOCX or TXT file in the "resume" field.');
  }

  const resume = await resumeService.uploadResume({
    studentId: req.studentId!,
    userId: req.auth!.userId,
    file: req.file,
    makePrimary: req.body?.makePrimary !== 'false',
  });

  await audit(
    {
      action: AuditAction.RESUME_UPLOAD,
      resource: 'Resume',
      resourceId: resume._id.toString(),
      metadata: { sizeBytes: resume.sizeBytes, mimeType: resume.mimeType },
    },
    req,
  );

  created(res, resume.toJSON());
});

/**
 * Runs the analysis pipeline and, on success, recomputes readiness so the
 * dashboard reflects the new ATS score immediately (the §43 feedback loop).
 */
export const analyze = asyncHandler(async (req: Request, res: Response) => {
  const resume = await resumeService.getResumeOwned(req.params.id, req.studentId!);

  const analysis = await resumeService.analyzeResume(resume, req.auth!.userId, {
    jobDescriptionId: req.body?.jobDescriptionId,
    jobDescriptionText: req.body?.jobDescriptionText,
    jobDescriptionLabel: req.body?.jobDescriptionLabel,
    applyToProfile: req.body?.applyToProfile !== false,
  });

  await audit(
    { action: AuditAction.RESUME_ANALYZE, resource: 'ResumeAnalysis', resourceId: analysis._id.toString(), metadata: { atsScore: analysis.atsScore } },
    req,
  );

  // Readiness failures must not fail the analysis the student just paid for
  // in wall-clock time; it is recomputed again on the next activity anyway.
  const readiness = await recomputeReadiness(req.studentId!, 'RESUME_ANALYZED').catch(() => null);

  ok(res, { analysis: analysis.toJSON(), readiness });
});

/** Extracts the text of an uploaded job-description file. Nothing is stored. */
export const extractJobDescription = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw ApiError.badRequest('No job description file was received. Attach a PDF, DOCX or TXT file in the "jd" field.');
  }
  ok(res, await resumeService.extractJobDescriptionText(req.file, req.auth!.userId));
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await resumeService.listResumes(req.studentId!));
});

export const getAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await ResumeAnalysis.findById(req.params.id);
  if (!analysis) throw ApiError.notFound('Resume analysis');

  const isOwner = analysis.studentId.toString() === req.studentId?.toString();
  const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
  if (!isOwner && !staff.includes(req.auth!.role)) {
    throw ApiError.forbidden('You can only view your own resume analysis.');
  }

  ok(res, analysis.toJSON());
});

export const latestAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const analysis = await resumeService.getLatestAnalysis(req.studentId!);
  ok(res, analysis ? analysis.toJSON() : null);
});

export const history = asyncHandler(async (req: Request, res: Response) => {
  const analyses = await ResumeAnalysis.find({ studentId: req.studentId })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('atsScore createdAt engineVersion targetJobDescriptionId jobMatchScore resumeId')
    .lean();
  ok(res, analyses);
});

export const setPrimary = asyncHandler(async (req: Request, res: Response) => {
  const resume = await resumeService.setPrimaryResume(req.params.id, req.studentId!);
  ok(res, resume.toJSON());
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await resumeService.deleteResume(req.params.id, req.studentId!);
  await audit({ action: AuditAction.RESUME_DELETE, resource: 'Resume', resourceId: req.params.id }, req);
  noContent(res);
});

/** Streams the original file. Local storage is never served statically (§29). */
export const download = asyncHandler(async (req: Request, res: Response) => {
  const resume = await Resume.findById(req.params.id);
  if (!resume) throw ApiError.notFound('Resume');

  const isOwner = resume.studentId.toString() === req.studentId?.toString();
  const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
  if (!isOwner && !staff.includes(req.auth!.role)) {
    throw ApiError.forbidden('You can only download your own resume.');
  }

  const file = await resumeService.downloadResume(resume);

  if (!isOwner) {
    await audit({ action: AuditAction.STUDENT_RECORD_ACCESS, resource: 'Resume', resourceId: resume._id.toString() }, req);
  }

  res.setHeader('Content-Type', file.mimeType);
  // `attachment` prevents a malicious upload from rendering inline in the browser.
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
});
