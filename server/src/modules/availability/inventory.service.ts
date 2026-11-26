import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, notFound } from '../../shared/errors.js';
import { addDays, stayNights, todayInTimeZone } from '../../utils/dates.js';
import type { AuthContext } from '../../types/express.js';
import { quoteStay } from '../bookings/pricing.service.js';
import { Hotel, type HotelLean } from '../hotels/hotel.model.js';
import { RatePlan } from '../rooms/ratePlan.model.js';
import { RoomType, type RoomTypeLean } from '../rooms/roomType.model.js';
import { Availability } from './availability.model.js';
import { ensureNights, freeRooms, loadNights, nightlyRate } from './availability.service.js';
import { assertBookableStay, fitsOccupancy } from './stay.validation.js';

export interface SearchInput {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  promoCode?: string | undefined;
}

export async function getActiveHotel(hotelId: string | Types.ObjectId): Promise<HotelLean> {
  if (!Types.ObjectId.isValid(String(hotelId))) throw notFound('Hotel');
  const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).lean();
  if (!hotel) throw notFound('Hotel');
  if (!hotel.modules.booking) throw new AppError(403, 'FORBIDDEN', 'Online booking is not enabled for this property');
  return hotel;
}

/**
 * Public live availability + server-computed price for each room type. Prices returned here are for
 * display; the booking endpoint recomputes everything and never accepts a client price.
 */
