import type { ApieComponentKey } from './constants';
import type {
  DsaExample, DsaLanguageId, DsaPublicTestCase, DsaSignature, SubmissionStatus,
} from './dsa';
import type {
  AccountStatus,
  AgentName,
  AssessmentType,
  AttemptStatus,
  DataProvenance,
  Difficulty,
  GapSeverity,
  InterviewMode,
  InterviewStatus,
  MentorshipStatus,
  MonitoringEventType,
  NotificationType,
  ReadinessBand,
  RiskLevel,
  SessionStatus,
  SkillCategory,
  UserRole,
  VerificationStatus,
} from './enums';

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export interface ApiError {
  code: string;
  message: string;
  /** Field-level validation issues, present for VALIDATION_ERROR. */
  details?: Array<{ path: string; message: string }>;
  /** Correlation id echoed from the request, for support/log lookup. */
  requestId?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta & Record<string, unknown>;
}

export interface ApiFailure {
  success: false;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: PaginationMeta;
}

/* ------------------------------------------------------------------ */
/* Auth & users                                                        */
/* ------------------------------------------------------------------ */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  emailVerified: boolean;
  avatarUrl?: string | null;
  department?: string | null;
  /** Present for ALUMNI accounts only. */
  alumniVerification?: VerificationStatus;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Also set as an httpOnly cookie; returned for non-browser clients. */
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
  /** Token family id, allows refresh-token rotation & revocation. */
  sid?: string;
  iat?: number;
  exp?: number;
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export interface EducationEntry {
  degree: string;
  institution: string;
  fieldOfStudy?: string;
  startYear?: number;
  endYear?: number;
  cgpa?: number;
  percentage?: number;
}

export interface ProjectEntry {
  title: string;
  description?: string;
  technologies: string[];
  link?: string;
  durationMonths?: number;
}

