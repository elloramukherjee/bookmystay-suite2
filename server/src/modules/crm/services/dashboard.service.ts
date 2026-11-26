import type { Types } from 'mongoose';
import { notFound } from '../../../shared/errors.js';
import type { AuthContext } from '../../../types/express.js';
import { addDays, diffDays, todayInTimeZone } from '../../../utils/dates.js';
import { percentOf } from '../../../utils/money.js';
import { Availability } from '../../availability/availability.model.js';
import { Booking } from '../../bookings/booking.model.js';
import { Guest } from '../../guests/guest.model.js';
import { SOURCE_LABEL } from '../../guests/guest.service.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { Room } from '../../rooms/room.model.js';
import { FollowUp } from '../models/followUp.model.js';
import { todayRoster } from './stay.service.js';

export const PERIODS = ['mtd', '30d', '90d', 'ytd', 'all'] as const;
export type Period = (typeof PERIODS)[number];

const STAY = ['confirmed', 'checked_in', 'checked_out'];
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

function periodRange(period: Period, today: string): { from: string; to: string } {
  switch (period) {
    case 'mtd':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'ytd':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'all':
      return { from: '2000-01-01', to: today };
  }
}

/**
 * Owner dashboard (Stitch screen 3). Definitions — every figure is derived from MongoDB:
 *  - A "stay" is a booking (confirmed / in-house / checked-out) whose check-in falls in the period.
 *  - Revenue = room revenue excluding GST (taxable amount); gross incl. GST is shown alongside.
 *  - Direct share = direct stays ÷ all stays (count) — the PRD's primary BookMyStay metric.
 *  - Commission saved = direct room revenue × the hotel's assumed OTA commission rate.
 *  - Repeat guest % = guests with a stay in the period who had stayed/booked before it ÷ distinct guests.
 *  - Occupancy = room-nights sold ÷ room-nights available, for nights in the period up to today.
 * Revenue figures require `finance.read`; others see operational numbers only.
 */
