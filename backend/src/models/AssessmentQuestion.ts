import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, Difficulty } from '@careerpilot/shared';

export interface IAssessmentQuestion extends Document {
  _id: Types.ObjectId;
  assessmentId?: Types.ObjectId | null;
  type: 'MCQ' | 'MULTI_SELECT' | 'SHORT_ANSWER' | 'CODING';
  prompt: string;
  options: Array<{ key: string; text: string }>;
  /**
   * Never returned to a student while an attempt is in progress. Controllers
   * project this field out explicitly; see `assessment.service.ts`.
   */
  correctAnswer: string[];
  explanation?: string;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  negativeMarks: number;
  codingProblemId?: Types.ObjectId | null;
  tags: string[];
  active: boolean;
  provenance: DataProvenance;
  createdAt: Date;
  updatedAt: Date;
}

const assessmentQuestionSchema = new Schema<IAssessmentQuestion>(
  {
    assessmentId: { type: Schema.Types.ObjectId, ref: 'Assessment', default: null, index: true },
    type: { type: String, enum: ['MCQ', 'MULTI_SELECT', 'SHORT_ANSWER', 'CODING'], default: 'MCQ' },
    prompt: { type: String, required: true, maxlength: 5000 },
    options: {
      type: [new Schema({ key: { type: String, required: true }, text: { type: String, required: true } }, { _id: false })],
      default: [],
    },
    correctAnswer: { type: [String], default: [] },
    explanation: { type: String, maxlength: 3000 },
    topic: { type: String, required: true, index: true },
    difficulty: { type: String, enum: Object.values(Difficulty), default: Difficulty.MEDIUM, index: true },
    marks: { type: Number, default: 1, min: 0 },
    negativeMarks: { type: Number, default: 0, min: 0 },
    codingProblemId: { type: Schema.Types.ObjectId, ref: 'CodingProblem', default: null },
    tags: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

assessmentQuestionSchema.index({ assessmentId: 1, active: 1 });
assessmentQuestionSchema.index({ topic: 1, difficulty: 1 });

export const AssessmentQuestion = registerModel<IAssessmentQuestion>('AssessmentQuestion', assessmentQuestionSchema);
