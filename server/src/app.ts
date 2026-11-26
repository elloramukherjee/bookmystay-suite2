import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { databaseState, supportsTransactions } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { safeQueryParser, sanitizeBody } from './middleware/sanitize.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { hotelsRouter } from './modules/hotels/hotel.routes.js';
import { availabilityRouter } from './modules/availability/availability.routes.js';
import { bookingsRouter } from './modules/bookings/booking.routes.js';
import { chatbotRouter } from './modules/chatbot/chatbot.routes.js';
import { crmRouter } from './modules/crm/crm.routes.js';
import { guestsRouter } from './modules/guests/guest.routes.js';
import { paymentsRouter } from './modules/payments/payment.routes.js';
import { roomsRouter } from './modules/rooms/room.routes.js';
import { usersRouter } from './modules/users/user.routes.js';
import { webhooksRouter, whatsappRouter } from './modules/whatsapp/whatsapp.routes.js';
import { mountClient } from './web.js';

/** Builds the Express app without listening, so tests can drive it with Supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('query parser', safeQueryParser);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // Log the path only: query strings can carry phone numbers or booking references.
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin and server-to-server requests (e.g. webhooks) carry no Origin header.
        if (!origin || env.clientOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Guest-Token', 'X-Chat-Token'],
      maxAge: 600,
    }),
  );
  app.use(
    express.json({
      limit: '100kb',
      // Payment/WhatsApp webhook signatures are computed over the exact bytes received.
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/v1/payments/webhook') || req.url?.startsWith('/api/v1/webhooks/')) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    }),
  );
  app.use(cookieParser());
  app.use(sanitizeBody);

  const api = Router();
  api.use(globalLimiter);
  api.get('/health', (_req, res) => {
    const db = databaseState();
    res.status(db === 'connected' ? 200 : 503).json({
      data: { status: db === 'connected' ? 'ok' : 'degraded', db, transactions: supportsTransactions(), uptime: Math.round(process.uptime()) },
    });
  });
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/hotels', hotelsRouter);
  api.use('/rooms', roomsRouter);
  api.use('/availability', availabilityRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/payments', paymentsRouter);
  api.use('/chatbot', chatbotRouter);
  api.use('/guests', guestsRouter);
  api.use('/crm', crmRouter);
  api.use('/whatsapp', whatsappRouter);

  app.use('/api/v1/webhooks', webhooksRouter);
  app.use('/api/v1', api);
  if (env.SERVE_CLIENT) mountClient(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