export async function searchAvailability(input: SearchInput) {
  const hotel = await getActiveHotel(input.hotelId);
  const nightsCount = assertBookableStay(input.checkIn, input.checkOut, hotel.timezone);
  const dates = stayNights(input.checkIn, input.checkOut);

  const roomTypes = await RoomType.find({ hotelId: hotel._id, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
  const plans = await RatePlan.find({ hotelId: hotel._id, isActive: true }).sort({ isDefault: -1, adjustmentPaise: 1 }).lean();

  const results = [];
  for (const rt of roomTypes) {
    await ensureNights(hotel._id, rt, dates);
    const nights = await loadNights(hotel._id, rt._id, dates);
    const available = Math.min(...nights.map(freeRooms));
    const minStay = Math.max(...nights.map((n) => n.minStay));
    const fits = fitsOccupancy(rt, input.adults, input.children, input.rooms);

    let reason: string | null = null;
    if (!fits) reason = `Fits up to ${rt.maxOccupancy} guests per room`;
    else if (available < input.rooms) reason = available === 0 ? 'Sold out for these dates' : `Only ${available} left for these dates`;
    else if (nightsCount < minStay) reason = `Minimum stay is ${minStay} nights for these dates`;

    const rtPlans = plans.filter((p) => p.roomTypeId.equals(rt._id));
    const planOptions = (rtPlans.length ? rtPlans : [null]).map((plan) => {
      const nightly = nights.map((n) => ({ date: n.date, ratePaise: nightlyRate(n, rt) + (plan?.adjustmentPaise ?? 0) }));
      return {
        ratePlan: plan ? { id: String(plan._id), name: plan.name, code: plan.code, mealPlan: plan.mealPlan, refundable: plan.refundable } : null,
        quote: quoteStay({
          nightly,
          quantity: input.rooms,
          applyDirectDiscount: true,
          promoCode: input.promoCode,
          otaNightlyPaise: rt.otaRatePaise ? rt.otaRatePaise + (plan?.adjustmentPaise ?? 0) : null,
          settings: hotel.settings,
        }),
      };
    });

    results.push({
      roomType: toPublicRoomType(rt),
      available,
      bookable: reason === null,
      reason,
      ratePlans: planOptions,
    });
  }

  return {
    hotelId: String(hotel._id),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights: nightsCount,
    adults: input.adults,
    children: input.children,
    rooms: input.rooms,
    results,
  };
}

export function toPublicRoomType(rt: RoomTypeLean) {
  return {
    id: String(rt._id),
    name: rt.name,
    slug: rt.slug,
    description: rt.description,
    sizeSqft: rt.sizeSqft,
    maxAdults: rt.maxAdults,
    maxChildren: rt.maxChildren,
    maxOccupancy: rt.maxOccupancy,
    bedType: rt.bedType,
    view: rt.view,
    amenities: rt.amenities,
    photos: rt.photos,
    tags: rt.tags,
    directPrivilege: rt.directPrivilege,
    baseRatePaise: rt.baseRatePaise,
    otaRatePaise: rt.otaRatePaise,
  };
}

/** Staff calendar: one row per room type, one cell per night. */
export async function getCalendar(hotelId: Types.ObjectId, from: string | undefined, days: number) {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  const start = from ?? todayInTimeZone(hotel.timezone);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const roomTypes = await RoomType.find({ hotelId, isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();

  const rows = [];
  for (const rt of roomTypes) {
    await ensureNights(hotelId, rt, dates);
    const nights = await loadNights(hotelId, rt._id, dates);
    rows.push({
      roomType: { id: String(rt._id), name: rt.name, baseRatePaise: rt.baseRatePaise, totalRooms: rt.totalRooms },
      nights: nights.map((n) => ({
        date: n.date,
        totalRooms: n.totalRooms,
        sold: n.sold,
        held: n.held,
        blocked: n.blocked,
        available: freeRooms(n),
        ratePaise: nightlyRate(n, rt),
        rateOverridden: n.ratePaise !== null,
        stopSell: n.stopSell,
        minStay: n.minStay,
      })),
    });
  }
  return { from: start, days, dates, rows };
}

export interface BulkUpdateInput {
  roomTypeId: string;
  from: string;
  to: string;
  /** null clears an override back to the base rate. */
  ratePaise?: number | null | undefined;
  stopSell?: boolean | undefined;
  blocked?: number | undefined;
  minStay?: number | undefined;
  weekdays?: number[] | undefined;
}

/**
 * Owner updates rates / stop-sell / blocked rooms for a date range from their phone. Blocking rooms is
 * guarded per night so it can never push a night into overbooking; such nights are reported back.
 */
export async function bulkUpdate(actor: AuthContext, hotelId: Types.ObjectId, input: BulkUpdateInput, req: Request) {
  const rt = await RoomType.findOne({ _id: input.roomTypeId, hotelId }).lean();
  if (!rt) throw notFound('Room type');
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const today = todayInTimeZone(hotel?.timezone ?? 'Asia/Kolkata');
  if (input.from < today) throw new AppError(400, 'VALIDATION_ERROR', 'Past dates cannot be changed', [{ path: 'from', message: 'Choose today or later' }]);
  if (input.to < input.from) throw new AppError(400, 'VALIDATION_ERROR', 'End date must be on or after start date', [{ path: 'to', message: 'Invalid range' }]);

  let dates = stayNights(input.from, addDays(input.to, 1));
  if (dates.length > 366) throw new AppError(400, 'VALIDATION_ERROR', 'Update at most one year at a time');
  if (input.weekdays?.length) {
    const allowed = new Set(input.weekdays);
    dates = dates.filter((d) => allowed.has(new Date(`${d}T00:00:00Z`).getUTCDay()));
  }
  await ensureNights(hotelId, rt, dates);

  const $set: Record<string, unknown> = {};
  if (input.ratePaise !== undefined) $set.ratePaise = input.ratePaise;
  if (input.stopSell !== undefined) $set.stopSell = input.stopSell;
  if (input.minStay !== undefined) $set.minStay = input.minStay;
  if (Object.keys($set).length) {
    await Availability.updateMany({ hotelId, roomTypeId: rt._id, date: { $in: dates } }, { $set });
  }

  const conflicts: string[] = [];
  if (input.blocked !== undefined) {
    const blocked = input.blocked;
    for (const date of dates) {
      const res = await Availability.updateOne(
        { hotelId, roomTypeId: rt._id, date, $expr: { $lte: [{ $add: ['$sold', '$held', blocked] }, '$totalRooms'] } },
        { $set: { blocked } },
      );
      if (res.matchedCount === 0) conflicts.push(date);
    }
  }

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'availability.updated',
    entity: { type: 'RoomType', id: rt._id },
    metadata: {
      from: input.from,
      to: input.to,
      nights: dates.length,
      changes: { ...$set, ...(input.blocked !== undefined ? { blocked: input.blocked } : {}) },
      conflicts,
    },
    req,
  });
  return { updatedNights: dates.length - conflicts.length, conflicts };
}
