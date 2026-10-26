import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * A generated career plan (skill gaps, phased roadmap, study plan, projects,
 * interview preparation, resources) for one student and one target role.
 *
 * Append-only with an `isLatest` flag, like readiness snapshots: regenerating
 * keeps the history, so progress between plans stays visible.
 *
 * `inference` records how the plan was produced (fine-tuned model, repaired,
 * or the deterministic planner), so a fallback is never mistaken for a model
 * answer. This collection is unrelated to the ATS model's data.
 */
export interface ICareerPlan extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  targetRole: string;
  /** The request sent to the AI service, kept so a plan can be regenerated. */
  request: Record<string, unknown>;
  plan: Record<string, unknown>;
  resources: Array<Record<string, unknown>>;
  /** Every gap skill with its courses/documentation and videos. */
  resourcesBySkill: Array<Record<string, unknown>>;
  dailyPlan: Array<Record<string, unknown>>;
  readiness: Record<string, unknown>;
  schedule: Record<string, unknown>;
  inference: Record<string, unknown>;
  completedSkills: string[];
  completedProjects: string[];
  knowledgeVersion: string;
  disclaimer: string;
  isLatest: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const careerPlanSchema = new Schema<ICareerPlan>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetRole: { type: String, required: true, trim: true, maxlength: 120 },
    request: { type: Schema.Types.Mixed, default: {} },
    plan: { type: Schema.Types.Mixed, required: true },
    resources: { type: Schema.Types.Mixed, default: [] },
    resourcesBySkill: { type: Schema.Types.Mixed, default: [] },
    dailyPlan: { type: Schema.Types.Mixed, default: [] },
    readiness: { type: Schema.Types.Mixed, default: {} },
    schedule: { type: Schema.Types.Mixed, default: {} },
    inference: { type: Schema.Types.Mixed, default: {} },
    completedSkills: { type: [String], default: [] },
    completedProjects: { type: [String], default: [] },
    knowledgeVersion: { type: String, default: '' },
    disclaimer: { type: String, default: '' },
    isLatest: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, minimize: false },
);

careerPlanSchema.index({ studentId: 1, isLatest: 1 });
careerPlanSchema.index({ studentId: 1, createdAt: -1 });

export const CareerPlan = registerModel<ICareerPlan>('CareerPlan', careerPlanSchema);
