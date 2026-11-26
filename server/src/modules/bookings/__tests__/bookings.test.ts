import { describe, expect, it } from 'vitest';
import { bookingPayload, createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { Availability } from '../../availability/availability.model.js';
import { Guest } from '../../guests/guest.model.js';
import { Booking } from '../booking.model.js';
import { expireStaleHolds } from '../booking.service.js';

useTestDatabase();

async function nightsOf(roomTypeId: unknown) {
  return Availability.find({ roomTypeId }).sort({ date: 1 }).lean();
}

describe('GET /availability (public search)', () => {
  it('returns live availability and a server-computed quote with GST and OTA comparison', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 3);
    const res = await api()
      .get('/api/v1/availability')
      .query({ hotelId: String(hotel._id), checkIn: dayFromNow(5), checkOut: dayFromNow(7), adults: 2 });

    expect(res.status).toBe(200);
    const [result] = res.body.data.results;
    expect(result.roomType.id).toBe(String(rt._id));
    expect(result.available).toBe(3);
    expect(result.bookable).toBe(true);
    const { quote } = result.ratePlans[0];
    expect(quote).toMatchObject({ subtotalPaise: 960_000, directDiscountPaise: 96_000, taxPaise: 43_200, totalPaise: 907_200, otaEquivalentPaise: 1_239_000 });
  });

  it('rejects past dates, inverted ranges and over-long stays', async () => {
    const hotel = await createHotel();
    await createRoomTypeWithUnits(hotel._id);
    const q = (checkIn: string, checkOut: string) =>
      api()
        .get('/api/v1/availability')
        .query({ hotelId: String(hotel._id), checkIn, checkOut });
    expect((await q(dayFromNow(-1), dayFromNow(1))).status).toBe(400);
    expect((await q(dayFromNow(5), dayFromNow(5))).status).toBe(400);
    expect((await q(dayFromNow(1), dayFromNow(40))).status).toBe(400);
    expect((await q('2026-02-30', dayFromNow(2))).status).toBe(400);
  });

  it('flags room types that cannot fit the party', async () => {
    const hotel = await createHotel();
    await createRoomTypeWithUnits(hotel._id, 2);
    const res = await api()
      .get('/api/v1/availability')
      .query({ hotelId: String(hotel._id), checkIn: dayFromNow(5), checkOut: dayFromNow(6), adults: 5 });
    expect(res.body.data.results[0]).toMatchObject({ bookable: false, reason: expect.stringMatching(/Fits up to/) });
  });
});

