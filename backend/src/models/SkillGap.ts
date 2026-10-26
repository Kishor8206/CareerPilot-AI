import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { GapSeverity, SkillCategory } from '@careerpilot/shared';

/**
 * Persisted skill gaps. Kept as a first-class collection (rather than only
 * embedded in a readiness snapshot) so the placement officer can aggregate
 * institution-wide gaps efficiently (§23).
 */
export interface ISkillGap extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  skill: string;
  normalizedSkill: string;
  category: SkillCategory;
  currentLevel: number;
  requiredLevel: number;
  gap: number;
  severity: GapSeverity;
  /** Where the gap was detected: RESUME_MATCH, ASSESSMENT, INTERVIEW, ALUMNI. */
  source: string;
  relatedRoles: string[];
  relatedCompanies: string[];
  recommendedActions: string[];
  resolved: boolean;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const skillGapSchema = new Schema<ISkillGap>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    skill: { type: String, required: true },
    normalizedSkill: { type: String, required: true, index: true },
    category: { type: String, enum: Object.values(SkillCategory), default: SkillCategory.PROGRAMMING_LANGUAGE },
    currentLevel: { type: Number, min: 0, max: 100, default: 0 },
    requiredLevel: { type: Number, min: 0, max: 100, default: 70 },
    gap: { type: Number, min: 0, max: 100, default: 0 },
    severity: { type: String, enum: Object.values(GapSeverity), default: GapSeverity.MEDIUM, index: true },
    source: { type: String, default: 'RESUME_MATCH' },
    relatedRoles: { type: [String], default: [] },
    relatedCompanies: { type: [String], default: [] },
    recommendedActions: { type: [String], default: [] },
    resolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

// A student holds at most one open gap record per skill; recomputation upserts.
skillGapSchema.index({ studentId: 1, normalizedSkill: 1 }, { unique: true });
skillGapSchema.index({ resolved: 1, severity: 1 });

export const SkillGap = registerModel<ISkillGap>('SkillGap', skillGapSchema);
