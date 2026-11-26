import type { ClientSession, Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { ChatMessage } from '../chatbot/models/chatMessage.model.js';
import { WhatsAppMessage } from '../whatsapp/whatsappMessage.model.js';
import { Notification, type NotificationChannel, type NotificationLean } from './notification.model.js';
import { formatPhone } from '../../utils/phone.js';
import { Booking } from '../bookings/booking.model.js';
import { isChannelLive, providerFor } from './providers.js';
import { PermanentSendError } from './sendErrors.js';

const MAX_ATTEMPTS = 5;
const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);

export interface EnqueueInput {
  hotelId: Types.ObjectId;
  channel: NotificationChannel;
  to: string;
  template: string;
  body: string;
  relatedEntity?: { type: string; id: Types.ObjectId } | undefined;
  /** If this channel ultimately fails, re-queue the same message on this channel (e.g. WhatsApp → SMS). */
  fallbackChannel?: NotificationChannel | undefined;
  /** Guest email: after SMS also fails, the message goes out by email (WhatsApp → SMS → email). */
  fallbackEmail?: string | null | undefined;
  /** Values for the Meta-approved template mapped to `template` (see WHATSAPP_TEMPLATES). */
  templateParams?: string[] | undefined;
}

export async function enqueue(input: EnqueueInput, session?: ClientSession): Promise<void> {
  // An email address only makes sense as the last step of the chain.
  const fallbackEmail = input.channel === 'email' ? null : (input.fallbackEmail ?? null);
  await Notification.create(
    [
      {
        hotelId: input.hotelId,
        channel: input.channel,
        to: input.to,
        template: input.template,
        body: input.body,
        relatedEntity: input.relatedEntity ?? null,
        fallbackChannel: input.fallbackChannel ?? (fallbackEmail ? 'email' : null),
        fallbackEmail,
        templateParams: input.templateParams ?? null,
        status: 'queued',
        nextAttemptAt: new Date(),
      },
    ],
    { session },
  );
}

/** Chat replies show their delivery state to staff (pending → sent/simulated → delivered → read, or failed). */
async function syncChatDelivery(n: Pick<NotificationLean, 'relatedEntity'>, deliveryStatus: 'sent' | 'simulated' | 'failed' | 'delivered' | 'read') {
  if (n.relatedEntity?.type !== 'ChatMessage') return;
  const order = ['pending', 'simulated', 'sent', 'delivered', 'read'];
  // Receipts can arrive out of order: never move "read" back to "delivered". A failure always wins.
  const allowed = deliveryStatus === 'failed' ? order.filter((s) => s !== 'read') : order.slice(0, order.indexOf(deliveryStatus));
  await ChatMessage.updateOne({ _id: n.relatedEntity.id, deliveryStatus: { $in: [...allowed, null] } }, { $set: { deliveryStatus } });
}

const MESSAGE_LABEL: Record<string, string> = {
  booking_confirmed: 'booking confirmation',
  booking_cancelled: 'cancellation notice',
  checkin_welcome: 'check-in welcome',
  payment_link_pending: 'payment-link notice',
  payment_received_room_unavailable: 'late-payment notice',
};

/**
 * No channel left that can reach the guest: rather than pretend, staff get a call task (Hotel Settings →
 * Guest messaging, and the booking's "needs attention" note).
 */
async function requireManualFollowUp(n: NotificationLean, reason: string): Promise<void> {
  if (n.template === 'staff_escalation_alert') return; // the escalation itself is already on the Concierge Desk
  await Notification.updateOne(
    { _id: n._id },
    { $set: { manualFollowUp: { required: true, reason: reason.slice(0, 300), resolvedAt: null, resolvedBy: null } } },
  );
  if (n.relatedEntity?.type === 'Booking') {
    const label = MESSAGE_LABEL[n.template] ?? 'message';
    await Booking.updateOne(
      { _id: n.relatedEntity.id, needsAttention: null },
      { $set: { needsAttention: `The ${label} couldn’t be delivered to the guest. Please call them on ${formatPhone(n.to)}.` } },
    );
  }
  logger.warn({ id: String(n._id), template: n.template }, 'Guest unreachable by message; staff follow-up required');
}

