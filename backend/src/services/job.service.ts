import type { Types } from 'mongoose';
import { AgentName } from '@careerpilot/shared';
import type { JobMatchResult } from '@careerpilot/shared';
import { Company } from '../models/Company';
import { JobDescription } from '../models/JobDescription';
import { JobRole } from '../models/JobRole';
import { StudentProfile } from '../models/StudentProfile';
import { ApiError } from '../utils/ApiError';
import { aiClient } from './aiClient.service';

/**
 * Runs the job-matching agent for a student against one job description.
 *
 * The student's skills come from their profile (which the resume pipeline has
 * already enriched), so matching reflects everything known about them rather
 * than only what they typed.
 */
export async function matchStudentToJob(
  studentId: Types.ObjectId,
  jobDescriptionId: string,
  userId: string,
): Promise<JobMatchResult> {
  const [profile, jd] = await Promise.all([
    StudentProfile.findById(studentId),
    JobDescription.findById(jobDescriptionId)
      .populate<{ companyId: { _id: Types.ObjectId; name: string; recruitmentPattern?: any } }>('companyId', 'name recruitmentPattern')
      .populate<{ roleId: { _id: Types.ObjectId; title: string } }>('roleId', 'title'),
  ]);

  if (!profile) throw ApiError.notFound('Student profile');
  if (!jd) throw ApiError.notFound('Job description');

  const eligibility = jd.companyId?.recruitmentPattern?.eligibility ?? {};

  const payload = {
    studentSkills: profile.skills.map((s) => s.name),
    studentProjects: profile.projects.map((p) => `${p.title} ${p.technologies.join(' ')}`),
    studentSummary: profile.summary ?? profile.headline ?? '',
    cgpa: profile.cgpa ?? null,
    backlogs: profile.backlogs ?? 0,
    totalExperienceMonths: profile.experience.length * 3,
    department: profile.department ?? null,

    jobDescriptionId: jd._id.toString(),
    companyName: jd.companyId?.name ?? '',
    roleTitle: jd.roleId?.title ?? jd.title,
    descriptionText: jd.descriptionText,
    requiredSkills: jd.requiredSkills,
    preferredSkills: jd.preferredSkills,
    minCgpa: eligibility.minCgpa ?? null,
    maxBacklogs: eligibility.maxBacklogs ?? null,
    allowedDepartments: eligibility.allowedDepartments ?? [],
  };

  const result = await aiClient.post<typeof payload, JobMatchResult & Record<string, unknown>>(
    '/ai/resume/match',
    payload,
    {
      userId,
      studentId: studentId.toString(),
      agent: AgentName.JOB_MATCHING,
      operation: 'job.match',
    },
  );

  return result.data;
}

/**
 * Matches a student against every active job description for a company,
 * returning the strongest fit first.
 */
export async function matchStudentToCompany(
  studentId: Types.ObjectId,
  companyId: string,
  userId: string,
): Promise<JobMatchResult[]> {
  const jds = await JobDescription.find({ companyId, active: true }).select('_id').lean();
  if (!jds.length) {
    throw ApiError.notFound('Active job descriptions for this company');
  }

  // Sequential rather than parallel: each call hits the AI service, and a
  // company with a dozen openings would otherwise burst its rate limit.
  const results: JobMatchResult[] = [];
  for (const jd of jds) {
    results.push(await matchStudentToJob(studentId, jd._id.toString(), userId));
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

export interface CompanyFilters {
  search?: string;
  industry?: string;
  tier?: string;
  page: number;
  limit: number;
}

export async function listCompanies(filters: CompanyFilters) {
  const query: Record<string, unknown> = { active: true };
  if (filters.industry) query.industry = filters.industry;
  if (filters.tier) query.tier = filters.tier;
  if (filters.search) {
    const safe = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.name = { $regex: safe, $options: 'i' };
  }

  const [items, total] = await Promise.all([
    Company.find(query)
      .sort({ name: 1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean(),
    Company.countDocuments(query),
  ]);

  // Attach the open-role count so the listing is useful without a second call.
  const counts = await JobDescription.aggregate([
    { $match: { companyId: { $in: items.map((c) => c._id) }, active: true } },
    { $group: { _id: '$companyId', count: { $sum: 1 } } },
  ]);
  const countByCompany = new Map(counts.map((c) => [String(c._id), c.count as number]));

  return {
    items: items.map((c) => ({ ...c, openRoles: countByCompany.get(c._id.toString()) ?? 0 })),
    total,
  };
}

export async function getCompanyDetail(companyId: string) {
  const company = await Company.findById(companyId).lean();
  if (!company) throw ApiError.notFound('Company');

  const jobDescriptions = await JobDescription.find({ companyId, active: true })
    .populate<{ roleId: { title: string; family: string } }>('roleId', 'title family')
    .lean();

  return {
    company,
    jobDescriptions,
    // Surfaces whether the recruitment pattern is sourced, so the UI can label
    // unverified information rather than presenting it as fact (§10).
    recruitmentPatternVerified: (company.recruitmentPattern?.sources ?? []).length > 0,
  };
}

export async function listRoles(search?: string) {
  const query: Record<string, unknown> = { active: true };
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.title = { $regex: safe, $options: 'i' };
  }
  return JobRole.find(query).sort({ title: 1 }).lean();
}

export async function listJobDescriptions(filters: { companyId?: string; roleId?: string; page: number; limit: number }) {
  const query: Record<string, unknown> = { active: true };
  if (filters.companyId) query.companyId = filters.companyId;
  if (filters.roleId) query.roleId = filters.roleId;

  const [items, total] = await Promise.all([
    JobDescription.find(query)
      .populate<{ companyId: { name: string; logoUrl?: string } }>('companyId', 'name logoUrl tier')
      .populate<{ roleId: { title: string } }>('roleId', 'title')
      .sort({ createdAt: -1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit)
      .lean(),
    JobDescription.countDocuments(query),
  ]);

  return { items, total };
}
