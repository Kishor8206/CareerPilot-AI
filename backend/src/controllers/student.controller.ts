import type { Request, Response } from 'express';
import { UserRole } from '@careerpilot/shared';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { Recommendation } from '../models/Recommendation';
import { SkillGap } from '../models/SkillGap';
import { StudentProfile } from '../models/StudentProfile';
import { AuditAction, audit } from '../services/audit.service';
import * as studentService from '../services/student.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { buildPaginationMeta, ok, paginated } from '../utils/response';

export const getMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await studentService.getProfileByUserId(req.auth!.userId);
  ok(res, await studentService.toProfileDto(profile));
});

export const updateMyProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await studentService.updateProfile(req.auth!.userId, req.body);
  await audit({ action: AuditAction.PROFILE_UPDATE, resource: 'StudentProfile', resourceId: profile._id.toString() }, req);
  ok(res, await studentService.toProfileDto(profile));
});

export const setTargets = asyncHandler(async (req: Request, res: Response) => {
  const profile = await studentService.setTargets(req.auth!.userId, req.body);
  ok(res, await studentService.toProfileDto(profile));
});

/**
 * A student's own record, or any student's record for staff.
 * Staff access is audited because it is access to another person's data (§29).
 */
export const getStudentById = asyncHandler(async (req: Request, res: Response) => {
  const profile = await studentService.getProfileById(req.params.id);
  const isOwner = profile.userId.toString() === req.auth!.userId;

  if (!isOwner) {
    const staff: string[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
    if (!staff.includes(req.auth!.role)) {
      throw ApiError.forbidden('You can only view your own profile.');
    }
    await audit(
      { action: AuditAction.STUDENT_RECORD_ACCESS, resource: 'StudentProfile', resourceId: profile._id.toString() },
      req,
    );
  }

  ok(res, await studentService.toProfileDto(profile));
});

/** Aggregated dashboard payload (§21) - one request rather than eight. */
export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const profile = await studentService.getProfileByUserId(req.auth!.userId);

  const [readiness, gaps, recommendations, trend] = await Promise.all([
    PlacementReadiness.findOne({ studentId: profile._id, isLatest: true }).lean(),
    SkillGap.find({ studentId: profile._id, resolved: false }).sort({ severity: 1, gap: -1 }).limit(10).lean(),
    Recommendation.find({ studentId: profile._id, status: 'ACTIVE' }).sort({ priority: 1, createdAt: -1 }).limit(6).lean(),
    PlacementReadiness.find({ studentId: profile._id })
      .sort({ computedAt: -1 })
      .limit(12)
      .select('score band computedAt components')
      .lean(),
  ]);

  const { MentorshipSession } = await import('../models/MentorshipSession');
  const { AlumniFeedback } = await import('../models/AlumniFeedback');

  const [upcomingSessions, recentFeedback] = await Promise.all([
    MentorshipSession.find({ studentId: profile._id, status: { $in: ['SCHEDULED', 'LIVE'] }, scheduledAt: { $gte: new Date() } })
      .sort({ scheduledAt: 1 })
      .limit(3)
      .lean(),
    AlumniFeedback.find({ studentId: profile._id }).sort({ createdAt: -1 }).limit(3).lean(),
  ]);

  ok(res, {
    profile: await studentService.toProfileDto(profile),
    readiness: readiness ?? null,
    skillGaps: gaps,
    recommendations,
    // Oldest-first so the chart reads left to right.
    trend: trend.reverse().map((t) => ({
      date: t.computedAt.toISOString(),
      score: t.score,
      band: t.band,
      components: Object.fromEntries(
        (t.components as Array<{ key: string; normalized: number }>).map((c) => [c.key, c.normalized]),
      ),
    })),
    upcomingSessions,
    recentFeedback,
    nextAction: recommendations[0]
      ? { title: recommendations[0].title, route: recommendations[0].actionRoute, label: recommendations[0].actionLabel }
      : {
          title: readiness ? 'Keep practising to raise your readiness' : 'Upload your resume to get started',
          route: readiness ? '/career' : '/resume',
          label: readiness ? 'Open your career plan' : 'Upload resume',
        },
  });
});

