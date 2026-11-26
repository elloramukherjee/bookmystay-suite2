import type { Request } from 'express';
import type { Types } from 'mongoose';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, forbidden, notFound } from '../../shared/errors.js';
import { escapeRegex, pageMeta, type PageMeta } from '../../shared/pagination.js';
import type { AuthContext } from '../../types/express.js';
import { hashPassword } from '../auth/password.js';
import { ASSIGNABLE_ROLES } from '../auth/permissions.js';
import { revokeAllForUser } from '../auth/token.service.js';
import { toPublicUser, type PublicUser } from './user.mapper.js';
import { User } from './user.model.js';
import type { ListUsersQuery, UpdateUserInput } from './user.validation.js';

export async function listStaff(hotelId: Types.ObjectId, query: ListUsersQuery): Promise<{ items: PublicUser[]; meta: PageMeta }> {
  const filter: Record<string, unknown> = { hotelId };
  if (query.role) filter.role = query.role;
  if (query.q) {
    const rx = new RegExp(escapeRegex(query.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ isActive: -1, role: 1, name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map(toPublicUser), meta: pageMeta(query.page, query.limit, total) };
}

export async function updateStaff(actor: AuthContext, userId: string, input: UpdateUserInput, req: Request): Promise<PublicUser> {
  const target = await User.findById(userId);
  // Treat other properties' users as nonexistent.
  if (!target || (actor.role !== 'super_admin' && !actor.hotelId?.equals(String(target.hotelId)))) {
    throw notFound('Staff member');
  }

  const isSelf = target._id.equals(actor.userId);
  if (isSelf && (input.role !== undefined || input.isActive === false)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot change your own role or deactivate yourself');
  }
  if (target.role === 'owner' && actor.role !== 'super_admin' && !isSelf) {
    throw forbidden('Only platform support can change another owner account');
  }
  if (input.role && input.role !== target.role && !ASSIGNABLE_ROLES[actor.role].includes(input.role)) {
    throw forbidden(`Your role cannot assign the ${input.role.replace('_', ' ')} role`);
  }

  const securityChange = (input.role !== undefined && input.role !== target.role) || (input.isActive !== undefined && input.isActive !== target.isActive);

  const before = { role: target.role, isActive: target.isActive };
  if (input.name !== undefined) target.name = input.name;
  if (input.role !== undefined) target.role = input.role;
  if (input.isActive !== undefined) target.isActive = input.isActive;
  if (securityChange) target.tokenVersion += 1;
  await target.save();

  if (securityChange) await revokeAllForUser(target._id);

  await audit({
    hotelId: target.hotelId ?? null,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'staff.updated',
    entity: { type: 'User', id: target._id },
    metadata: { before, after: { role: target.role, isActive: target.isActive } },
    req,
  });
  return toPublicUser(target);
}

/**
 * A manager sets a new password for a staff member who forgot theirs (there is no email/SMS reset in
 * this version). Only for roles the actor may assign; never for owners or yourself (use change-password).
 * Every session of that user ends immediately.
 */
export async function resetStaffPassword(actor: AuthContext, userId: string, newPassword: string, req: Request): Promise<void> {
  const target = await User.findById(userId).select('+passwordHash +failedLoginCount +lockedUntil');
  if (!target || (actor.role !== 'super_admin' && !actor.hotelId?.equals(String(target.hotelId)))) throw notFound('Staff member');
  if (target._id.equals(actor.userId)) throw new AppError(400, 'VALIDATION_ERROR', 'Use “Change password” in your account menu for your own password');
  if (actor.role !== 'super_admin' && !ASSIGNABLE_ROLES[actor.role].includes(target.role)) {
    throw forbidden(`Your role cannot reset a ${target.role.replace('_', ' ')}’s password`);
  }
  target.passwordHash = await hashPassword(newPassword);
  target.tokenVersion += 1;
  target.failedLoginCount = 0;
  target.lockedUntil = null;
  await target.save();
  await revokeAllForUser(target._id);
  await audit({
    hotelId: target.hotelId ?? null,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'staff.password_reset',
    entity: { type: 'User', id: target._id },
    req,
  });
}
