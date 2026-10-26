import type { Request, Response } from 'express';
import type { LoginResponse } from '@careerpilot/shared';
import { env } from '../config/env';
import { User } from '../models/User';
import { AuditAction, audit } from '../services/audit.service';
import {
  authenticateUser,
  changePassword as changePasswordService,
  createEmailVerificationToken,
  createPasswordResetToken,
  registerUser,
  resetPassword as resetPasswordService,
  toAuthUser,
  verifyEmailToken,
} from '../services/auth.service';
import { emailVerificationEmail, passwordResetEmail, sendEmail } from '../services/email.service';
import {
  REFRESH_COOKIE_NAME,
  issueTokens,
  refreshCookieOptions,
  revokeAllUserTokens,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/token.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { created, ok } from '../utils/response';

const frontendOrigin = () => env.CORS_ORIGINS[0] ?? 'http://localhost:5173';

function requestContext(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const user = await registerUser(req.body);
  const tokens = await issueTokens(
    { id: user._id.toString(), role: user.role, email: user.email },
    requestContext(req),
  );

  // Verification is optional in this build, but the token is still issued and
  // delivered through the mail abstraction so the flow is genuinely testable.
  const verificationToken = await createEmailVerificationToken(user);
  const message = emailVerificationEmail(user.fullName, verificationToken, `${frontendOrigin()}/verify-email`);
  await sendEmail({ ...message, to: user.email });

  await audit({ action: AuditAction.REGISTER, resource: 'User', resourceId: user._id.toString(), actorId: user._id.toString(), actorEmail: user.email, actorRole: user.role }, req);

  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());

  const payload: LoginResponse = {
    user: await toAuthUser(user),
    tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn },
  };
  created(res, payload);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };

  try {
    const user = await authenticateUser(email, password);
    const tokens = await issueTokens(
      { id: user._id.toString(), role: user.role, email: user.email },
      requestContext(req),
    );

    await audit(
      {
        action: AuditAction.LOGIN_SUCCESS,
        resource: 'User',
        resourceId: user._id.toString(),
        actorId: user._id.toString(),
        actorEmail: user.email,
        actorRole: user.role,
      },
      req,
    );

    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());

    const payload: LoginResponse = {
      user: await toAuthUser(user),
      tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn },
    };
    ok(res, payload);
  } catch (error) {
    await audit(
      { action: AuditAction.LOGIN_FAILURE, resource: 'User', status: 'FAILURE', actorEmail: email, metadata: { reason: (error as ApiError).code } },
      req,
    );
    throw error;
  }
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const presented = (req.signedCookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? req.body?.refreshToken;
  if (!presented) {
    throw ApiError.unauthorized('No refresh token was supplied.');
  }

  const { userId, tokens } = await rotateRefreshToken(presented, requestContext(req));
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');

  await audit({ action: AuditAction.TOKEN_REFRESH, resource: 'Session', resourceId: tokens.sessionId, actorId: userId }, req);

  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());

  const payload: LoginResponse = {
    user: await toAuthUser(user),
    tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: tokens.expiresIn },
  };
  ok(res, payload);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const presented = (req.signedCookies?.[REFRESH_COOKIE_NAME] as string | undefined) ?? req.body?.refreshToken;
  if (presented) await revokeRefreshToken(presented);

  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
  await audit({ action: AuditAction.LOGOUT, resource: 'Session' }, req);
  ok(res, { message: 'You have been signed out.' });
});

/** Ends every session for the account - used after a password change. */
export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  await revokeAllUserTokens(req.auth!.userId);
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
  await audit({ action: AuditAction.LOGOUT, resource: 'Session', metadata: { scope: 'all' } }, req);
  ok(res, { message: 'You have been signed out on all devices.' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw ApiError.notFound('User');
  ok(res, await toAuthUser(user));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };
  const result = await createPasswordResetToken(email);

  if (result) {
    const message = passwordResetEmail(result.user.fullName, result.token, `${frontendOrigin()}/reset-password`);
    await sendEmail({ ...message, to: result.user.email });
    await audit(
      { action: AuditAction.PASSWORD_RESET_REQUEST, resource: 'User', resourceId: result.user._id.toString(), actorEmail: email },
      req,
    );
  }

  // Always the same response, whether or not the address is registered, so this
  // endpoint cannot be used to discover which emails have accounts.
  ok(res, {
    message: 'If an account exists for that email address, a password reset link has been sent.',
    // Development convenience so the flow is demonstrable without a mail server.
    ...(env.isDev && result ? { devToken: result.token } : {}),
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body as { token: string; password: string };
  const user = await resetPasswordService(token, password);

  // Any session opened with the old password is invalidated.
  await revokeAllUserTokens(user._id.toString(), 'PASSWORD_RESET');
  await audit({ action: AuditAction.PASSWORD_RESET, resource: 'User', resourceId: user._id.toString(), actorId: user._id.toString() }, req);

  ok(res, { message: 'Your password has been reset. Please sign in with your new password.' });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await changePasswordService(req.auth!.userId, currentPassword, newPassword);
  await revokeAllUserTokens(req.auth!.userId, 'PASSWORD_CHANGED');
  await audit({ action: AuditAction.PASSWORD_CHANGE, resource: 'User', resourceId: req.auth!.userId }, req);

  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined });
  ok(res, { message: 'Your password has been changed. Please sign in again.' });
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const { token } = req.body as { token: string };
  const user = await verifyEmailToken(token);
  ok(res, { message: 'Your email address has been verified.', user: await toAuthUser(user) });
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.auth!.userId);
  if (!user) throw ApiError.notFound('User');
  if (user.emailVerified) {
    ok(res, { message: 'Your email address is already verified.' });
    return;
  }
  const token = await createEmailVerificationToken(user);
  const message = emailVerificationEmail(user.fullName, token, `${frontendOrigin()}/verify-email`);
  await sendEmail({ ...message, to: user.email });
  ok(res, { message: 'A new verification email has been sent.', ...(env.isDev ? { devToken: token } : {}) });
});

/** Records a consent decision in the user's consent ledger (§30). */
export const setConsent = asyncHandler(async (req: Request, res: Response) => {
  const { key, granted, policyVersion } = req.body as { key: string; granted: boolean; policyVersion: string };
  const user = await User.findById(req.auth!.userId);
  if (!user) throw ApiError.notFound('User');

  const existing = user.consents.find((c) => c.key === key);
  if (existing) {
    existing.granted = granted;
    existing.grantedAt = new Date();
    existing.policyVersion = policyVersion;
  } else {
    user.consents.push({ key, granted, grantedAt: new Date(), policyVersion });
  }
  await user.save();

  await audit({ action: 'privacy.consent.set', resource: 'User', resourceId: user._id.toString(), metadata: { key, granted } }, req);
  ok(res, { consents: user.consents });
});
