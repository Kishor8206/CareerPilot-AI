import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { Difficulty } from '@careerpilot/shared';
import type { RagSource } from '@careerpilot/shared';

export interface IInterviewQuestion extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  index: number;
  question: string;
  category: string;
  topic: string;
  difficulty: Difficulty;
  /** Model answer bullet points used to score completeness. Not shown up-front. */
  expectedPoints: string[];
  followUpTo?: Types.ObjectId | null;
  /** RAG provenance so company-specific questions can be traced (§10). */
  sources: RagSource[];
  generatedBy: string;
  askedAt: Date;
  createdAt: Date;
}

const sourceSchema = new Schema<RagSource>(
  {
    documentId: String,
    title: String,
    chunkIndex: Number,
    score: Number,
    snippet: String,
    category: String,
  },
  { _id: false },
);

const interviewQuestionSchema = new Schema<IInterviewQuestion>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'InterviewSession', required: true, index: true },
    index: { type: Number, required: true },
    question: { type: String, required: true, maxlength: 4000 },
    category: { type: String, default: 'GENERAL' },
    topic: { type: String, default: 'general' },
    difficulty: { type: String, enum: Object.values(Difficulty), default: Difficulty.MEDIUM },
    expectedPoints: { type: [String], default: [] },
    followUpTo: { type: Schema.Types.ObjectId, ref: 'InterviewQuestion', default: null },
    sources: { type: [sourceSchema], default: [] },
    generatedBy: { type: String, default: 'TECHNICAL_INTERVIEW_AGENT' },
    askedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } },
);

interviewQuestionSchema.index({ sessionId: 1, index: 1 }, { unique: true });

export const InterviewQuestion = registerModel<IInterviewQuestion>('InterviewQuestion', interviewQuestionSchema);
