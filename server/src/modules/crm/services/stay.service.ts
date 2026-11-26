import type { Request } from 'express';
import { Types } from 'mongoose';
import { withTransaction } from '../../../database/transaction.js';
import { audit } from '../../../shared/audit/audit.service.js';
import { AppError, notFound } from '../../../shared/errors.js';
import { escapeRegex } from '../../../shared/pagination.js';
import type { AuthContext } from '../../../types/express.js';
import { formatINR } from '../../../utils/money.js';
import { addDays, stayNights, todayInTimeZone, zonedDateTime } from '../../../utils/dates.js';
import { adjust } from '../../availability/availability.service.js';
import { Booking, type BookingLean } from '../../bookings/booking.model.js';
import { Guest } from '../../guests/guest.model.js';
import { guestTier } from '../../guests/guest.service.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { enqueue } from '../../notifications/notification.service.js';
import { Room } from '../../rooms/room.model.js';

const conflictState = (b: BookingLean, verb: string) =>
  new AppError(409, 'CONFLICT', `Can't ${verb}: booking ${b.reference} is ${b.status.replace(/_/g, ' ')}.`);

async function hotelToday(hotelId: Types.ObjectId) {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  return { hotel, today: todayInTimeZone(hotel.timezone) };
}

function rosterItem(b: BookingLean, guest?: { stats: { completedStays: number }; idVerification: { verified: boolean } } | null) {
  return {
    bookingId: String(b._id),
    reference: b.reference,
    guestId: String(b.guestId),
    guestName: b.guestSnapshot.name,
    guestPhone: b.guestSnapshot.phoneE164,
    roomTypeId: String(b.roomTypeId),
    roomTypeName: b.roomTypeName,
    roomNumber: b.roomNumber,
    quantity: b.quantity,
    adults: b.adults,
    children: b.children,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    status: b.status,
    source: b.source,
    paymentStatus: b.paymentStatus,
    totalPaise: b.amounts.totalPaise,
    specialRequests: b.specialRequests,
    tier: guestTier(guest?.stats.completedStays ?? 0),
    isReturning: (guest?.stats.completedStays ?? 0) >= 1,
    idVerified: guest?.idVerification.verified ?? false,
  };
}

/** Today at the desk: arrivals still to check in, guests in-house, and today's departures. */
export async function todayRoster(hotelId: Types.ObjectId) {
  const { hotel, today } = await hotelToday(hotelId);
  const [arrivals, inHouse, departedToday, rooms] = await Promise.all([
    Booking.find({ hotelId, status: 'confirmed', checkIn: { $lte: today }, checkOut: { $gt: today } })
      .sort({ checkIn: 1 })
      .lean(),
    Booking.find({ hotelId, status: 'checked_in' }).sort({ checkOut: 1 }).lean(),
    // Counted by when they actually left, so early and late departures are included.
    Booking.countDocuments({
      hotelId,
      status: 'checked_out',
      checkedOutAt: { $gte: zonedDateTime(today, '00:00', hotel.timezone), $lt: zonedDateTime(addDays(today, 1), '00:00', hotel.timezone) },
    }),
    Room.countDocuments({ hotelId, isActive: true }),
  ]);
  const guestIds = [...arrivals, ...inHouse].map((b) => b.guestId);
  const guests = await Guest.find({ _id: { $in: guestIds } })
    .select('stats.completedStays idVerification.verified')
    .lean();
  const gMap = new Map(guests.map((g) => [String(g._id), g]));
  const toItem = (b: BookingLean) => rosterItem(b, gMap.get(String(b.guestId)));
  const departuresDue = inHouse.filter((b) => b.checkOut <= today);
  const occupiedRooms = inHouse.reduce((n, b) => n + b.quantity, 0);
  return {
    date: today,
    timezone: hotel.timezone,
    arrivals: arrivals.map(toItem),
    inHouse: inHouse.map(toItem),
    departuresDue: departuresDue.map(toItem),
    counts: {
      arrivalsPending: arrivals.length,
      checkInsToday: arrivals.length + inHouse.filter((b) => b.checkIn === today).length,
      checkOutsToday: departuresDue.length + departedToday,
      inHouseRooms: occupiedRooms,
      totalRooms: rooms,
      occupancyPercent: rooms ? Math.round((occupiedRooms / rooms) * 1000) / 10 : 0,
    },
  };
}

