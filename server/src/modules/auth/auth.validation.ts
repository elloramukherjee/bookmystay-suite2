import { z } from 'zod';
import { STAFF_ROLES } from './permissions.js';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254));

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Don't apply strength rules at login: only check it's a bounded string.
  password: z.string().min(1, 'Password is required').max(128),
});

export const registerSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(STAFF_ROLES).exclude(['super_admin']),
  phone: z.string().trim().max(20).optional(),
  /** Only honoured for super admins; everyone else creates staff in their own hotel. */
  hotelId: objectIdSchema.optional(),
});

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a password you haven’t used just now' });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
