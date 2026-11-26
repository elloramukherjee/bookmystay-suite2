import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors.js';
import { hashIp, randomToken, sha256 } from '../../utils/crypto.js';
import type { StaffRole } from './permissions.js';
import { RefreshToken } from './refreshToken.model.js';

const ISSUER = 'bookmystay-api';
const AUDIENCE = 'bookmystay-staff';

export interface AccessClaims {
  sub: string;
  role: StaffRole;
  hid: string | null;
  ver: number;
}

export function signAccessToken(user: { _id: Types.ObjectId; role: StaffRole; hotelId: Types.ObjectId | null; tokenVersion: number }): string {
  const claims: AccessClaims = {
    sub: String(user._id),
    role: user.role,
    hid: user.hotelId ? String(user.hotelId) : null,
    ver: user.tokenVersion,
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof decoded !== 'object' || typeof decoded.sub !== 'string' || typeof decoded.ver !== 'number') {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid access token');
    }
    return decoded as unknown as AccessClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid access token');
  }
}

interface IssueContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface IssuedRefreshToken {
  raw: string;
  expiresAt: Date;
}

/**
 * Refresh tokens are opaque random strings (not JWTs): there is nothing to decode or forge, and
 * revocation is a simple database lookup. The secret is mixed into the stored hash so a leaked
 * database alone can't be used to look up live tokens.
 */
const hashRefresh = (raw: string) => sha256(`${env.JWT_REFRESH_SECRET}:${raw}`);

export async function issueRefreshToken(
  user: { _id: Types.ObjectId; hotelId: Types.ObjectId | null },
  ctx: IssueContext,
  familyId: string = randomUUID(),
  raw: string = randomToken(48),
): Promise<IssuedRefreshToken> {
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    userId: user._id,
    hotelId: user.hotelId,
    tokenHash: hashRefresh(raw),
    familyId,
    expiresAt,
    userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    ipHash: hashIp(ctx.ip) ?? null,
  });
  return { raw, expiresAt };
}

export type RotationResult =
  { ok: true; userId: Types.ObjectId; next: IssuedRefreshToken } | { ok: false; reason: 'unknown' | 'expired' | 'reused'; userId?: Types.ObjectId };

/**
 * Two tabs (or a tab plus a retry) commonly refresh at the same instant with the same cookie. A token that
 * was *rotated* (not logged out) within this window is treated as a benign race and gets a fresh sibling
 * token instead of triggering theft detection. Outside the window, reuse revokes the whole family.
 */
export const REUSE_GRACE_MS = 30_000;

export async function rotateRefreshToken(raw: string, ctx: IssueContext): Promise<RotationResult> {
  const tokenHash = hashRefresh(raw);
  const existing = await RefreshToken.findOne({ tokenHash }).lean();
  if (!existing) return { ok: false, reason: 'unknown' };

  const withinGrace = (revokedAt: Date | null | undefined) => Boolean(revokedAt && Date.now() - revokedAt.getTime() < REUSE_GRACE_MS);

  if (existing.revokedAt && existing.replacedByHash && withinGrace(existing.revokedAt) && existing.expiresAt.getTime() > Date.now()) {
    const family = await RefreshToken.exists({ familyId: existing.familyId, revokedAt: null });
    if (family) {
      const next = await issueRefreshToken({ _id: existing.userId, hotelId: existing.hotelId ?? null }, ctx, existing.familyId);
      return { ok: true, userId: existing.userId, next };
    }
  }

  if (existing.revokedAt) {
    // A rotated (or logged-out) token was presented again: assume theft and kill the whole family.
    await RefreshToken.updateMany({ familyId: existing.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return { ok: false, reason: 'reused', userId: existing.userId };
  }
  if (existing.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired', userId: existing.userId };

  // Claim and record the successor in one atomic update, so a concurrent loser can tell
  // "rotated by a sibling request" (benign) from "revoked by logout" (reject).
  const nextRaw = randomToken(48);
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: existing._id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedByHash: hashRefresh(nextRaw) } },
  );
  if (!claimed) {
    const current = await RefreshToken.findById(existing._id).select('replacedByHash').lean();
    if (!current?.replacedByHash) return { ok: false, reason: 'unknown', userId: existing.userId };
    const sibling = await issueRefreshToken({ _id: existing.userId, hotelId: existing.hotelId ?? null }, ctx, existing.familyId);
    return { ok: true, userId: existing.userId, next: sibling };
  }

  const next = await issueRefreshToken({ _id: existing.userId, hotelId: existing.hotelId ?? null }, ctx, existing.familyId, nextRaw);
  return { ok: true, userId: existing.userId, next };
}

export async function revokeRefreshToken(raw: string): Promise<{ userId: Types.ObjectId; hotelId: Types.ObjectId | null } | null> {
  const doc = await RefreshToken.findOneAndUpdate({ tokenHash: hashRefresh(raw), revokedAt: null }, { $set: { revokedAt: new Date() } }).lean();
  return doc ? { userId: doc.userId, hotelId: doc.hotelId ?? null } : null;
}

export async function revokeAllForUser(userId: Types.ObjectId): Promise<void> {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
