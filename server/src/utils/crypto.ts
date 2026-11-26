import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

/** One-way, salted IP fingerprint so audit logs can correlate abuse without storing raw IPs. */
export const hashIp = (ip: string | undefined): string | undefined =>
  ip ? createHmac('sha256', env.IP_HASH_SALT).update(ip).digest('hex').slice(0, 32) : undefined;

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
