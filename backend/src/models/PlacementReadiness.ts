import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { DataProvenance, ReadinessBand } from '@careerpilot/shared';
import type { ComponentScore, MlPredictionDto, SkillGapDto } from '@careerpilot/shared';

/**
 * A single APIE computation. Records are append-only: every recomputation
 * inserts a new document so the readiness trend and the research export have a
 * complete history (§6, §42).
 */
export interface IPlacementReadiness extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  userId: Types.ObjectId;
  score: number;
  band: ReadinessBand;
  components: ComponentScore[];
  modifiers: Array<{ label: string; delta: number; reason: string }>;
  strengths: string[];
  weaknesses: string[];
  skillGaps: SkillGapDto[];
  targetRoleReadiness: Array<{ roleId?: Types.ObjectId; roleTitle: string; score: number; band: ReadinessBand; missingSkills: string[] }>;
  targetCompanyReadiness: Array<{ companyId?: Types.ObjectId; companyName: string; score: number; band: ReadinessBand; gapSummary: string }>;
  reassessmentSuggestions: Array<{ component: string; reason: string; dueInDays: number }>;
  mlPrediction?: MlPredictionDto | null;
  /** Which weight configuration produced this score. */
  weightsVersion: string;
  weightsSnapshot: Record<string, number>;
  /**
   * Stored with the snapshot rather than injected at render time, so an
   * exported report always carries the disclaimer that applied when the score
   * was computed - even if the wording changes later.
   */
  modelDisclaimer: string;
  /** What triggered the recomputation, e.g. `ASSESSMENT_SUBMITTED`. */
  trigger: string;
  previousScore?: number | null;
  delta?: number | null;
  isLatest: boolean;
  provenance: DataProvenance;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const placementReadinessSchema = new Schema<IPlacementReadiness>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    score: { type: Number, min: 0, max: 100, required: true, index: true },
    band: { type: String, enum: Object.values(ReadinessBand), required: true, index: true },
    components: { type: Schema.Types.Mixed, default: [] },
    modifiers: { type: Schema.Types.Mixed, default: [] },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    skillGaps: { type: Schema.Types.Mixed, default: [] },
    targetRoleReadiness: { type: Schema.Types.Mixed, default: [] },
    targetCompanyReadiness: { type: Schema.Types.Mixed, default: [] },
    reassessmentSuggestions: { type: Schema.Types.Mixed, default: [] },
    mlPrediction: { type: Schema.Types.Mixed, default: null },
    weightsVersion: { type: String, default: '1.0.0' },
    weightsSnapshot: { type: Schema.Types.Mixed, default: {} },
    modelDisclaimer: {
      type: String,
      default:
        'PROTOTYPE SCORING MODEL. The Placement Readiness Score is produced by a configurable weighted model ' +
        'developed for this project. It has not been validated against real placement outcomes and must be ' +
        'used as a preparation guide, not as a prediction of employment.',
    },
    trigger: { type: String, default: 'MANUAL' },
    previousScore: { type: Number, default: null },
    delta: { type: Number, default: null },
    isLatest: { type: Boolean, default: true, index: true },
    provenance: { type: String, enum: Object.values(DataProvenance), default: DataProvenance.REAL },
    computedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

placementReadinessSchema.index({ studentId: 1, computedAt: -1 });
// One "current" record per student powers dashboards and analytics cheaply.
placementReadinessSchema.index({ studentId: 1, isLatest: 1 });

export const PlacementReadiness = registerModel<IPlacementReadiness>('PlacementReadiness', placementReadinessSchema);
