import { Schema, type Document, type Model, type Types } from 'mongoose';
import { registerModel } from './registerModel';
import bcrypt from 'bcryptjs';
import { ALL_ROLES, AccountStatus, UserRole } from '@careerpilot/shared';
import { env } from '../config/env';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  fullName: string;
  role: UserRole;
  status: AccountStatus;
  emailVerified: boolean;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;
  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  avatarUrl?: string | null;
  phone?: string | null;
  department?: string | null;
  lastLoginAt?: Date | null;
  loginCount: number;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  /** Privacy (§30): timestamp of an account-deletion request awaiting processing. */
  deletionRequestedAt?: Date | null;
  /** Consent ledger; the key is a policy id such as `ai_processing` or `recording`. */
  consents: Array<{ key: string; granted: boolean; grantedAt: Date; policyVersion: string }>;
  isDemoAccount: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
  isLocked(): boolean;
}

export interface IUserModel extends Model<IUser> {
  hashPassword(plain: string): Promise<string>;
}

const consentSchema = new Schema(
  {
    key: { type: String, required: true },
    granted: { type: Boolean, required: true },
    grantedAt: { type: Date, default: Date.now },
    policyVersion: { type: String, default: '1.0' },
  },
  { _id: false },
);

const userSchema = new Schema<IUser, IUserModel>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'A valid email address is required'],
      index: true,
    },
    // `select: false` keeps the hash out of every query result by default.
    passwordHash: { type: String, required: true, select: false },
    fullName: { type: String, required: [true, 'Full name is required'], trim: true, minlength: 2, maxlength: 120 },
    role: { type: String, enum: ALL_ROLES, required: true, default: UserRole.STUDENT, index: true },
    status: { type: String, enum: Object.values(AccountStatus), default: AccountStatus.ACTIVE, index: true },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    avatarUrl: { type: String, default: null },
    phone: { type: String, default: null, trim: true },
    department: { type: String, default: null, trim: true, index: true },
    lastLoginAt: { type: Date, default: null },
    loginCount: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    deletionRequestedAt: { type: Date, default: null },
    consents: { type: [consentSchema], default: [] },
    isDemoAccount: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Belt-and-braces: these are `select: false` already, but a document
        // loaded with an explicit `+field` projection must still not serialise
        // its secrets into an API response.
        const plain = ret as Record<string, unknown>;
        for (const field of [
          'passwordHash',
          'emailVerificationTokenHash',
          'emailVerificationExpiresAt',
          'passwordResetTokenHash',
          'passwordResetExpiresAt',
          'failedLoginAttempts',
          'lockedUntil',
          '__v',
        ]) {
          delete plain[field];
        }
        return plain;
      },
    },
  },
);

userSchema.index({ role: 1, status: 1 });
userSchema.index({ createdAt: -1 });

userSchema.methods.comparePassword = async function comparePassword(candidate: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.isLocked = function isLocked(): boolean {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

userSchema.statics.hashPassword = async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
};

export const User = registerModel<IUser, IUserModel>('User', userSchema);