/**
 * Marks a message permanently failed and moves it to the next channel in its chain that can actually
 * deliver (console simulators are skipped). Used when retries run out, when the provider says retrying is
 * pointless, and when Meta reports a failure after accepting. If nothing is left, staff are asked to call.
 */
export async function failPermanently(n: NotificationLean, message: string): Promise<void> {
  const claimed = await Notification.findOneAndUpdate({ _id: n._id, status: { $ne: 'dead' } }, { $set: { status: 'dead', lastError: message.slice(0, 300) } });
  if (!claimed) return; // already handled (e.g. a duplicate "failed" receipt)
  await syncChatDelivery(n, 'failed');
  logger.warn({ id: String(n._id), channel: n.channel, template: n.template, error: message.slice(0, 200) }, 'Notification permanently failed');

  if (!n.fallbackChannel) return; // chat replies: staff see the failed tick on the message
  const chain: { channel: NotificationChannel; to: string }[] = [];
  if (n.fallbackChannel === 'sms') chain.push({ channel: 'sms', to: n.to });
  if (n.fallbackChannel === 'whatsapp') chain.push({ channel: 'whatsapp', to: n.to });
  if (n.fallbackEmail && (n.fallbackChannel === 'sms' || n.fallbackChannel === 'email')) chain.push({ channel: 'email', to: n.fallbackEmail });

  const nextIndex = chain.findIndex((c) => isChannelLive(c.channel));
  if (nextIndex === -1) {
    const skipped = chain.map((c) => c.channel).join(' and ');
    await requireManualFollowUp(n, `${message.slice(0, 200)}${skipped ? ` — no ${skipped} provider configured` : ''}`);
    return;
  }
  const next = chain[nextIndex]!;
  await enqueue({
    hotelId: n.hotelId,
    channel: next.channel,
    to: next.to,
    template: n.template,
    body: n.body,
    relatedEntity: n.relatedEntity ?? undefined,
    fallbackChannel: chain[nextIndex + 1]?.channel,
    fallbackEmail: n.fallbackEmail,
    templateParams: n.templateParams ?? undefined,
  });
}

