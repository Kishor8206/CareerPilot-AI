import type { AuthUser } from '@careerpilot/shared';
import { AccountStatus, ErrorCode, UserRole, VerificationStatus } from '@careerpilot/shared';
import { moduleLogger } from '../config/logger';
import { AlumniProfile } from '../models/AlumniProfile';
import { PlacementOfficer } from '../models/PlacementOfficer';
import { StudentProfile } from '../models/StudentProfile';
import { User, type IUser } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { addMinutes, randomToken, sha256 } from '../utils/helpers';

const log = moduleLogger('auth');

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

export interface RegisterInput {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  department?: string;
  rollNumber?: string;
  batch?: string;
  graduationYear?: number;
  company?: string;
  designation?: string;
  experienceYears?: number;
  domain?: string;
  graduationYearAlumni?: number;
}

/** Shapes a user document into the DTO the frontend consumes. */
export async function toAuthUser(user: IUser): Promise<AuthUser> {
  const base: AuthUser = {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    avatarUrl: user.avatarUrl ?? null,
    department: user.department ?? null,
    createdAt: user.createdAt.toISOString(),
  };

  if (user.role === UserRole.ALUMNI) {
    const profile = await AlumniProfile.findOne({ userId: user._id }).select('verificationStatus').lean();
    base.alumniVerification = profile?.verificationStatus ?? VerificationStatus.UNVERIFIED;
  }
  return base;
}

/**
 * Creates the user account and its role-specific profile in one operation.
 *
 * A single MongoDB transaction would be ideal, but transactions require a
 * replica set which the in-memory development database does not provide. The
 * account is therefore rolled back manually if profile creation fails, so we
 * never leave an account without its profile.
 */
export async function registerUser(input: RegisterInput): Promise<IUser> {
  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw ApiError.conflict('An account with this email address already exists.');
  }

  const passwordHash = await User.hashPassword(input.password);
  const user = await User.create({
    email: input.email,
    passwordHash,
    fullName: input.fullName,
    role: input.role,
    department: input.department ?? null,
    // Email verification is an abstraction in this build; accounts are usable
    // immediately so a project review is not blocked by an SMTP dependency.
    status: AccountStatus.ACTIVE,
    emailVerified: false,
  });

  try {
    if (input.role === UserRole.STUDENT) {
      await StudentProfile.create({
        userId: user._id,
        rollNumber: input.rollNumber,
        department: input.department,
        batch: input.batch,
        graduationYear: input.graduationYear,
      });
    } else if (input.role === UserRole.ALUMNI) {
      await AlumniProfile.create({
        userId: user._id,
        company: input.company!,
        designation: input.designation!,
        domain: input.domain!,
        experienceYears: input.experienceYears ?? 0,
        department: input.department,
        graduationYear: input.graduationYearAlumni,
        // Alumni start unverified; an admin must confirm employment (§18).
        verificationStatus: VerificationStatus.PENDING,
        employmentProof: { submittedAt: new Date() },
      });
    } else if (input.role === UserRole.PLACEMENT_OFFICER) {
      await PlacementOfficer.create({
        userId: user._id,
        departments: input.department ? [input.department] : [],
      });
    }
  } catch (error) {
    await User.deleteOne({ _id: user._id });
    log.error({ err: error, email: input.email }, 'Profile creation failed; rolled back user account');
    throw ApiError.internal('Your account could not be created. Please try again.');
  }

  return user;
}

/**
 * Verifies credentials with a progressive lockout.
 *
 * The same generic message is returned for an unknown email and a wrong
 * password so the endpoint cannot be used to enumerate registered accounts.
 */
export async function authenticateUser(emailAddress: string, password: string): Promise<IUser> {
  const user = await User.findOne({ email: emailAddress }).select('+passwordHash +failedLoginAttempts +lockedUntil');

  const genericError = ApiError.unauthorized(
    'The email address or password is incorrect.',
    ErrorCode.INVALID_CREDENTIALS,
  );

  if (!user) {
    // Constant-ish work factor: hash a dummy value so a missing account does not
    // return measurably faster than a wrong password.
    await User.hashPassword('timing-equalisation-placeholder');
    throw genericError;
  }

  if (user.isLocked()) {
    const minutes = Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60_000);
    throw ApiError.forbidden(
      `Too many failed sign-in attempts. This account is temporarily locked for another ${minutes} minute(s).`,
    );
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = addMinutes(new Date(), LOCK_MINUTES);
      user.failedLoginAttempts = 0;
      log.warn({ userId: user._id.toString() }, 'Account locked after repeated failed sign-in attempts');
    }
    await user.save();
    throw genericError;
  }

  if (user.status === AccountStatus.SUSPENDED) {
    throw ApiError.forbidden('Your account has been suspended. Please contact the placement office.');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.loginCount += 1;
  await user.save();

  return user;
}

/**
 * Issues a password-reset token.
 *
 * Only the hash is stored. The caller must not reveal whether the address
 * exists, so this returns null for unknown accounts rather than throwing.
 */
export async function createPasswordResetToken(emailAddress: string): Promise<{ user: IUser; token: string } | null> {
  const user = await User.findOne({ email: emailAddress });
  if (!user) return null;

  const token = randomToken(32);
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpiresAt = addMinutes(new Date(), 30);
  await user.save();

  return { user, token };
}

export async function resetPassword(token: string, newPassword: string): Promise<IUser> {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) {
    throw ApiError.badRequest('This password reset link is invalid or has expired. Please request a new one.');
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  return user;
}

export async function createEmailVerificationToken(user: IUser): Promise<string> {
  const token = randomToken(32);
  user.emailVerificationTokenHash = sha256(token);
  user.emailVerificationExpiresAt = addMinutes(new Date(), 24 * 60);
  await user.save();
  return token;
}

export async function verifyEmailToken(token: string): Promise<IUser> {
  const user = await User.findOne({
    emailVerificationTokenHash: sha256(token),
    emailVerificationExpiresAt: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpiresAt');

  if (!user) {
    throw ApiError.badRequest('This verification link is invalid or has expired.');
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();

  return user;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('User');

  const valid = await user.comparePassword(currentPassword);
  if (!valid) {
    throw ApiError.badRequest('Your current password is incorrect.', ErrorCode.INVALID_CREDENTIALS);
  }

  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();
}
