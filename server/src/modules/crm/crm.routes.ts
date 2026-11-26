import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { guestListQuery } from '../guests/guest.routes.js';
import * as guests from '../guests/guest.service.js';
import { TEMPLATE_PURPOSES } from './models/messageTemplate.model.js';
import * as dashboard from './services/dashboard.service.js';
import * as followUps from './services/followUp.service.js';
import * as history from './services/history.service.js';
import * as stays from './services/stay.service.js';

const idParams = z.object({ id: objectIdSchema });
const checkInSchema = z.strictObject({
  bookingId: objectIdSchema,
  roomId: objectIdSchema.optional(),
  idVerified: z.boolean().default(false),
  idDocType: z.enum(['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other']).optional(),
  sendWelcome: z.boolean().default(true),
});
const checkOutSchema = z.strictObject({ bookingId: objectIdSchema, paymentCollected: z.boolean().default(false) });
const templateBody = z.strictObject({
  name: z.string().trim().min(3).max(80),
  purpose: z.enum(TEMPLATE_PURPOSES).default('other'),
  body: z.string().trim().min(10).max(1000),
  promoCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,24}$/)
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});
const draftsSchema = z.strictObject({
  templateId: objectIdSchema,
  audience: z.enum(['returning', 'ota_converts', 'ota_only', 'all_consented', 'selected']),
  guestIds: z.array(objectIdSchema).max(200).optional(),
});

const hotelOf = (req: Request) => requireScopedHotelId(req, req.query.hotelId as string | undefined);

export const crmRouter = Router();
crmRouter.use(authenticate);

// Dashboard: operational numbers for everyone with hotel.read; revenue only with finance.read (enforced in service).
crmRouter.get(
  '/dashboard',
  authorize('hotel.read'),
  validate({ query: z.object({ period: z.enum(dashboard.PERIODS).default('mtd'), hotelId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json({ data: await dashboard.getDashboard(req.auth!, hotelOf(req), (req.query as { period: dashboard.Period }).period) });
  },
);

// Guest ledger (same data as /guests, CRM-oriented route kept for the documented API).
crmRouter.get('/guests', authorize('guests.read'), validate({ query: guestListQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof guestListQuery>;
  const { items, meta } = await guests.listGuests(req.auth!, requireScopedHotelId(req, q.hotelId), q);
  res.json({ data: items, meta });
});
crmRouter.get('/guests/:id/history', authorize('guests.read'), validate({ params: idParams }), async (req, res) => {
  res.json({ data: await history.guestHistory(req.auth!, hotelOf(req), String(req.params.id)) });
});

// Front desk
crmRouter.get('/today', authorize('stays.manage'), async (req, res) => {
  res.json({ data: await stays.todayRoster(hotelOf(req)) });
});
crmRouter.get(
  '/desk-search',
  authorize('stays.manage'),
  validate({ query: z.object({ q: z.string().trim().min(2).max(60), hotelId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json({ data: await stays.findForDesk(hotelOf(req), String(req.query.q)) });
  },
);
crmRouter.get(
  '/available-rooms',
  authorize('stays.manage'),
  validate({ query: z.object({ roomTypeId: objectIdSchema, hotelId: objectIdSchema.optional() }) }),
  async (req, res) => {
    res.json({ data: await stays.availableRooms(hotelOf(req), String(req.query.roomTypeId)) });
  },
);
crmRouter.post('/check-in', authorize('stays.manage'), validate({ body: checkInSchema }), async (req, res) => {
  res.json({ data: await stays.checkIn(req.auth!, hotelOf(req), req.body, req) });
});
crmRouter.post('/check-out', authorize('stays.manage'), validate({ body: checkOutSchema }), async (req, res) => {
  res.json({ data: await stays.checkOut(req.auth!, hotelOf(req), req.body, req) });
});

// Direct follow-up drafts (owner)
crmRouter.get('/templates', authorize('campaigns.manage'), async (req, res) => {
  res.json({ data: await followUps.listTemplates(hotelOf(req)) });
});
crmRouter.post('/templates', authorize('campaigns.manage'), validate({ body: templateBody }), async (req, res) => {
  res.status(201).json({ data: await followUps.createTemplate(req.auth!, hotelOf(req), req.body, req) });
});
crmRouter.put('/templates/:id', authorize('campaigns.manage'), validate({ params: idParams, body: templateBody.partial() }), async (req, res) => {
  res.json({ data: await followUps.updateTemplate(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});
crmRouter.post('/drafts', authorize('campaigns.manage'), validate({ body: draftsSchema }), async (req, res) => {
  res.status(201).json({ data: await followUps.createDrafts(req.auth!, hotelOf(req), req.body, req) });
});
crmRouter.post('/drafts/:id/sent', authorize('campaigns.manage'), validate({ params: idParams }), async (req, res) => {
  res.json({ data: await followUps.markSent(req.auth!, hotelOf(req), String(req.params.id), 'sent_personally', req) });
});
crmRouter.post('/drafts/:id/discard', authorize('campaigns.manage'), validate({ params: idParams }), async (req, res) => {
  res.json({ data: await followUps.markSent(req.auth!, hotelOf(req), String(req.params.id), 'discarded', req) });
});
