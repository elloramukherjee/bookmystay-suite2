import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuery } from '../../shared/pagination.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { optionalGuest } from '../bookings/guestToken.js';
import { optionalChat, requireChat } from './chatToken.js';
import * as desk from './services/desk.service.js';
import * as faqs from './services/faq.service.js';
import * as webchat from './services/webchat.service.js';

const text = z.string().trim().min(1, 'Type a message').max(1000, 'Please keep messages under 1000 characters');
const idParams = z.object({ id: objectIdSchema });

const guestMessageSchema = z.strictObject({
  hotelId: objectIdSchema,
  text,
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  consent: z.boolean().optional(),
});
const verifySchema = z.strictObject({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^BMS-[A-Z0-9]{6}$/, 'References look like BMS-7K3Q9P'),
  phone: z.string().trim().min(8).max(20),
});
const sessionQuery = z.object({ after: z.iso.datetime().optional() });
const listQuery = z.object({
  ...paginationQuery,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z
    .string()
    .regex(/^(open|[a-z_]+(,[a-z_]+)*)$/)
    .optional(),
  channel: z.enum(['web', 'whatsapp', 'simulator']).optional(),
  q: z.string().trim().max(60).optional(),
  hotelId: objectIdSchema.optional(),
});
const replySchema = z.strictObject({ text, internal: z.boolean().default(false) });
const resolveSchema = z.strictObject({ resumeAi: z.boolean().default(true), note: z.string().trim().max(300).optional() });
const simulateSchema = z.strictObject({ phone: z.string().trim().min(8).max(20), name: z.string().trim().max(120).optional(), text });
const srQuery = z.object({
  status: z
    .string()
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .optional(),
});
const srUpdate = z.strictObject({ status: z.enum(['acknowledged', 'done', 'declined']), message: z.string().trim().max(500).optional() });
const faqBody = z.strictObject({
  question: z.string().trim().min(5).max(300),
  answer: z.string().trim().min(2).max(2000),
  category: z.enum(['arrival', 'amenities', 'dining', 'local', 'policies', 'services', 'other']).default('other'),
  keywords: z.array(z.string().trim().min(2).max(40)).max(15).default([]),
  published: z.boolean().default(true),
});

const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isTest ? 10_000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'You’re sending messages too quickly. Please wait a moment.', requestId: req.requestId } }),
});

const hotelOf = (req: Request) => requireScopedHotelId(req, (req.query.hotelId as string | undefined) ?? undefined);

export const chatbotRouter = Router();

// ── Guest web chat (public) ──────────────────────────────────────────────────────────────────────
chatbotRouter.post('/message', publicLimiter, optionalChat, optionalGuest, validate({ body: guestMessageSchema }), async (req, res) => {
  res.json({ data: await webchat.postWebMessage(req.body, req.chat, req.guest, req) });
});
chatbotRouter.get('/session', requireChat, validate({ query: sessionQuery }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: await webchat.getSession(req.chat!, (req.query as { after?: string }).after) });
});
chatbotRouter.post('/verify', publicLimiter, requireChat, validate({ body: verifySchema }), async (req, res) => {
  res.json({ data: await webchat.verifyBooking(req.chat!, req.body.reference, req.body.phone, req) });
});

// ── Staff desk ───────────────────────────────────────────────────────────────────────────────────
chatbotRouter.get('/stats', authenticate, authorize('conversations.read'), async (req, res) => {
  res.json({ data: await desk.deskStats(hotelOf(req)) });
});
chatbotRouter.get('/conversations', authenticate, authorize('conversations.read'), validate({ query: listQuery }), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const { items, meta } = await desk.listConversations(requireScopedHotelId(req, q.hotelId), q);
  res.json({ data: items, meta });
});
chatbotRouter.get('/conversations/:id', authenticate, authorize('conversations.read'), validate({ params: idParams }), async (req, res) => {
  res.json({ data: await desk.getConversation(hotelOf(req), String(req.params.id), req.auth!, req) });
});
chatbotRouter.post('/conversations/:id/takeover', authenticate, authorize('conversations.reply'), validate({ params: idParams }), async (req, res) => {
  await desk.takeOver(req.auth!, hotelOf(req), String(req.params.id), req);
  res.json({ data: await desk.getConversation(hotelOf(req), String(req.params.id), req.auth!, req) });
});
chatbotRouter.post(
  '/conversations/:id/reply',
  authenticate,
  authorize('conversations.reply'),
  validate({ params: idParams, body: replySchema }),
  async (req, res) => {
    res.status(201).json({ data: await desk.staffReply(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
  },
);
chatbotRouter.post(
  '/conversations/:id/resolve',
  authenticate,
  authorize('conversations.reply'),
  validate({ params: idParams, body: resolveSchema }),
  async (req, res) => {
    await desk.resolveConversation(req.auth!, hotelOf(req), String(req.params.id), req.body, req);
    res.json({ data: await desk.getConversation(hotelOf(req), String(req.params.id), req.auth!, req) });
  },
);
chatbotRouter.post('/simulate', authenticate, authorize('conversations.escalations'), validate({ body: simulateSchema }), async (req, res) => {
  res.status(201).json({ data: await desk.simulateIncoming(req.auth!, hotelOf(req), req.body, req) });
});

chatbotRouter.get('/service-requests', authenticate, authorize('conversations.read'), validate({ query: srQuery }), async (req, res) => {
  res.json({ data: await desk.listServiceRequests(hotelOf(req), (req.query as { status?: string }).status) });
});
chatbotRouter.patch('/service-requests/:id', authenticate, authorize('stays.manage'), validate({ params: idParams, body: srUpdate }), async (req, res) => {
  res.json({ data: await desk.updateServiceRequest(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});

// ── Knowledge base ───────────────────────────────────────────────────────────────────────────────
chatbotRouter.get('/faqs', authenticate, authorize('conversations.read'), async (req, res) => {
  res.json({ data: await faqs.listFaqs(hotelOf(req)) });
});
chatbotRouter.post('/faqs', authenticate, authorize('policies.manage'), validate({ body: faqBody }), async (req, res) => {
  res.status(201).json({ data: await faqs.createFaq(req.auth!, hotelOf(req), req.body, req) });
});
chatbotRouter.put('/faqs/:id', authenticate, authorize('policies.manage'), validate({ params: idParams, body: faqBody.partial() }), async (req, res) => {
  res.json({ data: await faqs.updateFaq(req.auth!, hotelOf(req), String(req.params.id), req.body, req) });
});
chatbotRouter.delete('/faqs/:id', authenticate, authorize('policies.manage'), validate({ params: idParams }), async (req, res) => {
  await faqs.deleteFaq(req.auth!, hotelOf(req), String(req.params.id), req);
  res.status(204).end();
});
