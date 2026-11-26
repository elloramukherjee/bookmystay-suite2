import { randomInt } from 'node:crypto';
import type { Request } from 'express';
import { Types, type ClientSession } from 'mongoose';
import { logger } from '../../config/logger.js';
import { withTransaction } from '../../database/transaction.js';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { requirePhone, upsertGuest } from '../../shared/guestIdentity.js';
import { escapeRegex, pageMeta } from '../../shared/pagination.js';
import type { AuthContext } from '../../types/express.js';
import { stayNights, todayInTimeZone, zonedDateTime } from '../../utils/dates.js';
import { formatINR, percentOf } from '../../utils/money.js';
import { maskPhone, normalizePhone } from '../../utils/phone.js';
import { adjust, ensureNights, loadNights, nightlyRate, reserve, roomUnavailable } from '../availability/availability.service.js';
import { getActiveHotel } from '../availability/inventory.service.js';
import { isPayAtHotelOnly } from '../payments/providers/index.js';
import { assertBookableStay, fitsOccupancy } from '../availability/stay.validation.js';
import { Guest } from '../guests/guest.model.js';
import { Hotel, type HotelLean } from '../hotels/hotel.model.js';
import { enqueue, latestFor } from '../notifications/notification.service.js';
import { RatePlan, type RatePlanLean } from '../rooms/ratePlan.model.js';
import { RoomType, type RoomTypeLean } from '../rooms/roomType.model.js';
import { Booking, isOtaSource, type BookingLean, type BookingShape, type BookingSource } from './booking.model.js';
import type { CreateBookingInput, ListBookingsQuery, ManualBookingInput } from './booking.validation.js';
import { signGuestToken } from './guestToken.js';
import { quoteStay } from './pricing.service.js';

// Crockford-style alphabet: no 0/O/1/I/L confusion when a guest reads a reference over the phone.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateReference(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `BMS-${s}`;
}

const isDuplicateKey = (err: unknown, field: string) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: number }).code === 11000 &&
  Boolean((err as { keyPattern?: Record<string, unknown> }).keyPattern?.[field]);

/**
 * Inside a real transaction, a failure rolls everything back. Without one (standalone MongoDB in
 * development), inventory already reserved must be released explicitly before rethrowing.
 */
async function compensateOnFailure<T>(session: ClientSession | undefined, compensate: () => Promise<void>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!session) await compensate().catch((e) => logger.error({ err: e }, 'Inventory compensation failed'));
    throw err;
  }
}

// ─── Views ────────────────────────────────────────────────────────────────────────────────────────

export function cancellationTerms(
  booking: Pick<BookingShape, 'checkIn' | 'status'>,
  hotel: Pick<HotelLean, 'checkInTime' | 'timezone' | 'settings'>,
  now = new Date(),
) {
  const checkInAt = zonedDateTime(booking.checkIn, hotel.checkInTime, hotel.timezone);
  const freeUntil = new Date(checkInAt.getTime() - hotel.settings.freeCancellationHours * 3_600_000);
  const cancellable = ['pending_payment', 'confirmed'].includes(booking.status) && now < checkInAt;
  return { freeUntil: freeUntil.toISOString(), isFree: now <= freeUntil, cancellable, freeCancellationHours: hotel.settings.freeCancellationHours };
}

/** Refund due on cancellation: everything inside the free window, otherwise all but the first night. */
export function refundDue(booking: Pick<BookingShape, 'amounts' | 'nights' | 'paymentStatus'>, isFree: boolean): number {
  if (booking.paymentStatus !== 'paid') return 0;
  if (isFree) return booking.amounts.totalPaise;
  const firstNight = Math.round(booking.amounts.totalPaise / booking.nights);
  return Math.max(0, booking.amounts.totalPaise - firstNight);
}

