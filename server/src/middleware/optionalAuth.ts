import type { NextFunction, Request, Response } from 'express';
import { authenticate } from './authenticate.js';

/** Runs staff authentication only when a bearer token is present; anonymous/guest requests pass through. */
export async function optionalStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.header('authorization')?.startsWith('Bearer ')) {
    await authenticate(req, res, next);
    return;
  }
  next();
}
