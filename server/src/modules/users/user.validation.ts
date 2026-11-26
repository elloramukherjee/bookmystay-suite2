import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { STAFF_ROLES } from '../auth/permissions.js';

export const listUsersQuery = z.object({
  ...paginationQuery,
  role: z.enum(STAFF_ROLES).optional(),
  q: z.string().trim().max(80).optional(),
  hotelId: objectIdSchema.optional(),
});

export const userIdParams = z.object({ id: objectIdSchema });

export const updateUserSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(STAFF_ROLES).exclude(['super_admin']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
