import type { Types } from 'mongoose';
import {
  AgentName,
  AttemptStatus,
  DataProvenance,

  NotificationType,
  SocketEvent,
  type ApieComponentKey,
} from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { AlumniFeedback } from '../models/AlumniFeedback';
import { AssessmentAttempt } from '../models/AssessmentAttempt';
import { Company } from '../models/Company';
import { InterviewEvaluation } from '../models/InterviewEvaluation';
import { JobRole } from '../models/JobRole';
import { PlacementReadiness } from '../models/PlacementReadiness';
import { Recommendation } from '../models/Recommendation';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { SkillGap } from '../models/SkillGap';
import { StudentProfile } from '../models/StudentProfile';
import { emitToUser } from '../sockets/emitter';
import { aiClient } from './aiClient.service';
import { configService } from './config.service';
import { notify } from './notification.service';
import { profileEvidenceCounts } from './student.service';
import { average, normalizeSkill, round } from '../utils/helpers';
import { ApiError } from '../utils/ApiError';

const log = moduleLogger('apie');

interface ComponentEvidence {
  value: number | null;
  evidenceCount: number;
  lastUpdated: string | null;
}

/**
 * Gathers every measured signal for a student from across the database.
 *
 * Two decisions worth noting:
 *  - Recent evidence is weighted over old evidence within a component, because
 *    a student's 5th coding attempt says more about them now than their 1st.
 *  - Communication has no assessment of its own; it is derived from the
 *    communication sub-scores already measured inside interviews.
 */
export async function collectEvidence(studentId: Types.ObjectId): Promise<Record<ApieComponentKey, ComponentEvidence>> {
  const [resumeAnalyses, codingAttempts, aptitudeAttempts, technicalMcq, interviews] = await Promise.all([
    ResumeAnalysis.find({ studentId }).sort({ createdAt: -1 }).limit(5).select('atsScore createdAt').lean(),
    AssessmentAttempt.find({ studentId, assessmentType: 'CODING', status: AttemptStatus.EVALUATED })
      .sort({ submittedAt: -1 }).limit(10).select('percentage submittedAt').lean(),
    AssessmentAttempt.find({ studentId, assessmentType: 'APTITUDE', status: AttemptStatus.EVALUATED })
      .sort({ submittedAt: -1 }).limit(10).select('percentage submittedAt').lean(),
    AssessmentAttempt.find({ studentId, assessmentType: 'TECHNICAL_MCQ', status: AttemptStatus.EVALUATED })
      .sort({ submittedAt: -1 }).limit(10).select('percentage submittedAt').lean(),
    InterviewEvaluation.find({ studentId }).sort({ createdAt: -1 }).limit(15)
      .select('mode overallScore technicalScore communicationScore createdAt').lean(),
  ]);

  /**
   * Recency-weighted mean. The most recent result carries full weight and each
   * older one decays, so improvement shows up quickly without a single bad day
   * erasing a track record.
   */
  const weightedMean = (values: number[]): number | null => {
    const valid = values.filter((v) => Number.isFinite(v));
    if (!valid.length) return null;
    let weightedSum = 0;
    let weightTotal = 0;
    valid.forEach((value, index) => {
      const weight = 1 / (index + 1);
      weightedSum += value * weight;
      weightTotal += weight;
    });
    return round(weightedSum / weightTotal, 2);
  };

  const evidence = (values: number[], dates: Array<Date | undefined | null>): ComponentEvidence => ({
    value: weightedMean(values),
    evidenceCount: values.length,
    lastUpdated: dates[0] ? new Date(dates[0]).toISOString() : null,
  });

  const technicalInterviews = interviews.filter((i) =>
    ['TECHNICAL', 'COMPANY_SPECIFIC', 'ROLE_SPECIFIC', 'RESUME_BASED'].includes(i.mode),
  );
  const hrInterviews = interviews.filter((i) => i.mode === 'HR' || i.mode === 'BEHAVIORAL');

  // Communication is measured inside interviews rather than separately.
  const communicationSamples = [
    ...interviews.map((i) => i.communicationScore).filter((v): v is number => Number.isFinite(v) && v > 0),
  ];
  const communicationDate = interviews[0]?.createdAt ?? null;

  // Technical MCQ results, where present, blend into the technical component.
  const technicalSamples = [
    ...technicalInterviews.map((i) => i.overallScore),
    ...technicalMcq.map((a) => a.percentage ?? 0),
  ];

  return {
    resume: evidence(resumeAnalyses.map((r) => r.atsScore), resumeAnalyses.map((r) => r.createdAt)),
    coding: evidence(codingAttempts.map((a) => a.percentage ?? 0), codingAttempts.map((a) => a.submittedAt)),
    technical: evidence(technicalSamples, [technicalInterviews[0]?.createdAt ?? technicalMcq[0]?.submittedAt]),
    hr: evidence(hrInterviews.map((i) => i.overallScore), hrInterviews.map((i) => i.createdAt)),
    communication: evidence(communicationSamples, [communicationDate]),
    aptitude: evidence(aptitudeAttempts.map((a) => a.percentage ?? 0), aptitudeAttempts.map((a) => a.submittedAt)),
    // Derived by the AI service from CGPA and backlogs.
    academic: { value: null, evidenceCount: 0, lastUpdated: null },
  };
}

