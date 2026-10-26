import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import type { ResponseEvaluation } from '@careerpilot/shared';

export interface IInterviewResponse extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  questionId: Types.ObjectId;
  studentId: Types.ObjectId;
  transcript: string;
  inputMode: 'TEXT' | 'SPEECH';
  durationSeconds: number;
  wordCount: number;
  fillerWordCount: number;
  fillerWordRate: number;
  /** Storage key of the audio clip, present only with explicit consent (§15). */
  audioKey?: string | null;
  evaluation?: ResponseEvaluation | null;
  submittedAt: Date;
  createdAt: Date;
}

const interviewResponseSchema = new Schema<IInterviewResponse>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'InterviewSession', required: true, index: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'InterviewQuestion', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    transcript: { type: String, default: '', maxlength: 20000 },
    inputMode: { type: String, enum: ['TEXT', 'SPEECH'], default: 'TEXT' },
    durationSeconds: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
    fillerWordCount: { type: Number, default: 0 },
    fillerWordRate: { type: Number, default: 0 },
    audioKey: { type: String, default: null },
    evaluation: { type: Schema.Types.Mixed, default: null },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } },
);

interviewResponseSchema.index({ sessionId: 1, questionId: 1 }, { unique: true });

export const InterviewResponse = registerModel<IInterviewResponse>('InterviewResponse', interviewResponseSchema);