export async function getDashboard(actor: AuthContext, hotelId: Types.ObjectId, period: Period) {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  const today = todayInTimeZone(hotel.timezone);
  const { from, to } = periodRange(period, today);
  const rate = hotel.settings.otaCommissionRate;
  const finance = actor.permissions.has('finance.read');

  const stays = await Booking.find({ hotelId, status: { $in: STAY }, checkIn: { $gte: from, $lte: to } })
    .select('guestId source checkIn amounts.taxablePaise amounts.totalPaise quantity nights')
    .lean();

  // Channel mix
  const bySource = new Map<string, { count: number; revenuePaise: number }>();
  for (const s of stays) {
    const e = bySource.get(s.source) ?? { count: 0, revenuePaise: 0 };
    e.count++;
    e.revenuePaise += s.amounts.taxablePaise;
    bySource.set(s.source, e);
  }
  const direct = stays.filter((s) => s.source === 'direct');
  const ota = stays.filter((s) => s.source.startsWith('ota_'));
  const roomRevenue = stays.reduce((n, s) => n + s.amounts.taxablePaise, 0);
  const grossRevenue = stays.reduce((n, s) => n + s.amounts.totalPaise, 0);
  const directRevenue = direct.reduce((n, s) => n + s.amounts.taxablePaise, 0);
  const otaRevenue = ota.reduce((n, s) => n + s.amounts.taxablePaise, 0);

  // Repeat guests: had any earlier booking (any channel) before their first stay in this period.
  const guestIds = [...new Set(stays.map((s) => String(s.guestId)))];
  const firstInPeriod = new Map<string, string>();
  for (const s of stays) {
    const k = String(s.guestId);
    if (!firstInPeriod.has(k) || s.checkIn < firstInPeriod.get(k)!) firstInPeriod.set(k, s.checkIn);
  }
  const earliest = await Booking.aggregate<{ _id: Types.ObjectId; first: string }>([
    { $match: { hotelId, guestId: { $in: stays.map((s) => s.guestId) }, status: { $in: STAY } } },
    { $group: { _id: '$guestId', first: { $min: '$checkIn' } } },
  ]);
  const returning = earliest.filter((e) => e.first < (firstInPeriod.get(String(e._id)) ?? e.first)).length;

  // Occupancy over nights already lived (from → today, capped at "to").
  const lastNight = to < today ? to : today;
  const nights = diffDays(from, lastNight) + 1;
  const activeRooms = await Room.countDocuments({ hotelId, isActive: true });
  let occupancy: number | null = null;
  if (nights > 0 && activeRooms > 0 && period !== 'all') {
    const sold = await Availability.aggregate<{ n: number }>([
      { $match: { hotelId, date: { $gte: from, $lte: lastNight } } },
      { $group: { _id: null, n: { $sum: '$sold' } } },
    ]);
    occupancy = pct(sold[0]?.n ?? 0, activeRooms * nights);
  }

  // Contacts & the OTA → direct migration funnel (all-time).
  const [contacts, consented, withEmail, otaGuests] = await Promise.all([
    Guest.countDocuments({ hotelId, 'privacy.anonymisedAt': null }),
    Guest.countDocuments({ hotelId, 'consent.marketing.granted': true, 'consent.marketing.withdrawnAt': null }),
    Guest.countDocuments({ hotelId, email: { $ne: null } }),
    Guest.find({ hotelId, 'stats.otaBookings': { $gte: 1 } })
      .select('consent.marketing stats.directBookings')
      .lean(),
  ]);
  const otaGuestIds = otaGuests.map((g) => g._id);
  const followedUp = await FollowUp.distinct('guestId', { hotelId, guestId: { $in: otaGuestIds }, status: { $in: ['sent_personally', 'sent_api'] } });

  const roster = await todayRoster(hotelId);

  // Revenue on the books for the next 7 days (forward-looking, useful for an owner on the move).
  const next7 = await Booking.find({ hotelId, status: { $in: ['confirmed', 'checked_in'] }, checkIn: { $gt: today, $lte: addDays(today, 7) } })
    .select('amounts.taxablePaise')
    .lean();

  const money = (v: number) => (finance ? v : null);
  return {
    period,
    from,
    to,
    asOf: today,
    otaCommissionRate: rate,
    stays: {
      total: stays.length,
      roomNights: stays.reduce((n, s) => n + s.nights * s.quantity, 0),
      direct: direct.length,
      ota: ota.length,
      other: stays.length - direct.length - ota.length,
      directSharePercent: pct(direct.length, stays.length),
      otaSharePercent: pct(ota.length, stays.length),
      channelMix: [...bySource.entries()]
        .map(([source, v]) => ({
          source,
          label: SOURCE_LABEL[source] ?? source,
          count: v.count,
          revenuePaise: money(v.revenuePaise),
          percent: pct(v.count, stays.length),
        }))
        .sort((a, b) => b.count - a.count),
    },
    revenue: {
      roomRevenuePaise: money(roomRevenue),
      grossRevenuePaise: money(grossRevenue),
      directRevenuePaise: money(directRevenue),
      otaRevenuePaise: money(otaRevenue),
      directRevenueSharePercent: finance ? pct(directRevenue, roomRevenue) : null,
      commissionSavedPaise: money(percentOf(directRevenue, rate)),
      /** What the OTA stays in this period are estimated to have cost in commission. */
      commissionPaidEstimatePaise: money(percentOf(otaRevenue, rate)),
      next7DaysOnBooksPaise: money(next7.reduce((n, b) => n + b.amounts.taxablePaise, 0)),
    },
    guests: {
      distinct: guestIds.length,
      returning,
      repeatGuestPercent: pct(returning, guestIds.length),
    },
    occupancyPercent: occupancy,
    today: roster.counts,
    contacts: { total: contacts, marketingConsent: consented, withEmail },
    funnel: {
      otaGuests: otaGuests.length,
      contactCaptured: otaGuests.length, // phone is captured for every guest record by design
      marketingConsent: otaGuests.filter((g) => g.consent.marketing?.granted && !g.consent.marketing?.withdrawnAt).length,
      followedUp: followedUp.length,
      convertedToDirect: otaGuests.filter((g) => g.stats.directBookings >= 1).length,
    },
    financeVisible: finance,
  };
}
