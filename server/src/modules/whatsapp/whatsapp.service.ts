import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { appendMessage } from '../../shared/conversationLog.js';
import { normalizePhone } from '../../utils/phone.js';
import { openPhoneConversation } from '../chatbot/services/phoneConversation.js';
import { processGuestMessage } from '../chatbot/services/receptionist.service.js';
import { Guest } from '../guests/guest.model.js';
import { Hotel } from '../hotels/hotel.model.js';
import { Notification } from '../notifications/notification.model.js';
import { applyDeliveryReceipt, openManualFollowUps } from '../notifications/notification.service.js';
import { isChannelLive } from '../notifications/providers.js';
import { isWhatsAppLive, templateMap } from './cloudApi.provider.js';
import { WhatsAppMessage, type WhatsAppMessageLean } from './whatsappMessage.model.js';

// ─── Webhook verification ───────────────────────────────────────────────────────────────────────

/** Meta's one-time subscription handshake (GET with hub.mode / hub.verify_token / hub.challenge). */
export function verifySubscription(mode: unknown, token: unknown, challenge: unknown): string | null {
  if (!isWhatsAppLive() || mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
  const expected = Buffer.from(env.WHATSAPP_VERIFY_TOKEN!);
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? challenge : null;
}

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, raw request body). */
export function verifySignature(rawBody: Buffer | undefined, header: unknown): boolean {
  if (!isWhatsAppLive() || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', env.WHATSAPP_APP_SECRET!).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ─── Payload parsing ────────────────────────────────────────────────────────────────────────────

interface WaInbound {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}
interface WaStatus {
  id: string;
  status: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}
interface WaValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaInbound[];
  statuses?: WaStatus[];
}
interface WaPayload {
  object?: string;
  entry?: { changes?: { field?: string; value?: WaValue }[] }[];
}

function readableText(m: WaInbound): string | null {
  if (m.type === 'text') return m.text?.body?.trim() || null;
  if (m.type === 'button') return m.button?.text?.trim() || null;
  if (m.type === 'interactive') return (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)?.trim() || null;
  return null; // image, audio, video, document, location, sticker, contacts, reaction…
}

async function hotelForNumber(phoneNumberId: string | null): Promise<Types.ObjectId | null> {
  if (!phoneNumberId) return null;
  const mapped = await Hotel.findOne({ 'integrations.whatsappPhoneNumberId': phoneNumberId, status: 'active' }).select('_id').lean();
  if (mapped) return mapped._id;
  // Single-property MVP: the number in .env belongs to the only active property.
  if (phoneNumberId === env.WHATSAPP_PHONE_NUMBER_ID) {
    const active = await Hotel.find({ status: 'active' }).select('_id').limit(2).lean();
    if (active.length === 1) return active[0]!._id;
  }
  return null;
}

/**
 * Stores everything in the webhook body and returns quickly (Meta expects a 200 within seconds and
 * redelivers otherwise). Inbound messages are saved as "received" — a durable queue — and processed in
 * the background; duplicates (same wamid) are ignored. Delivery receipts are applied immediately.
 */
export async function ingestWebhook(body: unknown): Promise<{ messages: number; statuses: number; duplicates: number }> {
  const payload = body as WaPayload;
  const stats = { messages: 0, statuses: 0, duplicates: 0 };
  if (payload?.object !== 'whatsapp_business_account') return stats;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const hotelId = await hotelForNumber(phoneNumberId);

      for (const m of value.messages ?? []) {
        const phoneE164 = normalizePhone(`+${m.from}`);
        if (!m.id || !phoneE164) continue;
        const profileName = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name?.slice(0, 120) ?? null;
        try {
          const row = await WhatsAppMessage.create({
            hotelId,
            direction: 'in',
            waMessageId: m.id,
            phoneNumberId,
            phoneE164,
            type: m.type?.slice(0, 40) || 'unknown',
            text: readableText(m)?.slice(0, 4096) ?? null,
            profileName,
            status: hotelId ? 'received' : 'ignored',
            error: hotelId ? null : `No property is linked to WhatsApp number id ${phoneNumberId ?? '(missing)'}`,
          });
          stats.messages++;
          if (hotelId) schedule(row._id);
          else logger.warn({ phoneNumberId }, 'WhatsApp message for an unknown number id ignored');
        } catch (err) {
          if ((err as { code?: number }).code === 11000) stats.duplicates++;
          else throw err;
        }
      }

      for (const s of value.statuses ?? []) {
        if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        const e = s.errors?.[0];
        const error = e ? `WhatsApp ${e.code ?? ''} ${e.error_data?.details ?? e.message ?? e.title ?? ''}`.trim() : null;
        await WhatsAppMessage.updateOne(
          { waMessageId: s.id, direction: 'out' },
          {
            $push: { statusHistory: { status: s.status, at: new Date(), error } },
            // Receipts can arrive out of order; only move forward (failed always applies).
            ...(s.status === 'failed' ? { $set: { status: 'failed', error } } : {}),
          },
        );
        if (s.status !== 'failed') {
          const forward: Record<string, string[]> = { sent: [], delivered: ['sent'], read: ['sent', 'delivered'] };
          await WhatsAppMessage.updateOne({ waMessageId: s.id, direction: 'out', status: { $in: forward[s.status] } }, { $set: { status: s.status } });
        }
        await applyDeliveryReceipt(s.id, s.status as 'sent' | 'delivered' | 'read' | 'failed', error);
        stats.statuses++;
      }
    }
  }
  return stats;
}

