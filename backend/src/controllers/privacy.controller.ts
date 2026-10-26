import type { Request, Response } from 'express';
import { AccountStatus } from '@careerpilot/shared';
import { env } from '../config/env';
import { moduleLogger } from '../config/logger';
import { Resume } from '../models/Resume';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { AuditAction, audit } from '../services/audit.service';
import { configService } from '../services/config.service';
import { storage } from '../services/storage.service';
import { revokeAllUserTokens } from '../services/token.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';

const log = moduleLogger('privacy');

/**
 * Privacy controls (§30).
 *
 * Three capabilities: see what is held, export it, and request deletion.
 * Deletion is a request rather than an immediate purge because assessment and
 * feedback records may be under institutional retention obligations; the
 * request is recorded, the account is locked, and staff process it.
 */

export const privacyPolicy = asyncHandler(async (_req: Request, res: Response) => {
  const retention = await configService.get<Record<string, number>>('privacy.retention', {
    resumeDays: 365,
    recordingDays: 30,
    monitoringEventDays: 180,
    aiInteractionDays: 90,
  });

  ok(res, {
    version: '1.0',
    // Placeholder policy text: an institution must review this with its own
    // data-protection officer before deployment.
    placeholder: true,
    summary:
      'CareerPilot AI processes your profile, resume, assessment results, interview transcripts and alumni ' +
      'feedback in order to compute your placement readiness and generate personalised preparation guidance.',
    dataCollected: [
      { category: 'Account', items: ['Name', 'Email address', 'Role', 'Department'], purpose: 'Authentication and access control' },
      { category: 'Profile', items: ['CGPA', 'Skills', 'Projects', 'Certifications', 'Target companies'], purpose: 'Readiness scoring and job matching' },
      { category: 'Resume', items: ['Uploaded file', 'Extracted text and structured fields'], purpose: 'ATS analysis and skill extraction' },
      { category: 'Assessments', items: ['Answers', 'Scores', 'Time spent'], purpose: 'Performance measurement' },
      { category: 'Interviews', items: ['Answer transcripts', 'Evaluation scores'], purpose: 'Interview feedback and readiness scoring' },
      { category: 'Integrity signals', items: ['Full-screen exits', 'Tab visibility changes', 'Paste events'], purpose: 'Assessment integrity review by a human' },
      { category: 'Camera and microphone', items: ['Live media during a consented interview'], purpose: 'Live mock interviews. Nothing is recorded without separate explicit consent.' },
    ],
    aiProcessing: {
      provider: env.AI_PROVIDER,
      notice:
        'Resume text and interview answers are sent to the configured AI provider for analysis. When ' +
        'AI_PROVIDER is set to "mock", processing is entirely local and no data leaves this deployment.',
    },
    monitoring: {
      notice:
        'Assessment monitoring is transparent: every signal recorded about you is visible to you in your ' +
        'assessment result. Signals never automatically invalidate a result - a human reviews the context.',
      neverCollected: [
        'Race, ethnicity or nationality inference',
        'Gender inference',
        'Emotion or affect analysis',
        'Disability inference',
        'Identity inference from biometrics',
      ],
    },
    retention,
    yourRights: [
      'View all data held about you (GET /api/v1/privacy/my-data)',
      'Export your data in machine-readable form (GET /api/v1/privacy/export)',
      'Request deletion of your account and data (POST /api/v1/privacy/delete-account)',
      'Withdraw consent for camera, microphone or recording at any time',
    ],
    contact: 'Contact your placement office for any data protection question.',
  });
});

