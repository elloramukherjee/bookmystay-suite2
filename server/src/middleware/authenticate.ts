import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ROLE_PERMISSIONS, type Permission, type StaffRole } from '../modules/auth/permissions.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { User } from '../modules/users/user.model.js';
import { AppError, forbidden, unauthenticated } from '../shared/errors.js';

/**
 * Verifies the bearer access token and re-checks the account on every request, so deactivation,
 * role changes and password resets take effect immediately (via `tokenVersion`), not after token expiry.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) throw unauthenticated();

  const claims = verifyAccessToken(header.slice(7).trim());

  const user = await User.findById(claims.sub).select('tokenVersion role hotelId isActive').lean();
  if (!user || !user.isActive || user.tokenVersion !== claims.ver || user.role !== claims.role) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Session is no longer valid. Please sign in again.');
  }

  const role = user.role as StaffRole;
  req.auth = {
    userId: user._id,
    role,
    hotelId: user.hotelId ? new Types.ObjectId(String(user.hotelId)) : null,
    permissions: ROLE_PERMISSIONS[role],
  };
  next();
}

export function authorize(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) throw unauthenticated();
    const missing = required.filter((p) => !req.auth!.permissions.has(p));
    if (missing.length) throw forbidden();
    next();
  };
}

/**
 * Property-level isolation: staff may only touch records of their own hotel. Super admins (no hotelId)
 * may act on any hotel. Services must still filter every query by the returned hotelId.
 */
export function assertHotelAccess(req: Request, hotelId: Types.ObjectId | string): Types.ObjectId {
  if (!req.auth) throw unauthenticated();
  const target = new Types.ObjectId(String(hotelId));
  if (req.auth.role === 'super_admin') return target;
  if (!req.auth.hotelId || !req.auth.hotelId.equals(target)) {
    // 404 rather than 403 so staff cannot probe for the existence of other properties' records.
    throw new AppError(404, 'NOT_FOUND', 'Hotel not found');
  }
  return target;
}

/** The hotel the current staff request is scoped to. Super admins must name one explicitly. */
export function requireScopedHotelId(req: Request, explicit?: string | null): Types.ObjectId {
  if (!req.auth) throw unauthenticated();
  if (req.auth.role === 'super_admin') {
    if (!explicit || !Types.ObjectId.isValid(explicit)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'hotelId is required for super admin requests');
    }
    return new Types.ObjectId(explicit);
  }
  return req.auth.hotelId!;
}
