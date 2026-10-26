import { z } from 'zod';
import {
  AccountStatus,
  AssessmentType,
  Difficulty,
  DSA_LANGUAGE_IDS,
  DSA_TAGS,
  type DsaLanguageId,
  InterviewMode,
  MonitoringEventType,
  UserRole,
} from '@careerpilot/shared';
import { objectId, safeString } from './common.validator';

export * from './common.validator';
export * from './auth.validator';
export * from './student.validator';

/* ------------------------------------------------------------------ */
/* Resume                                                              */
/* ------------------------------------------------------------------ */

export const analyzeResumeSchema = z
  .object({
    /** A predefined job description from the catalogue. */
    jobDescriptionId: objectId.optional(),
    /** A job description supplied by the student. Used for this analysis only; never stored. */
    jobDescriptionText: z
      .string()
      .trim()
      .min(80, 'The job description is too short to compare against. Paste at least a few lines.')
      .max(20_000, 'The job description is too long (maximum 20,000 characters).')
      .optional(),
    jobDescriptionLabel: safeString(120).optional(),
    applyToProfile: z.boolean().default(true),
  })
  .refine((value) => !(value.jobDescriptionId && value.jobDescriptionText), {
    message: 'Choose a predefined job description or supply your own, not both.',
    path: ['jobDescriptionText'],
  });

/* ------------------------------------------------------------------ */
/* Companies & jobs                                                    */
/* ------------------------------------------------------------------ */

export const companyListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: safeString(120).optional(),
  industry: safeString(120).optional(),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3', 'PRODUCT', 'SERVICE', 'STARTUP']).optional(),
});

export const jobListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  companyId: objectId.optional(),
  roleId: objectId.optional(),
});

export const matchJobSchema = z.object({ jobDescriptionId: objectId });
export const matchCompanySchema = z.object({ companyId: objectId });

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

export const assessmentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(AssessmentType).optional(),
  difficulty: z.nativeEnum(Difficulty).optional(),
  companyId: objectId.optional(),
});

export const startAttemptSchema = z.object({
  webcamConsent: z.boolean().default(false),
});

export const autosaveSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: objectId,
        // `null` clears an answer; a string or array sets it.
        answer: z.union([z.string().max(5000), z.array(z.string().max(500)).max(20), z.null()]).optional(),
        markedForReview: z.boolean().optional(),
        timeSpentSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
      }),
    )
    .max(200),
});

export const monitoringEventSchema = z.object({
  type: z.nativeEnum(MonitoringEventType),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const monitoringBatchSchema = z.object({
  events: z.array(monitoringEventSchema).min(1).max(50),
});

/* ------------------------------------------------------------------ */
/* Coding                                                              */
/* ------------------------------------------------------------------ */

export const codingListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  difficulty: z.nativeEnum(Difficulty).optional(),
  // Comma-separated tag names; a problem must carry all of them.
  tags: z
    .string()
    .max(400)
    .optional()
    .transform((value) => (value ? value.split(',').map((t) => t.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(DSA_TAGS)).max(DSA_TAGS.length).optional()),
  company: safeString(120).optional(),
  search: safeString(120).optional(),
});

export const submissionListQuery = z.object({
  problemId: objectId.optional(),
});

export const runCodeSchema = z.object({
  language: z.enum(DSA_LANGUAGE_IDS as [DsaLanguageId, ...DsaLanguageId[]]),
  code: z.string().min(1, 'Code cannot be empty').max(100_000),
  attemptId: objectId.optional(),
});

/* ------------------------------------------------------------------ */
/* Interviews                                                          */
/* ------------------------------------------------------------------ */

export const startInterviewSchema = z.object({
  mode: z.nativeEnum(InterviewMode).default(InterviewMode.TECHNICAL),
  companyId: objectId.optional(),
  roleId: objectId.optional(),
  difficulty: z.nativeEnum(Difficulty).default(Difficulty.MEDIUM),
  plannedQuestions: z.coerce.number().int().min(3).max(20).default(8),
  mediaConsent: z
    .object({
      camera: z.boolean().default(false),
      microphone: z.boolean().default(false),
      recording: z.boolean().default(false),
    })
    .optional(),
});

export const submitAnswerSchema = z.object({
  questionId: objectId,
  transcript: z.string().max(20_000),
  inputMode: z.enum(['TEXT', 'SPEECH']).default('TEXT'),
  durationSeconds: z.coerce.number().int().min(0).max(3600).default(0),
});

/* ------------------------------------------------------------------ */
/* Alumni & mentorship                                                 */
/* ------------------------------------------------------------------ */

export const alumniSearchQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(20),
  company: safeString(120).optional(),
  role: safeString(120).optional(),
  domain: safeString(120).optional(),
  expertise: safeString(120).optional(),
  search: safeString(120).optional(),
  acceptingOnly: z.coerce.boolean().default(true),
});

