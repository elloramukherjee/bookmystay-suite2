import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

/** client/dist, from both src/ (tsx) and dist/ (compiled): each is two levels below the repo root. */
export const DEFAULT_CLIENT_DIR = resolve(fileURLToPath(new URL('../../client/dist', import.meta.url)));

/**
 * Page CSP for the React app. Only what the app needs: Google Fonts, Razorpay Checkout (script, API and
 * frame), and room photos from any HTTPS host (owners paste photo URLs). No inline scripts.
 */
export const SITE_CSP = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
  frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"],
};

/**
 * Serves the built React app from the API process (one service to deploy, same origin, so the refresh
 * cookie stays first-party). Hashed assets are cached for a year; index.html is always revalidated so a
 * deploy is picked up on the next navigation. Unknown non-API GETs return index.html (client routing).
 */
export function mountClient(app: Express, dir = env.CLIENT_DIST_DIR ?? DEFAULT_CLIENT_DIR): boolean {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) {
    logger.warn({ dir }, 'SERVE_CLIENT is on but no client build was found; run "npm run build" first');
    return false;
  }
  const site = Router();
  site.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { ...SITE_CSP, ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}) } },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  site.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '365d', index: false }));
  // A missing hashed asset (old tab after a deploy) is a plain 404, never index.html served as JavaScript.
  site.use('/assets', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('Not found');
  });
  site.use(express.static(dir, { index: false, maxAge: '1h' }));
  site.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  app.use(site);
  logger.info({ dir }, 'Serving the web app from the API');
  return true;
}
