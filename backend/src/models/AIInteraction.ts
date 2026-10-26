import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import { AgentName } from '@careerpilot/shared';

/**
 * Audit + observability record for every agent invocation (§5, §38).
 * Prompts are NOT stored by default: they contain resume content and other
 * personal data. Only sizes, latency and outcome are retained.
 */
export interface IAIInteraction extends Document {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | null;
  studentId?: Types.ObjectId | null;
  agent: AgentName | string;
  operation: string;
  status: 'SUCCESS' | 'FAILED' | 'VALIDATION_ERROR';
  provider: string;
  /** Named `modelName` because `model` collides with Mongoose's Document.model(). */
  modelName?: string;
  latencyMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  estimatedCostUsd?: number;
  inputBytes: number;
  outputBytes: number;
  error?: string | null;
  correlationId?: string | null;
  ragSourceCount: number;
  createdAt: Date;
}

const aiInteractionSchema = new Schema<IAIInteraction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'StudentProfile', default: null, index: true },
    agent: { type: String, required: true, index: true },
    operation: { type: String, required: true },
    status: { type: String, enum: ['SUCCESS', 'FAILED', 'VALIDATION_ERROR'], required: true, index: true },
    provider: { type: String, default: 'unknown' },
    modelName: String,
    latencyMs: { type: Number, default: 0 },
    tokensPrompt: Number,
    tokensCompletion: Number,
    estimatedCostUsd: Number,
    inputBytes: { type: Number, default: 0 },
    outputBytes: { type: Number, default: 0 },
    error: { type: String, default: null },
    correlationId: { type: String, default: null, index: true },
    ragSourceCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } },
);

aiInteractionSchema.index({ createdAt: -1 });
aiInteractionSchema.index({ agent: 1, status: 1, createdAt: -1 });

export const AIInteraction = registerModel<IAIInteraction>('AIInteraction', aiInteractionSchema);
