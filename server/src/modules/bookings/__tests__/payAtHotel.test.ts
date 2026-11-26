import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env, loadEnv } from '../../../config/env.js';
import { bookingPayload, createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { Availability } from '../../availability/availability.model.js';
import { Guest } from '../../guests/guest.model.js';
import { Notification } from '../../notifications/notification.model.js';
import { Booking } from '../booking.model.js';
import { MAX_OPEN_PAY_AT_HOTEL } from '../booking.service.js';

useTestDatabase();

const original = env.PAYMENT_PROVIDER;
beforeAll(() => {
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'pay_at_hotel';
});
afterAll(() => {
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = original;
});

const nights = async (roomTypeId: unknown) =>
  (await Availability.find({ roomTypeId }).sort({ date: 1 }).lean()).map((n) => ({ date: n.date, held: n.held, sold: n.sold }));

describe('pay at hotel only mode', () => {
  it('is allowed in production without any payment gateway keys', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb+srv://cluster.example.net/bookmystay',
        JWT_ACCESS_SECRET: 'Zr8kQ2vN7xLp4sW1yT6bH3mJ9cF5dG0aE2uR8iO4nV7',
        JWT_REFRESH_SECRET: 'Yq7jP1uM6wKo3rV0xS5aG2lI8bE4cF9dH1tN6zQ3mB0',
        IP_HASH_SALT: 'k3J9xQ2mV8pL',
        CLIENT_URL: 'https://stay.heritagecourtyard.in',
        PAYMENT_PROVIDER: 'pay_at_hotel',
      }),
    ).not.toThrow();
  });

  it('tells the booking page there is no payment step', async () => {
    const hotel = await createHotel();
    const res = await api().get(`/api/v1/hotels/${hotel.slug}`);
    expect(res.body.data.paymentMode).toBe('pay_at_hotel');
  });

  it('confirms a website booking immediately: rooms sold, guest counted, confirmation queued with the amount due', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const { booking } = await createBookingViaApi(hotel._id, rt._id);

    expect(booking).toMatchObject({ status: 'confirmed', paymentStatus: 'pay_at_hotel', holdExpiresAt: null });
    expect(await nights(rt._id)).toEqual([
      { date: dayFromNow(10), held: 0, sold: 1 },
      { date: dayFromNow(11), held: 0, sold: 1 },
    ]);
    const saved = await Booking.findById(booking.id).lean();
    expect(saved).toMatchObject({ inventoryState: 'sold' });
    expect((await Guest.findById(saved!.guestId).lean())!.stats.totalBookings).toBe(1);
    const confirmation = await Notification.findOne({ template: 'booking_confirmed' }).lean();
    expect(confirmation!.body).toContain('Amount due at hotel');
  });

  it('a retried request (same Idempotency-Key) returns the same booking and sends one confirmation', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const payload = bookingPayload(hotel._id, rt._id);
    const first = await api().post('/api/v1/bookings').set('Idempotency-Key', 'retry-key-123456').send(payload);
    const again = await api().post('/api/v1/bookings').set('Idempotency-Key', 'retry-key-123456').send(payload);
    expect(again.body.data.booking.id).toBe(first.body.data.booking.id);
    expect(again.body.data.booking.status).toBe('confirmed');
    expect(await Notification.countDocuments({ template: 'booking_confirmed' })).toBe(1);
    expect((await nights(rt._id))[0]!.sold).toBe(1);
  });

  it('online payment is refused politely and the gateway webhook does not exist', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);
    const pay = await api().post('/api/v1/payments/create').set('X-Guest-Token', guestToken).send({ bookingId: booking.id, method: 'upi' });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe('ONLINE_PAYMENTS_DISABLED');
    expect((await api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').send('{}')).status).toBe(404);
  });

  it(`caps one phone number at ${MAX_OPEN_PAY_AT_HOTEL} upcoming unpaid bookings so fake bookings can't block the property`, async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 10);
    for (let i = 0; i < MAX_OPEN_PAY_AT_HOTEL; i++) await createBookingViaApi(hotel._id, rt._id);
    const blocked = await api().post('/api/v1/bookings').send(bookingPayload(hotel._id, rt._id));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('TOO_MANY_UNPAID_BOOKINGS');
    // Another guest is unaffected.
    await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Priya Nair', phone: '9811100002' } });
  });
});

describe('no-show', () => {
  async function setup() {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const desk = await createUser('front_desk', hotel._id);
    const auth = { Authorization: `Bearer ${(await loginAs(desk.email)).token}` };
    return { hotel, rt, auth };
  }

  it('frees tonight and later nights for a guest who never arrived', async () => {
    const { hotel, rt, auth } = await setup();
    const { booking } = await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(0), checkOut: dayFromNow(2) });
    const res = await api().post(`/api/v1/bookings/${booking.id}/no-show`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('no_show');
    expect(await nights(rt._id)).toEqual([
      { date: dayFromNow(0), held: 0, sold: 0 },
      { date: dayFromNow(1), held: 0, sold: 0 },
    ]);
    // Rooms can be sold again tonight.
    await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(0), checkOut: dayFromNow(1), guest: { name: 'Walk In', phone: '9811100003' } });
    // Doing it twice is a conflict, not a double release.
    expect((await api().post(`/api/v1/bookings/${booking.id}/no-show`).set(auth)).status).toBe(409);
  });

  it('only from the check-in day, only for your property, only for staff', async () => {
    const { hotel, rt, auth } = await setup();
    const { booking: future } = await createBookingViaApi(hotel._id, rt._id);
    const early = await api().post(`/api/v1/bookings/${future.id}/no-show`).set(auth);
    expect(early.status).toBe(409);
    expect(early.body.error.message).toContain('Cancel the booking instead');

    const other = await setup();
    expect((await api().post(`/api/v1/bookings/${future.id}/no-show`).set(other.auth)).status).toBe(404);
    expect((await api().post(`/api/v1/bookings/${future.id}/no-show`)).status).toBe(401);
  });
});
