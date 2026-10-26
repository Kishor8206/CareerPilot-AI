import crypto from 'node:crypto';
import type { Types } from 'mongoose';
import {
  AgentName,
  DataProvenance,
  MentorshipStatus,
  NotificationType,
  SessionStatus,
  VerificationStatus,
} from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { AlumniFeedback } from '../models/AlumniFeedback';
import { AlumniProfile } from '../models/AlumniProfile';
import { MentorshipRequest, type IMentorshipRequest } from '../models/MentorshipRequest';
import { MentorshipSession, type IMentorshipSession } from '../models/MentorshipSession';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { SkillGap } from '../models/SkillGap';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { aiClient } from './aiClient.service';
import { notify } from './notification.service';

const log = moduleLogger('mentorship');

/**
 * Searches mentors.
 *
 * Only VERIFIED alumni are ever returned (§18). Unverified accounts exist but
 * are invisible to students until an administrator confirms their employment.
 */
export async function searchAlumni(filters: {
  company?: string;
  role?: string;
  domain?: string;
  expertise?: string;
  search?: string;
  acceptingOnly?: boolean;
  page: number;
  limit: number;
}) {
  const query: Record<string, unknown> = { verificationStatus: VerificationStatus.VERIFIED };

  if (filters.acceptingOnly !== false) query.acceptingMentees = true;
  if (filters.company) query.company = { $regex: escapeRegex(filters.company), $options: 'i' };
  if (filters.domain) query.domain = { $regex: escapeRegex(filters.domain), $options: 'i' };
  if (filters.role) query.designation = { $regex: escapeRegex(filters.role), $options: 'i' };
  if (filters.expertise) query.expertise = { $regex: escapeRegex(filters.expertise), $options: 'i' };

  const [items, total] = await Promise.all([
    AlumniProfile.find(query)
      .populate<{ userId: { fullName: string; avatarUrl?: string } }>('userId', 'fullName avatarUrl')
      .sort({ averageRating: -1, sessionsConducted: -1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean(),
    AlumniProfile.countDocuments(query),
  ]);

  return { items: items.map(toPublicAlumni), total };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Public mentor card. Employment-proof documents are never exposed. */
function toPublicAlumni(profile: Record<string, any>) {
  return {
    id: profile._id.toString(),
    userId: String(profile.userId?._id ?? profile.userId),
    fullName: profile.userId?.fullName ?? 'Alumni',
    avatarUrl: profile.userId?.avatarUrl ?? null,
    company: profile.company,
    designation: profile.designation,
    experienceYears: profile.experienceYears,
    domain: profile.domain,
    expertise: profile.expertise,
    skills: profile.skills,
    college: profile.college,
    graduationYear: profile.graduationYear,
    department: profile.department,
    linkedinUrl: profile.linkedinUrl,
    bio: profile.bio,
    verificationStatus: profile.verificationStatus,
    availability: profile.availability,
    acceptingMentees: profile.acceptingMentees,
    sessionsConducted: profile.sessionsConducted,
    averageRating: profile.averageRating,
    provenance: profile.provenance,
  };
}

/** Ranks verified alumni against the student's gaps via the mentorship agent. */
export async function recommendMentors(studentId: Types.ObjectId, userId: string, limit = 8) {
  const [profile, gaps, readiness, candidates] = await Promise.all([
    StudentProfile.findById(studentId).lean(),
    SkillGap.find({ studentId, resolved: false }).select('skill').limit(15).lean(),
    PlacementReadiness.findOne({ studentId, isLatest: true }).select('components').lean(),
    AlumniProfile.find({ verificationStatus: VerificationStatus.VERIFIED, acceptingMentees: true })
      .populate<{ userId: { fullName: string } }>('userId', 'fullName')
      .limit(100)
      .lean(),
  ]);

  if (!profile) throw ApiError.notFound('Student profile');
  if (!candidates.length) {
    return { matches: [], note: 'No verified alumni are currently accepting mentees.' };
  }

  const weakComponents = ((readiness?.components ?? []) as Array<{ key: string; normalized: number; raw: number | null }>)
    .filter((c) => c.raw !== null && c.normalized < 55)
    .map((c) => c.key);

  const payload = {
    studentSkills: profile.skills.map((s: { name: string }) => s.name),
    skillGaps: gaps.map((g) => g.skill),
    targetCompanies: profile.targetCompanyNames ?? [],
    targetRoles: profile.targetRoleTitles ?? [],
    department: profile.department ?? null,
    weakComponents,
    limit,
    candidates: candidates.map((c) => ({
      alumniId: c._id.toString(),
      fullName: (c.userId as unknown as { fullName?: string })?.fullName ?? 'Alumni',
      company: c.company,
      designation: c.designation,
      domain: c.domain,
      expertise: c.expertise,
      skills: c.skills,
      experienceYears: c.experienceYears,
      averageRating: c.averageRating,
      sessionsConducted: c.sessionsConducted,
      acceptingMentees: c.acceptingMentees,
      availabilitySlots: (c.availability ?? []).length,
      department: c.department,
    })),
  };

  const result = await aiClient.post<typeof payload, Record<string, any>>('/ai/mentorship/match', payload, {
    userId,
    studentId: studentId.toString(),
    agent: AgentName.ALUMNI_MENTORSHIP,
    operation: 'mentorship.match',
  });

  return result.data;
}

export async function requestMentorship(input: {
  studentId: Types.ObjectId;
  studentUserId: string;
  alumniId: string;
  topic: string;
  message: string;
  targetRole?: string;
  targetCompany?: string;
  preferredSlots: string[];
}): Promise<IMentorshipRequest> {
  const alumni = await AlumniProfile.findById(input.alumniId);
  if (!alumni) throw ApiError.notFound('Alumni profile');

  if (alumni.verificationStatus !== VerificationStatus.VERIFIED) {
    throw ApiError.forbidden('This alumni account has not been verified, so mentorship cannot be requested.');
  }
  if (!alumni.acceptingMentees) {
    throw ApiError.conflict('This mentor is not accepting new mentees at the moment.');
  }

  // Respect the mentor's monthly capacity so the system does not overload them.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const acceptedThisMonth = await MentorshipRequest.countDocuments({
    alumniId: alumni._id,
    status: MentorshipStatus.ACCEPTED,
    respondedAt: { $gte: monthStart },
  });
  if (alumni.maxMenteesPerMonth > 0 && acceptedThisMonth >= alumni.maxMenteesPerMonth) {
    throw ApiError.conflict(
      `This mentor has reached their limit of ${alumni.maxMenteesPerMonth} session(s) for this month.`,
    );
  }

  const duplicate = await MentorshipRequest.findOne({
    studentId: input.studentId,
    alumniId: alumni._id,
    status: MentorshipStatus.PENDING,
  });
  if (duplicate) {
    throw ApiError.conflict('You already have a pending request with this mentor.');
  }

  const request = await MentorshipRequest.create({
    studentId: input.studentId,
    studentUserId: input.studentUserId,
    alumniId: alumni._id,
    alumniUserId: alumni.userId,
    status: MentorshipStatus.PENDING,
    topic: input.topic,
    message: input.message,
    targetRole: input.targetRole,
    targetCompany: input.targetCompany,
    preferredSlots: input.preferredSlots,
  });

  const student = await User.findById(input.studentUserId).select('fullName');
  await notify({
    userId: alumni.userId,
    type: NotificationType.MENTORSHIP_REQUEST,
    title: 'New mentorship request',
    body: `${student?.fullName ?? 'A student'} has requested a session on "${input.topic}".`,
    link: '/alumni/requests',
    metadata: { requestId: request._id.toString() },
    sendEmailToo: true,
  });

  return request;
}

/**
 * Accepts a request and books the session in one operation.
 * A scheduled slot is required on acceptance so the student is never left with
 * an "accepted" request and no actual meeting.
 */
export async function respondToRequest(
  requestId: string,
  alumniId: Types.ObjectId,
  input: { accept: boolean; message?: string; scheduledAt?: string; durationMinutes?: number; type?: string },
): Promise<{ request: IMentorshipRequest; session: IMentorshipSession | null }> {
  const request = await MentorshipRequest.findOne({ _id: requestId, alumniId });
  if (!request) throw ApiError.notFound('Mentorship request');

  if (request.status !== MentorshipStatus.PENDING) {
    throw ApiError.conflict(`This request has already been ${request.status.toLowerCase()}.`);
  }

  request.respondedAt = new Date();
  request.responseMessage = input.message ?? null;

  if (!input.accept) {
    request.status = MentorshipStatus.REJECTED;
    await request.save();

    await notify({
      userId: request.studentUserId,
      type: NotificationType.MENTORSHIP_REJECTED,
      title: 'Your mentorship request was declined',
      body: input.message || 'The mentor is unable to take this session. Try another mentor from your matches.',
      link: '/mentorship',
      sendEmailToo: true,
    });

    return { request, session: null };
  }

  if (!input.scheduledAt) {
    throw ApiError.badRequest('A scheduled date and time is required when accepting a mentorship request.');
  }
  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now()) {
    throw ApiError.badRequest('The scheduled time must be a valid date in the future.');
  }

  const session = await MentorshipSession.create({
    requestId: request._id,
    studentId: request.studentId,
    studentUserId: request.studentUserId,
    alumniId: request.alumniId,
    alumniUserId: request.alumniUserId,
    scheduledAt,
    durationMinutes: input.durationMinutes ?? 45,
    status: SessionStatus.SCHEDULED,
    // Unguessable room id: the only secret protecting the WebRTC room.
    roomId: crypto.randomBytes(18).toString('base64url'),
    type: (input.type as IMentorshipSession['type']) ?? 'MOCK_INTERVIEW',
    agenda: request.topic,
    provenance: DataProvenance.REAL,
  });

  request.status = MentorshipStatus.ACCEPTED;
  request.sessionId = session._id;
  await request.save();

  const alumni = await AlumniProfile.findById(alumniId).populate<{ userId: { fullName: string } }>('userId', 'fullName');

  await notify({
    userId: request.studentUserId,
    type: NotificationType.MENTORSHIP_ACCEPTED,
    title: 'Your mentorship request was accepted',
    body:
      `${(alumni?.userId as unknown as { fullName?: string })?.fullName ?? 'Your mentor'} at ${alumni?.company ?? ''} ` +
      `has scheduled a session for ${scheduledAt.toLocaleString()}.`,
    link: `/mentorship/session/${session._id.toString()}`,
    metadata: { sessionId: session._id.toString(), roomId: session.roomId },
    sendEmailToo: true,
  });

  log.info({ sessionId: session._id.toString(), scheduledAt }, 'Mentorship session scheduled');
  return { request, session };
}

