import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { overrideTransactionSupport } from '../../../config/db.js';
import { bookingPayload, createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, useTestDatabase } from '../../../test/helpers.js';
import { Availability } from '../../availability/availability.model.js';
import { Booking } from '../booking.model.js';

useTestDatabase();

/**
 * Local development often runs MongoDB standalone (no transactions). Inventory must stay correct there
 * too, via guarded per-night updates plus compensation when a later night fails.
 */
describe('inventory safety without transactions', () => {
  beforeAll(() => overrideTransactionSupport(false));
  afterAll(() => overrideTransactionSupport(null));

  it('still allows exactly one booking for the last room under concurrency', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api()
          .post('/api/v1/bookings')
          .send(bookingPayload(hotel._id, rt._id, { guest: { name: `Guest ${i}`, phone: `98111000${String(i).padStart(2, '0')}` } })),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Booking.countDocuments()).toBe(1);
    const nights = await Availability.find({ roomTypeId: rt._id }).lean();
    expect(nights.map((n) => n.held)).toEqual([1, 1]);
  });

  it('compensates nights already taken when a later night is full', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(12), checkOut: dayFromNow(13) });
    // Nights 10 and 11 are free, night 12 is full → the whole request fails and 10/11 are released.
    const res = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload(hotel._id, rt._id, { checkIn: dayFromNow(10), checkOut: dayFromNow(13), guest: { name: 'Late', phone: '9811100077' } }));
    expect(res.status).toBe(409);
    const byDate = Object.fromEntries((await Availability.find({ roomTypeId: rt._id }).lean()).map((n) => [n.date, n.held]));
    expect(byDate[dayFromNow(10)]).toBe(0);
    expect(byDate[dayFromNow(11)]).toBe(0);
    expect(byDate[dayFromNow(12)]).toBe(1);
  });
});