// ─── Inbound processing ─────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop offers', 'stop promotions', 'opt out', 'optout']);
const START_WORDS = new Set(['start', 'subscribe', 'start offers', 'opt in', 'optin']);
const keyword = (text: string | null) =>
  (text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '');

/** Marketing consent by keyword. Booking messages (transactional) are unaffected either way. */
async function handleConsentKeyword(row: WhatsAppMessageLean, hotelId: Types.ObjectId, word: string): Promise<string> {
  const now = new Date();
  if (STOP_WORDS.has(word)) {
    await Guest.updateOne(
      { hotelId, phoneE164: row.phoneE164 },
      { $set: { 'consent.marketing.granted': false, 'consent.marketing.withdrawnAt': now, 'consent.marketing.source': 'whatsapp_keyword' } },
    );
    return 'Done — you won’t receive offers from us any more. You’ll still get messages about your bookings. Reply START anytime to receive offers again.';
  }
  await Guest.updateOne(
    { hotelId, phoneE164: row.phoneE164 },
    { $set: { 'consent.marketing': { granted: true, at: now, source: 'whatsapp_keyword', withdrawnAt: null } } },
  );
  return 'Thank you! We’ll occasionally share direct-booking offers here. Reply STOP anytime to opt out.';
}

async function processInbound(id: Types.ObjectId): Promise<void> {
  const row = await WhatsAppMessage.findOneAndUpdate(
    { _id: id, direction: 'in', status: 'received' },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { new: true },
  ).lean();
  if (!row || !row.hotelId) return;

  try {
    const { conversation } = await openPhoneConversation(row.hotelId, 'whatsapp', row.phoneE164, row.profileName);
    await WhatsAppMessage.updateOne({ _id: row._id }, { $set: { conversationId: conversation._id } });
    const word = keyword(row.text);

    if (STOP_WORDS.has(word) || START_WORDS.has(word)) {
      await appendMessage(conversation, { sender: 'guest', text: row.text! });
      await appendMessage(conversation, { sender: 'system', text: await handleConsentKeyword(row, row.hotelId, word) });
    } else if (!row.text) {
      // Media: logged for staff, with a short note to the guest unless staff already own the chat.
      await appendMessage(conversation, { sender: 'guest', text: `[${row.type} received on WhatsApp — open the WhatsApp app to view it]` });
      if (conversation.status === 'ai_active' || conversation.status === 'resolved') {
        await appendMessage(conversation, {
          sender: 'system',
          text: 'Thank you! I can only read text messages here — please type your question, and our team will also look at what you sent.',
        });
      }
    } else {
      await processGuestMessage(conversation._id, row.text);
    }
    await WhatsAppMessage.updateOne({ _id: row._id }, { $set: { status: 'processed', error: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'processing failed';
    logger.error({ err, waMessageId: row.waMessageId }, 'WhatsApp inbound processing failed');
    // Back to the queue for the recovery job, up to 3 attempts.
    await WhatsAppMessage.updateOne({ _id: row._id }, { $set: { status: row.attempts >= 3 ? 'failed' : 'received', error: message } });
  }
}

const inFlight = new Set<Promise<void>>();
function schedule(id: Types.ObjectId): void {
  const p = processInbound(id).finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Resolves once background processing started by webhooks has finished (tests and graceful shutdown). */
export async function whatsappIdle(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

/**
 * Recovery job: messages left "received" (process restarted before handling them) or stuck in
 * "processing" for 5 minutes are processed again. Claiming is atomic, so several instances are safe.
 */
export async function recoverInbound(): Promise<number> {
  await WhatsAppMessage.updateMany(
    { direction: 'in', status: 'processing', updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } },
    { $set: { status: 'received' } },
  );
  const due = await WhatsAppMessage.find({ direction: 'in', status: 'received', createdAt: { $lt: new Date(Date.now() - 30_000) } })
    .select('_id')
    .sort({ createdAt: 1 })
    .limit(20)
    .lean();
  for (const r of due) await processInbound(r._id);
  return due.length;
}

// ─── Status for staff ───────────────────────────────────────────────────────────────────────────

const BUSINESS_INITIATED = ['booking_confirmed', 'booking_cancelled', 'checkin_welcome', 'staff_escalation_alert'] as const;

const mask = (v: string | undefined) => (v ? `••••${v.slice(-4)}` : null);

/** Integration health for the owner: mode, last activity and outbox results (last 7 days). */
export async function messagingStatus(hotelId: Types.ObjectId) {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [hotel, lastIn, lastOut, byStatus, recentFailures] = await Promise.all([
    Hotel.findById(hotelId).select('integrations.whatsappPhoneNumberId contact.whatsapp').lean(),
    WhatsAppMessage.findOne({ hotelId, direction: 'in' }).sort({ createdAt: -1 }).select('createdAt').lean(),
    WhatsAppMessage.findOne({ hotelId, direction: 'out' }).sort({ createdAt: -1 }).select('createdAt status').lean(),
    Notification.aggregate<{ _id: { channel: string; status: string }; count: number }>([
      { $match: { hotelId, createdAt: { $gte: since } } },
      { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
    ]),
    Notification.find({ hotelId, status: 'dead', createdAt: { $gte: since } })
      .sort({ updatedAt: -1 })
      .limit(5)
      .select('channel template lastError updatedAt fallbackChannel manualFollowUp')
      .lean(),
  ]);
  const live = isWhatsAppLive();
  const approved = templateMap();
  const channels = (['whatsapp', 'sms', 'email'] as const).map((channel) => {
    const counts = Object.fromEntries(byStatus.filter((b) => b._id.channel === channel).map((b) => [b._id.status, b.count]));
    return {
      channel,
      provider: channel === 'whatsapp' ? (live ? 'WhatsApp Cloud API' : 'Simulator (not sent)') : 'Not set up (logged only, never sent)',
      live: channel === 'whatsapp' ? live : isChannelLive(channel),
      sent: counts.sent ?? 0,
      simulated: counts.simulated ?? 0,
      pending: (counts.queued ?? 0) + (counts.sending ?? 0) + (counts.failed ?? 0),
      failed: counts.dead ?? 0,
    };
  });
  return {
    mode: live ? ('live' as const) : ('simulator' as const),
    phoneNumberId: live ? mask(env.WHATSAPP_PHONE_NUMBER_ID) : null,
    linkedToProperty: live
      ? (hotel?.integrations?.whatsappPhoneNumberId ?? null) === env.WHATSAPP_PHONE_NUMBER_ID || (await Hotel.countDocuments({ status: 'active' })) === 1
      : null,
    hotelWhatsapp: hotel?.contact.whatsapp ?? null,
    webhookPath: '/api/v1/webhooks/whatsapp',
    apiVersion: env.WHATSAPP_API_VERSION,
    lastInboundAt: lastIn?.createdAt.toISOString() ?? null,
    lastOutboundAt: lastOut?.createdAt.toISOString() ?? null,
    channels,
    recentFailures: recentFailures.map((f) => ({
      channel: f.channel,
      template: f.template,
      error: f.lastError,
      at: f.updatedAt.toISOString(),
      fellBackTo: f.manualFollowUp?.required ? null : f.fallbackChannel,
      staffFollowUp: Boolean(f.manualFollowUp?.required),
    })),
    // Business-initiated messages need an approved template to reach guests outside the 24-hour window.
    templates: BUSINESS_INITIATED.map((t) => ({ template: t, metaTemplate: approved.get(t)?.name ?? null })),
    manualFollowUps: await openManualFollowUps(hotelId),
  };
}
