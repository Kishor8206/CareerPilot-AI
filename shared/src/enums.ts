/**
 * Canonical enumerations for CareerPilot AI.
 * These values are persisted in MongoDB and travel over the REST API, so they
 * must stay stable. Add new members; never rename existing ones.
 */

export const UserRole = {
  STUDENT: 'STUDENT',
  ALUMNI: 'ALUMNI',
  PLACEMENT_OFFICER: 'PLACEMENT_OFFICER',
  ADMIN: 'ADMIN',
  /** Reserved for the future recruiter-facing module (§2). */
  RECRUITER: 'RECRUITER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const ALL_ROLES: UserRole[] = Object.values(UserRole);

export const AccountStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETION_REQUESTED: 'DELETION_REQUESTED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const VerificationStatus = {
  UNVERIFIED: 'UNVERIFIED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const ReadinessBand = {
  AT_RISK: 'AT_RISK',
  NEEDS_IMPROVEMENT: 'NEEDS_IMPROVEMENT',
  PLACEMENT_READY: 'PLACEMENT_READY',
  HIGHLY_READY: 'HIGHLY_READY',
} as const;
export type ReadinessBand = (typeof ReadinessBand)[keyof typeof ReadinessBand];

export const READINESS_BAND_LABEL: Record<ReadinessBand, string> = {
  AT_RISK: 'At Risk',
  NEEDS_IMPROVEMENT: 'Needs Improvement',
  PLACEMENT_READY: 'Placement Ready',
  HIGHLY_READY: 'Highly Ready',
};

export const AssessmentType = {
  CODING: 'CODING',
  APTITUDE: 'APTITUDE',
  TECHNICAL_MCQ: 'TECHNICAL_MCQ',
  COMMUNICATION: 'COMMUNICATION',
} as const;
export type AssessmentType = (typeof AssessmentType)[keyof typeof AssessmentType];

export const AttemptStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  EVALUATED: 'EVALUATED',
  EXPIRED: 'EXPIRED',
  ABANDONED: 'ABANDONED',
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const Difficulty = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
} as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const InterviewMode = {
  TECHNICAL: 'TECHNICAL',
  HR: 'HR',
  BEHAVIORAL: 'BEHAVIORAL',
  COMPANY_SPECIFIC: 'COMPANY_SPECIFIC',
  ROLE_SPECIFIC: 'ROLE_SPECIFIC',
  RESUME_BASED: 'RESUME_BASED',
} as const;
export type InterviewMode = (typeof InterviewMode)[keyof typeof InterviewMode];

export const InterviewStatus = {
  CREATED: 'CREATED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const;
export type InterviewStatus = (typeof InterviewStatus)[keyof typeof InterviewStatus];

export const MentorshipStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type MentorshipStatus = (typeof MentorshipStatus)[keyof typeof MentorshipStatus];

export const SessionStatus = {
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

/** Integrity signals recorded during an assessment (§14). Ethical monitoring only. */
export const MonitoringEventType = {
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  FULLSCREEN_ENTER: 'FULLSCREEN_ENTER',
  TAB_HIDDEN: 'TAB_HIDDEN',
  TAB_VISIBLE: 'TAB_VISIBLE',
  WINDOW_BLUR: 'WINDOW_BLUR',
  WINDOW_FOCUS: 'WINDOW_FOCUS',
  COPY: 'COPY',
  PASTE: 'PASTE',
  INACTIVITY: 'INACTIVITY',
  RAPID_ANSWER: 'RAPID_ANSWER',
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',
  NETWORK_ONLINE: 'NETWORK_ONLINE',
  MULTIPLE_SESSION: 'MULTIPLE_SESSION',
  FACE_NOT_DETECTED: 'FACE_NOT_DETECTED',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  SESSION_RESUMED: 'SESSION_RESUMED',
} as const;
export type MonitoringEventType = (typeof MonitoringEventType)[keyof typeof MonitoringEventType];

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const SkillCategory = {
  PROGRAMMING_LANGUAGE: 'PROGRAMMING_LANGUAGE',
  FRAMEWORK: 'FRAMEWORK',
  TOOL: 'TOOL',
  DATABASE: 'DATABASE',
  CLOUD: 'CLOUD',
  CS_FUNDAMENTAL: 'CS_FUNDAMENTAL',
  SOFT_SKILL: 'SOFT_SKILL',
  DOMAIN: 'DOMAIN',
} as const;
export type SkillCategory = (typeof SkillCategory)[keyof typeof SkillCategory];

export const GapSeverity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type GapSeverity = (typeof GapSeverity)[keyof typeof GapSeverity];

export const NotificationType = {
  MENTORSHIP_REQUEST: 'MENTORSHIP_REQUEST',
  MENTORSHIP_ACCEPTED: 'MENTORSHIP_ACCEPTED',
  MENTORSHIP_REJECTED: 'MENTORSHIP_REJECTED',
  SESSION_SCHEDULED: 'SESSION_SCHEDULED',
  SESSION_REMINDER: 'SESSION_REMINDER',
  ASSESSMENT_COMPLETED: 'ASSESSMENT_COMPLETED',
  INTERVIEW_COMPLETED: 'INTERVIEW_COMPLETED',
  FEEDBACK_RECEIVED: 'FEEDBACK_RECEIVED',
  READINESS_CHANGED: 'READINESS_CHANGED',
  ALUMNI_VERIFIED: 'ALUMNI_VERIFIED',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Data provenance labels (§42). These must never be mixed. */
export const DataProvenance = {
  DEMO: 'DEMO',
  SYNTHETIC: 'SYNTHETIC',
  REAL: 'REAL',
} as const;
export type DataProvenance = (typeof DataProvenance)[keyof typeof DataProvenance];

export const AgentName = {
  RESUME_INTELLIGENCE: 'RESUME_INTELLIGENCE',
  JOB_MATCHING: 'JOB_MATCHING',
  CODING_ASSESSMENT: 'CODING_ASSESSMENT',
  TECHNICAL_INTERVIEW: 'TECHNICAL_INTERVIEW',
  HR_INTERVIEW: 'HR_INTERVIEW',
  BEHAVIORAL_INTERVIEW: 'BEHAVIORAL_INTERVIEW',
  CAREER_PLAN: 'CAREER_PLAN',
  PLACEMENT_READINESS: 'PLACEMENT_READINESS',
  ALUMNI_MENTORSHIP: 'ALUMNI_MENTORSHIP',
  ANALYTICS: 'ANALYTICS',
} as const;
export type AgentName = (typeof AgentName)[keyof typeof AgentName];

export const ReportType = {
  RESUME_ANALYSIS: 'RESUME_ANALYSIS',
  ATS: 'ATS',
  INTERVIEW: 'INTERVIEW',
  CODING: 'CODING',
  PLACEMENT_READINESS: 'PLACEMENT_READINESS',
  ALUMNI_FEEDBACK: 'ALUMNI_FEEDBACK',
  INSTITUTION: 'INSTITUTION',
  DEPARTMENT: 'DEPARTMENT',
  STUDENT_PERFORMANCE: 'STUDENT_PERFORMANCE',
  SKILL_GAP: 'SKILL_GAP',
} as const;
export type ReportType = (typeof ReportType)[keyof typeof ReportType];