export interface ExperienceEntry {
  company: string;
  role: string;
  type?: 'INTERNSHIP' | 'FULL_TIME' | 'PART_TIME' | 'FREELANCE';
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface CertificationEntry {
  name: string;
  issuer?: string;
  issuedOn?: string;
  credentialId?: string;
  link?: string;
}

export interface StudentProfileDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  rollNumber?: string;
  department?: string;
  degree?: string;
  batch?: string;
  section?: string;
  graduationYear?: number;
  cgpa?: number;
  backlogs?: number;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  headline?: string;
  summary?: string;
  skills: StudentSkillDto[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
  certifications: CertificationEntry[];
  achievements: string[];
  targetCompanies: string[];
  targetRoles: string[];
  profileCompletion: number;
  provenance: DataProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface StudentSkillDto {
  skillId?: string;
  name: string;
  category: SkillCategory;
  /** 0-100 self-assessed or system-inferred proficiency. */
  proficiency: number;
  source: 'SELF' | 'RESUME' | 'ASSESSMENT' | 'ALUMNI';
  verified: boolean;
}

export interface AlumniProfileDto {
  id: string;
  userId: string;
  fullName: string;
  email?: string;
  company: string;
  designation: string;
  experienceYears: number;
  domain: string;
  expertise: string[];
  skills: string[];
  college?: string;
  graduationYear?: number;
  department?: string;
  linkedinUrl?: string;
  bio?: string;
  verificationStatus: VerificationStatus;
  verifiedAt?: string | null;
  verificationNote?: string | null;
  availability: AvailabilitySlot[];
  acceptingMentees: boolean;
  maxMenteesPerMonth: number;
  sessionsConducted: number;
  averageRating: number;
  provenance: DataProvenance;
  createdAt: string;
}

export interface AvailabilitySlot {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  /** "HH:mm" in the alumnus' timezone. */
  startTime: string;
  endTime: string;
  timezone: string;
}

/* ------------------------------------------------------------------ */
/* Companies & jobs                                                    */
/* ------------------------------------------------------------------ */

export interface CompanyDto {
  id: string;
  name: string;
  slug: string;
  industry: string;
  tier?: 'TIER_1' | 'TIER_2' | 'TIER_3' | 'PRODUCT' | 'SERVICE' | 'STARTUP';
  website?: string;
  description?: string;
  headquarters?: string;
  logoUrl?: string;
  recruitmentPattern?: RecruitmentPattern;
  active: boolean;
  provenance: DataProvenance;
}

export interface RecruitmentPattern {
  /** Ordered hiring stages, e.g. ["Online Test", "Technical", "HR"]. */
  rounds: Array<{ name: string; description?: string; durationMinutes?: number }>;
  eligibility?: {
    minCgpa?: number;
    maxBacklogs?: number;
    allowedDepartments?: string[];
  };
  averagePackageLpa?: number;
  hiringSeason?: string;
  /** Where this information came from; empty means unverified. */
  sources: string[];
}

export interface JobRoleDto {
  id: string;
  title: string;
  slug: string;
  family: string;
  description?: string;
  coreSkills: string[];
  active: boolean;
}

export interface JobDescriptionDto {
  id: string;
  companyId: string;
  companyName?: string;
  roleId: string;
  roleTitle?: string;
  title: string;
  location?: string;
  experienceLevel?: string;
  packageLpa?: number;
  descriptionText: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  active: boolean;
  provenance: DataProvenance;
  createdAt: string;
}

export interface JobMatchResult {
  jobDescriptionId: string;
  companyName: string;
  roleTitle: string;
  matchScore: number;
  requiredCoverage: number;
  preferredCoverage: number;
  semanticSimilarity: number;
  matchingSkills: string[];
  missingSkills: string[];
  recommendedSkills: string[];
  verdict: string;
  preparationPlan: PreparationPlanItem[];
}

export interface PreparationPlanItem {
  focus: string;
  reason: string;
  priority: GapSeverity;
  estimatedHours: number;
  resources: string[];
}

/* ------------------------------------------------------------------ */
/* Resume                                                              */
/* ------------------------------------------------------------------ */

export interface ResumeDto {
  id: string;
  studentId: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  isPrimary: boolean;
  parseStatus: 'PENDING' | 'PARSED' | 'FAILED';
  parseError?: string | null;
  createdAt: string;
}

export interface ResumeSections {
  contact?: string;
  summary?: string;
  education?: string;
  skills?: string;
  experience?: string;
  projects?: string;
  certifications?: string;
  achievements?: string;
  [key: string]: string | undefined;
}

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  links: string[];
  education: EducationEntry[];
  skills: string[];
  programmingLanguages: string[];
  frameworks: string[];
  tools: string[];
  databases: string[];
  cloud: string[];
  projects: ProjectEntry[];
  internships: ExperienceEntry[];
  experience: ExperienceEntry[];
  certifications: CertificationEntry[];
  achievements: string[];
  totalExperienceMonths: number;
  sections: ResumeSections;
  wordCount: number;
}

export interface AtsBreakdownItem {
  criterion: string;
  score: number;
  maxScore: number;
  weight: number;
  detail: string;
}

export interface ResumeAnalysisDto {
  id: string;
  resumeId: string;
  studentId: string;
  atsScore: number;
  parsed: ParsedResume;
  breakdown: AtsBreakdownItem[];
  matchedKeywords: string[];
  missingKeywords: string[];
  strengths: string[];
  weaknesses: string[];
  formattingRecommendations: string[];
  jobSpecificRecommendations: string[];
  targetJobDescriptionId?: string | null;
  /** Where the compared job description came from. `null` = no comparison was made. */
  jobDescriptionSource?: 'CATALOGUE' | 'CUSTOM' | null;
  /** Display name of the compared job description. */
  jobDescriptionLabel?: string | null;
  jobMatchScore?: number | null;
  engineVersion: string;
  provenance: DataProvenance;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Assessments                                                         */
/* ------------------------------------------------------------------ */

export interface AssessmentDto {
  id: string;
  title: string;
  type: AssessmentType;
  description?: string;
  durationMinutes: number;
  totalQuestions: number;
  passingScore: number;
  difficulty: Difficulty;
  companyId?: string | null;
  roleId?: string | null;
  topics: string[];
  requiresFullscreen: boolean;
  requiresWebcam: boolean;
  active: boolean;
  provenance: DataProvenance;
}

export interface AssessmentQuestionDto {
  id: string;
  assessmentId?: string;
  type: 'MCQ' | 'MULTI_SELECT' | 'SHORT_ANSWER' | 'CODING';
  prompt: string;
  options?: Array<{ key: string; text: string }>;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  codingProblemId?: string | null;
  /** Never sent to students; present for ADMIN/officer views only. */
  correctAnswer?: string | string[];
  explanation?: string;
}

export interface AttemptAnswerDto {
  questionId: string;
  answer: string | string[] | null;
  markedForReview: boolean;
  timeSpentSeconds: number;
  answeredAt?: string;
}

export interface AssessmentAttemptDto {
  id: string;
  assessmentId: string;
  assessmentTitle?: string;
  assessmentType?: AssessmentType;
  studentId: string;
  status: AttemptStatus;
  startedAt: string;
  /** Server-authoritative deadline; the client timer is only a display. */
  expiresAt: string;
  submittedAt?: string | null;
  durationMinutes: number;
  questions?: AssessmentQuestionDto[];
  answers: AttemptAnswerDto[];
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  correctCount?: number | null;
  passed?: boolean | null;
  topicBreakdown?: Array<{ topic: string; correct: number; total: number; percentage: number }>;
  integrityRisk: RiskLevel;
  monitoringEventCount: number;
  fullscreenRequired: boolean;
  webcamConsent: boolean;
  provenance: DataProvenance;
}

export interface MonitoringEventDto {
  id?: string;
  attemptId?: string;
  interviewSessionId?: string;
  studentId?: string;
  type: MonitoringEventType;
  severity: RiskLevel;
  explanation: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
  reviewed?: boolean;
  reviewNote?: string | null;
}

/* ------------------------------------------------------------------ */
/* Coding                                                              */
/* ------------------------------------------------------------------ */

export interface CodingProblemDto {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  tags: string[];
  companies: string[];
  description: string;
  examples: DsaExample[];
  constraints: string[];
  functionName: string;
  signature: DsaSignature;
  /** Starter code keyed by language id. The student implements only the function. */
  starterCode: Record<string, string>;
  supportedLanguages: DsaLanguageId[];
  /** Public test cases only. Hidden tests are never part of this DTO. */
  testCases: DsaPublicTestCase[];
  /** How many hidden tests a submission is additionally judged on (a count, never their content). */
  hiddenTestCount: number;
  timeLimitMs: number;
  memoryLimitMb: number;
  hints: string[];
  provenance: DataProvenance;
}

/** Row of the problem list. */
export interface CodingProblemSummaryDto {
  id: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  tags: string[];
  companies: string[];
  /** SOLVED = an accepted submission exists; ATTEMPTED = submitted but not accepted yet. */
  status: 'SOLVED' | 'ATTEMPTED' | 'TODO';
}

export interface TestCaseResult {
  index: number;
  hidden: boolean;
  passed: boolean;
  status: SubmissionStatus;
  executionTimeMs: number;
  memoryKb: number;
  /* Everything below is present for PUBLIC test cases only. */
  inputs?: Array<{ name: string; value: string }>;
  expected?: string;
  actual?: string | null;
  /** What the program printed to standard output. */
  stdout?: string;
  stderr?: string;
}

/** Outcome of running code in the sandbox. Produced only by the deterministic judge. */
export interface CodeExecutionResult {
  /** `ERROR` only appears on records written before the judge existed. */
  status: SubmissionStatus | 'ERROR';
  provider: string;
  /** `false` when the sandbox could not run the code at all (nothing was executed). */
  executed: boolean;
  passedCount: number;
  totalCount: number;
  results: TestCaseResult[];
  compileOutput?: string;
  /** Slowest single test, in milliseconds. */
  runtimeMs: number;
  totalExecutionTimeMs: number;
  peakMemoryKb: number;
  message?: string;
}

export interface CodingSubmissionDto {
  id: string;
  problemId: string;
  problemTitle?: string;
  language: string;
  code: string;
  status: SubmissionStatus | 'ERROR';
  passedCount: number;
  totalCount: number;
  runtimeMs: number;
  memoryKb: number;
  score: number;
  createdAt: string;
}

/** Solved counts shown on the dashboard and the problem list. */
export interface DsaProgressDto {
  solved: { easy: number; medium: number; hard: number; total: number };
  available: { easy: number; medium: number; hard: number; total: number };
  attempted: number;
  submissions: number;
  acceptanceRate: number | null;
}

/** Whether the server can execute code right now. */
export interface CodeSandboxStatusDto {
  available: boolean;
  provider: string;
  languages: DsaLanguageId[];
  /** Human-readable reason when `available` is false. */
  reason: string | null;
}

export interface CodeReviewDto {
  correctnessNotes: string[];
  complexityEstimate: { time: string; space: string; confidence: number };
  readabilityScore: number;
  suggestions: string[];
  detectedPatterns: string[];
  disclaimer: string;
}

/* ------------------------------------------------------------------ */
/* Interviews                                                          */
/* ------------------------------------------------------------------ */

export interface InterviewSessionDto {
  id: string;
  studentId: string;
  mode: InterviewMode;
  status: InterviewStatus;
  companyId?: string | null;
  companyName?: string | null;
  roleId?: string | null;
  roleTitle?: string | null;
  difficulty: Difficulty;
  plannedQuestions: number;
  currentIndex: number;
  startedAt: string;
  completedAt?: string | null;
  durationMinutes?: number;
  mediaConsent: MediaConsent;
  evaluation?: InterviewEvaluationDto | null;
  questions?: InterviewQuestionDto[];
  provenance: DataProvenance;
}

export interface MediaConsent {
  camera: boolean;
  microphone: boolean;
  recording: boolean;
  consentedAt?: string | null;
  retentionDays: number;
  policyVersion: string;
}

export interface InterviewQuestionDto {
  id: string;
  sessionId: string;
  index: number;
  question: string;
  category: string;
  topic: string;
  difficulty: Difficulty;
  expectedPoints: string[];
  followUpTo?: string | null;
  /** RAG provenance: which knowledge chunks grounded this question. */
  sources?: RagSource[];
  askedAt: string;
}

export interface InterviewResponseDto {
  id: string;
  sessionId: string;
  questionId: string;
  transcript: string;
  inputMode: 'TEXT' | 'SPEECH';
  durationSeconds: number;
  wordCount: number;
  fillerWordCount: number;
  fillerWordRate: number;
  submittedAt: string;
  evaluation?: ResponseEvaluation | null;
}

export interface ResponseEvaluation {
  relevance: number;
  correctness: number;
  completeness: number;
  communication: number;
  structure: number;
  overall: number;
  strengths: string[];
  improvements: string[];
  explanation: string;
  missedPoints: string[];
  /** Objective delivery signals only - no emotional or psychological inference. */
  deliverySignals: {
    wordCount: number;
    fillerWordRate: number;
    responseLengthVerdict: 'TOO_SHORT' | 'APPROPRIATE' | 'TOO_LONG';
    clarityScore: number;
  };
}

export interface InterviewEvaluationDto {
  id?: string;
  sessionId: string;
  overallScore: number;
  technicalScore: number;
  communicationScore: number;
  structureScore: number;
  confidenceIndicatorScore: number;
  questionsAnswered: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  perQuestion: Array<{ questionId: string; question: string; score: number; feedback: string }>;
  summary: string;
  disclaimer: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* APIE / readiness                                                    */
/* ------------------------------------------------------------------ */

export interface ComponentScore {
  key: ApieComponentKey;
  label: string;
  raw: number | null;
  normalized: number;
  weight: number;
  weighted: number;
  evidenceCount: number;
  lastUpdated: string | null;
  stale: boolean;
}

export interface SkillGapDto {
  id?: string;
  skill: string;
  category: SkillCategory;
  currentLevel: number;
  requiredLevel: number;
  gap: number;
  severity: GapSeverity;
  source: string;
  relatedRoles: string[];
  recommendedActions: string[];
}

export interface PlacementReadinessDto {
  id: string;
  studentId: string;
  score: number;
  band: ReadinessBand;
  components: ComponentScore[];
  modifiers: Array<{ label: string; delta: number; reason: string }>;
  strengths: string[];
  weaknesses: string[];
  skillGaps: SkillGapDto[];
  targetRoleReadiness: Array<{ roleId?: string; roleTitle: string; score: number; band: ReadinessBand; missingSkills: string[] }>;
  targetCompanyReadiness: Array<{ companyId?: string; companyName: string; score: number; band: ReadinessBand; gapSummary: string }>;
  recommendations: RecommendationDto[];
  reassessmentSuggestions: Array<{ component: string; reason: string; dueInDays: number }>;
  mlPrediction?: MlPredictionDto | null;
  weightsVersion: string;
  modelDisclaimer: string;
  computedAt: string;
  previousScore?: number | null;
  delta?: number | null;
}

export interface MlPredictionDto {
  band: ReadinessBand;
  score: number;
  confidence: number;
  classProbabilities: Record<string, number>;
  featureContributions: Array<{ feature: string; importance: number; value: number }>;
  modelVersion: string;
  trainedOn: DataProvenance;
  disclaimer: string;
}

export interface ReadinessTrendPoint {
  date: string;
  score: number;
  band: ReadinessBand;
  components: Partial<Record<ApieComponentKey, number>>;
}

export interface RecommendationDto {
  id?: string;
  title: string;
  description: string;
  category: 'SKILL' | 'ASSESSMENT' | 'INTERVIEW' | 'RESUME' | 'MENTORSHIP' | 'PROJECT' | 'COMMUNICATION';
  priority: GapSeverity;
  estimatedHours: number;
  actionRoute?: string;
  actionLabel?: string;
  rationale: string;
  resources: Array<{ title: string; url?: string; type: string }>;
  status?: 'ACTIVE' | 'COMPLETED' | 'DISMISSED';
}

/* ------------------------------------------------------------------ */
/* Mentorship                                                          */
/* ------------------------------------------------------------------ */

export interface MentorshipRequestDto {
  id: string;
  studentId: string;
  studentName?: string;
  studentDepartment?: string;
  alumniId: string;
  alumniName?: string;
  alumniCompany?: string;
  status: MentorshipStatus;
  topic: string;
  message: string;
  targetRole?: string;
  targetCompany?: string;
  preferredSlots: string[];
  respondedAt?: string | null;
  responseMessage?: string | null;
  sessionId?: string | null;
  createdAt: string;
}

export interface MentorshipSessionDto {
  id: string;
  requestId?: string | null;
  studentId: string;
  studentName?: string;
  alumniId: string;
  alumniName?: string;
  alumniCompany?: string;
  scheduledAt: string;
  durationMinutes: number;
  status: SessionStatus;
  roomId: string;
  type: 'MOCK_INTERVIEW' | 'MENTORSHIP_CALL' | 'RESUME_REVIEW';
  agenda?: string;
  notes?: string;
  joinedAt?: string | null;
  endedAt?: string | null;
  feedbackId?: string | null;
  /** True only when both participants consented to recording (§15). */
  recordingConsent: boolean;
  provenance: DataProvenance;
}

export interface AlumniFeedbackDto {
  id: string;
  sessionId: string;
  studentId: string;
  alumniId: string;
  alumniName?: string;
  alumniCompany?: string;
  technicalKnowledge: number;
  communication: number;
  problemSolving: number;
  confidence: number;
  roleSuitability: number;
  overallScore: number;
  recommendation: 'STRONG_HIRE' | 'HIRE' | 'BORDERLINE' | 'NEEDS_WORK';
  strengths: string[];
  improvements: string[];
  comments: string;
  /** True once APIE has ingested this feedback into the readiness computation. */
  appliedToApie: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  readAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* RAG & AI plumbing                                                   */
/* ------------------------------------------------------------------ */

export interface RagSource {
  documentId: string;
  title: string;
  chunkIndex: number;
  score: number;
  snippet?: string;
  category: string;
}

export interface RagQueryResult {
  answer: string;
  grounded: boolean;
  sources: RagSource[];
  /** Set when no sufficiently relevant context was retrieved (§10). */
  insufficientContext: boolean;
  provider: string;
  model: string;
}

export interface AgentRunDto {
  id: string;
  agent: AgentName;
  status: 'SUCCESS' | 'FAILED' | 'VALIDATION_ERROR';
  latencyMs: number;
  provider: string;
  model?: string;
  tokensPrompt?: number;
  tokensCompletion?: number;
  error?: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export interface PlacementAnalyticsDto {
  totals: {
    students: number;
    activeStudents: number;
    alumni: number;
    verifiedAlumni: number;
    assessmentsTaken: number;
    interviewsTaken: number;
    mentorshipSessions: number;
  };
  averages: {
    prs: number;
    ats: number;
    coding: number;
    technical: number;
    hr: number;
    communication: number;
    aptitude: number;
  };
  readinessDistribution: Array<{ band: ReadinessBand; count: number; percentage: number }>;
  placementReadyPercentage: number;
  atRiskPercentage: number;
  commonSkillGaps: Array<{ skill: string; count: number; averageGap: number; severity: GapSeverity }>;
  topTargetCompanies: Array<{ company: string; count: number }>;
  topTargetRoles: Array<{ role: string; count: number }>;
  departmentComparison: Array<{ department: string; students: number; averagePrs: number; readyPercentage: number }>;
  monthlyProgress: Array<{ month: string; averagePrs: number; assessments: number; interviews: number }>;
  alumniParticipation: Array<{ alumniName: string; company: string; sessions: number; averageRating: number }>;
  generatedAt: string;
}

export interface StudentSummaryRow {
  studentId: string;
  userId: string;
  fullName: string;
  rollNumber?: string;
  department?: string;
  batch?: string;
  section?: string;
  cgpa?: number;
  prs: number | null;
  band: ReadinessBand | null;
  atsScore: number | null;
  codingScore: number | null;
  interviewScore: number | null;
  skillGapCount: number;
  targetCompanies: string[];
  lastActivityAt: string | null;
}

export interface AdminDashboardDto {
  users: { total: number; byRole: Record<string, number>; activeLast7Days: number; newLast30Days: number };
  alumni: { total: number; verified: number; pending: number; rejected: number };
  catalog: { companies: number; jobRoles: number; jobDescriptions: number; codingProblems: number; assessments: number; ragDocuments: number };
  ai: { totalInteractions: number; last24h: number; failureRate: number; byAgent: Array<{ agent: string; count: number; avgLatencyMs: number; failures: number }>; provider: string };
  health: SystemHealthDto;
  recentAudit: AuditLogDto[];
  flagged: { highRiskAttempts: number; unreviewedEvents: number };
}

export interface SystemHealthDto {
  status: 'OK' | 'DEGRADED' | 'DOWN';
  uptimeSeconds: number;
  version: string;
  environment: string;
  checks: Array<{ name: string; status: 'OK' | 'DEGRADED' | 'DOWN'; latencyMs?: number; detail?: string }>;
  timestamp: string;
}

export interface AuditLogDto {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  status: 'SUCCESS' | 'FAILURE';
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Research export (§42)                                               */
/* ------------------------------------------------------------------ */

export interface ResearchRecord {
  anonymousId: string;
  department?: string;
  batch?: string;
  provenance: DataProvenance;
  atsScore: number | null;
  codingScore: number | null;
  technicalScore: number | null;
  hrScore: number | null;
  communicationScore: number | null;
  aptitudeScore: number | null;
  academicScore: number | null;
  projectCount: number;
  certificationCount: number;
  internshipCount: number;
  alumniFeedbackScore: number | null;
  skillGapCount: number;
  sessionsCompleted: number;
  firstPrs: number | null;
  latestPrs: number | null;
  improvement: number | null;
  readinessBand: ReadinessBand | null;
  recordedAt: string;
}

export interface MlEvaluationMetrics {
  modelVersion: string;
  algorithm: string;
  trainedAt: string;
  datasetProvenance: DataProvenance;
  datasetSize: number;
  trainSize: number;
  testSize: number;
  accuracy: number;
  precisionMacro: number;
  recallMacro: number;
  f1Macro: number;
  perClass: Array<{ label: string; precision: number; recall: number; f1: number; support: number }>;
  confusionMatrix: number[][];
  labels: string[];
  featureImportance: Array<{ feature: string; importance: number }>;
  crossValidation?: { folds: number; meanAccuracy: number; stdAccuracy: number };
  disclaimer: string;
}
