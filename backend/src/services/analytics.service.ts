import { AgentName, AttemptStatus, ReadinessBand, VerificationStatus } from '@careerpilot/shared';
import type { PlacementAnalyticsDto } from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { AlumniProfile } from '../models/AlumniProfile';
import { AssessmentAttempt } from '../models/AssessmentAttempt';
import { InterviewEvaluation } from '../models/InterviewEvaluation';
import { MentorshipSession } from '../models/MentorshipSession';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { SkillGap } from '../models/SkillGap';
import { StudentProfile } from '../models/StudentProfile';
import { average, percentage, round } from '../utils/helpers';
import { aiClient } from './aiClient.service';

const log = moduleLogger('analytics');

export interface AnalyticsFilters {
  department?: string;
  batch?: string;
  section?: string;
  band?: ReadinessBand;
  targetCompany?: string;
}

function buildProfileFilter(filters: AnalyticsFilters): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (filters.department) query.department = filters.department;
  if (filters.batch) query.batch = filters.batch;
  if (filters.section) query.section = filters.section;
  if (filters.targetCompany) query.targetCompanyNames = filters.targetCompany;
  return query;
}

/**
 * Institution-wide placement analytics (§23).
 *
 * Everything is computed from the latest readiness snapshot per student, which
 * is why `PlacementReadiness` carries the `isLatest` flag - it turns what would
 * be a per-student subquery into a single indexed lookup.
 */
export async function getPlacementAnalytics(filters: AnalyticsFilters): Promise<PlacementAnalyticsDto> {
  const profiles = await StudentProfile.find(buildProfileFilter(filters)).select('_id department batch targetCompanyNames targetRoleTitles lastActivityAt').lean();
  const studentIds = profiles.map((p) => p._id);

  const [readinessDocs, alumniStats, sessionCount] = await Promise.all([
    PlacementReadiness.find({ studentId: { $in: studentIds }, isLatest: true })
      .select('studentId score band components')
      .lean(),
    AlumniProfile.aggregate([
      { $group: { _id: '$verificationStatus', count: { $sum: 1 } } },
    ]),
    MentorshipSession.countDocuments({ studentId: { $in: studentIds } }),
  ]);

  const filtered = filters.band ? readinessDocs.filter((r) => r.band === filters.band) : readinessDocs;
  const scores = filtered.map((r) => r.score);

  // Component averages come from the readiness snapshots, so they always agree
  // with the score shown on each student's dashboard.
  const componentAverage = (key: string): number => {
    const values = filtered
      .flatMap((r) => (r.components as Array<{ key: string; raw: number | null }>))
      .filter((c) => c.key === key && c.raw !== null)
      .map((c) => c.raw as number);
    return values.length ? round(average(values), 1) : 0;
  };

  const bandCounts = new Map<string, number>();
  for (const doc of filtered) bandCounts.set(doc.band, (bandCounts.get(doc.band) ?? 0) + 1);

  const total = filtered.length;
  const readyCount = (bandCounts.get('PLACEMENT_READY') ?? 0) + (bandCounts.get('HIGHLY_READY') ?? 0);
  const atRiskCount = bandCounts.get('AT_RISK') ?? 0;

  const [gapAggregate, companyTally, roleTally, departmentComparison, monthly, alumniParticipation, activityCounts] =
    await Promise.all([
      SkillGap.aggregate([
        { $match: { studentId: { $in: studentIds }, resolved: false } },
        { $group: { _id: '$skill', count: { $sum: 1 }, averageGap: { $avg: '$gap' }, severities: { $push: '$severity' } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]),
      tallyStrings(profiles.flatMap((p) => p.targetCompanyNames ?? [])),
      tallyStrings(profiles.flatMap((p) => p.targetRoleTitles ?? [])),
      buildDepartmentComparison(filters),
      buildMonthlyProgress(studentIds),
      buildAlumniParticipation(),
      Promise.all([
        AssessmentAttempt.countDocuments({ studentId: { $in: studentIds }, status: AttemptStatus.EVALUATED }),
        InterviewEvaluation.countDocuments({ studentId: { $in: studentIds } }),
      ]),
    ]);

  const alumniByStatus = new Map(alumniStats.map((a) => [String(a._id), a.count as number]));
  const activeCutoff = new Date(Date.now() - 30 * 86_400_000);

  return {
    totals: {
      students: profiles.length,
      activeStudents: profiles.filter((p) => p.lastActivityAt && p.lastActivityAt > activeCutoff).length,
      alumni: [...alumniByStatus.values()].reduce((a, b) => a + b, 0),
      verifiedAlumni: alumniByStatus.get(VerificationStatus.VERIFIED) ?? 0,
      assessmentsTaken: activityCounts[0],
      interviewsTaken: activityCounts[1],
      mentorshipSessions: sessionCount,
    },
    averages: {
      prs: scores.length ? round(average(scores), 1) : 0,
      ats: componentAverage('resume'),
      coding: componentAverage('coding'),
      technical: componentAverage('technical'),
      hr: componentAverage('hr'),
      communication: componentAverage('communication'),
      aptitude: componentAverage('aptitude'),
    },
    readinessDistribution: (['AT_RISK', 'NEEDS_IMPROVEMENT', 'PLACEMENT_READY', 'HIGHLY_READY'] as ReadinessBand[]).map(
      (band) => ({
        band,
        count: bandCounts.get(band) ?? 0,
        percentage: percentage(bandCounts.get(band) ?? 0, total),
      }),
    ),
    placementReadyPercentage: percentage(readyCount, total),
    atRiskPercentage: percentage(atRiskCount, total),
    commonSkillGaps: gapAggregate.map((g) => ({
      skill: String(g._id),
      count: g.count as number,
      averageGap: round(g.averageGap as number, 1),
      severity: dominantSeverity(g.severities as string[]),
    })),
    topTargetCompanies: companyTally,
    topTargetRoles: roleTally,
    departmentComparison,
    monthlyProgress: monthly,
    alumniParticipation,
    generatedAt: new Date().toISOString(),
  };
}

function dominantSeverity(severities: string[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
  // Report the most severe classification present, so a cohort-level gap is
  // never understated by averaging it away.
  return order.find((s) => severities.includes(s)) ?? 'MEDIUM';
}

async function tallyStrings(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ company: name, role: name, count }));
}

