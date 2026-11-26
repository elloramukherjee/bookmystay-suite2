import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env.js';
import * as authService from './auth.service.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.validation.js';

export const REFRESH_COOKIE = 'bms_rt';

const cookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/api/v1/auth',
  ...(expires ? { expires } : {}),
});

function sendSession(res: Response, session: authService.SessionResult, status = 200): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken.raw, cookieOptions(session.refreshToken.expiresAt));
  res.status(status).json({
    data: { accessToken: session.accessToken, expiresIn: env.JWT_ACCESS_TTL_SECONDS, user: session.user },
  });
}

const readRefreshCookie = (req: Request): string | undefined => {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : undefined;
};

export async function login(req: Request<unknown, unknown, LoginInput>, res: Response): Promise<void> {
  sendSession(res, await authService.login(req.body, req as Request));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    sendSession(res, await authService.refresh(readRefreshCookie(req), req));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    throw err;
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(readRefreshCookie(req), req);
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
}

export async function register(req: Request<unknown, unknown, RegisterInput>, res: Response): Promise<void> {
  const user = await authService.register(req.auth!, req.body, req as Request);
  res.status(201).json({ data: { user } });
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ data: await authService.me(req.auth!) });
}

export async function changePassword(req: Request<unknown, unknown, ChangePasswordInput>, res: Response): Promise<void> {
  sendSession(res, await authService.changePassword(req.auth!, req.body, req as Request));
}
