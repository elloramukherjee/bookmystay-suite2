import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, notFound } from '../../shared/errors.js';
import { Booking, type BookingLean } from '../bookings/booking.model.js';
import { confirmBooking, getBookingLean } from '../bookings/booking.service.js';
import { Hotel } from '../hotels/hotel.model.js';
import { enqueue } from '../notifications/notification.service.js';
import { Payment, type PaymentLean, type PaymentMethod } from './payment.model.js';
import { isPayAtHotelOnly, paymentProvider } from './providers/index.js';
import { signMockWebhook, MOCK_SIGNATURE_HEADER } from './providers/mock.provider.js';
import { PaymentProviderUnavailableError, type CheckoutInstructions } from './providers/types.js';

export interface PaymentAccess {
  /** Staff hotel scope, or the guest token's booking id. */
  hotelId?: Types.ObjectId | null;
  guestBookingId?: string | null;
}

function assertAccess(booking: BookingLean, access: PaymentAccess) {
  const ok = (access.hotelId && booking.hotelId.equals(access.hotelId)) || access.guestBookingId === String(booking._id);
  if (!ok) throw notFound('Booking');
}

function toPaymentView(p: PaymentLean, booking: BookingLean, checkout?: CheckoutInstructions) {
  return {
    id: String(p._id),
    status: p.status,
    method: p.method,
    provider: p.provider,
    amountPaise: p.amountPaise,
    failureReason: p.failureReason,
    devMode: p.provider === 'mock',
    checkout: checkout ?? null,
    booking: {
      id: String(booking._id),
      reference: booking.reference,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    },
  };
}

/**
 * Starts (or resumes) a payment for a pending booking. If the gateway is down the booking is NOT lost:
 * it stays pending, the hold is extended once, staff are flagged and the guest is told a payment link
 * will follow — exactly the "degrade gracefully" requirement in the PRD.
 */
export async function createPayment(bookingId: string, method: PaymentMethod, access: PaymentAccess, req: Request) {
  const booking = await getBookingLean(bookingId);
  assertAccess(booking, access);
  if (isPayAtHotelOnly()) paymentProvider(); // throws ONLINE_PAYMENTS_DISABLED with a guest-friendly message

  if (booking.status !== 'pending_payment') {
    throw new AppError(
      409,
      'CONFLICT',
      booking.status === 'confirmed' ? 'This booking is already paid and confirmed.' : `This booking is ${booking.status.replace('_', ' ')}.`,
    );
  }
  if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() <= Date.now() || booking.inventoryState !== 'held') {
    throw new AppError(409, 'HOLD_EXPIRED', 'Your reservation hold has expired. Please search again — rooms may still be available.');
  }

  const provider = paymentProvider();
  const open = await Payment.findOne({
    bookingId: booking._id,
    status: { $in: ['created', 'pending'] },
    method,
    provider: provider.name,
    amountPaise: booking.amounts.totalPaise,
  }).lean();
  if (open) {
    const checkout: CheckoutInstructions = {
      kind: provider.name,
      orderId: open.providerOrderId,
      ...(provider.name === 'razorpay' && env.PAYMENT_GATEWAY_KEY ? { keyId: env.PAYMENT_GATEWAY_KEY } : {}),
    };
    return toPaymentView(open, booking, checkout);
  }

  try {
    const order = await provider.createOrder({
      amountPaise: booking.amounts.totalPaise,
      receipt: booking.reference,
      method,
      notes: { bookingId: String(booking._id), hotelId: String(booking.hotelId) },
    });
    const payment = await Payment.create({
      hotelId: booking.hotelId,
      bookingId: booking._id,
      provider: provider.name,
      method,
      providerOrderId: order.providerOrderId,
      amountPaise: booking.amounts.totalPaise,
      status: 'created',
    });
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'pending_payment' },
      { $set: { paymentStatus: 'pending' } },
      { new: true },
    ).lean();
    await audit({
      hotelId: booking.hotelId,
      actor: { type: 'guest', id: booking.guestId },
      action: 'payment.created',
      entity: { type: 'Payment', id: payment._id },
      metadata: { method, provider: provider.name },
      req,
    });
    return toPaymentView(payment.toObject() as PaymentLean, updated ?? booking, order.checkout);
  } catch (err) {
    if (!(err instanceof PaymentProviderUnavailableError)) throw err;
    logger.error({ err, bookingId: String(booking._id) }, 'Payment gateway unavailable');
    const hotel = await Hotel.findById(booking.hotelId).lean();
    const firstOutage = booking.paymentStatus !== 'provider_unavailable';
    await Booking.updateOne(
      { _id: booking._id, status: 'pending_payment' },
      {
        $set: {
          paymentStatus: 'provider_unavailable',
          needsAttention: 'Payment gateway was unavailable when the guest tried to pay. Share a payment link or confirm as pay-at-hotel.',
          ...(firstOutage ? { holdExpiresAt: new Date(Date.now() + (hotel?.settings.holdMinutes ?? 15) * 60_000 * 2) } : {}),
        },
      },
    );
    if (firstOutage) {
      await enqueue({
        hotelId: booking.hotelId,
        channel: 'whatsapp',
        fallbackChannel: 'sms',
        to: booking.guestSnapshot.phoneE164,
        fallbackEmail: booking.guestSnapshot.email,
        template: 'payment_link_pending',
        body: `Namaste ${booking.guestSnapshot.name.split(' ')[0]}, we've received your booking request ${booking.reference} at ${hotel?.name ?? 'our hotel'}. Our payment service is briefly unavailable — your room is held and we'll send you a payment link shortly.`,
        relatedEntity: { type: 'Booking', id: booking._id },
      });
    }
    throw new AppError(
      503,
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Payments are temporarily unavailable. Your booking request is saved and your room is held — we’ll send a payment link on WhatsApp.',
      {
        reference: booking.reference,
      },
    );
  }
}

