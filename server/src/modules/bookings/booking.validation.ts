import { z } from 'zod';
import { paginationQuery } from '../../shared/pagination.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { isoDay, MAX_ROOMS_PER_BOOKING } from '../availability/stay.validation.js';
import { BOOKING_SOURCES } from './booking.model.js';

const guestDetails = z.strictObject({
  name: z.string().trim().min(2, 'Enter the guest’s full name').max(120),
  phone: z.string().trim().min(8, 'Enter a valid mobile number').max(20),
  email: z.union([z.literal(''), z.email('Enter a valid email').max(254)]).optional(),
});

/**
 * Note what is *absent*: no price, no total, no discount. The client cannot influence the amount
 * charged — the server recomputes everything from inventory and hotel settings.
 */
export const createBookingSchema = z.strictObject({
  hotelId: objectIdSchema,
  roomTypeId: objectIdSchema,
  ratePlanId: objectIdSchema.optional(),
  checkIn: isoDay,
  checkOut: isoDay,
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(10).default(0),
  rooms: z.number().int().min(1).max(MAX_ROOMS_PER_BOOKING).default(1),
  guest: guestDetails,
  specialRequests: z.string().trim().max(500).optional(),
  promoCode: z.string().trim().max(24).optional(),
  consent: z.strictObject({
    // Required to fulfil the booking (DPDP: processing necessary for the service the guest asked for).
    transactional: z.literal(true, { error: 'Please accept the booking terms to continue' }),
    marketing: z.boolean().default(false),
  }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const manualBookingSchema = z.strictObject({
  roomTypeId: objectIdSchema,
  ratePlanId: objectIdSchema.optional(),
  checkIn: isoDay,
  checkOut: isoDay,
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(10).default(0),
  rooms: z.number().int().min(1).max(10).default(1),
  source: z.enum(BOOKING_SOURCES).exclude(['direct']),
  otaReference: z.string().trim().max(60).optional(),
  /** Staff-entered nightly rate (e.g. what the OTA sold at). Staff input is trusted; guest input never is. */
  nightlyRatePaise: z.number().int().min(0).max(100_000_000).optional(),
  guest: guestDetails,
  specialRequests: z.string().trim().max(500).optional(),
  sendConfirmation: z.boolean().default(true),
});
export type ManualBookingInput = z.infer<typeof manualBookingSchema>;

export const listBookingsQuery = z.object({
  ...paginationQuery,
  status: z
    .string()
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional(),
  source: z.union([z.enum(BOOKING_SOURCES), z.literal('ota')]).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  q: z.string().trim().max(60).optional(),
  attention: z.coerce.boolean().optional(),
  sort: z.enum(['created', 'checkIn']).default('created'),
});
export type ListBookingsQuery = z.infer<typeof listBookingsQuery>;

export const bookingIdParams = z.object({ id: objectIdSchema });

export const cancelBookingSchema = z.strictObject({ reason: z.string().trim().max(300).optional() });

export const lookupSchema = z.strictObject({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^BMS-[A-Z0-9]{6}$/, 'Booking references look like BMS-7K3Q9P'),
  phone: z.string().trim().min(8).max(20),
});

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Invalid Idempotency-Key')
  .optional();