export interface RecomputeResult {
  readiness: Record<string, unknown>;
  score: number;
  band: string;
  delta: number | null;
}

/**
 * Recomputes readiness and persists a new snapshot.
 *
 * This is the hinge of the continuous feedback loop (§43): every activity that
 * produces a score calls it, so the readiness number, skill gaps and
 * recommendations are never stale relative to what the student has done.
 */
export async function recomputeReadiness(
  studentId: Types.ObjectId,
  trigger: string,
): Promise<RecomputeResult | null> {
  const profile = await StudentProfile.findById(studentId);
  if (!profile) throw ApiError.notFound('Student profile');

  const [components, weights, modifiers, bands, reassessmentDays, previous] = await Promise.all([
    collectEvidence(studentId),
    configService.getApieWeights(),
    configService.getApieModifiers(),
    configService.getReadinessBands(),
    configService.getReassessmentDays(),
    PlacementReadiness.findOne({ studentId, isLatest: true }).select('score').lean(),
  ]);

  const [targetRoles, targetCompanies, alumniFeedback, gapDocs, counts] = await Promise.all([
    JobRole.find({ _id: { $in: profile.targetRoles } }).select('title coreSkills').lean(),
    Company.find({ _id: { $in: profile.targetCompanies } }).select('name recruitmentPattern').lean(),
    AlumniFeedback.find({ studentId }).sort({ createdAt: -1 }).limit(5).select('overallScore').lean(),
    SkillGap.find({ studentId, resolved: false }).select('skill').lean(),
    Promise.resolve(profileEvidenceCounts(profile)),
  ]);

  const [assessmentsTaken, interviewsTaken] = await Promise.all([
    AssessmentAttempt.countDocuments({ studentId, status: AttemptStatus.EVALUATED }),
    InterviewEvaluation.countDocuments({ studentId }),
  ]);

  const payload = {
    studentId: studentId.toString(),
    components,
    profile: {
      cgpa: counts.cgpa,
      backlogs: counts.backlogs,
      projectCount: counts.projectCount,
      certificationCount: counts.certificationCount,
      internshipMonths: counts.internshipMonths,
      alumniFeedbackScore: alumniFeedback.length ? round(average(alumniFeedback.map((f) => f.overallScore)), 2) : null,
      assessmentsTaken,
      interviewsTaken,
    },
    studentSkills: profile.skills.map((s) => s.name),
    targetRoles: targetRoles.map((r) => ({ roleId: r._id.toString(), roleTitle: r.title, coreSkills: r.coreSkills })),
    targetCompanies: targetCompanies.map((c) => ({
      companyId: c._id.toString(),
      companyName: c.name,
      minCgpa: c.recruitmentPattern?.eligibility?.minCgpa ?? null,
      maxBacklogs: c.recruitmentPattern?.eligibility?.maxBacklogs ?? null,
    })),
    jobMatchMissingSkills: gapDocs.map((g) => g.skill),
    previousScore: previous?.score ?? null,
    weights,
    modifiers,
    bands,
    reassessmentDays,
    weightsVersion: '1.0.0',
    includeMlPrediction: true,
    includeRecommendations: true,
  };

  let result;
  try {
    result = await aiClient.post<typeof payload, Record<string, any>>('/ai/readiness/predict', payload, {
      userId: profile.userId.toString(),
      studentId: studentId.toString(),
      agent: AgentName.PLACEMENT_READINESS,
      operation: 'readiness.compute',
    });
  } catch (error) {
    // Readiness is recomputed on every activity; one unavailable AI service
    // must not break the activity that triggered it.
    log.warn({ err: (error as Error).message, studentId: studentId.toString() }, 'Readiness recomputation skipped');
    return null;
  }

  const data = result.data;

  // Snapshots are append-only: mark the previous one historical, insert the new.
  await PlacementReadiness.updateMany({ studentId, isLatest: true }, { $set: { isLatest: false } });

  const readiness = await PlacementReadiness.create({
    studentId,
    userId: profile.userId,
    score: data.score,
    band: data.band,
    components: data.components,
    modifiers: data.modifiers,
    strengths: data.strengths,
    weaknesses: data.weaknesses,
    skillGaps: data.skillGaps,
    targetRoleReadiness: data.targetRoleReadiness,
    targetCompanyReadiness: data.targetCompanyReadiness,
    reassessmentSuggestions: data.reassessmentSuggestions,
    mlPrediction: data.mlPrediction ?? null,
    weightsVersion: data.weightsVersion,
    weightsSnapshot: data.weightsSnapshot,
    modelDisclaimer: data.modelDisclaimer,
    trigger,
    previousScore: data.previousScore ?? null,
    delta: data.delta ?? null,
    isLatest: true,
    provenance: profile.provenance === DataProvenance.DEMO ? DataProvenance.DEMO : DataProvenance.REAL,
    computedAt: new Date(),
  });

  await Promise.all([
    persistSkillGaps(studentId, data.skillGaps ?? []),
    persistRecommendations(studentId, readiness._id, data.recommendations ?? []),
  ]);

  emitToUser(profile.userId.toString(), SocketEvent.READINESS_UPDATED, {
    score: data.score,
    band: data.band,
    delta: data.delta,
    trigger,
  });

  // Only notify on a band change: a notification for every 0.4-point move
  // would train the student to ignore notifications entirely.
  if (previous && data.band && bandOf(previous.score, bands) !== data.band) {
    await notify({
      userId: profile.userId,
      type: NotificationType.READINESS_CHANGED,
      title: `Your placement readiness is now ${String(data.band).replace(/_/g, ' ').toLowerCase()}`,
      body: `Your Placement Readiness Score moved to ${data.score}/100 after your latest activity.`,
      link: '/readiness',
      metadata: { score: data.score, band: data.band, delta: data.delta },
    });
  }

  log.info(
    { studentId: studentId.toString(), score: data.score, band: data.band, trigger },
    'Readiness recomputed',
  );

  return { readiness: readiness.toJSON(), score: data.score, band: data.band, delta: data.delta ?? null };
}

