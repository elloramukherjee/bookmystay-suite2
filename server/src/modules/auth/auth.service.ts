import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, conflict, forbidden, notFound } from '../../shared/errors.js';
import { normalizePhone } from '../../utils/phone.js';
import { Hotel } from '../hotels/hotel.model.js';
import { User } from '../users/user.model.js';
import { toPublicUser, type PublicUser } from '../users/user.mapper.js';
import type { AuthContext } from '../../types/express.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.validation.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { ASSIGNABLE_ROLES, permissionsFor, type Permission, type StaffRole } from './permissions.js';
import { issueRefreshToken, revokeAllForUser, revokeRefreshToken, rotateRefreshToken, signAccessToken } from './token.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export interface SessionResult {
  accessToken: string;
  refreshToken: { raw: string; expiresAt: Date };
  user: PublicUser;
}

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');

export async function login(input: LoginInput, req: Request): Promise<SessionResult> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash +failedLoginCount +lockedUntil');

  if (!user) {
    await burnPasswordCheck(input.password);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${LOCKOUT_MINUTES} minutes.`);
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    const update =
      failed >= MAX_FAILED_LOGINS
        ? { $set: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } }
        : { $set: { failedLoginCount: failed } };
    await User.updateOne({ _id: user._id }, update);
    await audit({
      hotelId: user.hotelId ?? null,
      actor: { type: 'user', id: user._id, role: user.role },
      action: failed >= MAX_FAILED_LOGINS ? 'auth.locked' : 'auth.login_failed',
      req,
    });
    throw invalidCredentials();
  }

  // Deactivated accounts get the same generic error as a wrong password.
  if (!user.isActive) throw invalidCredentials();

  if (user.hotelId) {
    const hotel = await Hotel.findById(user.hotelId).select('status').lean();
    if (!hotel || hotel.status !== 'active') throw forbidden('This property is not active. Contact support.');
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });

  const role = user.role as StaffRole;
  const hotelId = user.hotelId ? new Types.ObjectId(String(user.hotelId)) : null;
  const accessToken = signAccessToken({ _id: user._id, role, hotelId, tokenVersion: user.tokenVersion });
  const refreshToken = await issueRefreshToken({ _id: user._id, hotelId }, { userAgent: req.get('user-agent'), ip: req.ip });

  await audit({ hotelId, actor: { type: 'user', id: user._id, role }, action: 'auth.login', req });
  return { accessToken, refreshToken, user: toPublicUser(user) };
}

export async function refresh(rawToken: string | undefined, req: Request): Promise<SessionResult> {
  if (!rawToken) throw new AppError(401, 'UNAUTHENTICATED', 'No session');

  const result = await rotateRefreshToken(rawToken, { userAgent: req.get('user-agent'), ip: req.ip });
  if (!result.ok) {
    if (result.reason === 'reused' && result.userId) {
      await audit({ hotelId: null, actor: { type: 'user', id: result.userId }, action: 'auth.refresh_reuse_detected', req });
    }
    throw new AppError(401, 'UNAUTHENTICATED', 'Session expired. Please sign in again.');
  }

  const user = await User.findById(result.userId);
  if (!user || !user.isActive) {
    await revokeAllForUser(result.userId);
    throw new AppError(401, 'UNAUTHENTICATED', 'Session expired. Please sign in again.');
  }

  const role = user.role as StaffRole;
  const hotelId = user.hotelId ? new Types.ObjectId(String(user.hotelId)) : null;
  const accessToken = signAccessToken({ _id: user._id, role, hotelId, tokenVersion: user.tokenVersion });
  return { accessToken, refreshToken: result.next, user: toPublicUser(user) };
}

export async function logout(rawToken: string | undefined, req: Request): Promise<void> {
  if (!rawToken) return;
  const revoked = await revokeRefreshToken(rawToken);
  if (revoked) {
    await audit({ hotelId: revoked.hotelId, actor: { type: 'user', id: revoked.userId }, action: 'auth.logout', req });
  }
}

export async function register(actor: AuthContext, input: RegisterInput, req: Request): Promise<PublicUser> {
  if (!ASSIGNABLE_ROLES[actor.role].includes(input.role)) {
    throw forbidden(`Your role cannot create ${input.role.replace('_', ' ')} accounts`);
  }

  let hotelId: Types.ObjectId;
  if (actor.role === 'super_admin') {
    if (!input.hotelId) throw new AppError(400, 'VALIDATION_ERROR', 'hotelId is required');
    hotelId = new Types.ObjectId(input.hotelId);
  } else {
    // Ignore any hotelId in the payload: staff are always created inside the actor's own property.
    hotelId = actor.hotelId!;
  }
  const hotelExists = await Hotel.exists({ _id: hotelId });
  if (!hotelExists) throw notFound('Hotel');

  if (await User.exists({ email: input.email })) throw conflict('An account with this email already exists');

  let phone: string | null = null;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    if (!phone) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid mobile number', [{ path: 'phone', message: 'Invalid phone' }]);
  }

  const user = await User.create({
    hotelId,
    name: input.name,
    email: input.email,
    phone,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    createdBy: actor.userId,
  });

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'staff.created',
    entity: { type: 'User', id: user._id },
    metadata: { role: input.role },
    req,
  });
  return toPublicUser(user);
}

export interface MeResult {
  user: PublicUser;
  permissions: Permission[];
  hotel: {
    id: string;
    name: string;
    slug: string;
    city: string;
    totalRooms: number;
    whatsapp: string | null;
    modules: Record<string, boolean>;
  } | null;
}

export async function me(actor: AuthContext): Promise<MeResult> {
  const user = await User.findById(actor.userId);
  if (!user) throw notFound('User');
  const hotel = actor.hotelId ? await Hotel.findById(actor.hotelId).select('name slug address.city totalRooms modules contact.whatsapp').lean() : null;
  return {
    user: toPublicUser(user),
    permissions: permissionsFor(actor.role),
    hotel: hotel
      ? {
          id: String(hotel._id),
          name: hotel.name,
          slug: hotel.slug,
          city: hotel.address.city,
          totalRooms: hotel.totalRooms,
          whatsapp: hotel.contact?.whatsapp ?? null,
          modules: {
            booking: hotel.modules?.booking ?? true,
            receptionist: hotel.modules?.receptionist ?? true,
            crm: hotel.modules?.crm ?? true,
          },
        }
      : null,
  };
}

/**
 * Self-service password change. Every other session (other devices, a stolen refresh token) is revoked
 * and outstanding access tokens stop working; this device gets a fresh session so the user stays in.
 */
export async function changePassword(actor: AuthContext, input: ChangePasswordInput, req: Request): Promise<SessionResult> {
  const user = await User.findById(actor.userId).select('+passwordHash');
  if (!user || !user.isActive) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in again');
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    await audit({ hotelId: actor.hotelId, actor: { type: 'user', id: user._id, role: actor.role }, action: 'auth.password_change_failed', req });
    throw new AppError(400, 'VALIDATION_ERROR', 'Your current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }]);
  }
  user.passwordHash = await hashPassword(input.newPassword);
  user.tokenVersion += 1;
  await user.save();
  await revokeAllForUser(user._id);

  const role = user.role as StaffRole;
  const hotelId = user.hotelId ? new Types.ObjectId(String(user.hotelId)) : null;
  const accessToken = signAccessToken({ _id: user._id, role, hotelId, tokenVersion: user.tokenVersion });
  const refreshToken = await issueRefreshToken({ _id: user._id, hotelId }, { userAgent: req.get('user-agent'), ip: req.ip });
  await audit({ hotelId, actor: { type: 'user', id: user._id, role }, action: 'auth.password_changed', req });
  return { accessToken, refreshToken, user: toPublicUser(user) };
}
