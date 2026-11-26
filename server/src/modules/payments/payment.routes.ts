import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { optionalStaff } from '../../middleware/optionalAuth.js';
import { validate } from '../../middleware/validate.js';
import { unauthenticated } from '../../shared/errors.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { optionalGuest } from '../bookings/guestToken.js';
import { PAYMENT_METHODS } from './payment.model.js';
import * as paymentService from './payment.service.js';
import { isMockPayments } from './providers/index.js';

const createSchema = z.strictObject({ bookingId: objectIdSchema, method: z.enum(PAYMENT_METHODS) });
const idParams = z.object({ id: objectIdSchema });
const simulateSchema = z.strictObject({ outcome: z.enum(['success', 'failure']) });

function access(req: Request): paymentService.PaymentAccess {
  if (req.auth) return { hotelId: req.auth.hotelId };
  if (req.guest) return { guestBookingId: req.guest.bid };
  throw unauthenticated('Please open your booking again to continue');
}

export const paymentsRouter = Router();

/** Raw body is captured by express.json's `verify` hook in app.ts — signatures are computed over exact bytes. */
paymentsRouter.post('/webhook', async (req: Request, res: Response) => {
  const result = await paymentService.handleWebhook((req as Request & { rawBody?: Buffer }).rawBody, req.headers);
  res.json({ data: result });
});

paymentsRouter.post('/create', optionalStaff, optionalGuest, validate({ body: createSchema }), async (req, res) => {
  const { bookingId, method } = req.body as z.infer<typeof createSchema>;
  res.status(201).json({ data: await paymentService.createPayment(bookingId, method, access(req), req) });
});

paymentsRouter.get('/:id/status', optionalStaff, optionalGuest, validate({ params: idParams }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: await paymentService.getPaymentStatus(String(req.params.id), access(req)) });
});

// ⚠️ Development-only simulator route: not even registered when a real provider is configured or in production.
if (isMockPayments()) {
  paymentsRouter.post('/:id/simulate', optionalStaff, optionalGuest, validate({ params: idParams, body: simulateSchema }), async (req, res) => {
    const { outcome } = req.body as z.infer<typeof simulateSchema>;
    res.json({ data: await paymentService.simulateMockPayment(String(req.params.id), outcome, access(req)) });
  });
}
