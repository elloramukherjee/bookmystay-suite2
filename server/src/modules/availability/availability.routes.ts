import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import * as inventory from './inventory.service.js';
import { isoDay, stayQuery } from './stay.validation.js';

const searchQuery = z.object({ hotelId: objectIdSchema, ...stayQuery, promoCode: z.string().trim().max(24).optional() });
const calendarQuery = z.object({ from: isoDay.optional(), days: z.coerce.number().int().min(1).max(62).default(14), hotelId: objectIdSchema.optional() });
const bulkSchema = z
  .strictObject({
    roomTypeId: objectIdSchema,
    from: isoDay,
    to: isoDay,
    ratePaise: z.number().int().min(10_000).max(100_000_000).nullable().optional(),
    stopSell: z.boolean().optional(),
    blocked: z.number().int().min(0).max(500).optional(),
    minStay: z.number().int().min(1).max(30).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .refine((v) => v.ratePaise !== undefined || v.stopSell !== undefined || v.blocked !== undefined || v.minStay !== undefined, 'Choose at least one change');

export const availabilityRouter = Router();

/** Public live availability with server-computed prices. */
availabilityRouter.get('/', validate({ query: searchQuery }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: await inventory.searchAvailability(req.query as unknown as inventory.SearchInput) });
});

availabilityRouter.get('/calendar', authenticate, authorize('rooms.read'), validate({ query: calendarQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof calendarQuery>;
  const hotelId = requireScopedHotelId(req, q.hotelId);
  res.json({ data: await inventory.getCalendar(hotelId, q.from, q.days) });
});

availabilityRouter.put('/', authenticate, authorize('availability.manage'), validate({ body: bulkSchema }), async (req, res) => {
  const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
  res.json({ data: await inventory.bulkUpdate(req.auth!, hotelId, req.body as inventory.BulkUpdateInput, req) });
});
