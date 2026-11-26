import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';

const ISSUER = 'bookmystay-api';
const AUDIENCE = 'bookmystay-guest';
const TTL_SECONDS = 2 * 60 * 60;

export interface GuestClaims {
  typ: 'guest';
  bid: string;
  hid: string;
  gid: string;
}

/**
 * Guests have no passwords. Proving "booking reference + phone" (or having just created the booking)
 * yields a short-lived token that unlocks exactly one booking — nothing else.
 */
export function signGuestToken(claims: Omit<GuestClaims, 'typ'>): { token: string; expiresIn: number } {
  const token = jwt.sign({ ...claims, typ: 'guest' }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return { token, expiresIn: TTL_SECONDS };
}

export function verifyGuestToken(token: string): GuestClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    if (typeof decoded !== 'object' || decoded.typ !== 'guest' || typeof decoded.bid !== 'string') throw new Error('bad claims');
    return decoded as unknown as GuestClaims;
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Your booking session has expired. Please look up your booking again.');
  }
}

declare global {
  namespace Express {
    interface Request {
      guest?: GuestClaims;
    }
  }
}

/** Reads `X-Guest-Token`. Separate header from staff `Authorization` so the two can never be confused. */
export function optionalGuest(req: Request, _res: Response, next: NextFunction): void {
  const token = req.header('x-guest-token');
  if (token) req.guest = verifyGuestToken(token);
  next();
}
