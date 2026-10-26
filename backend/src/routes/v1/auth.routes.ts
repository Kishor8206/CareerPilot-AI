import { Router } from 'express';
import * as controller from '../../controllers/auth.controller';
import { authenticate } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import {
  changePasswordSchema,
  consentSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../../validators/auth.validator';

export const authRouter = Router();

/* ---- Public. All credential endpoints sit behind the strict limiter. ---- */
authRouter.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
authRouter.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.post('/forgot-password', authLimiter, validate({ body: forgotPasswordSchema }), controller.forgotPassword);
authRouter.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), controller.resetPassword);
authRouter.post('/verify-email', validate({ body: verifyEmailSchema }), controller.verifyEmail);

/* ---- Authenticated ---- */
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/logout-all', authenticate, controller.logoutAll);
authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), controller.changePassword);
authRouter.post('/resend-verification', authenticate, authLimiter, controller.resendVerification);
authRouter.post('/consent', authenticate, validate({ body: consentSchema }), controller.setConsent);