export const updateAlumniProfileSchema = z
  .object({
    fullName: safeString(120).optional(),
    company: safeString(160).optional(),
    designation: safeString(160).optional(),
    experienceYears: z.coerce.number().min(0).max(60).optional(),
    domain: safeString(120).optional(),
    expertise: z.array(safeString(80)).max(20).optional(),
    skills: z.array(safeString(80)).max(40).optional(),
    college: safeString(200).optional(),
    graduationYear: z.coerce.number().int().min(1950).max(2100).optional(),
    department: safeString(120).optional(),
    linkedinUrl: z.string().url().max(500).optional().or(z.literal('')),
    bio: safeString(2000).optional(),
    acceptingMentees: z.boolean().optional(),
    maxMenteesPerMonth: z.coerce.number().int().min(0).max(100).optional(),
    availability: z
      .array(
        z.object({
          dayOfWeek: z.coerce.number().int().min(0).max(6),
          startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm format'),
          endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm format'),
          timezone: safeString(60).default('Asia/Kolkata'),
        }),
      )
      .max(30)
      .optional(),
    employmentProof: z
      .object({
        workEmail: z.string().email().max(254).optional(),
        employeeId: safeString(60).optional(),
      })
      .optional(),
  })
  .strict();

export const mentorshipRequestSchema = z.object({
  alumniId: objectId,
  topic: safeString(200).pipe(z.string().min(3)),
  message: safeString(2000).pipe(z.string().min(10, 'Please describe what you would like help with')),
  targetRole: safeString(120).optional(),
  targetCompany: safeString(120).optional(),
  preferredSlots: z.array(z.string().datetime()).max(5).default([]),
});

export const respondRequestSchema = z
  .object({
    accept: z.boolean(),
    message: safeString(1000).optional(),
    scheduledAt: z.string().datetime().optional(),
    durationMinutes: z.coerce.number().int().min(15).max(180).default(45),
    type: z.enum(['MOCK_INTERVIEW', 'MENTORSHIP_CALL', 'RESUME_REVIEW']).default('MOCK_INTERVIEW'),
  })
  .refine((data) => !data.accept || Boolean(data.scheduledAt), {
    message: 'A scheduled date and time is required when accepting a request',
    path: ['scheduledAt'],
  });

const rating10 = z.coerce.number().min(0).max(10);

export const alumniFeedbackSchema = z.object({
  technicalKnowledge: rating10,
  communication: rating10,
  problemSolving: rating10,
  confidence: rating10,
  roleSuitability: rating10,
  recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'BORDERLINE', 'NEEDS_WORK']),
  strengths: z.array(safeString(300)).max(10).default([]),
  improvements: z.array(safeString(300)).max(10).default([]),
  comments: safeString(5000).default(''),
});

export const rateMentorSchema = z.object({ rating: z.coerce.number().int().min(1).max(5) });

export const sessionNotesSchema = z.object({ notes: safeString(8000) });

/* ------------------------------------------------------------------ */
/* Analytics & reports                                                 */
/* ------------------------------------------------------------------ */

export const analyticsQuery = z.object({
  department: safeString(120).optional(),
  batch: safeString(20).optional(),
  section: safeString(10).optional(),
  band: z.enum(['AT_RISK', 'NEEDS_IMPROVEMENT', 'PLACEMENT_READY', 'HIGHLY_READY']).optional(),
  targetCompany: safeString(120).optional(),
});

