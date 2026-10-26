import type { NextFunction, Request, Response } from 'express';
import { AccountStatus, ErrorCode, UserRole, VerificationStatus } from '@careerpilot/shared';
import { AlumniProfile } from '../models/AlumniProfile';
import { StudentProfile } from '../models/StudentProfile';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { verifyAccessToken } from '../services/token.service';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Verifies the access token and confirms the account is still usable.
 * Re-reading the user on every request costs one indexed lookup but means a
 * suspended or deleted account loses access immediately rather than at token
 * expiry.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    throw ApiError.unauthorized('You must be signed in to access this resource.');
  }

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).select('email role status');
  if (!user) {
    throw ApiError.unauthorized('Your account could not be found.', ErrorCode.INVALID_TOKEN);
  }
  if (user.status === AccountStatus.SUSPENDED) {
    throw ApiError.forbidden('Your account has been suspended. Please contact the placement office.');
  }

  req.auth = {
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
    sessionId: payload.sid,
  };
  next();
});

/**
 * Attaches `req.auth` when a valid token is present but never rejects.
 * Used by endpoints whose response varies for signed-in users.
 */
export const optionalAuthenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.auth = { userId: payload.sub, role: payload.role, email: payload.email, sessionId: payload.sid };
  } catch {
    // A bad token on an optional route is simply treated as anonymous.
  }
  next();
});

/** Role-based access control (§2, §29). */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(ApiError.unauthorized('You must be signed in to access this resource.'));
    }
    if (roles.length && !roles.includes(req.auth.role)) {
      return next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${roles.join(', ')}. Your role is ${req.auth.role}.`,
        ),
      );
    }
    return next();
  };
}

/** Resolves and caches the caller's StudentProfile id. */
export const requireStudentProfile = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth) throw ApiError.unauthorized();
  const profile = await StudentProfile.findOne({ userId: req.auth.userId }).select('_id');
  if (!profile) {
    throw ApiError.notFound('Student profile');
  }
  req.studentId = profile._id;
  next();
});

/**
 * Resolves the caller's AlumniProfile and, by default, refuses unverified
 * alumni. Only VERIFIED alumni may mentor students (§18).
 */
export function requireAlumniProfile(options: { mustBeVerified?: boolean } = {}) {
  const mustBeVerified = options.mustBeVerified ?? true;
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw ApiError.unauthorized();
    const profile = await AlumniProfile.findOne({ userId: req.auth.userId }).select('_id verificationStatus');
    if (!profile) throw ApiError.notFound('Alumni profile');
    if (mustBeVerified && profile.verificationStatus !== VerificationStatus.VERIFIED) {
      throw ApiError.forbidden(
        'Your alumni account is not verified yet. An administrator must verify your employment details before you can mentor students.',
        ErrorCode.ALUMNI_NOT_VERIFIED,
      );
    }
    req.alumniId = profile._id;
    next();
  });
}

/**
 * Ownership guard: allows the resource owner through, and lets staff roles
 * (placement officer / admin) read any student's record.
 */
export function allowSelfOrStaff(getOwnerUserId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(ApiError.unauthorized());
    const staff: UserRole[] = [UserRole.ADMIN, UserRole.PLACEMENT_OFFICER];
    if (staff.includes(req.auth.role)) return next();
    const ownerId = getOwnerUserId(req);
    if (ownerId && ownerId === req.auth.userId) return next();
    return next(ApiError.forbidden('You can only access your own records.'));
  };
}
