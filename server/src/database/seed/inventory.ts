import type { Types } from 'mongoose';
import { Availability } from '../../modules/availability/availability.model.js';
import { ensureNights } from '../../modules/availability/availability.service.js';
import { Booking } from '../../modules/bookings/booking.model.js';
import { generateReference } from '../../modules/bookings/booking.service.js';
import { quoteStay } from '../../modules/bookings/pricing.service.js';
import { Guest } from '../../modules/guests/guest.model.js';
import type { HotelLean } from '../../modules/hotels/hotel.model.js';
import { HotelPolicy } from '../../modules/hotels/hotelPolicy.model.js';
import { RatePlan } from '../../modules/rooms/ratePlan.model.js';
import { Room } from '../../modules/rooms/room.model.js';
import { RoomType } from '../../modules/rooms/roomType.model.js';
import { upsertGuest } from '../../shared/guestIdentity.js';
import { addDays, stayNights, todayInTimeZone } from '../../utils/dates.js';
import { percentOf } from '../../utils/money.js';
import { SEED_BOOKINGS, SEED_GUESTS, SEED_POLICIES, SEED_RATE_PLANS, SEED_ROOM_TYPES } from './data.js';

export async function seedRooms(hotelId: Types.ObjectId): Promise<void> {
  for (const { units, ...rt } of SEED_ROOM_TYPES) {
    const roomType = await RoomType.findOneAndUpdate(
      { hotelId, slug: rt.slug },
      { $set: { ...rt, hotelId, isActive: true }, $setOnInsert: { totalRooms: 0 } },
      { upsert: true, new: true, runValidators: true },
    );
    for (const number of units) {
      await Room.updateOne(
        { hotelId, number },
        { $setOnInsert: { hotelId, roomTypeId: roomType._id, number, floor: number.slice(0, 1) === '1' ? 'Ground' : `Level ${Number(number[0]) - 1}` } },
        { upsert: true },
      );
    }
    for (const plan of SEED_RATE_PLANS) {
      await RatePlan.updateOne(
        { hotelId, roomTypeId: roomType._id, code: plan.code },
        { $set: { ...plan, hotelId, roomTypeId: roomType._id, isActive: true } },
        { upsert: true },
      );
    }
    const count = await Room.countDocuments({ hotelId, roomTypeId: roomType._id, isActive: true });
    await RoomType.updateOne({ _id: roomType._id }, { $set: { totalRooms: count } });
    await Availability.updateMany({ hotelId, roomTypeId: roomType._id }, { $set: { totalRooms: count } });
  }
}

export async function seedPolicies(hotelId: Types.ObjectId): Promise<void> {
  for (const p of SEED_POLICIES) {
    await HotelPolicy.updateOne({ hotelId, type: p.type }, { $set: { ...p, hotelId, published: true } }, { upsert: true });
  }
}

/**
 * Sample guest history (past stays, in-house, arrivals today, future) so every screen has real data.
 * Inventory counters are incremented exactly as live bookings would, so availability stays consistent.
 * Skipped if the hotel already has bookings, so re-running the seed never duplicates them.
 */
export async function seedBookings(hotel: HotelLean): Promise<number> {
  if (await Booking.exists({ hotelId: hotel._id })) return 0;
  const today = todayInTimeZone(hotel.timezone);
  const guests = new Map<string, Types.ObjectId>();

  for (const g of SEED_GUESTS) {
    const doc = await upsertGuest({
      hotelId: hotel._id,
      phone: g.phone,
      name: g.name,
      email: g.email,
      source: 'direct',
      consent: { transactional: true, marketing: g.marketing },
    });
    await Guest.updateOne({ _id: doc._id }, { $set: { city: g.city } });
    guests.set(g.key, doc._id);
  }

  let created = 0;
  for (const s of SEED_BOOKINGS) {
    const roomType = await RoomType.findOne({ hotelId: hotel._id, slug: s.roomType }).lean();
    const guestId = guests.get(s.guest);
    const guestData = SEED_GUESTS.find((g) => g.key === s.guest);
    if (!roomType || !guestId || !guestData) continue;

    const checkIn = addDays(today, s.from);
    const checkOut = addDays(checkIn, s.nights);
    const dates = stayNights(checkIn, checkOut);
    const direct = s.source === 'direct';
    const amounts = quoteStay({
      nightly: dates.map((date) => ({ date, ratePaise: roomType.baseRatePaise })),
      quantity: 1,
      applyDirectDiscount: direct,
      otaNightlyPaise: direct ? roomType.otaRatePaise : null,
      settings: hotel.settings,
    });
    const room = s.room ? await Room.findOne({ hotelId: hotel._id, number: s.room }).lean() : null;
    const checkedIn = s.status === 'checked_in' || s.status === 'checked_out';
    const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);

    // Booked two weeks ahead, but never in the future (upcoming sample stays are booked "earlier today").
    const bookedAt = new Date(Math.min(at(addDays(checkIn, -14), '10:00').getTime(), Date.now() - 2 * 3_600_000));
    await Booking.create({
      hotelId: hotel._id,
      reference: generateReference(),
      guestId,
      guestSnapshot: { name: guestData.name, phoneE164: guestData.phone, email: guestData.email },
      roomTypeId: roomType._id,
      roomTypeName: roomType.name,
      quantity: 1,
      adults: s.adults,
      children: s.children ?? 0,
      checkIn,
      checkOut,
      nights: s.nights,
      source: s.source,
      otaReference: direct ? null : `${s.source.replace('ota_', '').toUpperCase()}-${Math.floor(100000 + Math.random() * 899999)}`,
      status: s.status,
      paymentStatus: direct ? 'paid' : 'collected_by_ota',
      amounts,
      inventoryState: 'sold',
      roomId: room?._id ?? null,
      roomNumber: room?.number ?? null,
      confirmedAt: bookedAt,
      checkedInAt: checkedIn ? at(checkIn, '13:20') : null,
      checkedOutAt: s.status === 'checked_out' ? at(checkOut, '10:45') : null,
      consentSnapshot: { transactional: true, marketing: guestData.marketing, noticeVersion: '2026-11' },
      createdAt: bookedAt,
    });

    await ensureNights(hotel._id, roomType, dates);
    await Availability.updateMany({ hotelId: hotel._id, roomTypeId: roomType._id, date: { $in: dates } }, { $inc: { sold: 1 } });

    const completed = s.status === 'checked_out';
    await Guest.updateOne(
      { _id: guestId },
      {
        $inc: {
          'stats.totalBookings': 1,
          'stats.directBookings': direct ? 1 : 0,
          'stats.otaBookings': direct ? 0 : 1,
          'stats.completedStays': completed ? 1 : 0,
          'stats.lifetimeValuePaise': amounts.totalPaise,
          'stats.commissionSavedPaise': direct ? percentOf(amounts.taxablePaise, hotel.settings.otaCommissionRate) : 0,
        },
      },
    );
    if (room && s.status === 'checked_in') await Room.updateOne({ _id: room._id }, { $set: { status: 'occupied' } });
    created++;
  }

  // First/last stay dates from actual stays (null-safe, unlike $min/$max against a null field).
  for (const guestId of guests.values()) {
    const stays = await Booking.find({ guestId, status: { $in: ['checked_in', 'checked_out'] } })
      .select('checkIn')
      .sort({ checkIn: 1 })
      .lean();
    if (stays.length) {
      await Guest.updateOne({ _id: guestId }, { $set: { 'stats.firstStayAt': stays[0]!.checkIn, 'stats.lastStayAt': stays[stays.length - 1]!.checkIn } });
    }
  }
  return created;
}