export async function getPaymentStatus(paymentId: string, access: PaymentAccess) {
  if (!Types.ObjectId.isValid(paymentId)) throw notFound('Payment');
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw notFound('Payment');
  const booking = await getBookingLean(payment.bookingId);
  assertAccess(booking, access);
  return toPaymentView(payment, booking);
}

/**
 * Webhook pipeline: verify signature on the raw body → normalise → idempotency (event id recorded with a
 * conditional $push, so a replayed event is a no-op) → amount check → confirm booking.
 */
export async function handleWebhook(rawBody: Buffer | undefined, headers: Request['headers']) {
  if (isPayAtHotelOnly()) throw new AppError(404, 'NOT_FOUND', 'Online payments are not enabled');
  const provider = paymentProvider();
  if (!rawBody || !provider.verifyWebhook(rawBody, headers)) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature');
  }
  const event = provider.parseWebhook(rawBody, headers);
  if (event.type === 'ignored' || !event.providerOrderId) return { status: 'ignored' as const };

  const recorded = await Payment.findOneAndUpdate(
    { provider: provider.name, providerOrderId: event.providerOrderId, 'events.providerEventId': { $ne: event.eventId } },
    { $push: { events: { providerEventId: event.eventId, type: event.type, receivedAt: new Date() } } },
    { new: true },
  ).lean();

  if (!recorded) {
    const exists = await Payment.exists({ provider: provider.name, providerOrderId: event.providerOrderId });
    if (!exists) logger.warn({ orderId: event.providerOrderId }, 'Webhook for unknown payment order');
    return { status: exists ? ('duplicate' as const) : ('unknown_order' as const) };
  }

  if (event.type === 'payment.failed') {
    await Payment.updateOne(
      { _id: recorded._id, status: { $ne: 'captured' } },
      { $set: { status: 'failed', failureReason: event.failureReason ?? 'Payment failed', providerPaymentId: event.providerPaymentId } },
    );
    await Booking.updateOne({ _id: recorded.bookingId, status: 'pending_payment' }, { $set: { paymentStatus: 'unpaid' } });
    return { status: 'failed' as const };
  }

  // payment.captured
  if (event.amountPaise !== null && event.amountPaise !== recorded.amountPaise) {
    await Booking.updateOne(
      { _id: recorded.bookingId },
      { $set: { needsAttention: `Captured amount ${event.amountPaise} paise does not match the order amount ${recorded.amountPaise} paise.` } },
    );
    logger.error({ paymentId: String(recorded._id) }, 'Captured amount mismatch');
    return { status: 'amount_mismatch' as const };
  }
  await Payment.updateOne({ _id: recorded._id }, { $set: { status: 'captured', providerPaymentId: event.providerPaymentId, failureReason: null } });
  const outcome = await confirmBooking(recorded.bookingId, 'paid', { type: 'system' });
  if (!outcome.ok && outcome.reason === 'not_pending' && outcome.booking?.status === 'cancelled') {
    // Guest cancelled while paying: money must go back.
    await Booking.updateOne(
      { _id: recorded.bookingId },
      {
        $set: {
          paymentStatus: 'refund_pending',
          refundDuePaise: recorded.amountPaise,
          needsAttention: 'Payment captured for a cancelled booking. Refund required.',
        },
      },
    );
  }
  return { status: outcome.ok ? ('confirmed' as const) : (`not_confirmed:${outcome.reason}` as const) };
}

/**
 * ⚠️ Development only: emulates the gateway calling our webhook after the guest pays (or fails).
 * Goes through the exact same signed-webhook path as production.
 */
export async function simulateMockPayment(paymentId: string, outcome: 'success' | 'failure', access: PaymentAccess) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment || payment.provider !== 'mock') throw notFound('Payment');
  const booking = await getBookingLean(payment.bookingId);
  assertAccess(booking, access);

  const body = JSON.stringify({
    id: `mock_evt_${randomUUID()}`,
    event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
    orderId: payment.providerOrderId,
    paymentId: `mock_pay_${randomUUID().slice(0, 12)}`,
    amountPaise: payment.amountPaise,
    reason: outcome === 'failure' ? 'Simulated decline (dev mock)' : undefined,
  });
  const result = await handleWebhook(Buffer.from(body), { [MOCK_SIGNATURE_HEADER]: signMockWebhook(body) });
  return { result, payment: await getPaymentStatus(paymentId, access) };
}