/**
 * Submits alumni feedback and feeds it into APIE.
 *
 * This closes the human-in-the-loop half of the §43 feedback cycle: a verified
 * human's judgement measurably moves the readiness score.
 */
export async function submitFeedback(
  sessionId: string,
  alumniId: Types.ObjectId,
  alumniUserId: string,
  input: {
    technicalKnowledge: number;
    communication: number;
    problemSolving: number;
    confidence: number;
    roleSuitability: number;
    recommendation: 'STRONG_HIRE' | 'HIRE' | 'BORDERLINE' | 'NEEDS_WORK';
    strengths: string[];
    improvements: string[];
    comments: string;
  },
) {
  const session = await MentorshipSession.findOne({ _id: sessionId, alumniId });
  if (!session) throw ApiError.notFound('Mentorship session');

  const existing = await AlumniFeedback.findOne({ sessionId: session._id });
  if (existing) throw ApiError.conflict('Feedback has already been submitted for this session.');

  const feedback = await AlumniFeedback.create({
    sessionId: session._id,
    studentId: session.studentId,
    alumniId,
    alumniUserId,
    ...input,
  });

  session.status = SessionStatus.COMPLETED;
  session.endedAt = session.endedAt ?? new Date();
  session.feedbackId = feedback._id;
  await session.save();

  await MentorshipRequest.updateOne({ sessionId: session._id }, { $set: { status: MentorshipStatus.COMPLETED } });
  await AlumniProfile.updateOne({ _id: alumniId }, { $inc: { sessionsConducted: 1 } });

  // Translate the structured ratings into APIE signals via the agent.
  let ingest: Record<string, any> | null = null;
  try {
    const result = await aiClient.post<typeof input, Record<string, any>>('/ai/mentorship/feedback', input, {
      userId: alumniUserId,
      studentId: session.studentId.toString(),
      agent: AgentName.ALUMNI_MENTORSHIP,
      operation: 'mentorship.feedback',
    });
    ingest = result.data;
  } catch (error) {
    log.warn({ err: (error as Error).message }, 'Alumni feedback ingestion unavailable');
  }

  await notify({
    userId: session.studentUserId,
    type: NotificationType.FEEDBACK_RECEIVED,
    title: 'You have new alumni feedback',
    body: `Your mentor rated your session ${feedback.overallScore}/100 with a recommendation of ${input.recommendation
      .replace(/_/g, ' ')
      .toLowerCase()}.`,
    link: `/mentorship/feedback/${feedback._id.toString()}`,
    metadata: { feedbackId: feedback._id.toString() },
    sendEmailToo: true,
  });

  const { recomputeReadiness } = await import('./apie.service');
  const readiness = await recomputeReadiness(session.studentId, 'ALUMNI_FEEDBACK').catch(() => null);

  if (readiness) {
    feedback.appliedToApie = true;
    feedback.appliedAt = new Date();
    await feedback.save();
  }

  log.info(
    { feedbackId: feedback._id.toString(), overall: feedback.overallScore, appliedToApie: feedback.appliedToApie },
    'Alumni feedback recorded',
  );

  return { feedback: feedback.toJSON(), apieSignals: ingest, readiness };
}

