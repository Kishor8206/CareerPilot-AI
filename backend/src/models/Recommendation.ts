import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { GapSeverity } from '@careerpilot/shared';

export interface IRecommendation extends Document {
  _id: Types.ObjectId;
  studentId: Types.ObjectId;
  title: string;
  description: string;
  category: 'SKILL' | 'ASSESSMENT' | 'INTERVIEW' | 'RESUME' | 'MENTORSHIP' | 'PROJECT' | 'COMMUNICATION';
  priority: GapSeverity;
  estimatedHours: number;
  /** Deep link into the app so the recommendation is actionable, not advisory. */
  actionRoute?: string;
  actionLabel?: string;
  rationale: string;
  resources: Array<{ title: string; url?: string; type: string }>;
  status: 'ACTIVE' | 'COMPLETED' | 'DISMISSED';
  completedAt?: Date | null;
  generatedBy: string;
  readinessId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const recommendationSchema = new Schema<IRecommendation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['SKILL', 'ASSESSMENT', 'INTERVIEW', 'RESUME', 'MENTORSHIP', 'PROJECT', 'COMMUNICATION'],
      default: 'SKILL',
      index: true,
    },
    priority: { type: String, enum: Object.values(GapSeverity), default: GapSeverity.MEDIUM, index: true },
    estimatedHours: { type: Number, default: 4 },
    actionRoute: String,
    actionLabel: String,
    rationale: { type: String, default: '' },
    resources: {
      type: [new Schema({ title: String, url: String, type: String }, { _id: false })],
      default: [],
    },
    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'DISMISSED'], default: 'ACTIVE', index: true },
    completedAt: { type: Date, default: null },
    generatedBy: { type: String, default: 'PLACEMENT_READINESS' },
    readinessId: { type: Schema.Types.ObjectId, ref: 'PlacementReadiness', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

recommendationSchema.index({ studentId: 1, status: 1, priority: 1 });

export const Recommendation = registerModel<IRecommendation>('Recommendation', recommendationSchema);