async function deliver(n: NotificationLean): Promise<void> {
  try {
    const provider = providerFor(n.channel);
    const result = await provider.send(n.to, n.body, { template: n.template, params: n.templateParams });
    await Notification.updateOne(
      { _id: n._id },
      { $set: { status: result.delivered ? 'sent' : 'simulated', providerMessageId: result.providerMessageId, lastError: null } },
    );
    await syncChatDelivery(n, result.delivered ? 'sent' : 'simulated');
    if (n.channel === 'whatsapp' && result.delivered && result.providerMessageId) {
      // Outbound channel log; delivery receipts from the webhook update this row.
      await WhatsAppMessage.updateOne(
        { waMessageId: result.providerMessageId },
        {
          $setOnInsert: {
            hotelId: n.hotelId,
            direction: 'out',
            phoneE164: n.to,
            type: 'text',
            text: n.body.slice(0, 4096),
            status: 'sent',
            statusHistory: [{ status: 'sent', at: new Date(), error: null }],
            notificationId: n._id,
          },
        },
        { upsert: true },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : 'send failed';
    if (err instanceof PermanentSendError || n.attempts >= MAX_ATTEMPTS) {
      await failPermanently(n, message);
    } else {
      await Notification.updateOne(
        { _id: n._id },
        { $set: { status: 'failed', lastError: message, nextAttemptAt: new Date(Date.now() + backoffMs(n.attempts)) } },
      );
    }
  }
}

/**
 * Delivers due messages. Each message is claimed with an atomic status flip, so several API instances
 * can run the worker without double-sending.
 */
export async function processOutbox(batch = 20): Promise<number> {
  let processed = 0;
  for (let i = 0; i < batch; i++) {
    const claimed = await Notification.findOneAndUpdate(
      { status: { $in: ['queued', 'failed'] }, nextAttemptAt: { $lte: new Date() } },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { sort: { nextAttemptAt: 1 }, new: true },
    ).lean();
    if (!claimed) break;
    await deliver(claimed);
    processed++;
  }
  return processed;
}

/** Messages stuck in "sending" (process crashed mid-send) are retried after 5 minutes. */
export async function recoverStuck(): Promise<void> {
  await Notification.updateMany(
    { status: 'sending', updatedAt: { $lt: new Date(Date.now() - 5 * 60_000) } },
    { $set: { status: 'failed', nextAttemptAt: new Date() } },
  );
}

/**
 * Applies a WhatsApp delivery receipt (from the Cloud API webhook) to the outbox row and the chat message.
 * A "failed" receipt after Meta accepted the message still triggers the SMS/email fallback.
 */
export async function applyDeliveryReceipt(providerMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error: string | null): Promise<void> {
  const n = await Notification.findOne({ channel: 'whatsapp', providerMessageId }).lean();
  if (!n) return;
  if (status === 'failed') {
    await failPermanently(n, error ?? 'WhatsApp reported the message as failed');
    return;
  }
  if (status === 'delivered' || status === 'read') await syncChatDelivery(n, status);
}

export async function latestFor(entityType: string, entityId: Types.ObjectId) {
  return Notification.find({ 'relatedEntity.type': entityType, 'relatedEntity.id': entityId })
    .sort({ createdAt: -1 })
    .select('channel status template createdAt')
    .limit(5)
    .lean();
}

/** Guests staff must contact themselves (every channel failed, or no channel can deliver). */
export async function openManualFollowUps(hotelId: Types.ObjectId) {
  const rows = await Notification.find({ hotelId, 'manualFollowUp.required': true, 'manualFollowUp.resolvedAt': null })
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  const bookingIds = rows.filter((r) => r.relatedEntity?.type === 'Booking').map((r) => r.relatedEntity!.id);
  const bookings = await Booking.find({ _id: { $in: bookingIds } })
    .select('reference guestSnapshot.name')
    .lean();
  const byId = new Map(bookings.map((b) => [String(b._id), b]));
  return rows.map((r) => {
    const b = r.relatedEntity?.type === 'Booking' ? byId.get(String(r.relatedEntity.id)) : undefined;
    return {
      id: String(r._id),
      message: MESSAGE_LABEL[r.template] ?? r.template.replace(/_/g, ' '),
      phone: r.channel === 'email' ? null : r.to,
      email: r.channel === 'email' ? r.to : null,
      guestName: b?.guestSnapshot.name ?? null,
      bookingReference: b?.reference ?? null,
      bookingId: b ? String(b._id) : null,
      body: r.body,
      reason: r.manualFollowUp!.reason,
      at: r.updatedAt.toISOString(),
    };
  });
}

/** Staff confirm they reached the guest. Clears the booking's note if it was ours. */
export async function resolveManualFollowUp(hotelId: Types.ObjectId, id: string, userId: Types.ObjectId): Promise<boolean> {
  const n = await Notification.findOneAndUpdate(
    { _id: id, hotelId, 'manualFollowUp.required': true, 'manualFollowUp.resolvedAt': null },
    { $set: { 'manualFollowUp.resolvedAt': new Date(), 'manualFollowUp.resolvedBy': userId } },
    { new: true },
  ).lean();
  if (!n) return false;
  if (n.relatedEntity?.type === 'Booking') {
    await Booking.updateOne({ _id: n.relatedEntity.id, needsAttention: /couldn’t be delivered to the guest/ }, { $set: { needsAttention: null } });
  }
  return true;
}
