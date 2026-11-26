import type { NextFunction, Request, Response } from 'express';
import qs from 'qs';

const MAX_DEPTH = 10;

/**
 * Removes keys that MongoDB would interpret as operators or paths (`$gt`, `a.b`) from untrusted input,
 * recursively and in place. Combined with strict Zod schemas this blocks NoSQL operator injection.
 */
export function stripMongoOperators<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) stripMongoOperators(item, depth + 1);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete record[key];
    } else {
      stripMongoOperators(record[key], depth + 1);
    }
  }
  return value;
}

/**
 * Express 5 exposes `req.query` as a getter that re-parses on each access, so sanitising after the fact
 * doesn't stick. Instead, sanitisation is built into the query parser itself (registered in app.ts).
 */
export function safeQueryParser(queryString: string): Record<string, unknown> {
  const parsed = qs.parse(queryString, { depth: 5, arrayLimit: 50, parameterLimit: 100, allowPrototypes: false });
  return stripMongoOperators(parsed as Record<string, unknown>);
}

export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') stripMongoOperators(req.body);
  next();
}
