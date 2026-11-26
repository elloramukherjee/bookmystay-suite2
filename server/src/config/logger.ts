import pino from 'pino';
import { env } from './env.js';

/**
 * Structured logger. Personal data (phones, emails, names, tokens, request bodies) is redacted —
 * guest PII must never land in log aggregation.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'bookmystay-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.phone',
      '*.phoneE164',
      '*.email',
      '*.name',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' } }
      : undefined,
});
