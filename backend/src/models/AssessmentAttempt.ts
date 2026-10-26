import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { AssessmentType, AttemptStatus, DataProvenance, RiskLevel } from '@careerpilot/shared';

export interface IAttemptAnswer {
  questionId: Types.ObjectId;
  answer: string[] | null;
  markedForReview: boolean;
  timeSpentSeconds: number;
  answeredAt?: Date | null;
  isCorrect?: boolean | null;
  awardedMarks?: number;
}

export interface IAssessmentAttempt extends Document {
  _id: Types.ObjectId;
  assessmentId: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  assessmentType: AssessmentType;
  status: AttemptStatus;
  /** Question order is frozen at start so refresh/recovery is deterministic. */
  questionIds: Types.ObjectId[];
  answers: IAttemptAnswer[];
  startedAt: Date;
  /** Server-authoritative deadline. The client timer is display only (§13). */
  expiresAt: Date;
  submittedAt?: Date | null;
  lastAutosaveAt?: Date | null;
  autosaveCount: number;
  resumeCount: number;
  durationMinutes: number;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  correctCount?: number | null;
  passed?: boolean | null;
  topicBreakdown: Array<{ topic: string; correct: number; total: number; percentage: number }>;
  integrityRisk: RiskLevel;
  monitoringEventCount: number;
  fullscreenRequired: boolean;
  webcamConsent: boolean;
  /** Set when a human reviewer clears or upholds an integrity flag (§14). */
  integrityReviewedBy?: Types.ObjectId | null;
  integrityReviewNote?: string | null;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const answerSchema = new Schema<IAttemptAnswer>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'AssessmentQuestion', required: true },
    answer: { type: [String], default: null },
    markedForReview: { type: Boolean, default: false },
    timeSpentSeconds: { type: Number, default: 0 },
    answeredAt: { type: Date, default: null },
    isCorrect: { type: Boolean, default: null },
    awardedMarks: { type: Number, default: 0 },
  },
  { _id: false },
);

const assessmentAttemptSchema = new Schema<IAssessmentAttempt>(
  {
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assessmentType: { type: String, enum: Object.values(AssessmentType), required: true, index: true },
    status: { type: String, enum: Object.values(AttemptStatus), default: AttemptStatus.IN_PROGRESS, index: true },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'AssessmentQuestion' }],
    answers: { type: [answerSchema], default: [] },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    submittedAt: { type: Date, default: null },
    lastAutosaveAt: { type: Date, default: null },
    autosaveCount: { type: Number, default: 0 },
    resumeCount: { type: Number, default: 0 },
    durationMinutes: { type: Number, required: true },
    score: { type: Number, default: null },
    maxScore: { type: Number, default: null },
    percentage: { type: Number, default: null },
    correctCount: { type: Number, default: null },
    passed: { type: Boolean, default: null },
    topicBreakdown: {
      type: [
        new Schema(
          { topic: String, correct: Number, total: Number, percentage: Number },
          { _id: false },
        ),
      ],
      default: [],
    },
    integrityRisk: { type: String, enum: Object.values(RiskLevel), default: RiskLevel.LOW, index: true },
    monitoringEventCount: { type: Number, default: 0 },
    fullscreenRequired: { type: Boolean, default: true },
    webcamConsent: { type: Boolean, default: false },
    integrityReviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    integrityReviewNote: { type: String, default: null },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

assessmentAttemptSchema.index({ studentId: 1, status: 1, createdAt: -1 });
assessmentAttemptSchema.index({ studentId: 1, assessmentType: 1, submittedAt: -1 });
// Guards against two concurrent live attempts on the same paper.
assessmentAttemptSchema.index(
  { studentId: 1, assessmentId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: AttemptStatus.IN_PROGRESS } },
);

export const AssessmentAttempt = registerModel<IAssessmentAttempt>('AssessmentAttempt', assessmentAttemptSchema);