async function toGuestView(b: BookingLean, hotel?: HotelLean) {
  const h = hotel ?? (await Hotel.findById(b.hotelId).lean());
  if (!h) throw notFound('Hotel');
  const notifications = await latestFor('Booking', b._id);
  return {
    id: String(b._id),
    reference: b.reference,
    status: b.status,
    paymentStatus: b.paymentStatus,
    hotel: {
      id: String(h._id),
      name: h.name,
      slug: h.slug,
      checkInTime: h.checkInTime,
      checkOutTime: h.checkOutTime,
      timezone: h.timezone,
      address: { line1: h.address.line1, locality: h.address.locality, city: h.address.city, state: h.address.state, pincode: h.address.pincode },
      whatsapp: h.contact.whatsapp,
      phone: h.contact.phone,
    },
    roomTypeId: String(b.roomTypeId),
    roomTypeName: b.roomTypeName,
    ratePlanName: b.ratePlanName,
    quantity: b.quantity,
    adults: b.adults,
    children: b.children,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    source: b.source,
    guest: { name: b.guestSnapshot.name, phoneMasked: maskPhone(b.guestSnapshot.phoneE164), hasEmail: Boolean(b.guestSnapshot.email) },
    amounts: b.amounts,
    holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    refundDuePaise: b.refundDuePaise,
    specialRequests: b.specialRequests,
    cancellation: cancellationTerms(b, h),
    confirmationMessages: notifications.map((n) => ({ channel: n.channel, status: n.status, template: n.template, at: n.createdAt })),
    createdAt: b.createdAt.toISOString(),
  };
}

async function toStaffView(b: BookingLean) {
  const base = await toGuestView(b);
  const guest = await Guest.findById(b.guestId).select('stats name').lean();
  return {
    ...base,
    guestId: String(b.guestId),
    guest: {
      name: b.guestSnapshot.name,
      phoneE164: b.guestSnapshot.phoneE164,
      email: b.guestSnapshot.email,
      isReturning: (guest?.stats.completedStays ?? 0) >= 1,
      totalBookings: guest?.stats.totalBookings ?? 0,
    },
    otaReference: b.otaReference,
    roomNumber: b.roomNumber,
    inventoryState: b.inventoryState,
    needsAttention: b.needsAttention,
    cancellationReason: b.cancellationReason,
    cancelledBy: b.cancelledBy,
    consent: b.consentSnapshot,
  };
}

