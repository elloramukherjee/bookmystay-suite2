import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and replaces `req.body`, `req.query` and `req.params` with their parsed (coerced, stripped)
 * values. ZodErrors propagate to the error handler, which renders a 400 with field-level details.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as Request['params'];
    }
    if (schemas.query) {
      const parsed = schemas.query.parse(req.query);
      // req.query is a getter in Express 5; shadow it with the parsed value for this request.
      Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true, enumerable: true });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body ?? {});
    }
    next();
  };
}
