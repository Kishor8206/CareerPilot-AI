import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * Runtime configuration held in the database rather than in source (§45 rule 17).
 * The APIE weights, readiness bands, monitoring severities and AI defaults all
 * live here so an administrator can retune them without a redeploy.
 */
export interface ISystemConfiguration extends Document {
  _id: Types.ObjectId;
  key: string;
  value: unknown;
  description: string;
  category: 'APIE' | 'AI' | 'MONITORING' | 'ASSESSMENT' | 'PRIVACY' | 'GENERAL';
  version: string;
  editable: boolean;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const systemConfigurationSchema = new Schema<ISystemConfiguration>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['APIE', 'AI', 'MONITORING', 'ASSESSMENT', 'PRIVACY', 'GENERAL'],
      default: 'GENERAL',
      index: true,
    },
    version: { type: String, default: '1.0.0' },
    editable: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

export const SystemConfiguration = registerModel<ISystemConfiguration>('SystemConfiguration', systemConfigurationSchema);

/** Well-known configuration keys. */
export const CONFIG_KEYS = {
  APIE_WEIGHTS: 'apie.weights',
  APIE_MODIFIERS: 'apie.modifiers',
  APIE_BANDS: 'apie.bands',
  APIE_REASSESSMENT_DAYS: 'apie.reassessmentDays',
  MONITORING_SEVERITY: 'monitoring.severityMap',
  MONITORING_THRESHOLDS: 'monitoring.riskThresholds',
  AI_DEFAULTS: 'ai.defaults',
  PRIVACY_RETENTION: 'privacy.retention',
} as const;