/** Rooms of the booked type that are free to hand over right now. */
export async function availableRooms(hotelId: Types.ObjectId, roomTypeId: string) {
  if (!Types.ObjectId.isValid(roomTypeId)) throw notFound('Room type');
  const rooms = await Room.find({ hotelId, roomTypeId, isActive: true, status: { $in: ['available', 'cleaning'] } })
    .sort({ status: 1, number: 1 })
    .lean();
  return rooms.map((r) => ({ id: String(r._id), number: r.number, floor: r.floor, status: r.status }));
}

export interface CheckInInput {
  bookingId: string;
  roomId?: string | undefined;
  idVerified?: boolean | undefined;
  idDocType?: 'aadhaar' | 'passport' | 'driving_licence' | 'voter_id' | 'other' | undefined;
  sendWelcome?: boolean | undefined;
}

/**
 * The 10-second check-in: confirm the booking, assign a clean room (chosen or auto-picked), mark the ID as
 * seen (the document number is never stored — DPDP data minimisation) and send a WhatsApp welcome.
 */
export async function checkIn(actor: AuthContext, hotelId: Types.ObjectId, input: CheckInInput, req: Request) {
  if (!Types.ObjectId.isValid(input.bookingId)) throw notFound('Booking');
  const { hotel, today } = await hotelToday(hotelId);
  const b = await Booking.findOne({ _id: input.bookingId, hotelId }).lean();
  if (!b) throw notFound('Booking');
  if (b.status !== 'confirmed') throw conflictState(b, 'check in');
  if (b.checkIn > today)
    throw new AppError(409, 'CONFLICT', `This booking starts on ${b.checkIn}. Early check-in on an earlier date needs the booking dates changed first.`);
  if (b.checkOut <= today) throw new AppError(409, 'CONFLICT', 'This stay has already ended. Mark it as a no-show or contact the guest.');

  // Pick the room: the one requested if it fits, otherwise the first available room of this type.
  const room = input.roomId
    ? await Room.findOne({ _id: input.roomId, hotelId, roomTypeId: b.roomTypeId, isActive: true }).lean()
    : await Room.findOne({ hotelId, roomTypeId: b.roomTypeId, isActive: true, status: 'available' }).sort({ number: 1 }).lean();
  if (input.roomId && !room)
    throw new AppError(400, 'VALIDATION_ERROR', 'That room does not belong to this booking’s room type', [{ path: 'roomId', message: 'Choose another room' }]);
  if (!room) throw new AppError(409, 'CONFLICT', 'No clean room of this type is free right now. Mark a room as available or choose another.');

  const updated = await withTransaction(async (session) => {
    // Atomically claim the room so two desks can't give the same room to two guests.
    const claimed = await Room.findOneAndUpdate(
      { _id: room!._id, status: { $in: ['available', 'cleaning'] } },
      { $set: { status: 'occupied' } },
      { new: true, session },
    ).lean();
    if (!claimed) throw new AppError(409, 'CONFLICT', `Room ${room!.number} was just taken. Pick another room.`);
    const next = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'confirmed' },
      { $set: { status: 'checked_in', checkedInAt: new Date(), roomId: claimed._id, roomNumber: claimed.number } },
      { new: true, session },
    ).lean();
    if (!next) {
      await Room.updateOne({ _id: claimed._id }, { $set: { status: room!.status } }, { session });
      throw conflictState(b, 'check in');
    }
    if (input.idVerified) {
      await Guest.updateOne(
        { _id: b.guestId },
        {
          $set: {
            'idVerification.verified': true,
            'idVerification.docType': input.idDocType ?? 'other',
            'idVerification.verifiedAt': new Date(),
            'idVerification.verifiedBy': actor.userId,
          },
        },
        { session },
      );
    }
    if (input.sendWelcome !== false) {
      await enqueue(
        {
          hotelId,
          channel: 'whatsapp',
          fallbackChannel: 'sms',
          to: b.guestSnapshot.phoneE164,
          template: 'checkin_welcome',
          // Template "checkin_welcome": {{1}} hotel, {{2}} first name, {{3}} room, {{4}} check-out time and date.
          templateParams: [hotel.name, b.guestSnapshot.name.split(' ')[0] || b.guestSnapshot.name, claimed.number, `${hotel.checkOutTime} on ${b.checkOut}`],
          body: `Welcome to ${hotel.name}, ${b.guestSnapshot.name.split(' ')[0]}! 🙏 You're in room ${claimed.number}. Check-out is by ${hotel.checkOutTime} on ${b.checkOut}. Message us here anytime for towels, food, late checkout or anything else.`,
          relatedEntity: { type: 'Booking', id: b._id },
        },
        session,
      );
    }
    return next;
  });

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'stay.checked_in',
    entity: { type: 'Booking', id: b._id },
    metadata: { roomNumber: updated.roomNumber, idVerified: Boolean(input.idVerified) },
    req,
  });
  const guest = await Guest.findById(b.guestId).select('stats.completedStays idVerification.verified').lean();
  return rosterItem(updated, guest);
}