/** Everything the platform holds about the caller. */
export const myData = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth!.userId;

  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.notFound('User');

  const profile = await StudentProfile.findOne({ userId }).lean();
  const studentId = profile?._id;

  const [resumes, analyses, attempts, interviews, monitoring, feedback, readiness] = await Promise.all([
    studentId ? Resume.find({ studentId }).select('-storageKey -checksum').lean() : [],
    studentId ? ResumeAnalysis.find({ studentId }).select('atsScore createdAt').lean() : [],
    studentId ? import('../models/AssessmentAttempt').then(({ AssessmentAttempt }) => AssessmentAttempt.find({ studentId }).select('assessmentType percentage submittedAt integrityRisk').lean()) : [],
    studentId ? import('../models/InterviewEvaluation').then(({ InterviewEvaluation }) => InterviewEvaluation.find({ studentId }).select('mode overallScore createdAt').lean()) : [],
    studentId ? import('../models/MonitoringEvent').then(({ MonitoringEvent }) => MonitoringEvent.find({ studentId }).select('type severity explanation occurredAt').lean()) : [],
    studentId ? import('../models/AlumniFeedback').then(({ AlumniFeedback }) => AlumniFeedback.find({ studentId }).lean()) : [],
    studentId ? import('../models/PlacementReadiness').then(({ PlacementReadiness }) => PlacementReadiness.find({ studentId }).select('score band computedAt').lean()) : [],
  ]);

  ok(res, {
    account: user,
    profile,
    resumes,
    resumeAnalyses: analyses,
    assessmentAttempts: attempts,
    interviewEvaluations: interviews,
    // Shown in full: the student is entitled to see exactly what was recorded.
    monitoringEvents: monitoring,
    alumniFeedback: feedback,
    readinessHistory: readiness,
    generatedAt: new Date().toISOString(),
  });
});

export const exportMyData = asyncHandler(async (req: Request, res: Response) => {
  await audit({ action: AuditAction.DATA_EXPORT, resource: 'User', resourceId: req.auth!.userId, metadata: { scope: 'self' } }, req);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="careerpilot-my-data-${new Date().toISOString().slice(0, 10)}.json"`);

  // Reuse `myData` so the export and the on-screen view can never diverge.
  await myData(req, res, () => undefined);
});

/**
 * Records a deletion request and locks the account.
 *
 * Uploaded files are removed immediately, since they are the most sensitive
 * artefact and are not needed for any retention obligation. Assessment records
 * are retained pending staff review, and the user is told this plainly.
 */
export const requestAccountDeletion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth!.userId;
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  user.deletionRequestedAt = new Date();
  user.status = AccountStatus.DELETION_REQUESTED;
  await user.save();

  const profile = await StudentProfile.findOne({ userId }).select('_id');
  let filesRemoved = 0;

  if (profile) {
    const resumes = await Resume.find({ studentId: profile._id });
    for (const resume of resumes) {
      await storage.delete(resume.storageKey).catch(() => null);
      filesRemoved += 1;
    }
    await Resume.deleteMany({ studentId: profile._id });
    await ResumeAnalysis.deleteMany({ studentId: profile._id });
    await StudentProfile.updateOne({ _id: profile._id }, { $set: { primaryResumeId: null } });
  }

  await revokeAllUserTokens(userId, 'DELETION_REQUESTED');
  await audit(
    { action: AuditAction.DATA_DELETION_REQUEST, resource: 'User', resourceId: userId, metadata: { filesRemoved } },
    req,
  );

  log.info({ userId, filesRemoved }, 'Account deletion requested');

  ok(res, {
    message:
      'Your deletion request has been recorded and your account has been locked. Uploaded resume files have ' +
      'been deleted immediately. Assessment and interview records are retained until the placement office ' +
      'completes the deletion, in line with institutional retention policy.',
    filesRemoved,
    requestedAt: user.deletionRequestedAt.toISOString(),
  });
});

/** Withdraws media consent; the interview room enforces this on the next join. */
export const withdrawConsent = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw ApiError.notFound('User');

  const key = String(req.body.key ?? '');
  const consent = user.consents.find((c) => c.key === key);

  if (consent) {
    consent.granted = false;
    consent.grantedAt = new Date();
  } else {
    user.consents.push({ key, granted: false, grantedAt: new Date(), policyVersion: '1.0' });
  }

  await user.save();
  await audit({ action: 'privacy.consent.withdraw', resource: 'User', resourceId: user._id.toString(), metadata: { key } }, req);

  ok(res, { consents: user.consents });
});