describe('POST /bookings (direct booking)', () => {
  it('creates a pending booking, holds inventory, and creates/updates the guest by normalised phone', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);

    expect(booking).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid', nights: 2, reference: expect.stringMatching(/^BMS-[A-Z0-9]{6}$/) });
    expect(booking.amounts.totalPaise).toBe(907_200);
    expect(booking.guest.phoneMasked).toBe('+91•••••34567');
    expect(guestToken).toEqual(expect.any(String));
    expect((await nightsOf(rt._id)).map((n) => n.held)).toEqual([1, 1]);

    // Same guest, phone typed differently → same profile (cross-module identity).
    await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Rajesh K', phone: '+91-9811234567' }, checkIn: dayFromNow(20), checkOut: dayFromNow(21) });
    const guests = await Guest.find({ hotelId: hotel._id }).lean();
    expect(guests).toHaveLength(1);
    expect(guests[0]!.phoneE164).toBe('+919811234567');
  });

  it('never accepts a client-supplied price', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id);
    const res = await api()
      .post('/api/v1/bookings')
      .send({ ...bookingPayload(hotel._id, rt._id), totalPaise: 100 });
    expect(res.status).toBe(400);
  });

  it('requires transactional consent and a valid phone', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id);
    expect(
      (
        await api()
          .post('/api/v1/bookings')
          .send(bookingPayload(hotel._id, rt._id, { consent: { transactional: false, marketing: false } }))
      ).status,
    ).toBe(400);
    const badPhone = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload(hotel._id, rt._id, { guest: { name: 'Asha', phone: '12345678' } }));
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error.details[0].path).toBe('guest.phone');
  });

  it('prevents double booking of the last room under concurrency', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api()
          .post('/api/v1/bookings')
          .send(bookingPayload(hotel._id, rt._id, { guest: { name: `Guest ${i}`, phone: `98111000${String(i).padStart(2, '0')}` } })),
      ),
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect(attempts.find((r) => r.status === 409)!.body.error.code).toBe('ROOM_UNAVAILABLE');
    expect((await nightsOf(rt._id)).map((n) => n.held)).toEqual([1, 1]);
    expect(await Booking.countDocuments()).toBe(1);
  });

  it('rejects overlapping stays only on the nights that are full', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(10), checkOut: dayFromNow(12) });
    const overlap = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload(hotel._id, rt._id, { checkIn: dayFromNow(11), checkOut: dayFromNow(13) }));
    expect(overlap.status).toBe(409);
    // Back-to-back stay (check-in on the previous check-out day) is fine.
    const backToBack = await api()
      .post('/api/v1/bookings')
      .send(bookingPayload(hotel._id, rt._id, { checkIn: dayFromNow(12), checkOut: dayFromNow(14) }));
    expect(backToBack.status).toBe(201);
    // The failed overlap must not leak held inventory on night 12.
    const nights = await nightsOf(rt._id);
    expect(nights.find((n) => n.date === dayFromNow(12))!.held).toBe(1);
  });

  it('is idempotent per Idempotency-Key', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 3);
    const key = 'checkout-attempt-0123456789';
    const first = await api().post('/api/v1/bookings').set('Idempotency-Key', key).send(bookingPayload(hotel._id, rt._id));
    const replay = await api().post('/api/v1/bookings').set('Idempotency-Key', key).send(bookingPayload(hotel._id, rt._id));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.booking.reference).toBe(first.body.data.booking.reference);
    expect((await nightsOf(rt._id))[0]!.held).toBe(1);
  });

  it('expires unpaid holds and releases inventory', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking } = await createBookingViaApi(hotel._id, rt._id);
    await Booking.updateOne({ _id: booking.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });

    expect(await expireStaleHolds()).toBe(1);
    expect(await expireStaleHolds()).toBe(0); // idempotent
    expect((await Booking.findById(booking.id).lean())!.status).toBe('expired');
    expect((await nightsOf(rt._id)).every((n) => n.held === 0)).toBe(true);

    // Room is sellable again.
    expect(
      (
        await api()
          .post('/api/v1/bookings')
          .send(bookingPayload(hotel._id, rt._id, { guest: { name: 'Next Guest', phone: '9811100099' } }))
      ).status,
    ).toBe(201);
  });

  it('respects stop-sell and blocked rooms set by the owner', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);

    const stop = await api()
      .put('/api/v1/availability')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomTypeId: String(rt._id), from: dayFromNow(10), to: dayFromNow(10), stopSell: true });
    expect(stop.status).toBe(200);
    expect((await api().post('/api/v1/bookings').send(bookingPayload(hotel._id, rt._id))).status).toBe(409);

    await api()
      .put('/api/v1/availability')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomTypeId: String(rt._id), from: dayFromNow(10), to: dayFromNow(10), stopSell: false });
    await createBookingViaApi(hotel._id, rt._id);
    const block = await api()
      .put('/api/v1/availability')
      .set('Authorization', `Bearer ${token}`)
      .send({ roomTypeId: String(rt._id), from: dayFromNow(10), to: dayFromNow(11), blocked: 2 });
    // 1 room held + 2 blocked > 2 total → both nights refused, reported back.
    expect(block.body.data.conflicts).toEqual([dayFromNow(10), dayFromNow(11)]);
  });
});