export interface CheckOutInput {
  bookingId: string;
  /** Pay-at-hotel balance collected at the desk. */
  paymentCollected?: boolean | undefined;
}

/**
 * Check-out: stay counted on the guest profile (this is what makes them a "returning guest"), room sent to
 * housekeeping, and — for an early departure — unused future nights released back to sale.
 */
export async function checkOut(actor: AuthContext, hotelId: Types.ObjectId, input: CheckOutInput, req: Request) {
  if (!Types.ObjectId.isValid(input.bookingId)) throw notFound('Booking');
  const { today } = await hotelToday(hotelId);
  const b = await Booking.findOne({ _id: input.bookingId, hotelId }).lean();
  if (!b) throw notFound('Booking');
  if (b.status !== 'checked_in') throw conflictState(b, 'check out');
  if (b.paymentStatus === 'pay_at_hotel' && !input.paymentCollected) {
    throw new AppError(409, 'CONFLICT', `Collect the balance of ${formatINR(b.amounts.totalPaise)} (pay at hotel) before checking out, then confirm it here.`);
  }

  const releasedNights = stayNights(b.checkIn, b.checkOut).filter((d) => d > today);
  const updated = await withTransaction(async (session) => {
    const next = await Booking.findOneAndUpdate(
      { _id: b._id, status: 'checked_in' },
      { $set: { status: 'checked_out', checkedOutAt: new Date(), ...(input.paymentCollected ? { paymentStatus: 'paid' } : {}) } },
      { new: true, session },
    ).lean();
    if (!next) throw conflictState(b, 'check out');
    if (releasedNights.length) await adjust(hotelId, b.roomTypeId, releasedNights, { sold: -b.quantity }, session);
    if (b.roomId) await Room.updateOne({ _id: b.roomId, hotelId }, { $set: { status: 'cleaning' } }, { session });
    const guest = await Guest.findById(b.guestId)
      .select('stats.firstStayAt')
      .session(session ?? null)
      .lean();
    await Guest.updateOne(
      { _id: b.guestId },
      {
        $inc: { 'stats.completedStays': 1 },
        $set: { 'stats.lastStayAt': b.checkIn, ...(guest?.stats.firstStayAt ? {} : { 'stats.firstStayAt': b.checkIn }) },
      },
      { session },
    );
    return next;
  });

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'stay.checked_out',
    entity: { type: 'Booking', id: b._id },
    metadata: { earlyDepartureNightsReleased: releasedNights.length, paymentCollected: Boolean(input.paymentCollected) },
    req,
  });
  const guest = await Guest.findById(b.guestId).select('stats.completedStays idVerification.verified').lean();
  return rosterItem(updated, guest);
}

/** Booking-level desk search: reference, room number, guest name or phone. */
export async function findForDesk(hotelId: Types.ObjectId, q: string) {
  const { today } = await hotelToday(hotelId);
  const trimmed = q.trim();
  const digits = trimmed.replace(/\D/g, '');
  const or: Record<string, unknown>[] = [{ 'guestSnapshot.name': new RegExp(escapeRegex(trimmed), 'i') }, { roomNumber: trimmed }];
  if (/^BMS-?/i.test(trimmed)) or.push({ reference: trimmed.toUpperCase().replace(/^BMS-?/, 'BMS-') });
  if (digits.length >= 4) or.push({ 'guestSnapshot.phoneE164': new RegExp(`${digits}$`) });
  const bookings = await Booking.find({ hotelId, status: { $in: ['confirmed', 'checked_in'] }, checkOut: { $gte: today }, $or: or })
    .sort({ checkIn: 1 })
    .limit(10)
    .lean();
  const guests = await Guest.find({ _id: { $in: bookings.map((b) => b.guestId) } })
    .select('stats.completedStays idVerification.verified')
    .lean();
  const gMap = new Map(guests.map((g) => [String(g._id), g]));
  return bookings.map((b) => rosterItem(b, gMap.get(String(b.guestId))));
}