/** Staff-facing student list with filters (§23). */
export const listStudents = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as import('../validators/student.validator').StudentListQuery;

  const filter: Record<string, unknown> = {};
  if (query.department) filter.department = query.department;
  if (query.batch) filter.batch = query.batch;
  if (query.section) filter.section = query.section;
  if (query.targetCompany) filter.targetCompanyNames = query.targetCompany;

  if (query.search) {
    // Escape user input before it becomes a regular expression.
    const safe = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { rollNumber: { $regex: safe, $options: 'i' } },
      { department: { $regex: safe, $options: 'i' } },
      { headline: { $regex: safe, $options: 'i' } },
    ];
  }

  const profiles = await StudentProfile.find(filter)
    .populate<{ userId: { fullName: string; email: string } }>('userId', 'fullName email')
    .lean();

  // Readiness lives in its own collection; join it in one query rather than
  // per-student, then filter and sort in memory (cohort sizes are institutional,
  // not web-scale).
  const readinessDocs = await PlacementReadiness.find({
    studentId: { $in: profiles.map((p) => p._id) },
    isLatest: true,
  })
    .select('studentId score band components')
    .lean();

  const readinessByStudent = new Map(readinessDocs.map((r) => [r.studentId.toString(), r]));
  const gapCounts = await SkillGap.aggregate([
    { $match: { studentId: { $in: profiles.map((p) => p._id) }, resolved: false } },
    { $group: { _id: '$studentId', count: { $sum: 1 } } },
  ]);
  const gapByStudent = new Map(gapCounts.map((g) => [String(g._id), g.count as number]));

  let rows = profiles.map((profile) => {
    const readiness = readinessByStudent.get(profile._id.toString());
    const components = (readiness?.components ?? []) as Array<{ key: string; raw: number | null }>;
    const componentValue = (key: string) => components.find((c) => c.key === key)?.raw ?? null;

    // `userId` is populated, so it is the user document rather than an ObjectId.
    const owner = profile.userId as unknown as { _id?: { toString(): string }; fullName?: string };

    return {
      studentId: profile._id.toString(),
      userId: owner?._id?.toString() ?? String(profile.userId),
      fullName: owner?.fullName ?? 'Unknown',
      rollNumber: profile.rollNumber,
      department: profile.department,
      batch: profile.batch,
      section: profile.section,
      cgpa: profile.cgpa,
      prs: readiness?.score ?? null,
      band: readiness?.band ?? null,
      atsScore: componentValue('resume'),
      codingScore: componentValue('coding'),
      interviewScore: componentValue('technical'),
      skillGapCount: gapByStudent.get(profile._id.toString()) ?? 0,
      targetCompanies: profile.targetCompanyNames ?? [],
      lastActivityAt: profile.lastActivityAt?.toISOString() ?? null,
    };
  });

  if (query.band) rows = rows.filter((r) => r.band === query.band);
  if (query.minPrs !== undefined) rows = rows.filter((r) => r.prs !== null && r.prs >= query.minPrs!);
  if (query.maxPrs !== undefined) rows = rows.filter((r) => r.prs !== null && r.prs <= query.maxPrs!);
  if (query.search) {
    const needle = query.search.toLowerCase();
    rows = rows.filter(
      (r) => r.fullName.toLowerCase().includes(needle) || (r.rollNumber ?? '').toLowerCase().includes(needle),
    );
  }

  const direction = query.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    switch (query.sort) {
      case 'name':
        return a.fullName.localeCompare(b.fullName) * direction;
      case 'cgpa':
        return ((a.cgpa ?? 0) - (b.cgpa ?? 0)) * direction;
      case 'recent':
        return ((a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0) - (b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0)) * direction;
      default:
        // Students with no score sort last regardless of direction, so the list
        // always opens on actionable records.
        if (a.prs === null && b.prs === null) return 0;
        if (a.prs === null) return 1;
        if (b.prs === null) return -1;
        return (a.prs - b.prs) * direction;
    }
  });

  const total = rows.length;
  const start = (query.page - 1) * query.limit;
  const page = rows.slice(start, start + query.limit);

  await audit({ action: AuditAction.STUDENT_RECORD_ACCESS, resource: 'StudentProfile', metadata: { count: page.length, filters: filter } }, req);

  paginated(res, page, buildPaginationMeta(query.page, query.limit, total));
});