function bandOf(score: number, bands: Array<{ band: string; min: number; max: number }>): string {
  return bands.find((b) => score >= b.min && score <= b.max)?.band ?? 'AT_RISK';
}

/**
 * Upserts the current gap set and resolves gaps that no longer appear.
 * Keeping resolved records (rather than deleting) preserves the improvement
 * history the research export depends on.
 */
async function persistSkillGaps(studentId: Types.ObjectId, gaps: Array<Record<string, any>>): Promise<void> {
  const currentKeys = new Set<string>();

  for (const gap of gaps) {
    if (!gap?.skill) continue;
    const key = normalizeSkill(gap.skill);
    currentKeys.add(key);

    await SkillGap.findOneAndUpdate(
      { studentId, normalizedSkill: key },
      {
        $set: {
          skill: gap.skill,
          category: gap.category ?? 'PROGRAMMING_LANGUAGE',
          currentLevel: gap.currentLevel ?? 0,
          requiredLevel: gap.requiredLevel ?? 70,
          gap: gap.gap ?? 70,
          severity: gap.severity ?? 'MEDIUM',
          source: gap.source ?? 'ROLE_REQUIREMENT',
          relatedRoles: gap.relatedRoles ?? [],
          recommendedActions: gap.recommendedActions ?? [],
          resolved: false,
          resolvedAt: null,
        },
      },
      { upsert: true },
    );
  }

  await SkillGap.updateMany(
    { studentId, resolved: false, normalizedSkill: { $nin: [...currentKeys] } },
    { $set: { resolved: true, resolvedAt: new Date() } },
  );
}

/**
 * Replaces the active recommendation set.
 * Completed and dismissed recommendations are left untouched so the student's
 * own decisions are never overwritten by a recomputation.
 */
async function persistRecommendations(
  studentId: Types.ObjectId,
  readinessId: Types.ObjectId,
  recommendations: Array<Record<string, any>>,
): Promise<void> {
  await Recommendation.deleteMany({ studentId, status: 'ACTIVE' });

  if (!recommendations.length) return;

  await Recommendation.insertMany(
    recommendations.slice(0, 10).map((rec) => ({
      studentId,
      title: String(rec.title ?? 'Recommended action').slice(0, 200),
      description: String(rec.description ?? '').slice(0, 2000),
      category: rec.category ?? 'SKILL',
      priority: rec.priority ?? 'MEDIUM',
      estimatedHours: Number(rec.estimatedHours ?? 4),
      actionRoute: rec.actionRoute,
      actionLabel: rec.actionLabel,
      rationale: String(rec.rationale ?? '').slice(0, 1000),
      resources: Array.isArray(rec.resources) ? rec.resources.slice(0, 6) : [],
      status: 'ACTIVE',
      generatedBy: AgentName.PLACEMENT_READINESS,
      readinessId,
    })),
  );
}

export async function getLatestReadiness(studentId: Types.ObjectId) {
  return PlacementReadiness.findOne({ studentId, isLatest: true }).lean();
}

export async function getReadinessTrend(studentId: Types.ObjectId, limit = 20) {
  const docs = await PlacementReadiness.find({ studentId })
    .sort({ computedAt: -1 })
    .limit(limit)
    .select('score band computedAt components trigger')
    .lean();

  return docs.reverse().map((doc) => ({
    date: doc.computedAt.toISOString(),
    score: doc.score,
    band: doc.band,
    trigger: doc.trigger,
    components: Object.fromEntries(
      (doc.components as Array<{ key: string; normalized: number }>).map((c) => [c.key, c.normalized]),
    ),
  }));
}
