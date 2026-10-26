import { GapSeverity, ReadinessBand, UserRole } from './enums';

/**
 * PROTOTYPE SCORING MODEL (§6).
 *
 * These are the *default* Adaptive Placement Intelligence Engine weights. They
 * are seeded into the `SystemConfiguration` collection at bootstrap and are read
 * from the database at runtime, so an administrator can retune the model without
 * a redeploy. They are a defensible starting point derived from campus-placement
 * practice, NOT an empirically validated model.
 */
export const DEFAULT_APIE_WEIGHTS = {
  resume: 0.1,
  // Group Discussion was removed from the platform. Its former 0.10 was split
  // between coding (now measured by a real judge) and communication.
  coding: 0.25,
  technical: 0.2,
  hr: 0.1,
  communication: 0.15,
  aptitude: 0.1,
  academic: 0.1,
} as const;

export type ApieComponentKey = keyof typeof DEFAULT_APIE_WEIGHTS;

export const APIE_COMPONENT_KEYS = Object.keys(DEFAULT_APIE_WEIGHTS) as ApieComponentKey[];

export const APIE_COMPONENT_LABEL: Record<ApieComponentKey, string> = {
  resume: 'Resume & ATS',
  coding: 'Coding',
  technical: 'Technical Interview',
  hr: 'HR Interview',
  communication: 'Communication',
  aptitude: 'Aptitude',
  academic: 'Academic',
};

/**
 * Bonus/penalty modifiers applied on top of the weighted base score.
 * Kept small so the weighted components remain dominant and explainable.
 */
export const DEFAULT_APIE_MODIFIERS = {
  /** Max points added for projects (capped at `projectCap` projects). */
  projectBonusMax: 3,
  projectCap: 4,
  /** Max points added for certifications. */
  certificationBonusMax: 2,
  certificationCap: 4,
  /** Max points added for internship experience. */
  internshipBonusMax: 3,
  internshipCap: 2,
  /** Max points added or removed by human alumni feedback (human-in-the-loop). */
  alumniFeedbackInfluence: 4,
  /** Points removed when a component has no evidence at all (stale profile). */
  missingComponentPenalty: 0,
} as const;

/** Readiness band cut-offs applied to the 0-100 Placement Readiness Score. */
export const DEFAULT_READINESS_BANDS: Array<{ band: ReadinessBand; min: number; max: number }> = [
  { band: 'AT_RISK', min: 0, max: 39.999 },
  { band: 'NEEDS_IMPROVEMENT', min: 40, max: 59.999 },
  { band: 'PLACEMENT_READY', min: 60, max: 79.999 },
  { band: 'HIGHLY_READY', min: 80, max: 100 },
];

export function bandForScore(score: number): ReadinessBand {
  const found = DEFAULT_READINESS_BANDS.find((b) => score >= b.min && score <= b.max);
  return found ? found.band : 'AT_RISK';
}

/** How stale a component score may be before APIE recommends reassessment. */
export const DEFAULT_REASSESSMENT_DAYS = 30;

export const GAP_SEVERITY_ORDER: GapSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Files accepted by the resume pipeline (§8). Enforced by MIME + extension. */
export const ALLOWED_RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
] as const;

export const ALLOWED_RESUME_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'] as const;

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Landing route per role, used by the frontend after login. */
export const ROLE_HOME_ROUTE: Record<UserRole, string> = {
  STUDENT: '/dashboard',
  ALUMNI: '/alumni/dashboard',
  PLACEMENT_OFFICER: '/placement/dashboard',
  ADMIN: '/admin/dashboard',
  RECRUITER: '/dashboard',
};

/** Socket.IO event names shared by client and server. */
export const SocketEvent = {
  CONNECT_ERROR: 'connect_error',
  NOTIFICATION: 'notification:new',
  NOTIFICATION_READ: 'notification:read',
  ASSESSMENT_TICK: 'assessment:tick',
  ASSESSMENT_AUTOSAVE: 'assessment:autosave',
  ASSESSMENT_AUTOSAVE_ACK: 'assessment:autosave:ack',
  ASSESSMENT_MONITOR: 'assessment:monitor',
  ASSESSMENT_SUBMITTED: 'assessment:submitted',
  INTERVIEW_JOIN: 'interview:join',
  INTERVIEW_LEAVE: 'interview:leave',
  INTERVIEW_PARTICIPANT_JOINED: 'interview:participant:joined',
  INTERVIEW_PARTICIPANT_LEFT: 'interview:participant:left',
  INTERVIEW_CHAT: 'interview:chat',
  INTERVIEW_STATE: 'interview:state',
  INTERVIEW_ENDED: 'interview:ended',
  RTC_OFFER: 'rtc:offer',
  RTC_ANSWER: 'rtc:answer',
  RTC_ICE: 'rtc:ice',
  RTC_MEDIA_STATE: 'rtc:media-state',
  READINESS_UPDATED: 'readiness:updated',
} as const;
export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

/** Machine-readable API error codes (§37). */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  RESUME_PARSE_FAILED: 'RESUME_PARSE_FAILED',
  AI_SERVICE_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  AI_RESPONSE_INVALID: 'AI_RESPONSE_INVALID',
  CODE_EXECUTION_FAILED: 'CODE_EXECUTION_FAILED',
  ASSESSMENT_EXPIRED: 'ASSESSMENT_EXPIRED',
  ASSESSMENT_ALREADY_SUBMITTED: 'ASSESSMENT_ALREADY_SUBMITTED',
  INTERVIEW_NOT_ACTIVE: 'INTERVIEW_NOT_ACTIVE',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  ALUMNI_NOT_VERIFIED: 'ALUMNI_NOT_VERIFIED',
  DB_ERROR: 'DB_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
