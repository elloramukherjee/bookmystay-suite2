import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../shared/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: req.requestId } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;

  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details, requestId } });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Invalid value for ${err.path}`, requestId } });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details, requestId } });
    return;
  }

  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    const fields = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
    res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists', details: { fields }, requestId } });
    return;
  }

  const bodyParserError = err as { type?: string; status?: number };
  if (bodyParserError?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId } });
    return;
  }
  if (bodyParserError?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body', requestId } });
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: env.isProduction ? 'Something went wrong. Please try again.' : String((err as Error)?.message ?? err),
      requestId,
    },
  });
}