describe('guest access with booking-scoped tokens', () => {
  it('lets a guest read only their own booking', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 3);
    const a = await createBookingViaApi(hotel._id, rt._id);
    const b = await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Priya', phone: '9433018274' } });

    expect((await api().get(`/api/v1/bookings/${a.booking.id}`).set('X-Guest-Token', a.guestToken)).status).toBe(200);
    expect((await api().get(`/api/v1/bookings/${b.booking.id}`).set('X-Guest-Token', a.guestToken)).status).toBe(404);
    expect((await api().get(`/api/v1/bookings/${a.booking.id}`)).status).toBe(401);
    expect((await api().get(`/api/v1/bookings/${a.booking.id}`).set('X-Guest-Token', 'forged.token.value')).status).toBe(401);
  });

  it('looks up a booking by reference + phone with a uniform failure', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id);
    const { booking } = await createBookingViaApi(hotel._id, rt._id);

    const ok = await api().post('/api/v1/bookings/lookup').send({ reference: booking.reference.toLowerCase(), phone: '+91 98112 34567' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.guestToken).toEqual(expect.any(String));

    const wrongPhone = await api().post('/api/v1/bookings/lookup').send({ reference: booking.reference, phone: '9811100000' });
    const wrongRef = await api().post('/api/v1/bookings/lookup').send({ reference: 'BMS-ZZZZZZ', phone: '9811234567' });
    expect(wrongPhone.status).toBe(404);
    expect(wrongRef.status).toBe(404);
    expect(wrongPhone.body.error.message).toBe(wrongRef.body.error.message);
  });

  it('lets a guest cancel inside the free window and frees the room', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);
    const res = await api().post(`/api/v1/bookings/${booking.id}/cancel`).set('X-Guest-Token', guestToken).send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect((await nightsOf(rt._id)).every((n) => n.held === 0)).toBe(true);
    expect((await api().post(`/api/v1/bookings/${booking.id}/cancel`).set('X-Guest-Token', guestToken).send({})).status).toBe(409);
  });
});

describe('staff booking management', () => {
  it('lists bookings for the staff member’s own hotel only', async () => {
    const hotelA = await createHotel();
    const hotelB = await createHotel();
    const rtA = await createRoomTypeWithUnits(hotelA._id, 2);
    const rtB = await createRoomTypeWithUnits(hotelB._id, 2);
    const a = await createBookingViaApi(hotelA._id, rtA._id);
    const b = await createBookingViaApi(hotelB._id, rtB._id);
    const fd = await createUser('front_desk', hotelA._id);
    const { token } = await loginAs(fd.email);

    const list = await api().get('/api/v1/bookings').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { reference: string }) => x.reference)).toEqual([a.booking.reference]);
    expect((await api().get(`/api/v1/bookings/${b.booking.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    // Front desk can view but not cancel.
    expect((await api().post(`/api/v1/bookings/${a.booking.id}/cancel`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(403);
    // Search by phone in any format.
    const byPhone = await api().get('/api/v1/bookings').query({ q: '98112 34567' }).set('Authorization', `Bearer ${token}`);
    expect(byPhone.body.data).toHaveLength(1);
  });

  it('records OTA bookings as sold inventory and counts them on the guest profile', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const mgr = await createUser('manager', hotel._id);
    const { token } = await loginAs(mgr.email);

    const res = await api()
      .post('/api/v1/bookings/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({
        roomTypeId: String(rt._id),
        checkIn: dayFromNow(3),
        checkOut: dayFromNow(5),
        adults: 2,
        source: 'ota_mmt',
        otaReference: 'MMT-889123',
        nightlyRatePaise: 520_000,
        guest: { name: 'Devendra Rathore', phone: '97245 33219' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'confirmed', paymentStatus: 'collected_by_ota', source: 'ota_mmt' });
    expect(res.body.data.amounts.directDiscountPaise).toBe(0);
    expect(res.body.data.amounts.subtotalPaise).toBe(1_040_000);
    expect((await nightsOf(rt._id)).map((n) => n.sold)).toEqual([1, 1]);
    const guest = await Guest.findOne({ phoneE164: '+919724533219' }).lean();
    expect(guest!.stats).toMatchObject({ totalBookings: 1, otaBookings: 1, directBookings: 0 });
  });

  it('confirms a pending booking as pay-at-hotel', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking } = await createBookingViaApi(hotel._id, rt._id);
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);

    const res = await api().post(`/api/v1/bookings/${booking.id}/confirm`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'confirmed', paymentStatus: 'pay_at_hotel' });
    expect((await nightsOf(rt._id)).map((n) => [n.held, n.sold])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
});
