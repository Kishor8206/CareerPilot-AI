import type { Request, Response } from 'express';
import { MentorshipStatus, SessionStatus, VerificationStatus } from '@careerpilot/shared';
import { env } from '../config/env';
import { AlumniFeedback } from '../models/AlumniFeedback';
import { AlumniProfile } from '../models/AlumniProfile';
import { MentorshipRequest } from '../models/MentorshipRequest';
import { MentorshipSession } from '../models/MentorshipSession';
import { User } from '../models/User';
import * as mentorshipService from '../services/mentorship.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, created, ok, paginated } from '../utils/response';

/* ------------------------------------------------------------------ */
/* Student-facing                                                      */
/* ------------------------------------------------------------------ */

export const searchAlumni = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as Parameters<typeof mentorshipService.searchAlumni>[0];
  const { items, total } = await mentorshipService.searchAlumni(query);
  paginated(res, items, buildPaginationMeta(query.page, query.limit, total));
});

export const recommendMentors = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await mentorshipService.recommendMentors(req.studentId!, req.auth!.userId));
});

export const getAlumniProfile = asyncHandler(async (req: Request, res: Response) => {
  const alumni = await AlumniProfile.findOne({ _id: req.params.id, verificationStatus: VerificationStatus.VERIFIED })
    .populate<{ userId: { fullName: string; avatarUrl?: string } }>('userId', 'fullName avatarUrl')
    .lean();

  if (!alumni) throw ApiError.notFound('Verified alumni profile');

  // Employment-proof documents are never exposed to students.
  const { employmentProof: _employmentProof, ...safe } = alumni as Record<string, unknown> & { employmentProof?: unknown };
  ok(res, safe);
});

export const requestMentorship = asyncHandler(async (req: Request, res: Response) => {
  const request = await mentorshipService.requestMentorship({
    studentId: req.studentId!,
    studentUserId: req.auth!.userId,
    alumniId: req.body.alumniId,
    topic: req.body.topic,
    message: req.body.message,
    targetRole: req.body.targetRole,
    targetCompany: req.body.targetCompany,
    preferredSlots: req.body.preferredSlots,
  });
  created(res, request.toJSON());
});

export const myRequests = asyncHandler(async (req: Request, res: Response) => {
  const requests = await MentorshipRequest.find({ studentId: req.studentId })
    .populate<{ alumniId: { company: string; designation: string } }>('alumniId', 'company designation')
    .populate<{ alumniUserId: { fullName: string } }>('alumniUserId', 'fullName')
    .sort({ createdAt: -1 })
    .lean();
  ok(res, requests);
});

export const mySessions = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await mentorshipService.listStudentSessions(req.studentId!));
});

export const rateMentor = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await mentorshipService.rateMentor(req.params.id, req.studentId!, req.body.rating));
});

export const myFeedback = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await AlumniFeedback.find({ studentId: req.studentId })
    .populate<{ alumniId: { company: string; designation: string } }>('alumniId', 'company designation')
    .sort({ createdAt: -1 })
    .lean();
  ok(res, feedback);
});

/* ------------------------------------------------------------------ */
/* Alumni-facing                                                       */
/* ------------------------------------------------------------------ */

export const getMyAlumniProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await AlumniProfile.findOne({ userId: req.auth!.userId }).lean();
  if (!profile) throw ApiError.notFound('Alumni profile');
  const user = await User.findById(req.auth!.userId).select('fullName email avatarUrl').lean();
  ok(res, { ...profile, fullName: user?.fullName, email: user?.email, avatarUrl: user?.avatarUrl });
});

export const updateMyAlumniProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await AlumniProfile.findOne({ userId: req.auth!.userId });
  if (!profile) throw ApiError.notFound('Alumni profile');

  const { fullName, employmentProof, ...fields } = req.body as Record<string, any>;
  if (fullName) await User.updateOne({ _id: req.auth!.userId }, { $set: { fullName } });

  Object.assign(profile, fields);

  if (employmentProof) {
    profile.employmentProof = { ...profile.employmentProof, ...employmentProof, submittedAt: new Date() };
    // Editing employment details invalidates a prior verification: the claim
    // an administrator checked is no longer the claim being made.
    if (profile.verificationStatus === VerificationStatus.VERIFIED) {
      profile.verificationStatus = VerificationStatus.PENDING;
      profile.verificationNote = 'Employment details were changed and require re-verification.';
    }
  }

  await profile.save();
  ok(res, profile.toJSON());
});