export const researchExportQuery = analyticsQuery.extend({
  provenance: z.enum(['DEMO', 'SYNTHETIC', 'REAL']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const reportQuery = z.object({
  ref: z.string().max(64).optional(),
  studentId: objectId.optional(),
});

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export const userListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(AccountStatus).optional(),
  search: safeString(120).optional(),
});

export const changeRoleSchema = z.object({ role: z.nativeEnum(UserRole) });
export const changeStatusSchema = z.object({ status: z.nativeEnum(AccountStatus) });

export const verifyAlumniSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED', 'PENDING']),
  note: safeString(1000).optional(),
});

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: safeString(80).optional(),
  actorId: objectId.optional(),
  resource: safeString(80).optional(),
  status: z.enum(['SUCCESS', 'FAILURE']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const configUpdateSchema = z.object({
  value: z.unknown().refine((v) => v !== undefined, 'A value is required'),
});

export const reviewIntegritySchema = z.object({
  note: safeString(1000),
  clear: z.boolean().default(false),
});

export const companySchema = z.object({
  name: safeString(160),
  industry: safeString(120),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3', 'PRODUCT', 'SERVICE', 'STARTUP']).default('SERVICE'),
  website: z.string().url().max(300).optional().or(z.literal('')),
  description: safeString(4000).optional(),
  headquarters: safeString(160).optional(),
  recruitmentPattern: z
    .object({
      rounds: z.array(z.object({ name: safeString(120), description: safeString(500).optional(), durationMinutes: z.coerce.number().int().min(0).max(600).optional() })).max(12).default([]),
      eligibility: z
        .object({
          minCgpa: z.coerce.number().min(0).max(10).optional(),
          maxBacklogs: z.coerce.number().int().min(0).max(50).optional(),
          allowedDepartments: z.array(safeString(120)).max(30).default([]),
        })
        .optional(),
      averagePackageLpa: z.coerce.number().min(0).max(500).optional(),
      hiringSeason: safeString(60).optional(),
      sources: z.array(z.string().max(500)).max(10).default([]),
    })
    .optional(),
  active: z.boolean().default(true),
});

export const jobRoleSchema = z.object({
  title: safeString(160),
  family: safeString(120),
  description: safeString(4000).optional(),
  coreSkills: z.array(safeString(80)).max(40).default([]),
  interviewTopics: z.array(safeString(80)).max(30).default([]),
  active: z.boolean().default(true),
});

export const jobDescriptionSchema = z.object({
  companyId: objectId,
  roleId: objectId,
  title: safeString(200),
  location: safeString(160).optional(),
  experienceLevel: safeString(60).default('Fresher'),
  packageLpa: z.coerce.number().min(0).max(500).optional(),
  descriptionText: z.string().min(50, 'The job description must be at least 50 characters').max(20_000),
  requiredSkills: z.array(safeString(80)).max(40).default([]),
  preferredSkills: z.array(safeString(80)).max(40).default([]),
  responsibilities: z.array(safeString(500)).max(30).default([]),
  qualifications: z.array(safeString(500)).max(30).default([]),
  active: z.boolean().default(true),
});

export const ragDocumentSchema = z.object({
  title: safeString(200),
  category: z.enum([
    'COMPANY_PROFILE', 'JOB_DESCRIPTION', 'ROLE_REQUIREMENTS', 'INTERVIEW_PREP',
    'CODING_PATTERN', 'HR_PREP', 'GD_TOPIC', 'CAREER_RESOURCE',
  ]),
  content: z.string().min(50, 'Document content must be at least 50 characters').max(100_000),
  companyId: objectId.optional(),
  roleId: objectId.optional(),
  sourceUrls: z.array(z.string().url().max(500)).max(10).default([]),
  sourceNote: safeString(1000).optional(),
  tags: z.array(safeString(60)).max(20).default([]),
  active: z.boolean().default(true),
});

export const ragQuerySchema = z.object({
  question: z.string().min(5, 'Please ask a longer question').max(1000),
  category: z.string().max(60).optional(),
  companyId: objectId.optional(),
  roleId: objectId.optional(),
  topK: z.coerce.number().int().min(1).max(15).optional(),
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export const notificationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
});

export const announcementSchema = z.object({
  title: safeString(200),
  body: safeString(2000),
  roles: z.array(z.nativeEnum(UserRole)).min(1).default([UserRole.STUDENT]),
  link: safeString(300).optional(),
  sendEmail: z.boolean().default(false),
});
