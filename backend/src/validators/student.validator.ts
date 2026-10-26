import { z } from 'zod';
import { SkillCategory } from '@careerpilot/shared';
import { objectId, optionalUrl, safeString } from './common.validator';

const educationEntry = z.object({
  degree: safeString(120),
  institution: safeString(200),
  fieldOfStudy: safeString(120).optional(),
  startYear: z.coerce.number().int().min(1950).max(2100).optional(),
  endYear: z.coerce.number().int().min(1950).max(2100).optional(),
  cgpa: z.coerce.number().min(0).max(10).optional(),
  percentage: z.coerce.number().min(0).max(100).optional(),
});

const projectEntry = z.object({
  title: safeString(150),
  description: safeString(2000).optional(),
  technologies: z.array(safeString(60)).max(30).default([]),
  link: optionalUrl,
  durationMonths: z.coerce.number().int().min(0).max(240).optional(),
});

const experienceEntry = z.object({
  company: safeString(150),
  role: safeString(150),
  type: z.enum(['INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'FREELANCE']).default('INTERNSHIP'),
  startDate: safeString(30).optional(),
  endDate: safeString(30).optional(),
  description: safeString(2000).optional(),
});

const certificationEntry = z.object({
  name: safeString(200),
  issuer: safeString(150).optional(),
  issuedOn: safeString(30).optional(),
  credentialId: safeString(120).optional(),
  link: optionalUrl,
});

const studentSkill = z.object({
  name: safeString(80),
  category: z.nativeEnum(SkillCategory).default(SkillCategory.PROGRAMMING_LANGUAGE),
  proficiency: z.coerce.number().min(0).max(100).default(50),
  source: z.enum(['SELF', 'RESUME', 'ASSESSMENT', 'ALUMNI']).default('SELF'),
});

/**
 * Profile update. Every field is optional so the frontend can PATCH one section
 * at a time; `.strict()` rejects unknown keys so a client cannot smuggle in
 * fields the schema does not own (such as `profileCompletion`).
 */
export const updateProfileSchema = z
  .object({
    fullName: safeString(120).optional(),
    rollNumber: safeString(40).optional(),
    department: safeString(120).optional(),
    degree: safeString(120).optional(),
    batch: safeString(20).optional(),
    section: safeString(10).optional(),
    graduationYear: z.coerce.number().int().min(1980).max(2100).optional(),
    cgpa: z.coerce.number().min(0).max(10).optional(),
    backlogs: z.coerce.number().int().min(0).max(50).optional(),
    phone: safeString(20).optional(),
    location: safeString(120).optional(),
    linkedinUrl: optionalUrl,
    githubUrl: optionalUrl,
    portfolioUrl: optionalUrl,
    headline: safeString(160).optional(),
    summary: safeString(2000).optional(),
    skills: z.array(studentSkill).max(80).optional(),
    education: z.array(educationEntry).max(10).optional(),
    projects: z.array(projectEntry).max(25).optional(),
    experience: z.array(experienceEntry).max(20).optional(),
    certifications: z.array(certificationEntry).max(30).optional(),
    achievements: z.array(safeString(300)).max(30).optional(),
  })
  .strict();

export const setTargetsSchema = z.object({
  companyIds: z.array(objectId).max(15).default([]),
  roleIds: z.array(objectId).max(10).default([]),
  companyNames: z.array(safeString(120)).max(15).default([]),
  roleTitles: z.array(safeString(120)).max(10).default([]),
});

export const studentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  department: safeString(120).optional(),
  batch: safeString(20).optional(),
  section: safeString(10).optional(),
  band: z.enum(['AT_RISK', 'NEEDS_IMPROVEMENT', 'PLACEMENT_READY', 'HIGHLY_READY']).optional(),
  search: safeString(120).optional(),
  minPrs: z.coerce.number().min(0).max(100).optional(),
  maxPrs: z.coerce.number().min(0).max(100).optional(),
  targetCompany: safeString(120).optional(),
  sort: z.enum(['prs', 'name', 'cgpa', 'recent']).default('prs'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type StudentListQuery = z.infer<typeof studentListQuery>;
