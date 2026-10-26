import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { SUBMISSION_STATUSES } from '@careerpilot/shared';
import type { CodeExecutionResult, CodeReviewDto, SubmissionStatus } from '@careerpilot/shared';

export interface ICodingSubmission extends Document {
  _id: Types.ObjectId;
  problemId: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  attemptId?: Types.ObjectId | null;
  language: string;
  code: string;
  /** Always `false`: a "Run" is never stored. Kept for records written by older builds. */
  isDraftRun: boolean;
  /** The judge's verdict. `ERROR` exists only on records written before the judge. */
  status: SubmissionStatus | 'ERROR';
  passedCount: number;
  totalCount: number;
  /** Slowest test, in milliseconds. */
  runtimeMs: number;
  memoryKb: number;
  /** Full judge output. Hidden tests appear in it only as pass/fail, status and timing. */
  execution: CodeExecutionResult;
  score: number;
  /** Advisory static analysis from the AI service. Never part of the verdict. */
  aiReview?: CodeReviewDto | null;
  createdAt: Date;
  updatedAt: Date;
}

const codingSubmissionSchema = new Schema<ICodingSubmission>(
  {
    problemId: { type: Schema.Types.ObjectId, ref: 'CodingProblem', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: 'AssessmentAttempt', default: null, index: true },
    language: { type: String, required: true },
    code: { type: String, required: true, maxlength: 100_000 },
    isDraftRun: { type: Boolean, default: false, index: true },
    status: { type: String, enum: [...SUBMISSION_STATUSES, 'ERROR'], default: 'INTERNAL_ERROR', index: true },
    passedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    runtimeMs: { type: Number, default: 0 },
    memoryKb: { type: Number, default: 0 },
    execution: { type: Schema.Types.Mixed, required: true },
    score: { type: Number, min: 0, max: 100, default: 0 },
    aiReview: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

codingSubmissionSchema.index({ studentId: 1, createdAt: -1 });
codingSubmissionSchema.index({ studentId: 1, problemId: 1, isDraftRun: 1 });
codingSubmissionSchema.index({ studentId: 1, problemId: 1, status: 1 });

export const CodingSubmission = registerModel<ICodingSubmission>('CodingSubmission', codingSubmissionSchema);
