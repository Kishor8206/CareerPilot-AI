import type { Types } from 'mongoose';
import type { StudentProfileDto } from '@careerpilot/shared';
import { DataProvenance, SkillCategory } from '@careerpilot/shared';
import { Company } from '../models/Company';
import { JobRole } from '../models/JobRole';
import { StudentProfile, type IStudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { normalizeSkill, uniqueBy } from '../utils/helpers';

/** Loads the profile for a user id, or throws a clear 404. */
export async function getProfileByUserId(userId: string): Promise<IStudentProfile> {
  const profile = await StudentProfile.findOne({ userId });
  if (!profile) {
    throw ApiError.notFound('Student profile');
  }
  return profile;
}

export async function getProfileById(studentId: string | Types.ObjectId): Promise<IStudentProfile> {
  const profile = await StudentProfile.findById(studentId);
  if (!profile) throw ApiError.notFound('Student profile');
  return profile;
}

/** Serialises a profile plus its owning user into the frontend DTO. */
export async function toProfileDto(profile: IStudentProfile): Promise<StudentProfileDto> {
  const user = await User.findById(profile.userId).select('fullName email');

  return {
    id: profile._id.toString(),
    userId: profile.userId.toString(),
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    rollNumber: profile.rollNumber,
    department: profile.department,
    degree: profile.degree,
    batch: profile.batch,
    section: profile.section,
    graduationYear: profile.graduationYear,
    cgpa: profile.cgpa,
    backlogs: profile.backlogs,
    phone: profile.phone,
    location: profile.location,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    headline: profile.headline,
    summary: profile.summary,
    skills: profile.skills,
    education: profile.education,
    projects: profile.projects,
    experience: profile.experience,
    certifications: profile.certifications,
    achievements: profile.achievements,
    targetCompanies: profile.targetCompanyNames,
    targetRoles: profile.targetRoleTitles,
    profileCompletion: profile.profileCompletion,
    provenance: profile.provenance,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export interface UpdateProfileInput {
  fullName?: string;
  [key: string]: unknown;
}

/**
 * Applies a partial profile update.
 *
 * `fullName` lives on the User document, so it is split out and applied there;
 * everything else is assigned onto the profile. The pre-save hook recomputes
 * profile completion.
 */
export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<IStudentProfile> {
  const profile = await getProfileByUserId(userId);
  const { fullName, ...profileFields } = input;

  if (fullName) {
    await User.updateOne({ _id: userId }, { $set: { fullName } });
  }
  if (profileFields.department) {
    // Keep the denormalised department on User in step, since analytics
    // aggregations group by it.
    await User.updateOne({ _id: userId }, { $set: { department: profileFields.department } });
  }

  Object.assign(profile, profileFields);
  profile.lastActivityAt = new Date();
  await profile.save();

  return profile;
}

/**
 * Merges skills extracted from a resume into the profile.
 *
 * Existing self-declared skills keep their proficiency; a skill already present
 * is upgraded to `verified` because the resume corroborates it. New skills are
 * added with a conservative default proficiency, since appearing on a resume is
 * evidence of exposure, not of mastery.
 */
export async function mergeResumeSkills(
  profile: IStudentProfile,
  extracted: Array<{ name: string; category?: string }>,
): Promise<IStudentProfile> {
  const existing = new Map(profile.skills.map((s) => [normalizeSkill(s.name), s]));

  for (const skill of extracted) {
    const key = normalizeSkill(skill.name);
    const current = existing.get(key);
    if (current) {
      current.verified = true;
      if (current.source === 'SELF') current.source = 'RESUME';
      continue;
    }
    profile.skills.push({
      name: skill.name,
      category: (skill.category as SkillCategory) ?? SkillCategory.PROGRAMMING_LANGUAGE,
      proficiency: 55,
      source: 'RESUME',
      verified: true,
    });
  }

  profile.skills = uniqueBy(profile.skills, (s) => normalizeSkill(s.name)).slice(0, 100);
  await profile.save();
  return profile;
}

/**
 * Merges structured resume data into an otherwise-empty profile.
 * Existing user-entered values always win: parsing is a convenience, never an
 * overwrite of something the student typed themselves.
 */
export async function applyParsedResume(profile: IStudentProfile, parsed: Record<string, any>): Promise<IStudentProfile> {
  if (!profile.education.length && Array.isArray(parsed.education) && parsed.education.length) {
    profile.education = parsed.education.slice(0, 6);
  }
  if (!profile.projects.length && Array.isArray(parsed.projects) && parsed.projects.length) {
    profile.projects = parsed.projects.slice(0, 15);
  }
  if (!profile.certifications.length && Array.isArray(parsed.certifications) && parsed.certifications.length) {
    profile.certifications = parsed.certifications.slice(0, 20);
  }
  if (!profile.experience.length && Array.isArray(parsed.internships)) {
    profile.experience = [...parsed.internships, ...(parsed.experience ?? [])].slice(0, 12);
  }
  if (!profile.achievements.length && Array.isArray(parsed.achievements)) {
    profile.achievements = parsed.achievements.slice(0, 15);
  }
  if (profile.cgpa === undefined && typeof parsed.cgpa === 'number') {
    profile.cgpa = parsed.cgpa;
  }
  if (!profile.phone && parsed.phone) profile.phone = String(parsed.phone).slice(0, 20);
  if (!profile.linkedinUrl && Array.isArray(parsed.links)) {
    profile.linkedinUrl = parsed.links.find((l: string) => l.toLowerCase().includes('linkedin'));
    profile.githubUrl = profile.githubUrl ?? parsed.links.find((l: string) => l.toLowerCase().includes('github'));
  }

  await profile.save();
  return profile;
}

/** Resolves target company/role selections, keeping ids and names in step. */
export async function setTargets(
  userId: string,
  input: { companyIds: string[]; roleIds: string[]; companyNames: string[]; roleTitles: string[] },
): Promise<IStudentProfile> {
  const profile = await getProfileByUserId(userId);

  const [companies, roles] = await Promise.all([
    Company.find({ _id: { $in: input.companyIds } }).select('name').lean(),
    JobRole.find({ _id: { $in: input.roleIds } }).select('title').lean(),
  ]);

  // Reject ids that do not exist, rather than silently dropping them - a
  // student choosing a company that vanished should see an error.
  if (companies.length !== input.companyIds.length) {
    throw ApiError.badRequest('One or more selected companies could not be found.');
  }
  if (roles.length !== input.roleIds.length) {
    throw ApiError.badRequest('One or more selected roles could not be found.');
  }

  profile.targetCompanies = companies.map((c) => c._id);
  profile.targetRoles = roles.map((r) => r._id);
  profile.targetCompanyNames = [...new Set([...companies.map((c) => c.name), ...input.companyNames])].slice(0, 15);
  profile.targetRoleTitles = [...new Set([...roles.map((r) => r.title), ...input.roleTitles])].slice(0, 10);
  profile.lastActivityAt = new Date();

  await profile.save();
  return profile;
}

export async function touchActivity(studentId: Types.ObjectId | string): Promise<void> {
  await StudentProfile.updateOne({ _id: studentId }, { $set: { lastActivityAt: new Date() } });
}

/** Counts used by APIE's modifier calculations. */
export function profileEvidenceCounts(profile: IStudentProfile) {
  const internshipMonths = profile.experience
    .filter((e) => e.type === 'INTERNSHIP')
    .reduce((total, e) => {
      const months = Number((e as { durationMonths?: number }).durationMonths ?? 0);
      // Fall back to a conservative 2 months when the resume gave no dates.
      return total + (Number.isFinite(months) && months > 0 ? months : 2);
    }, 0);

  return {
    projectCount: profile.projects.length,
    certificationCount: profile.certifications.length,
    internshipMonths,
    cgpa: profile.cgpa ?? null,
    backlogs: profile.backlogs ?? 0,
  };
}

export const DEMO_PROVENANCE = DataProvenance.DEMO;