async function buildDepartmentComparison(filters: AnalyticsFilters) {
  const profiles = await StudentProfile.find(buildProfileFilter({ ...filters, department: undefined }))
    .select('_id department')
    .lean();

  const readiness = await PlacementReadiness.find({
    studentId: { $in: profiles.map((p) => p._id) },
    isLatest: true,
  })
    .select('studentId score')
    .lean();

  const scoreByStudent = new Map(readiness.map((r) => [r.studentId.toString(), r.score]));
  const groups = new Map<string, number[]>();

  for (const profile of profiles) {
    const score = scoreByStudent.get(profile._id.toString());
    if (score === undefined) continue;
    const key = profile.department || 'Unspecified';
    groups.set(key, [...(groups.get(key) ?? []), score]);
  }

  return [...groups.entries()]
    .map(([department, values]) => ({
      department,
      students: values.length,
      averagePrs: round(average(values), 1),
      readyPercentage: percentage(values.filter((v) => v >= 60).length, values.length),
    }))
    .sort((a, b) => b.averagePrs - a.averagePrs);
}

/** Twelve-month readiness/activity trend for the officer dashboard. */
async function buildMonthlyProgress(studentIds: Array<{ toString(): string }>) {
  const since = new Date();
  since.setMonth(since.getMonth() - 11);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [readiness, assessments, interviews] = await Promise.all([
    PlacementReadiness.aggregate([
      { $match: { studentId: { $in: studentIds }, computedAt: { $gte: since } } },
      {
        $group: {
          _id: { year: { $year: '$computedAt' }, month: { $month: '$computedAt' } },
          averagePrs: { $avg: '$score' },
        },
      },
    ]),
    AssessmentAttempt.aggregate([
      { $match: { studentId: { $in: studentIds }, submittedAt: { $gte: since } } },
      { $group: { _id: { year: { $year: '$submittedAt' }, month: { $month: '$submittedAt' } }, count: { $sum: 1 } } },
    ]),
    InterviewEvaluation.aggregate([
      { $match: { studentId: { $in: studentIds }, createdAt: { $gte: since } } },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
    ]),
  ]);

  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
  const prsMap = new Map(readiness.map((r) => [key(r._id.year, r._id.month), r.averagePrs as number]));
  const assessMap = new Map(assessments.map((a) => [key(a._id.year, a._id.month), a.count as number]));
  const interviewMap = new Map(interviews.map((i) => [key(i._id.year, i._id.month), i.count as number]));

  // Emit every month in the window, including empty ones, so the chart has no
  // misleading gaps.
  const months: Array<{ month: string; averagePrs: number; assessments: number; interviews: number }> = [];
  const cursor = new Date(since);
  for (let i = 0; i < 12; i += 1) {
    const k = key(cursor.getFullYear(), cursor.getMonth() + 1);
    months.push({
      month: k,
      averagePrs: round(prsMap.get(k) ?? 0, 1),
      assessments: assessMap.get(k) ?? 0,
      interviews: interviewMap.get(k) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

async function buildAlumniParticipation() {
  const alumni = await AlumniProfile.find({ verificationStatus: VerificationStatus.VERIFIED, sessionsConducted: { $gt: 0 } })
    .populate<{ userId: { fullName: string } }>('userId', 'fullName')
    .sort({ sessionsConducted: -1 })
    .limit(15)
    .lean();

  return alumni.map((a) => ({
    alumniName: (a.userId as unknown as { fullName?: string })?.fullName ?? 'Alumni',
    company: a.company,
    sessions: a.sessionsConducted,
    averageRating: a.averageRating,
  }));
}

/** Runs the analytics agent for cohort insights and interventions (§5.11). */
export async function getCohortInsights(filters: AnalyticsFilters, userId: string) {
  const profiles = await StudentProfile.find(buildProfileFilter(filters))
    .populate<{ userId: { fullName: string } }>('userId', 'fullName')
    .select('_id department batch userId')
    .lean();

  const studentIds = profiles.map((p) => p._id);

  const [readiness, gaps] = await Promise.all([
    PlacementReadiness.find({ studentId: { $in: studentIds }, isLatest: true })
      .select('studentId score components')
      .lean(),
    SkillGap.find({ studentId: { $in: studentIds }, resolved: false }).select('skill gap severity').lean(),
  ]);

  const readinessByStudent = new Map(readiness.map((r) => [r.studentId.toString(), r]));
  const gapCounts = new Map<string, number>();
  for (const gap of gaps) gapCounts.set(gap.studentId.toString(), (gapCounts.get(gap.studentId.toString()) ?? 0) + 1);

  const payload = {
    groupBy: filters.department ? 'batch' : 'department',
    students: profiles.map((profile) => {
      const record = readinessByStudent.get(profile._id.toString());
      const components = (record?.components ?? []) as Array<{ key: string; raw: number | null }>;
      const value = (key: string) => components.find((c) => c.key === key)?.raw ?? null;

      return {
        studentId: profile._id.toString(),
        fullName: (profile.userId as unknown as { fullName?: string })?.fullName ?? 'Student',
        department: profile.department ?? 'Unspecified',
        batch: profile.batch ?? 'Unspecified',
        prs: record?.score ?? null,
        codingScore: value('coding'),
        interviewScore: value('technical'),
        atsScore: value('resume'),
        skillGapCount: gapCounts.get(profile._id.toString()) ?? 0,
      };
    }),
    skillGaps: gaps.map((g) => ({ skill: g.skill, gap: g.gap, severity: g.severity })),
  };

  const result = await aiClient.post<typeof payload, Record<string, any>>('/ai/analytics/cohort', payload, {
    userId,
    agent: AgentName.ANALYTICS,
    operation: 'analytics.cohort',
  });

  return result.data;
}

/** Distinct filter values, so the UI's dropdowns reflect real data. */
export async function getFilterOptions() {
  const [departments, batches, sections, companies] = await Promise.all([
    StudentProfile.distinct('department'),
    StudentProfile.distinct('batch'),
    StudentProfile.distinct('section'),
    StudentProfile.distinct('targetCompanyNames'),
  ]);

  return {
    departments: departments.filter(Boolean).sort(),
    batches: batches.filter(Boolean).sort(),
    sections: sections.filter(Boolean).sort(),
    companies: companies.filter(Boolean).sort(),
    bands: ['AT_RISK', 'NEEDS_IMPROVEMENT', 'PLACEMENT_READY', 'HIGHLY_READY'],
  };
}

/**
 * Research export (§42).
 *
 * Students are pseudonymised: the export carries a stable hash, never a name,
 * roll number or email. `provenance` is preserved on every row so DEMO,
 * SYNTHETIC and REAL records can never be silently mixed in analysis.
 */
export async function buildResearchDataset(filters: AnalyticsFilters & { provenance?: string }) {
  const crypto = await import('node:crypto');
  const query = buildProfileFilter(filters);
  if (filters.provenance) query.provenance = filters.provenance;

  const profiles = await StudentProfile.find(query).lean();
  const studentIds = profiles.map((p) => p._id);

  const [allReadiness, gapCounts, _feedback, assessments, interviews] = await Promise.all([
    PlacementReadiness.find({ studentId: { $in: studentIds } }).sort({ computedAt: 1 }).select('studentId score band components computedAt isLatest').lean(),
    SkillGap.aggregate([
      { $match: { studentId: { $in: studentIds }, resolved: false } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]),
    ResumeAnalysis.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', latest: { $last: '$atsScore' } } },
    ]),
    AssessmentAttempt.aggregate([
      { $match: { studentId: { $in: studentIds }, status: AttemptStatus.EVALUATED } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]),
    InterviewEvaluation.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]),
  ]);

  const readinessByStudent = new Map<string, typeof allReadiness>();
  for (const record of allReadiness) {
    const key = record.studentId.toString();
    readinessByStudent.set(key, [...(readinessByStudent.get(key) ?? []), record]);
  }

  const gapMap = new Map(gapCounts.map((g) => [String(g._id), g.count as number]));
  const assessMap = new Map(assessments.map((a) => [String(a._id), a.count as number]));
  const interviewMap = new Map(interviews.map((i) => [String(i._id), i.count as number]));

  const alumniScores = await import('../models/AlumniFeedback').then(({ AlumniFeedback }) =>
    AlumniFeedback.aggregate([
      { $match: { studentId: { $in: studentIds } } },
      { $group: { _id: '$studentId', avg: { $avg: '$overallScore' } } },
    ]),
  );
  const alumniMap = new Map(alumniScores.map((a) => [String(a._id), a.avg as number]));

  return profiles.map((profile) => {
    const key = profile._id.toString();
    const history = readinessByStudent.get(key) ?? [];
    const first = history[0];
    const latest = history[history.length - 1];
    const components = (latest?.components ?? []) as Array<{ key: string; raw: number | null }>;
    const value = (componentKey: string) => components.find((c) => c.key === componentKey)?.raw ?? null;

    const internshipMonths = profile.experience
      .filter((e) => e.type === 'INTERNSHIP')
      .reduce((sum, e) => sum + Number((e as { durationMonths?: number }).durationMonths ?? 2), 0);

    return {
      // Stable pseudonym: the same student maps to the same id across exports,
      // but the id cannot be reversed to a person without the database.
      anonymousId: crypto.createHash('sha256').update(`careerpilot-research:${key}`).digest('hex').slice(0, 16),
      department: profile.department ?? null,
      batch: profile.batch ?? null,
      provenance: profile.provenance,
      atsScore: value('resume'),
      codingScore: value('coding'),
      technicalScore: value('technical'),
      hrScore: value('hr'),
      communicationScore: value('communication'),
      aptitudeScore: value('aptitude'),
      academicScore: value('academic'),
      projectCount: profile.projects.length,
      certificationCount: profile.certifications.length,
      internshipCount: profile.experience.filter((e) => e.type === 'INTERNSHIP').length,
      internshipMonths,
      alumniFeedbackScore: alumniMap.get(key) ? round(alumniMap.get(key)!, 2) : null,
      skillGapCount: gapMap.get(key) ?? 0,
      assessmentsCompleted: assessMap.get(key) ?? 0,
      interviewsCompleted: interviewMap.get(key) ?? 0,
      sessionsCompleted: (assessMap.get(key) ?? 0) + (interviewMap.get(key) ?? 0),
      firstPrs: first?.score ?? null,
      latestPrs: latest?.score ?? null,
      improvement: first && latest ? round(latest.score - first.score, 2) : null,
      readinessBand: latest?.band ?? null,
      readinessComputations: history.length,
      recordedAt: new Date().toISOString(),
    };
  });
}

log.debug('Analytics service ready');
