import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * Security audit trail (§29). Written for authentication events, privileged
 * admin actions, data exports and any access to another user's records.
 */
export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  actorId?: Types.ObjectId | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  status: 'SUCCESS' | 'FAILURE';
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorEmail: { type: String, default: null },
    actorRole: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true },
    resource: { type: String, required: true, index: true },
    resourceId: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    status: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: { virtuals: true } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLog = registerModel<IAuditLog>('AuditLog', auditLogSchema);
