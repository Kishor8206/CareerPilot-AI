import jwt, { type SignOptions } from 'jsonwebtoken';
import type { JwtPayload, UserRole } from '@careerpilot/shared';
import { ErrorCode } from '@careerpilot/shared';
import { env } from '../config/env';
import { RefreshToken } from '../models/RefreshToken';
import { ApiError } from '../utils/ApiError';
import { parseDuration, randomToken, sha256 } from '../utils/helpers';

const ACCESS_TTL_MS = parseDuration(env.JWT_ACCESS_EXPIRES_IN, 15 * 60_000);
const REFRESH_TTL_MS = parseDuration(env.JWT_REFRESH_EXPIRES_IN, 7 * 86_400_000);

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

function signAccessToken(payload: { sub: string; role: UserRole; email: string; sid: string }): string {
  const options: SignOptions = {
    expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
    issuer: 'careerpilot-ai',
    audience: 'careerpilot-client',
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

/**
 * Issues an access/refresh pair and persists the (hashed) refresh token so it
 * can be rotated and revoked server-side.
 */
export async function issueTokens(
  user: { id: string; role: UserRole; email: string },
  context: { ip?: string; userAgent?: string; sessionId?: string } = {},
): Promise<IssuedTokens> {
  const sessionId = context.sessionId ?? randomToken(16);
  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email, sid: sessionId });

  const refreshToken = randomToken(48);
  await RefreshToken.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    sessionId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null,
  });

  return { accessToken, refreshToken, sessionId, expiresIn: Math.floor(ACCESS_TTL_MS / 1000) };
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: 'careerpilot-ai',
      audience: 'careerpilot-client',
    }) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Your session has expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED);
    }
    throw ApiError.unauthorized('The provided authentication token is not valid.', ErrorCode.INVALID_TOKEN);
  }
}

/**
 * Rotation: the presented refresh token is revoked and a fresh pair is issued
 * within the same token family. Reuse of an already-revoked token revokes the
 * whole family, which is the standard defence against token theft.
 */
export async function rotateRefreshToken(
  presented: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<{ userId: string; tokens: IssuedTokens }> {
  const tokenHash = sha256(presented);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) {
    throw ApiError.unauthorized('This refresh token is not recognised.', ErrorCode.INVALID_TOKEN);
  }

  if (stored.revokedAt) {
    await RefreshToken.updateMany(
      { sessionId: stored.sessionId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' } },
    );
    throw ApiError.unauthorized(
      'This session has been ended for security reasons. Please sign in again.',
      ErrorCode.INVALID_TOKEN,
    );
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Your session has expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED);
  }

  // The caller re-issues with the real user record; we only need the identity.
  const { User } = await import('../models/User');
  const user = await User.findById(stored.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.', ErrorCode.INVALID_TOKEN);

  const tokens = await issueTokens(
    { id: user._id.toString(), role: user.role, email: user.email },
    { ...context, sessionId: stored.sessionId },
  );

  stored.revokedAt = new Date();
  stored.revokedReason = 'ROTATED';
  stored.replacedByHash = sha256(tokens.refreshToken);
  await stored.save();

  return { userId: user._id.toString(), tokens };
}

export async function revokeRefreshToken(presented: string, reason = 'LOGOUT'): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: sha256(presented), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function revokeAllUserTokens(userId: string, reason = 'LOGOUT_ALL'): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/** httpOnly cookie options for the refresh token. */
export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? ('none' as const) : ('lax' as const),
    maxAge: REFRESH_TTL_MS,
    path: `${env.API_PREFIX}/auth`,
    signed: true,
  };
}

export const REFRESH_COOKIE_NAME = 'cp_refresh';
