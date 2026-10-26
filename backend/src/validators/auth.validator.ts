import { z } from 'zod';
import { UserRole } from '@careerpilot/shared';
import { email, password, safeString } from './common.validator';

/**
 * Self-registration is limited to students and alumni. Placement officers and
 * administrators are provisioned by an existing admin, so the role field cannot
 * be used to escalate privileges (§29).
 */
export const SELF_REGISTERABLE_ROLES = [UserRole.STUDENT, UserRole.ALUMNI] as const;

export const registerSchema = z.object({
  fullName: safeString(120).pipe(z.string().min(2, 'Full name must be at least 2 characters')),
  email,
  password,
  role: z.enum(SELF_REGISTERABLE_ROLES).default(UserRole.STUDENT),
  department: safeString(120).optional(),

  // Student-specific optional fields captured at signup.
  rollNumber: safeString(40).optional(),
  batch: safeString(20).optional(),
  graduationYear: z.coerce.number().int().min(1980).max(2100).optional(),

  // Alumni-specific fields; required when role === ALUMNI (checked below).
  company: safeString(160).optional(),
  designation: safeString(160).optional(),
  experienceYears: z.coerce.number().min(0).max(60).optional(),
  domain: safeString(120).optional(),
  graduationYearAlumni: z.coerce.number().int().min(1950).max(2100).optional(),
})
  .refine((data) => data.role !== UserRole.ALUMNI || Boolean(data.company && data.designation && data.domain), {
    message: 'Alumni registration requires company, designation and domain',
    path: ['company'],
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});

export const refreshSchema = z.object({
  // Optional: browsers send the httpOnly cookie instead.
  refreshToken: z.string().min(20).max(200).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const consentSchema = z.object({
  key: z.enum(['ai_processing', 'recording', 'analytics', 'data_sharing']),
  granted: z.boolean(),
  policyVersion: z.string().max(20).default('1.0'),
});
