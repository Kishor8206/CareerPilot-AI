import { Schema, type Document, type Types } from 'mongoose';
import { registerModel } from './registerModel';

/**
 * Refresh-token store enabling rotation and server-side revocation (§28).
 * Only the SHA-256 hash of the token is persisted, so a database leak does not
 * hand an attacker usable sessions.
 */
export interface IRefreshToken extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  /** Token family; rotating a token keeps the family and revokes the parent. */
  sessionId: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  replacedByHash?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    replacedByHash: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// MongoDB removes expired documents automatically, keeping the collection small.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = registerModel<IRefreshToken>('RefreshToken', refreshTokenSchema);