/** Student's rating of the mentor, maintaining the mentor's average. */
export async function rateMentor(sessionId: string, studentId: Types.ObjectId, rating: number) {
  const session = await MentorshipSession.findOne({ _id: sessionId, studentId });
  if (!session) throw ApiError.notFound('Mentorship session');

  const feedback = await AlumniFeedback.findOne({ sessionId: session._id });
  if (feedback) {
    feedback.studentRating = rating;
    await feedback.save();
  }

  const alumni = await AlumniProfile.findById(session.alumniId);
  if (alumni) {
    alumni.ratingSum += rating;
    alumni.ratingCount += 1;
    alumni.averageRating = Math.round((alumni.ratingSum / alumni.ratingCount) * 100) / 100;
    await alumni.save();
  }

  return { rating, averageRating: alumni?.averageRating ?? 0 };
}

export async function listStudentSessions(studentId: Types.ObjectId) {
  return MentorshipSession.find({ studentId })
    .populate<{ alumniId: { company: string; designation: string } }>('alumniId', 'company designation')
    .populate<{ alumniUserId: { fullName: string } }>('alumniUserId', 'fullName')
    .sort({ scheduledAt: -1 })
    .lean();
}

export async function listAlumniSessions(alumniId: Types.ObjectId) {
  return MentorshipSession.find({ alumniId })
    .populate<{ studentUserId: { fullName: string } }>('studentUserId', 'fullName')
    .populate<{ studentId: { department: string; rollNumber: string } }>('studentId', 'department rollNumber')
    .sort({ scheduledAt: -1 })
    .lean();
}

/** Loads a session for the interview room, enforcing participation. */
export async function getSessionForRoom(sessionId: string, userId: string): Promise<IMentorshipSession> {
  const session = await MentorshipSession.findById(sessionId);
  if (!session) throw ApiError.notFound('Mentorship session');

  const isParticipant =
    session.studentUserId.toString() === userId || session.alumniUserId.toString() === userId;
  if (!isParticipant) {
    throw ApiError.forbidden('You are not a participant in this session.');
  }

  return session;
}
