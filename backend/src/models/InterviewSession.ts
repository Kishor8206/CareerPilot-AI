import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, Difficulty, InterviewMode, InterviewStatus, RiskLevel } from '@careerpilot/shared';
import type { MediaConsent } from '@careerpilot/shared';

export interface IInterviewSession extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  mode: InterviewMode;
  status: InterviewStatus;
  companyId?: Types.ObjectId | null;
  roleId?: Types.ObjectId | null;
  resumeAnalysisId?: Types.ObjectId | null;
  difficulty: Difficulty;
  /** Difficulty is re-evaluated after each answer; this records the trajectory. */
  difficultyTrail: Array<{ index: number; difficulty: Difficulty; reason: string }>;
  plannedQuestions: number;
  currentIndex: number;
  topicFocus: string[];
  startedAt: Date;
  completedAt?: Date | null;
  durationSeconds: number;
  mediaConsent: MediaConsent;
  integrityRisk: RiskLevel;
  evaluationId?: Types.ObjectId | null;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const mediaConsentSchema = new Schema<MediaConsent>(
  {
    camera: { type: Boolean, default: false },
    microphone: { type: Boolean, default: false },
    recording: { type: Boolean, default: false },
    consentedAt: { type: Date, default: null },
    retentionDays: { type: Number, default: 30 },
    policyVersion: { type: String, default: '1.0' },
  },
  { _id: false },
);

const interviewSessionSchema = new Schema<IInterviewSession>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: Object.values(InterviewMode), required: true, index: true },
    status: { type: String, enum: Object.values(InterviewStatus), default: InterviewStatus.CREATED, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', default: null },
    resumeAnalysisId: { type: Schema.Types.ObjectId, ref: 'ResumeAnalysis', default: null },
    difficulty: { type: String, enum: Object.values(Difficulty), default: Difficulty.MEDIUM },
    difficultyTrail: {
      type: [new Schema({ index: Number, difficulty: String, reason: String }, { _id: false })],
      default: [],
    },
    plannedQuestions: { type: Number, default: 8, min: 1, max: 30 },
    currentIndex: { type: Number, default: 0 },
    topicFocus: { type: [String], default: [] },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    mediaConsent: { type: mediaConsentSchema, default: () => ({}) },
    integrityRisk: { type: String, enum: Object.values(RiskLevel), default: RiskLevel.LOW },
    evaluationId: { type: Schema.Types.ObjectId, ref: 'InterviewEvaluation', default: null },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

interviewSessionSchema.index({ studentId: 1, status: 1, createdAt: -1 });
interviewSessionSchema.index({ studentId: 1, mode: 1, completedAt: -1 });

export const InterviewSession = registerModel<IInterviewSession>('InterviewSession', interviewSessionSchema);
