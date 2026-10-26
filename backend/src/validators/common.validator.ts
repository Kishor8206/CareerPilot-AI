import { Types } from 'mongoose';
import { z } from 'zod';

/** A MongoDB ObjectId supplied as a path/query parameter. */
export const objectId = z
  .string()
  .refine((value) => Types.ObjectId.isValid(value), { message: 'Must be a valid identifier' });

export const idParam = z.object({ id: objectId });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

/**
 * Password policy (§28). Length is the dominant factor in resistance to
 * offline cracking, so a 10-character minimum is combined with a modest
 * character-class requirement rather than an unmemorable one.
 */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters long')
  .max(128, 'Password must be at most 128 characters long')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /\d/.test(v), 'Password must contain a digit');

export const email = z.string().trim().toLowerCase().email('A valid email address is required').max(254);

export const safeString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    // Strips angle brackets so stored text can never be interpreted as markup.
    .transform((v) => v.replace(/[<>]/g, ''));

export const optionalUrl = z.string().trim().url('Must be a valid URL').max(500).optional().or(z.literal(''));

export const scoreValue = z.number().min(0).max(100);
