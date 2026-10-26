import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { AssessmentType, DataProvenance, Difficulty } from '@careerpilot/shared';

export interface IAssessment extends Document {
  _id: Types.ObjectId;
  title: string;
  type: AssessmentType;
  description?: string;
  durationMinutes: number;
  totalQuestions: number;
  passingScore: number;
  difficulty: Difficulty;
  companyId?: Types.ObjectId | null;
  roleId?: Types.ObjectId | null;
  topics: string[];
  /** Full-screen assessment mode is mandatory for proctored papers (§13). */
  requiresFullscreen: boolean;
  requiresWebcam: boolean;
  /** Serve a random subset of the question bank so retakes differ. */
  randomizeQuestions: boolean;
  maxAttempts: number;
  active: boolean;
  provenance: DataProvenance;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const assessmentSchema = new Schema<IAssessment>(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: Object.values(AssessmentType), required: true, index: true },
    description: { type: String, maxlength: 2000 },
    durationMinutes: { type: Number, required: true, min: 1, max: 300 },
    totalQuestions: { type: Number, required: true, min: 1, max: 200 },
    passingScore: { type: Number, min: 0, max: 100, default: 40 },
    difficulty: { type: String, enum: Object.values(Difficulty), default: Difficulty.MEDIUM, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', default: null, index: true },
    topics: { type: [String], default: [], index: true },
    requiresFullscreen: { type: Boolean, default: true },
    requiresWebcam: { type: Boolean, default: false },
    randomizeQuestions: { type: Boolean, default: true },
    maxAttempts: { type: Number, default: 0 }, // 0 = unlimited
    active: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.DEMO },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

assessmentSchema.index({ type: 1, active: 1, difficulty: 1 });

export const Assessment = registerModel<IAssessment>('Assessment', assessmentSchema);
