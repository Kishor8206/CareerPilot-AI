import type { Types } from 'mongoose';
import { AgentName } from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { CareerPlan, type ICareerPlan } from '../models/CareerPlan';
import { ResumeAnalysis } from '../models/ResumeAnalysis';
import { StudentProfile } from '../models/StudentProfile';
import { ApiError } from '../utils/ApiError';
import { aiClient } from './aiClient.service';

const log = moduleLogger('career');

export interface CareerPlanOptions {
  targetRole: string;
  hoursPerDay: number;
  daysPerWeek: number;
  deadlineWeeks?: number | null;
  experienceLevel?: string;
  learningStyle?: string | null;
  /** Skills entered on the form. When omitted, the student's profile skills are used. */
  skills?: Array<{ skill: string; level: string }>;
  /** Pass the latest ATS analysis to the career model as context. */
  useAts?: boolean;
}

/** Profile proficiency is 0-100; the career knowledge uses three levels. */
function levelFor(proficiency: number): string {
  if (proficiency >= 70) return 'advanced';
  if (proficiency >= 40) return 'intermediate';
  return 'beginner';
}

/** Roles, skills and levels the form can offer. Read straight from the AI service's knowledge. */
export async function getCatalogue(): Promise<Record<string, unknown>> {
  return aiClient.get<Record<string, unknown>>('/ai/career/roles');
}

/**
 * Builds the career request and generates a plan.
 *
 * The ATS model is not called here. If `useAts` is set, the OUTPUT of the
 * student's most recent resume analysis (score, matched and missing keywords)
 * is passed along as context. That is the only link between the two models.
 */
export async function generatePlan(
  studentId: Types.ObjectId,
  userId: string,
  options: CareerPlanOptions,
  carry: { completedSkills?: string[]; completedProjects?: string[] } = {},
): Promise<ICareerPlan> {
  const profile = await StudentProfile.findById(studentId);
  if (!profile) throw ApiError.notFound('Student profile');

  // An unknown role is the caller's mistake, not an AI failure: answer 400 with the
  // supported roles instead of letting it surface as a 502 from the AI service.
  const catalogue = (await getCatalogue()) as { roles?: Array<{ name: string; aliases?: string[] }> };
  const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9+#]/g, '');
  const wanted = key(options.targetRole);
  const known = (catalogue.roles ?? []).some((r) => [r.name, ...(r.aliases ?? [])].some((n) => key(n) === wanted));
  if (!known) {
    throw ApiError.badRequest(
      `"${options.targetRole}" is not a supported target role. Choose one of: ${(catalogue.roles ?? []).map((r) => r.name).join(', ')}.`,
    );
  }

  const currentSkills =
    options.skills && options.skills.length
      ? options.skills
      : profile.skills.map((s) => ({ skill: s.name, level: levelFor(s.proficiency) }));

  let atsContext: Record<string, unknown> = {};
  if (options.useAts !== false) {
    const analysis = await ResumeAnalysis.findOne({ studentId }).sort({ createdAt: -1 }).lean();
    if (analysis) {
      atsContext = {
        ats_score: analysis.atsScore,
        matched_skills: analysis.matchedKeywords ?? [],
        missing_skills: analysis.missingKeywords ?? [],
      };
    }
  }

  const completedSkills = carry.completedSkills ?? [];
  const completedProjects = carry.completedProjects ?? [];
  const payload = {
    target_role: options.targetRole,
    current_skills: currentSkills,
    user_profile: {
      available_hours_per_day: options.hoursPerDay,
      available_days_per_week: options.daysPerWeek,
      deadline_weeks: options.deadlineWeeks ?? null,
      experience_level: options.experienceLevel ?? 'STUDENT',
      preferred_learning_style: options.learningStyle ?? null,
    },
    ats_context: atsContext,
    progress: { completed_skills: completedSkills, completed_projects: completedProjects, current_phase: '' },
  };

  const result = await aiClient.post<typeof payload, Record<string, any>>('/ai/career/roadmap', payload, {
    userId,
    studentId: studentId.toString(),
    agent: AgentName.CAREER_PLAN,
    operation: 'career.roadmap',
  });
  const data = result.data;

  await CareerPlan.updateMany({ studentId, isLatest: true }, { $set: { isLatest: false } });
  const saved = await CareerPlan.create({
    studentId,
    userId,
    targetRole: data.plan.target_role,
    request: { ...options, usedProfileSkills: !(options.skills && options.skills.length), atsUsed: Object.keys(atsContext).length > 0 },
    plan: data.plan,
    resources: data.resources ?? [],
    resourcesBySkill: data.resources_by_skill ?? [],
    dailyPlan: data.daily_plan ?? [],
    readiness: data.readiness ?? {},
    schedule: data.schedule ?? {},
    inference: data.inference ?? {},
    completedSkills,
    completedProjects,
    knowledgeVersion: data.knowledge_version ?? '',
    disclaimer: data.disclaimer ?? '',
    isLatest: true,
  });

  log.info(
    { studentId: studentId.toString(), role: saved.targetRole, provider: data.inference?.provider, degraded: data.inference?.degraded },
    'career plan generated',
  );
  return saved;
}

export async function getLatestPlan(studentId: Types.ObjectId): Promise<ICareerPlan | null> {
  return CareerPlan.findOne({ studentId, isLatest: true });
}

export async function getHistory(studentId: Types.ObjectId) {
  return CareerPlan.find({ studentId })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('targetRole readiness.percent schedule.weeks_needed inference.provider completedSkills createdAt isLatest')
    .lean();
}

/**
 * Progress adaptation: records completed skills or projects and regenerates
 * the plan, so the next roadmap moves forward instead of repeating what the
 * student has already done.
 */
export async function recordProgress(
  studentId: Types.ObjectId,
  userId: string,
  update: { completedSkills?: string[]; completedProjects?: string[] },
): Promise<ICareerPlan> {
  const current = await getLatestPlan(studentId);
  if (!current) throw ApiError.badRequest('Generate a career plan first.');

  const planSkills = new Set(((current.plan.skill_gap as Array<{ skill: string }>) ?? []).map((g) => g.skill));
  const unknown = (update.completedSkills ?? []).filter((s) => !planSkills.has(s));
  if (unknown.length) {
    throw ApiError.badRequest(`These skills are not part of your current plan: ${unknown.join(', ')}.`);
  }

  const completedSkills = [...new Set([...current.completedSkills, ...(update.completedSkills ?? [])])];
  const completedProjects = [...new Set([...current.completedProjects, ...(update.completedProjects ?? [])])];
  const request = current.request as unknown as CareerPlanOptions;

  return generatePlan(studentId, userId, { ...request, targetRole: current.targetRole }, { completedSkills, completedProjects });
}
