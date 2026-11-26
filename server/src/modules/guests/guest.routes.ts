import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuery } from '../../shared/pagination.js';
import { emailSchema, objectIdSchema } from '../auth/auth.validation.js';
import * as guests from './guest.service.js';

const idParams = z.object({ id: objectIdSchema });
export const guestListQuery = z.object({
  ...paginationQuery,
  q: z.string().trim().max(80).optional(),
  filter: z.enum(['all', 'returning', 'direct', 'ota', 'ota_converts', 'in_house', 'marketing']).default('all'),
  hotelId: objectIdSchema.optional(),
});
const createSchema = z.strictObject({
  phone: z.string().trim().min(8).max(20),
  name: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  city: z.string().trim().max(80).optional(),
  marketingConsent: z.boolean().optional(),
});
const updateSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    email: z
      .union([z.literal(''), emailSchema])
      .nullable()
      .optional(),
    city: z.string().trim().max(80).nullable().optional(),
    tags: z.array(z.string().trim().min(2).max(30)).max(10).optional(),
    marketingConsent: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const noteSchema = z.strictObject({ text: z.string().trim().min(2).max(1000), category: z.enum(['room', 'fnb', 'general']).default('general') });
const prefSchema = z.strictObject({
  category: z.enum(['room', 'fnb', 'accessibility', 'communication', 'other']),
  key: z.string().trim().min(2).max(60),
  value: z.string().trim().min(1).max(300),
});
const prefParams = z.object({ id: objectIdSchema, prefId: objectIdSchema });

const hotelOf = (req: Request) => requireScopedHotelId(req, req.query.hotelId as string | undefined);

export const guestsRouter = Router();
guestsRouter.use(authenticate);

guestsRouter.get('/', authorize('guests.read'), validate({ query: guestListQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof guestListQuery>;
  const { items, meta } = await guests.listGuests(req.auth!, requireScopedHotelId(req, q.hotelId), q);
  res.json({ data: items, meta });
});
guestsRouter.post('/', authorize('guests.write'), validate({ body: createSchema }), async (req, res) => {
  res.status(201).json({ data: await guests.createGuest(req.auth!, hotelOf(req), req.body, req) });
});
guestsRouter.get(
  '/lookup',
  authorize('guests.read'),
  validate({ query: z.object({ phone: z.string().trim().min(8).max(20), hotelId: objectIdSchema.optional() }) }),
  async (req, res) => {
    const result = await guests.lookupByPhone(req.auth!, hotelOf(req), String(req.query.phone));
    res.json({
      data: {
        guest: result.guest,
        bookings: result.bookings.map((b) => ({
          id: String(b._id),
          reference: b.reference,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          status: b.status,
          roomTypeName: b.roomTypeName,
          roomNumber: b.roomNumber,
        })),
      },
    });
  },
);
guestsRouter.get('/:id', authorize('guests.read'), validate({ params: idParams }), async (req, res) => {
  res.json({ data: await guests.getGuestProfile(req.auth!, hotelOf(req), String(req.params.id), req) });
});
guestsRouter.put('/:id', authorize('guests.write'), validate({ params: idParams, body: updateSchema }), async (req, res) => {
  res.json({ data: await guests.updateGuest(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});
guestsRouter.post('/:id/notes', authorize('guests.write'), validate({ params: idParams, body: noteSchema }), async (req, res) => {
  res.status(201).json({ data: await guests.addNote(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});
guestsRouter.put('/:id/preferences', authorize('guests.write'), validate({ params: idParams, body: prefSchema }), async (req, res) => {
  res.json({ data: await guests.upsertPreference(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});
guestsRouter.delete('/:id/preferences/:prefId', authorize('guests.write'), validate({ params: prefParams }), async (req, res) => {
  res.json({ data: await guests.deletePreference(req.auth!, hotelOf(req), String(req.params.id), String(req.params.prefId), req) });
});
