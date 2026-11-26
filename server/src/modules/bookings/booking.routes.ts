import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate, authorize } from '../../middleware/authenticate.js';
import { optionalStaff } from '../../middleware/optionalAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './booking.controller.js';
import { bookingIdParams, cancelBookingSchema, createBookingSchema, listBookingsQuery, lookupSchema, manualBookingSchema } from './booking.validation.js';
import { optionalGuest } from './guestToken.js';

const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: env.isTest ? 10_000 : limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes.', requestId: req.requestId } }),
  });

export const bookingsRouter = Router();

// Public guest endpoints
bookingsRouter.post('/', limiter(30), validate({ body: createBookingSchema }), controller.create);
// Lookup is brute-force sensitive (reference + phone): keep it tight.
bookingsRouter.post('/lookup', limiter(10), validate({ body: lookupSchema }), controller.lookup);

// Staff endpoints
bookingsRouter.get('/', authenticate, authorize('bookings.read'), validate({ query: listBookingsQuery }), controller.list);
bookingsRouter.post('/manual', authenticate, authorize('bookings.manage'), validate({ body: manualBookingSchema }), controller.createManual);
bookingsRouter.post('/:id/confirm', authenticate, authorize('bookings.manage'), validate({ params: bookingIdParams }), controller.confirm);
bookingsRouter.post('/:id/no-show', authenticate, authorize('stays.manage'), validate({ params: bookingIdParams }), controller.noShow);

// Staff or the guest who owns the booking
bookingsRouter.get('/:id', optionalStaff, optionalGuest, validate({ params: bookingIdParams }), controller.get);
bookingsRouter.post('/:id/cancel', optionalStaff, optionalGuest, validate({ params: bookingIdParams, body: cancelBookingSchema }), controller.cancel);
