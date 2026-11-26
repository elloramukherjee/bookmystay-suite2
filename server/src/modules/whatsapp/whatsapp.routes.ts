import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, authorize, requireScopedHotelId } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../shared/audit/audit.service.js';
import { notFound } from '../../shared/errors.js';
import { objectIdSchema } from '../auth/auth.validation.js';
import { resolveManualFollowUp } from '../notifications/notification.service.js';
import { isWhatsAppLive } from './cloudApi.provider.js';
import { ingestWebhook, messagingStatus, verifySignature, verifySubscription } from './whatsapp.service.js';

/**
 * Meta WhatsApp Cloud API webhook. Public, but every POST must carry a valid X-Hub-Signature-256.
 * Mounted outside the global rate limiter: Meta delivers in bursts and unsigned requests are rejected cheaply.
 */
export const webhooksRouter = Router();

webhooksRouter.get('/whatsapp', (req, res) => {
  if (!isWhatsAppLive()) {
    res
      .status(404)
      .json({ error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp Cloud API is not configured on this server', requestId: req.requestId } });
    return;
  }
  // Read from the raw URL: the app-wide query sanitiser drops dotted keys such as "hub.mode".
  const params = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
  const challenge = verifySubscription(params.get('hub.mode'), params.get('hub.verify_token'), params.get('hub.challenge'));
  if (challenge === null) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification token mismatch', requestId: req.requestId } });
    return;
  }
  res.type('text/plain').send(challenge);
});

webhooksRouter.post('/whatsapp', async (req, res) => {
  if (!isWhatsAppLive()) {
    res
      .status(404)
      .json({ error: { code: 'WHATSAPP_NOT_CONFIGURED', message: 'WhatsApp Cloud API is not configured on this server', requestId: req.requestId } });
    return;
  }
  if (!verifySignature((req as Request & { rawBody?: Buffer }).rawBody, req.headers['x-hub-signature-256'])) {
    res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature', requestId: req.requestId } });
    return;
  }
  res.json({ data: await ingestWebhook(req.body) });
});

/** Integration health for owners and managers. */
export const whatsappRouter = Router();
whatsappRouter.get('/status', authenticate, authorize('hotel.read'), async (req, res) => {
  res.json({ data: await messagingStatus(requireScopedHotelId(req, req.query.hotelId as string | undefined)) });
});

/** A staff member reached the guest by phone after every message channel failed. */
whatsappRouter.post(
  '/follow-ups/:id/resolve',
  authenticate,
  authorize('stays.manage'),
  validate({ params: z.object({ id: objectIdSchema }) }),
  async (req, res) => {
    const hotelId = requireScopedHotelId(req, req.query.hotelId as string | undefined);
    const id = String(req.params.id);
    if (!(await resolveManualFollowUp(hotelId, id, req.auth!.userId))) throw notFound('Follow-up');
    await audit({
      hotelId,
      actor: { type: 'user', id: req.auth!.userId, role: req.auth!.role },
      action: 'messaging.follow_up_resolved',
      entity: { type: 'Notification', id: new Types.ObjectId(id) },
      req,
    });
    res.json({ data: { id, resolved: true } });
  },
);