function toListItem(b: BookingLean) {
  return {
    id: String(b._id),
    reference: b.reference,
    status: b.status,
    paymentStatus: b.paymentStatus,
    source: b.source,
    guestName: b.guestSnapshot.name,
    guestPhone: b.guestSnapshot.phoneE164,
    roomTypeName: b.roomTypeName,
    quantity: b.quantity,
    adults: b.adults,
    children: b.children,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    totalPaise: b.amounts.totalPaise,
    needsAttention: b.needsAttention,
    holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────────

async function loadRoomAndPlan(
  hotelId: Types.ObjectId,
  roomTypeId: string,
  ratePlanId?: string | null,
): Promise<{ roomType: RoomTypeLean; plan: RatePlanLean | null }> {
  const roomType = await RoomType.findOne({ _id: roomTypeId, hotelId, isActive: true }).lean();
  if (!roomType) throw new AppError(404, 'NOT_FOUND', 'Room type not found', [{ path: 'roomTypeId', message: 'Choose an available room' }]);
  let plan: RatePlanLean | null = null;
  if (ratePlanId) {
    plan = await RatePlan.findOne({ _id: ratePlanId, hotelId, roomTypeId: roomType._id, isActive: true }).lean();
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'Rate plan not found', [{ path: 'ratePlanId', message: 'Choose a valid plan' }]);
  } else {
    plan = await RatePlan.findOne({ hotelId, roomTypeId: roomType._id, isActive: true }).sort({ isDefault: -1, adjustmentPaise: 1 }).lean();
  }
  return { roomType, plan };
}

type ConfirmationFields = Pick<
  BookingShape,
  'reference' | 'guestSnapshot' | 'roomTypeName' | 'checkIn' | 'checkOut' | 'nights' | 'quantity' | 'amounts' | 'paymentStatus'
>;

/**
 * Values for the approved WhatsApp template "booking_confirmed" (docs/WHATSAPP-SETUP.md):
 * {{1}} first name, {{2}} hotel, {{3}} reference, {{4}} rooms & nights, {{5}} check-in, {{6}} check-out, {{7}} payment.
 */
function confirmationParams(b: ConfirmationFields, hotel: HotelLean): string[] {
  const payLine =
    b.paymentStatus === 'paid'
      ? `Paid: ${formatINR(b.amounts.totalPaise)} (incl. GST)`
      : b.paymentStatus === 'collected_by_ota'
        ? 'Payment: collected by your booking platform'
        : `Amount due at hotel: ${formatINR(b.amounts.totalPaise)}`;
  return [
    b.guestSnapshot.name.split(' ')[0] || b.guestSnapshot.name,
    hotel.name,
    b.reference,
    `${b.quantity} × ${b.roomTypeName}, ${b.nights} night${b.nights > 1 ? 's' : ''}`,
    `${b.checkIn} from ${hotel.checkInTime}`,
    `${b.checkOut} by ${hotel.checkOutTime}`,
    payLine,
  ];
}

function confirmationText(b: ConfirmationFields, hotel: HotelLean): string {
  const [name, hotelName, reference, rooms, checkIn, checkOut, payLine] = confirmationParams(b, hotel);
  return [
    `Namaste ${name}! Your stay at ${hotelName} is confirmed.`,
    `Booking ref: ${reference}`,
    rooms,
    `Check-in ${checkIn} · Check-out ${checkOut}`,
    payLine,
    `Reply here on WhatsApp for anything you need before arrival.`,
  ].join('\n');
}

async function queueConfirmation(b: BookingLean, hotel: HotelLean, session?: ClientSession) {
  await enqueue(
    {
      hotelId: b.hotelId,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      to: b.guestSnapshot.phoneE164,
      fallbackEmail: b.guestSnapshot.email,
      template: 'booking_confirmed',
      body: confirmationText(b, hotel),
      templateParams: confirmationParams(b, hotel),
      relatedEntity: { type: 'Booking', id: b._id },
    },
    session,
  );
}

async function recordGuestBookingStats(b: BookingLean, hotel: HotelLean, session?: ClientSession) {
  const direct = b.source === 'direct';
  await Guest.updateOne(
    { _id: b.guestId, hotelId: b.hotelId },
    {
      $inc: {
        'stats.totalBookings': 1,
        'stats.directBookings': direct ? 1 : 0,
        'stats.otaBookings': isOtaSource(b.source) ? 1 : 0,
        'stats.lifetimeValuePaise': b.amounts.totalPaise,
        'stats.commissionSavedPaise': direct ? percentOf(b.amounts.taxablePaise, hotel.settings.otaCommissionRate) : 0,
      },
    },
    { session },
  );
}

// ─── Public direct booking ────────────────────────────────────────────────────────────────────────

export async function createDirectBooking(input: CreateBookingInput, idempotencyKey: string | undefined, req: Request) {
  const hotel = await getActiveHotel(input.hotelId);
  const phoneE164 = requirePhone(input.guest.phone, 'guest.phone');

  if (idempotencyKey) {
    const existing = await Booking.findOne({ hotelId: hotel._id, idempotencyKey }).lean();
    if (existing) {
      if (existing.guestSnapshot.phoneE164 !== phoneE164) throw conflict('This request was already used for a different booking');
      return {
        booking: await toGuestView(existing, hotel),
        guestToken: signGuestToken({ bid: String(existing._id), hid: String(hotel._id), gid: String(existing.guestId) }),
        replayed: true,
      };
    }
  }

  const nightsCount = assertBookableStay(input.checkIn, input.checkOut, hotel.timezone);
  if (isPayAtHotelOnly()) await assertUnpaidBookingCap(hotel, phoneE164);
  const { roomType, plan } = await loadRoomAndPlan(hotel._id, input.roomTypeId, input.ratePlanId);
  if (!fitsOccupancy(roomType, input.adults, input.children, input.rooms)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${roomType.name} fits up to ${roomType.maxOccupancy} guests per room`, [
      { path: 'adults', message: 'Too many guests for this room' },
    ]);
  }

  const dates = stayNights(input.checkIn, input.checkOut);
  await ensureNights(hotel._id, roomType, dates);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const created = await withTransaction(async (session) => {
        const nights = await loadNights(hotel._id, roomType._id, dates, session);
        const minStay = Math.max(...nights.map((n) => n.minStay));
        if (nightsCount < minStay) throw new AppError(409, 'ROOM_UNAVAILABLE', `Minimum stay is ${minStay} nights for these dates`);

        await reserve(hotel._id, roomType._id, dates, input.rooms, 'held', session);
        return compensateOnFailure(
          session,
          () => adjust(hotel._id, roomType._id, dates, { held: -input.rooms }),
          async () => {
            const amounts = quoteStay({
              nightly: nights.map((n) => ({ date: n.date, ratePaise: nightlyRate(n, roomType) + (plan?.adjustmentPaise ?? 0) })),
              quantity: input.rooms,
              applyDirectDiscount: true,
              promoCode: input.promoCode,
              otaNightlyPaise: roomType.otaRatePaise ? roomType.otaRatePaise + (plan?.adjustmentPaise ?? 0) : null,
              settings: hotel.settings,
            });

            const guest = await upsertGuest(
              {
                hotelId: hotel._id,
                phone: phoneE164,
                name: input.guest.name,
                email: input.guest.email,
                source: 'direct',
                consent: { transactional: true, marketing: input.consent.marketing },
              },
              session,
            );

            const [booking] = await Booking.create(
              [
                {
                  hotelId: hotel._id,
                  reference: generateReference(),
                  guestId: guest._id,
                  guestSnapshot: { name: input.guest.name, phoneE164, email: input.guest.email || null },
                  roomTypeId: roomType._id,
                  roomTypeName: roomType.name,
                  ratePlanId: plan?._id ?? null,
                  ratePlanName: plan?.name ?? null,
                  quantity: input.rooms,
                  adults: input.adults,
                  children: input.children,
                  checkIn: input.checkIn,
                  checkOut: input.checkOut,
                  nights: nightsCount,
                  source: 'direct',
                  status: 'pending_payment',
                  paymentStatus: 'unpaid',
                  amounts,
                  inventoryState: 'held',
                  holdExpiresAt: new Date(Date.now() + hotel.settings.holdMinutes * 60_000),
                  specialRequests: input.specialRequests || null,
                  consentSnapshot: { transactional: true, marketing: input.consent.marketing, noticeVersion: '2026-11' },
                  idempotencyKey: idempotencyKey ?? null,
                },
              ],
              { session },
            );
            return booking!.toObject() as BookingLean;
          },
        );
      });

      await audit({
        hotelId: hotel._id,
        actor: { type: 'guest', id: created.guestId },
        action: 'booking.created',
        entity: { type: 'Booking', id: created._id },
        metadata: { source: 'direct', nights: nightsCount, rooms: input.rooms },
        req,
      });
      // No payment gateway: the booking is confirmed now (held → sold, guest stats, WhatsApp confirmation).
      const final = isPayAtHotelOnly() ? ((await confirmBooking(created._id, 'pay_at_hotel', { type: 'system' })).booking ?? created) : created;
      return {
        booking: await toGuestView(final, hotel),
        guestToken: signGuestToken({ bid: String(created._id), hid: String(hotel._id), gid: String(created.guestId) }),
        replayed: false,
      };
    } catch (err) {
      if (isDuplicateKey(err, 'reference')) continue; // astronomically rare; inventory was rolled back/compensated
      if (idempotencyKey && isDuplicateKey(err, 'idempotencyKey')) {
        // A concurrent retry with the same key won the race; release whatever this attempt held.
        return createDirectBooking(input, idempotencyKey, req);
      }
      throw err;
    }
  }
  throw new AppError(500, 'INTERNAL', 'Could not allocate a booking reference. Please try again.');
}

/** Upcoming unpaid (pay-at-hotel) bookings one phone number may hold, so fake bookings can't block the property. */
export const MAX_OPEN_PAY_AT_HOTEL = 3;

async function assertUnpaidBookingCap(hotel: HotelLean, phoneE164: string): Promise<void> {
  const guest = await Guest.findOne({ hotelId: hotel._id, phoneE164 }).select('_id').lean();
  if (!guest) return;
  const open = await Booking.countDocuments({
    hotelId: hotel._id,
    guestId: guest._id,
    status: { $in: ['pending_payment', 'confirmed'] },
    paymentStatus: { $in: ['unpaid', 'pay_at_hotel'] },
    checkOut: { $gt: todayInTimeZone(hotel.timezone) },
  });
  if (open >= MAX_OPEN_PAY_AT_HOTEL) {
    throw new AppError(
      409,
      'TOO_MANY_UNPAID_BOOKINGS',
      `You already have ${open} upcoming bookings to pay at the hotel. Please contact us${hotel.contact?.phone ? ` on ${hotel.contact.phone}` : ''} to book more rooms.`,
    );
  }
}

// ─── Confirmation (payment captured / staff) ──────────────────────────────────────────────────────

export type ConfirmOutcome = { ok: true; booking: BookingLean } | { ok: false; reason: 'not_pending' | 'unavailable'; booking: BookingLean | null };

/**
 * Moves a pending booking to confirmed. Handles the awkward case where payment arrives after the hold
 * expired: inventory is re-reserved if still free; otherwise the booking is flagged for a refund and
 * staff attention instead of silently overbooking.
 */
export async function confirmBooking(
  bookingId: Types.ObjectId,
  paymentStatus: 'paid' | 'pay_at_hotel',
  actor: { type: 'system' | 'user'; id?: Types.ObjectId | null; role?: string | null },
): Promise<ConfirmOutcome> {
  const current = await Booking.findById(bookingId).lean();
  if (!current) return { ok: false, reason: 'not_pending', booking: null };
  const hotel = await Hotel.findById(current.hotelId).lean();
  if (!hotel) throw notFound('Hotel');

  if (current.status === 'expired' && paymentStatus === 'paid') {
    return confirmLatePayment(current, hotel, actor);
  }

  const result = await withTransaction(async (session) => {
    const updated = await Booking.findOneAndUpdate(
      { _id: bookingId, status: 'pending_payment' },
      { $set: { status: 'confirmed', paymentStatus, confirmedAt: new Date(), holdExpiresAt: null, inventoryState: 'sold' } },
      { new: true, session },
    ).lean();
    if (!updated) return null;
    if (current.inventoryState === 'held') {
      await adjust(
        updated.hotelId,
        updated.roomTypeId,
        stayNights(updated.checkIn, updated.checkOut),
        { held: -updated.quantity, sold: updated.quantity },
        session,
      );
    }
    await recordGuestBookingStats(updated, hotel, session);
    await queueConfirmation(updated, hotel, session);
    return updated;
  });

  if (!result) return { ok: false, reason: 'not_pending', booking: await Booking.findById(bookingId).lean() };
  await audit({ hotelId: result.hotelId, actor, action: 'booking.confirmed', entity: { type: 'Booking', id: result._id }, metadata: { paymentStatus } });
  return { ok: true, booking: result };
}

async function confirmLatePayment(b: BookingLean, hotel: HotelLean, actor: { type: 'system' | 'user'; id?: Types.ObjectId | null }): Promise<ConfirmOutcome> {
  const dates = stayNights(b.checkIn, b.checkOut);
  try {
    const updated = await withTransaction(async (session) => {
      const claimed = await Booking.findOneAndUpdate(
        { _id: b._id, status: 'expired', inventoryState: 'released' },
        { $set: { status: 'confirmed', paymentStatus: 'paid', confirmedAt: new Date(), inventoryState: 'sold', needsAttention: null } },
        { new: true, session },
      ).lean();
      if (!claimed) return null;
      await reserve(b.hotelId, b.roomTypeId, dates, b.quantity, 'sold', session);
      await recordGuestBookingStats(claimed, hotel, session);
      await queueConfirmation(claimed, hotel, session);
      return claimed;
    });
    if (!updated) return { ok: false, reason: 'not_pending', booking: b };
    await audit({ hotelId: b.hotelId, actor, action: 'booking.confirmed_after_expiry', entity: { type: 'Booking', id: b._id } });
    return { ok: true, booking: updated };
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'ROOM_UNAVAILABLE') throw err;
    const flagged = await Booking.findOneAndUpdate(
      { _id: b._id },
      {
        $set: {
          paymentStatus: 'refund_pending',
          refundDuePaise: b.amounts.totalPaise,
          needsAttention: 'Payment received after the hold expired and the room was sold. Refund or offer an alternative.',
        },
      },
      { new: true },
    ).lean();
    await enqueue({
      hotelId: b.hotelId,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      to: b.guestSnapshot.phoneE164,
      fallbackEmail: b.guestSnapshot.email,
      template: 'payment_received_room_unavailable',
      body: `Namaste ${b.guestSnapshot.name.split(' ')[0]}, we received your payment for ${b.reference}, but your reservation hold had expired and the room is no longer available. Our team will call you shortly to offer an alternative or a full refund.`,
      relatedEntity: { type: 'Booking', id: b._id },
    });
    await audit({ hotelId: b.hotelId, actor, action: 'booking.late_payment_unavailable', entity: { type: 'Booking', id: b._id } });
    return { ok: false, reason: 'unavailable', booking: flagged };
  }
}

// ─── Hold expiry ──────────────────────────────────────────────────────────────────────────────────

/** Releases inventory for unpaid bookings past their hold. Each booking is claimed atomically. */
export async function expireStaleHolds(now = new Date(), batch = 100): Promise<number> {
  let count = 0;
  for (let i = 0; i < batch; i++) {
    const claimed = await Booking.findOneAndUpdate(
      { status: 'pending_payment', holdExpiresAt: { $lte: now }, inventoryState: 'held' },
      { $set: { status: 'expired', inventoryState: 'released', paymentStatus: 'unpaid' } },
      { new: true, sort: { holdExpiresAt: 1 } },
    ).lean();
    if (!claimed) break;
    await adjust(claimed.hotelId, claimed.roomTypeId, stayNights(claimed.checkIn, claimed.checkOut), { held: -claimed.quantity });
    await audit({ hotelId: claimed.hotelId, actor: { type: 'system' }, action: 'booking.expired', entity: { type: 'Booking', id: claimed._id } });
    count++;
  }
  if (count) logger.info({ count }, 'Expired unpaid booking holds');
  return count;
}

// ─── Cancellation ─────────────────────────────────────────────────────────────────────────────────

export async function cancelBooking(
  bookingId: Types.ObjectId,
  by: { type: 'guest' | 'staff'; userId?: Types.ObjectId | null; role?: string | null },
  reason: string | undefined,
  req: Request,
) {
  const b = await Booking.findById(bookingId).lean();
  if (!b) throw notFound('Booking');
  const hotel = await Hotel.findById(b.hotelId).lean();
  if (!hotel) throw notFound('Hotel');

  const terms = cancellationTerms(b, hotel);
  if (!terms.cancellable) throw new AppError(409, 'CONFLICT', 'This booking can no longer be cancelled online. Please contact the hotel.');
  const due = refundDue(b, terms.isFree);
  const today = todayInTimeZone(hotel.timezone);

  const updated = await withTransaction(async (session) => {
    const claimed = await Booking.findOneAndUpdate(
      { _id: b._id, status: { $in: ['pending_payment', 'confirmed'] }, inventoryState: { $ne: 'released' } },
      {
        $set: {
          status: 'cancelled',
          inventoryState: 'released',
          cancelledAt: new Date(),
          cancelledBy: by.type,
          cancellationReason: reason?.slice(0, 300) || null,
          holdExpiresAt: null,
          refundDuePaise: due,
          ...(due > 0 ? { paymentStatus: 'refund_pending' } : {}),
        },
      },
      { new: true, session },
    ).lean();
    if (!claimed) return null;
    const futureNights = stayNights(b.checkIn, b.checkOut).filter((d) => d >= today);
    await adjust(b.hotelId, b.roomTypeId, futureNights, b.inventoryState === 'held' ? { held: -b.quantity } : { sold: -b.quantity }, session);
    if (b.status === 'confirmed') {
      await Guest.updateOne(
        { _id: b.guestId },
        {
          $inc: {
            'stats.totalBookings': -1,
            'stats.directBookings': b.source === 'direct' ? -1 : 0,
            'stats.otaBookings': isOtaSource(b.source) ? -1 : 0,
            'stats.lifetimeValuePaise': -(b.amounts.totalPaise - due),
            'stats.commissionSavedPaise': b.source === 'direct' ? -percentOf(b.amounts.taxablePaise, hotel.settings.otaCommissionRate) : 0,
          },
        },
        { session },
      );
      await enqueue(
        {
          hotelId: b.hotelId,
          channel: 'whatsapp',
          fallbackChannel: 'sms',
          to: b.guestSnapshot.phoneE164,
          fallbackEmail: b.guestSnapshot.email,
          template: 'booking_cancelled',
          body: `Your booking ${b.reference} at ${hotel.name} has been cancelled.${due > 0 ? ` A refund of ${formatINR(due)} will be processed to your original payment method within 5–7 working days.` : ''}`,
          relatedEntity: { type: 'Booking', id: b._id },
          // Template "booking_cancelled": {{1}} reference, {{2}} hotel, {{3}} refund line.
          templateParams: [
            b.reference,
            hotel.name,
            due > 0 ? `A refund of ${formatINR(due)} will reach your original payment method in 5–7 working days.` : 'No payment is due.',
          ],
        },
        session,
      );
    }
    return claimed;
  });
  if (!updated) throw new AppError(409, 'CONFLICT', 'This booking was already updated. Refresh and try again.');

  await audit({
    hotelId: b.hotelId,
    actor: by.type === 'guest' ? { type: 'guest', id: b.guestId } : { type: 'user', id: by.userId ?? null, role: by.role ?? null },
    action: 'booking.cancelled',
    entity: { type: 'Booking', id: b._id },
    metadata: { refundDuePaise: due, freeWindow: terms.isFree },
    req,
  });
  return updated;
}

// ─── Staff operations ─────────────────────────────────────────────────────────────────────────────

/** Bookings taken outside the website (OTA, walk-in, phone) so the CRM and dashboard see every stay. */
export async function createManualBooking(actor: AuthContext, hotelId: Types.ObjectId, input: ManualBookingInput, req: Request) {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  const phoneE164 = requirePhone(input.guest.phone, 'guest.phone');
  const today = todayInTimeZone(hotel.timezone);
  if (input.checkOut <= input.checkIn)
    throw new AppError(400, 'VALIDATION_ERROR', 'Check-out must be after check-in', [{ path: 'checkOut', message: 'Invalid dates' }]);
  if (input.checkOut <= today)
    throw new AppError(400, 'VALIDATION_ERROR', 'This stay has already ended', [{ path: 'checkOut', message: 'Choose future dates' }]);

  const { roomType, plan } = await loadRoomAndPlan(hotelId, input.roomTypeId, input.ratePlanId);
  const dates = stayNights(input.checkIn, input.checkOut);
  await ensureNights(hotelId, roomType, dates);
  const source = input.source as BookingSource;

  const created = await withTransaction(async (session) => {
    const nights = await loadNights(hotelId, roomType._id, dates, session);
    await reserve(hotelId, roomType._id, dates, input.rooms, 'sold', session);
    return compensateOnFailure(
      session,
      () => adjust(hotelId, roomType._id, dates, { sold: -input.rooms }),
      async () => {
        const amounts = quoteStay({
          nightly: nights.map((n) => ({ date: n.date, ratePaise: input.nightlyRatePaise ?? nightlyRate(n, roomType) + (plan?.adjustmentPaise ?? 0) })),
          quantity: input.rooms,
          applyDirectDiscount: false,
          otaNightlyPaise: null,
          settings: hotel.settings,
        });
        const guest = await upsertGuest({ hotelId, phone: phoneE164, name: input.guest.name, email: input.guest.email, source }, session);
        const [booking] = await Booking.create(
          [
            {
              hotelId,
              reference: generateReference(),
              guestId: guest._id,
              guestSnapshot: { name: input.guest.name, phoneE164, email: input.guest.email || null },
              roomTypeId: roomType._id,
              roomTypeName: roomType.name,
              ratePlanId: plan?._id ?? null,
              ratePlanName: plan?.name ?? null,
              quantity: input.rooms,
              adults: input.adults,
              children: input.children,
              checkIn: input.checkIn,
              checkOut: input.checkOut,
              nights: dates.length,
              source,
              otaReference: input.otaReference || null,
              status: 'confirmed',
              paymentStatus: isOtaSource(source) ? 'collected_by_ota' : 'pay_at_hotel',
              amounts,
              inventoryState: 'sold',
              confirmedAt: new Date(),
              specialRequests: input.specialRequests || null,
              consentSnapshot: { transactional: true, marketing: false, noticeVersion: '2026-11' },
              createdBy: actor.userId,
            },
          ],
          { session },
        );
        const lean = booking!.toObject() as BookingLean;
        await recordGuestBookingStats(lean, hotel, session);
        if (input.sendConfirmation) await queueConfirmation(lean, hotel, session);
        return lean;
      },
    );
  });

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'booking.created_manual',
    entity: { type: 'Booking', id: created._id },
    metadata: { source },
    req,
  });
  return toStaffView(created);
}

export async function staffConfirm(actor: AuthContext, hotelId: Types.ObjectId, bookingId: string) {
  const b = await Booking.findOne({ _id: bookingId, hotelId }).lean();
  if (!b) throw notFound('Booking');
  if (b.status !== 'pending_payment') throw new AppError(409, 'CONFLICT', `Booking is already ${b.status.replace('_', ' ')}`);
  if (b.inventoryState !== 'held') throw roomUnavailable();
  const result = await confirmBooking(b._id, 'pay_at_hotel', { type: 'user', id: actor.userId, role: actor.role });
  if (!result.ok || !result.booking) throw new AppError(409, 'CONFLICT', 'Booking could not be confirmed. Refresh and try again.');
  return toStaffView(result.booking);
}

export async function listBookings(hotelId: Types.ObjectId, q: ListBookingsQuery) {
  const filter: Record<string, unknown> = { hotelId };
  if (q.status) filter.status = { $in: q.status.split(',') };
  if (q.source === 'direct') filter.source = 'direct';
  else if (q.source === 'ota') filter.source = { $regex: '^ota_' };
  else if (q.source) filter.source = q.source;
  if (q.from || q.to) filter.checkIn = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.attention) filter.needsAttention = { $ne: null };
  if (q.q) {
    const phone = normalizePhone(q.q);
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ reference: rx }, { 'guestSnapshot.name': rx }, ...(phone ? [{ 'guestSnapshot.phoneE164': phone }] : [])];
  }
  const sort: Record<string, 1 | -1> = q.sort === 'checkIn' ? { checkIn: 1, createdAt: -1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  return { items: items.map(toListItem), meta: pageMeta(q.page, q.limit, total) };
}

export async function getBookingForStaff(hotelId: Types.ObjectId, id: string) {
  const b = await Booking.findOne({ _id: id, hotelId }).lean();
  if (!b) throw notFound('Booking');
  return toStaffView(b);
}

export async function getBookingForGuest(bookingId: string) {
  const b = await Booking.findById(bookingId).lean();
  if (!b) throw notFound('Booking');
  return toGuestView(b);
}

/**
 * "Find my booking": reference + phone. Both must match; any mismatch yields the same 404 so the
 * endpoint can't be used to confirm whether a reference or a phone number exists.
 */
export async function lookupBooking(reference: string, phone: string) {
  const phoneE164 = normalizePhone(phone);
  const b = phoneE164 ? await Booking.findOne({ reference: reference.trim().toUpperCase() }).lean() : null;
  if (!b || b.guestSnapshot.phoneE164 !== phoneE164) {
    throw new AppError(404, 'NOT_FOUND', 'We couldn’t find a booking with that reference and phone number.');
  }
  return {
    booking: await toGuestView(b),
    guestToken: signGuestToken({ bid: String(b._id), hid: String(b.hotelId), gid: String(b.guestId) }),
  };
}

export async function getBookingLean(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw notFound('Booking');
  const b = await Booking.findById(id).lean();
  if (!b) throw notFound('Booking');
  return b;
}

export { toGuestView, toStaffView };

/**
 * The guest never arrived. Allowed from the check-in day on (after check-in time staff can no longer
 * cancel). Tonight and later nights go back on sale; past nights stay as they were. No message is sent.
 */
export async function markNoShow(actor: AuthContext, hotelId: Types.ObjectId, bookingId: string, req: Request) {
  if (!Types.ObjectId.isValid(bookingId)) throw notFound('Booking');
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  const today = todayInTimeZone(hotel.timezone);
  const b = await Booking.findOne({ _id: bookingId, hotelId }).lean();
  if (!b) throw notFound('Booking');
  if (b.status !== 'confirmed')
    throw new AppError(409, 'CONFLICT', `Only a confirmed booking that hasn't checked in can be a no-show (this one is ${b.status.replace('_', ' ')}).`);
  if (b.checkIn > today) throw new AppError(409, 'CONFLICT', `The guest isn't due until ${b.checkIn}. Cancel the booking instead.`);

  const released = stayNights(b.checkIn, b.checkOut).filter((d) => d >= today);
  const updated = await withTransaction(async (session) => {
    const next = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'confirmed' },
      { $set: { status: 'no_show', inventoryState: 'released', needsAttention: null } },
      { new: true, session },
    ).lean();
    if (!next) throw new AppError(409, 'CONFLICT', 'This booking was just updated. Refresh and try again.');
    if (released.length) await adjust(hotelId, b.roomTypeId, released, { sold: -b.quantity }, session);
    return next;
  });
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'booking.no_show',
    entity: { type: 'Booking', id: b._id },
    metadata: { nightsReleased: released.length, paymentStatus: b.paymentStatus },
    req,
  });
  return updated;
}