export const alumniDashboard = asyncHandler(async (req: Request, res: Response) => {
  const alumniId = req.alumniId!;

  const [profile, pending, upcoming, completed, feedbackGiven] = await Promise.all([
    AlumniProfile.findById(alumniId).lean(),
    MentorshipRequest.countDocuments({ alumniId, status: MentorshipStatus.PENDING }),
    MentorshipSession.find({ alumniId, status: { $in: [SessionStatus.SCHEDULED, SessionStatus.LIVE] }, scheduledAt: { $gte: new Date() } })
      .populate<{ studentUserId: { fullName: string } }>('studentUserId', 'fullName')
      .sort({ scheduledAt: 1 })
      .limit(5)
      .lean(),
    MentorshipSession.countDocuments({ alumniId, status: SessionStatus.COMPLETED }),
    AlumniFeedback.countDocuments({ alumniId }),
  ]);

  ok(res, {
    profile,
    stats: {
      pendingRequests: pending,
      upcomingSessions: upcoming.length,
      completedSessions: completed,
      feedbackGiven,
      averageRating: profile?.averageRating ?? 0,
      verificationStatus: profile?.verificationStatus,
    },
    upcoming,
    // Feedback owed is the gap the dashboard should nudge on.
    pendingFeedback: completed - feedbackGiven,
  });
});

export const alumniRequests = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = { alumniId: req.alumniId };
  if (status) filter.status = status;

  const requests = await MentorshipRequest.find(filter)
    .populate<{ studentUserId: { fullName: string; email: string } }>('studentUserId', 'fullName email')
    .populate<{ studentId: { department: string; rollNumber: string; batch: string } }>('studentId', 'department rollNumber batch')
    .sort({ createdAt: -1 })
    .lean();

  ok(res, requests);
});

export const respondToRequest = asyncHandler(async (req: Request, res: Response) => {
  const result = await mentorshipService.respondToRequest(req.params.id, req.alumniId!, req.body);
  ok(res, { request: result.request.toJSON(), session: result.session?.toJSON() ?? null });
});

export const alumniSessions = asyncHandler(async (req: Request, res: Response) => {
  ok(res, await mentorshipService.listAlumniSessions(req.alumniId!));
});

export const submitFeedback = asyncHandler(async (req: Request, res: Response) => {
  const result = await mentorshipService.submitFeedback(
    req.params.id,
    req.alumniId!,
    req.auth!.userId,
    req.body,
  );
  created(res, result);
});

export const alumniFeedbackHistory = asyncHandler(async (req: Request, res: Response) => {
  const feedback = await AlumniFeedback.find({ alumniId: req.alumniId })
    .populate<{ studentId: { department: string; rollNumber: string } }>('studentId', 'department rollNumber')
    .sort({ createdAt: -1 })
    .lean();
  ok(res, feedback);
});

/* ------------------------------------------------------------------ */
/* Shared: the live interview room                                     */
/* ------------------------------------------------------------------ */

/**
 * Returns the room credentials for a booked session (§19).
 *
 * ICE servers are issued here rather than being baked into the frontend, so
 * TURN credentials never sit in the client bundle.
 */
export const getSessionRoom = asyncHandler(async (req: Request, res: Response) => {
  const session = await mentorshipService.getSessionForRoom(req.params.id, req.auth!.userId);

  const isStudent = session.studentUserId.toString() === req.auth!.userId;

  const [student, alumni, alumniProfile] = await Promise.all([
    User.findById(session.studentUserId).select('fullName avatarUrl').lean(),
    User.findById(session.alumniUserId).select('fullName avatarUrl').lean(),
    AlumniProfile.findById(session.alumniId).select('company designation').lean(),
  ]);

  const iceServers: Array<Record<string, unknown>> = [
    { urls: env.WEBRTC_STUN_URLS.split(',').map((u) => u.trim()).filter(Boolean) },
  ];
  if (env.WEBRTC_TURN_URL) {
    iceServers.push({
      urls: env.WEBRTC_TURN_URL,
      username: env.WEBRTC_TURN_USERNAME,
      credential: env.WEBRTC_TURN_CREDENTIAL,
    });
  }

  ok(res, {
    session: session.toJSON(),
    role: isStudent ? 'STUDENT' : 'ALUMNI',
    participants: {
      student: { name: student?.fullName, avatarUrl: student?.avatarUrl },
      alumni: { name: alumni?.fullName, avatarUrl: alumni?.avatarUrl, company: alumniProfile?.company, designation: alumniProfile?.designation },
    },
    iceServers,
    // Consent is required before any recording begins (§15).
    recordingConsent: session.recordingConsent,
    canSubmitFeedback: !isStudent && !session.feedbackId,
  });
});

export const updateSessionNotes = asyncHandler(async (req: Request, res: Response) => {
  const session = await mentorshipService.getSessionForRoom(req.params.id, req.auth!.userId);
  session.notes = req.body.notes;
  await session.save();
  ok(res, { notes: session.notes });
});

export const endSession = asyncHandler(async (req: Request, res: Response) => {
  const session = await mentorshipService.getSessionForRoom(req.params.id, req.auth!.userId);

  if (session.status === SessionStatus.LIVE || session.status === SessionStatus.SCHEDULED) {
    session.status = SessionStatus.COMPLETED;
    session.endedAt = new Date();
    await session.save();
  }

  ok(res, session.toJSON());
});
