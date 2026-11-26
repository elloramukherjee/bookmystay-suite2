import type { Request, Response } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const rateLimitedHandler = (req: Request, res: Response) => {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.', requestId: req.requestId },
  });
};

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitedHandler,
});

/** Login attempts are limited per IP *and* per email, so one attacker can't lock out every account from one IP cheaply. */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 254) : '';
    return `${ipKeyGenerator(req.ip ?? '0.0.0.0')}|${email}`;
  },
  handler: rateLimitedHandler,
});

export const refreshLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX * 6,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitedHandler,
});
