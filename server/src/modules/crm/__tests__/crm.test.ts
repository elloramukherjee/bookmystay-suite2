import type { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { upsertGuest } from '../../../shared/guestIdentity.js';
import { Availability } from '../../availability/availability.model.js';
import { Booking } from '../../bookings/booking.model.js';
import { generateReference } from '../../bookings/booking.service.js';
import { quoteStay } from '../../bookings/pricing.service.js';
import { Conversation } from '../../chatbot/models/conversation.model.js';
import { Guest } from '../../guests/guest.model.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { Notification } from '../../notifications/notification.model.js';
import { Room } from '../../rooms/room.model.js';
import { MessageTemplate } from '../models/messageTemplate.model.js';

useTestDatabase();

async function setup() {
  const hotel = await createHotel();
  const rt = await createRoomTypeWithUnits(hotel._id, 3);
  const owner = await createUser('owner', hotel._id);
  const mgr = await createUser('manager', hotel._id);
  const fd = await createUser('front_desk', hotel._id);
  return {
    hotel,
    rt,
    ownerToken: (await loginAs(owner.email)).token,
    mgrToken: (await loginAs(mgr.email)).token,
    fdToken: (await loginAs(fd.email)).token,
  };
}

/** A direct booking arriving today, confirmed as pay-at-hotel. */
async function arrivingToday(hotelId: Types.ObjectId, rtId: Types.ObjectId, ownerToken: string, phone = '98112 34567', nights = 2) {
  const { booking } = await createBookingViaApi(hotelId, rtId, {
    checkIn: dayFromNow(0),
    checkOut: dayFromNow(nights),
    guest: { name: 'Rajesh Kumar', phone },
  });
  await api().post(`/api/v1/bookings/${booking.id}/confirm`).set('Authorization', `Bearer ${ownerToken}`);
  return booking.id as string;
}

/** A past, completed stay inserted directly (the API correctly refuses to create stays in the past). */
async function pastStay(hotelId: Types.ObjectId, rtId: Types.ObjectId, phone: string, name: string, source: 'direct' | 'ota_mmt', daysAgo: number) {
  const guest = await upsertGuest({ hotelId, phone, name, source });
  const hotel = (await Hotel.findById(hotelId).lean())!;
  const checkIn = dayFromNow(-daysAgo);
  const amounts = quoteStay({
    nightly: [{ date: checkIn, ratePaise: 480_000 }],
    quantity: 1,
    applyDirectDiscount: source === 'direct',
    otaNightlyPaise: null,
    settings: hotel.settings,
  });
  await Booking.create({
    hotelId,
    reference: generateReference(),
    guestId: guest._id,
    guestSnapshot: { name, phoneE164: guest.phoneE164, email: null },
    roomTypeId: rtId,
    roomTypeName: 'Deluxe',
    quantity: 1,
    adults: 2,
    children: 0,
    checkIn,
    checkOut: dayFromNow(-daysAgo + 1),
    nights: 1,
    source,
    status: 'checked_out',
    paymentStatus: 'paid',
    amounts,
    inventoryState: 'sold',
    checkedInAt: new Date(),
    checkedOutAt: new Date(),
  });
  await Guest.updateOne(
    { _id: guest._id },
    { $inc: { 'stats.completedStays': 1, 'stats.totalBookings': 1, [`stats.${source === 'direct' ? 'directBookings' : 'otaBookings'}`]: 1 } },
  );
  return guest;
}

describe('quick check-in / check-out', () => {
  it('checks in with an auto-assigned room, records ID seen, and sends a welcome', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const bookingId = await arrivingToday(hotel._id, rt._id, ownerToken);

    const today = await api().get('/api/v1/crm/today').set('Authorization', `Bearer ${fdToken}`);
    expect(today.body.data.arrivals.map((a: { bookingId: string }) => a.bookingId)).toEqual([bookingId]);

    const res = await api().post('/api/v1/crm/check-in').set('Authorization', `Bearer ${fdToken}`).send({ bookingId, idVerified: true, idDocType: 'aadhaar' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'checked_in', roomNumber: expect.any(String), idVerified: true });
    const room = await Room.findOne({ number: res.body.data.roomNumber }).lean();
    expect(room!.status).toBe('occupied');
    expect(await Notification.countDocuments({ template: 'checkin_welcome' })).toBe(1);
    const guest = await Guest.findById(res.body.data.guestId).lean();
    expect(guest!.idVerification).toMatchObject({ verified: true, docType: 'aadhaar' });

    expect((await api().post('/api/v1/crm/check-in').set('Authorization', `Bearer ${fdToken}`).send({ bookingId })).status).toBe(409);
  });

  it('refuses to give the same room to two guests and to check in future bookings', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const a = await arrivingToday(hotel._id, rt._id, ownerToken, '9811100001');
    const b = await arrivingToday(hotel._id, rt._id, ownerToken, '9811100002');
    const room = await Room.findOne({ roomTypeId: rt._id }).lean();

    expect(
      (
        await api()
          .post('/api/v1/crm/check-in')
          .set('Authorization', `Bearer ${fdToken}`)
          .send({ bookingId: a, roomId: String(room!._id) })
      ).status,
    ).toBe(200);
    const clash = await api()
      .post('/api/v1/crm/check-in')
      .set('Authorization', `Bearer ${fdToken}`)
      .send({ bookingId: b, roomId: String(room!._id) });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toMatch(/just taken/);

    const { booking: future } = await createBookingViaApi(hotel._id, rt._id, {
      checkIn: dayFromNow(5),
      checkOut: dayFromNow(6),
      guest: { name: 'Later', phone: '9811100003' },
    });
    await api().post(`/api/v1/bookings/${future.id}/confirm`).set('Authorization', `Bearer ${ownerToken}`);
    expect((await api().post('/api/v1/crm/check-in').set('Authorization', `Bearer ${fdToken}`).send({ bookingId: future.id })).status).toBe(409);
  });

  it('checks out: collects pay-at-hotel balance, counts the stay, sends the room to cleaning, releases unused nights', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const bookingId = await arrivingToday(hotel._id, rt._id, ownerToken, '98112 34567', 3);
    const ci = await api().post('/api/v1/crm/check-in').set('Authorization', `Bearer ${fdToken}`).send({ bookingId });

    const unpaid = await api().post('/api/v1/crm/check-out').set('Authorization', `Bearer ${fdToken}`).send({ bookingId });
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.message).toMatch(/Collect the balance/);

    const res = await api().post('/api/v1/crm/check-out').set('Authorization', `Bearer ${fdToken}`).send({ bookingId, paymentCollected: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'checked_out', paymentStatus: 'paid', isReturning: true });
    expect((await Room.findOne({ number: ci.body.data.roomNumber }).lean())!.status).toBe('cleaning');
    const guest = await Guest.findById(res.body.data.guestId).lean();
    expect(guest!.stats).toMatchObject({ completedStays: 1, lastStayAt: dayFromNow(0), firstStayAt: dayFromNow(0) });
    // Early departure: tonight is still sold; the 2 future nights go back on sale.
    const nights = await Availability.find({ roomTypeId: rt._id }).sort({ date: 1 }).lean();
    expect(nights.map((n) => n.sold)).toEqual([1, 0, 0]);
  });

  it('recognises the guest as returning on their next booking (by phone, any format)', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const first = await arrivingToday(hotel._id, rt._id, ownerToken, '98112 34567', 1);
    await api().post('/api/v1/crm/check-in').set('Authorization', `Bearer ${fdToken}`).send({ bookingId: first });
    await api().post('/api/v1/crm/check-out').set('Authorization', `Bearer ${fdToken}`).send({ bookingId: first, paymentCollected: true });

    const { booking } = await createBookingViaApi(hotel._id, rt._id, {
      checkIn: dayFromNow(20),
      checkOut: dayFromNow(21),
      guest: { name: 'Rajesh K', phone: '+91-9811234567' },
    });
    // An unpaid hold is not a stay yet; confirm it (pay at hotel) so it counts.
    await api().post(`/api/v1/bookings/${booking.id}/confirm`).set('Authorization', `Bearer ${ownerToken}`);
    const staffView = await api().get(`/api/v1/bookings/${booking.id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(staffView.body.data.guest).toMatchObject({ isReturning: true });
    const ledger = await api().get('/api/v1/crm/guests?filter=returning').set('Authorization', `Bearer ${ownerToken}`);
    expect(ledger.body.data).toHaveLength(1);
    expect(ledger.body.data[0]).toMatchObject({ tier: { level: 'returning' }, stayPath: 'Direct ×2', nextStay: { checkIn: dayFromNow(20) } });
  });
});

describe('owner dashboard', () => {
  it('computes channel mix, commission saved, repeat guests and occupancy from bookings', async () => {
    const { hotel, rt, ownerToken, mgrToken } = await setup();
    // Returning guest: an earlier OTA stay, now booking direct.
    await pastStay(hotel._id, rt._id, '9811100009', 'Arjun Singhania', 'ota_mmt', 400);
    await arrivingToday(hotel._id, rt._id, ownerToken, '9811100009', 2);
    // One OTA stay this month.
    await api()
      .post('/api/v1/bookings/manual')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        roomTypeId: String(rt._id),
        checkIn: dayFromNow(0),
        checkOut: dayFromNow(1),
        adults: 2,
        source: 'ota_bookingcom',
        nightlyRatePaise: 500_000,
        guest: { name: 'Devendra', phone: '9724533219' },
        sendConfirmation: false,
      });

    const res = await api().get('/api/v1/crm/dashboard?period=mtd').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.stays).toMatchObject({ total: 2, direct: 1, ota: 1, directSharePercent: 50, otaSharePercent: 50 });
    // Direct: 2 nights × ₹4,800 − 10% = ₹8,640 taxable → 18% saved = ₹1,555.20
    expect(d.revenue).toMatchObject({
      directRevenuePaise: 864_000,
      otaRevenuePaise: 500_000,
      commissionSavedPaise: 155_520,
      commissionPaidEstimatePaise: 90_000,
    });
    expect(d.guests).toMatchObject({ distinct: 2, returning: 1, repeatGuestPercent: 50 });
    expect(d.today).toMatchObject({ checkInsToday: 2, totalRooms: 3 });
    expect(d.occupancyPercent).toEqual(expect.any(Number));
    expect(d.funnel).toMatchObject({ otaGuests: 2, convertedToDirect: 1 });
    expect(d.stays.channelMix.map((c: { label: string }) => c.label).sort()).toEqual(['Booking.com', 'Direct']);

    // Managers see operations but not money.
    const mgr = await api().get('/api/v1/crm/dashboard').set('Authorization', `Bearer ${mgrToken}`);
    expect(mgr.body.data.financeVisible).toBe(false);
    expect(mgr.body.data.revenue.commissionSavedPaise).toBeNull();
    expect(mgr.body.data.stays.channelMix.every((c: { revenuePaise: unknown }) => c.revenuePaise === null)).toBe(true);
    expect(mgr.body.data.stays.total).toBe(2);
  });

  it('is isolated per property', async () => {
    const { ownerToken } = await setup();
    const other = await createHotel();
    const otherRt = await createRoomTypeWithUnits(other._id, 2);
    await createBookingViaApi(other._id, otherRt._id);
    const res = await api().get('/api/v1/crm/dashboard').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.data.stays.total).toBe(0);
    expect(res.body.data.contacts.total).toBe(0);
  });
});

describe('guest register', () => {
  it('finds guests by phone in any format, name or booking reference', async () => {
    const { hotel, rt, ownerToken } = await setup();
    const { booking } = await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Priya Mukherjee', phone: '94330 18274' } });
    for (const q of ['+91 94330 18274', '9433018274', '18274', 'priya', booking.reference]) {
      const res = await api().get('/api/v1/guests').query({ q }).set('Authorization', `Bearer ${ownerToken}`);
      expect(
        res.body.data.map((g: { name: string }) => g.name),
        q,
      ).toEqual(['Priya Mukherjee']);
    }
  });

  it('front desk sees only guests relevant to the current window; owners see everyone', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const old = await pastStay(hotel._id, rt._id, '9811100077', 'Old Guest', 'direct', 200);
    await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(3), checkOut: dayFromNow(4), guest: { name: 'Soon Guest', phone: '9811100088' } });

    const fdList = await api().get('/api/v1/guests').set('Authorization', `Bearer ${fdToken}`);
    expect(fdList.body.data.map((g: { name: string }) => g.name)).toEqual(['Soon Guest']);
    expect((await api().get(`/api/v1/guests/${old._id}`).set('Authorization', `Bearer ${fdToken}`)).status).toBe(404);
    expect((await api().get(`/api/v1/crm/guests/${old._id}/history`).set('Authorization', `Bearer ${fdToken}`)).status).toBe(404);

    const ownerList = await api().get('/api/v1/guests').set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerList.body.data).toHaveLength(2);
  });

  it('records notes, preferences and consent changes; timeline includes bookings, chats and notes', async () => {
    const { hotel, rt, ownerToken } = await setup();
    const { booking } = await createBookingViaApi(hotel._id, rt._id, { consent: { transactional: true, marketing: true } });
    const guestId = String((await Booking.findById(booking.id).lean())!.guestId);
    await Conversation.create({
      hotelId: hotel._id,
      channel: 'web',
      channelUserId: 'web_1',
      guestId,
      guestName: 'Rajesh Kumar',
      messageCount: 2,
      lastMessagePreview: 'Is parking free?',
    });

    await api()
      .post(`/api/v1/guests/${guestId}/notes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ text: 'Celebrating anniversary', category: 'general' });
    const pref = await api()
      .put(`/api/v1/guests/${guestId}/preferences`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ category: 'room', key: 'Floor', value: 'Ground floor' });
    expect(pref.body.data.preferences[0]).toMatchObject({ key: 'Floor', value: 'Ground floor' });
    expect(pref.body.data.keyPreference).toBe('Floor: Ground floor');

    const withdrawn = await api().put(`/api/v1/guests/${guestId}`).set('Authorization', `Bearer ${ownerToken}`).send({ marketingConsent: false });
    expect(withdrawn.body.data.consent.marketing).toMatchObject({ granted: false, withdrawnAt: expect.any(String) });

    const history = await api().get(`/api/v1/crm/guests/${guestId}/history`).set('Authorization', `Bearer ${ownerToken}`);
    const kinds = history.body.data.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['booking', 'conversation', 'note']));
    expect(history.body.data.events.find((e: { kind: string }) => e.kind === 'conversation').detail).toBe('Is parking free?');
  });

  it('never creates a duplicate profile for the same phone', async () => {
    const { ownerToken } = await setup();
    expect((await api().post('/api/v1/guests').set('Authorization', `Bearer ${ownerToken}`).send({ phone: '98201 44552', name: 'Arjun' })).status).toBe(201);
    expect((await api().post('/api/v1/guests').set('Authorization', `Bearer ${ownerToken}`).send({ phone: '+919820144552', name: 'Arjun S' })).status).toBe(
      409,
    );
  });
});

describe('direct follow-up drafts', () => {
  it('drafts only for guests with marketing consent and re-checks consent before marking sent', async () => {
    const { hotel, rt, ownerToken, fdToken } = await setup();
    const yes = await pastStay(hotel._id, rt._id, '9811100011', 'Ananya Kulkarni', 'direct', 30);
    await Guest.updateOne({ _id: yes._id }, { $set: { 'consent.marketing': { granted: true, at: new Date(), source: 'booking', withdrawnAt: null } } });
    await pastStay(hotel._id, rt._id, '9811100012', 'No Consent', 'direct', 40);
    const template = await MessageTemplate.create({
      hotelId: hotel._id,
      name: 'Thanks',
      purpose: 'thank_you',
      body: 'Namaste {{firstName}}! Thank you for staying at {{hotelName}}. Code {{code}}',
      promoCode: 'DIRECTSTAY',
    });

    expect(
      (
        await api()
          .post('/api/v1/crm/drafts')
          .set('Authorization', `Bearer ${fdToken}`)
          .send({ templateId: String(template._id), audience: 'returning' })
      ).status,
    ).toBe(403);

    const res = await api()
      .post('/api/v1/crm/drafts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ templateId: String(template._id), audience: 'returning' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ drafted: 1, excludedNoConsent: 1 });
    expect(res.body.data.drafts[0].text).toBe('Namaste Ananya! Thank you for staying at Test Haveli. Code DIRECTSTAY');

    // Guest replies STOP before the owner sends → refused.
    await Guest.updateOne({ _id: yes._id }, { $set: { 'consent.marketing.withdrawnAt': new Date() } });
    expect((await api().post(`/api/v1/crm/drafts/${res.body.data.drafts[0].id}/sent`).set('Authorization', `Bearer ${ownerToken}`)).status).toBe(409);
  });

  it('marks a personal send and counts it in the OTA→direct funnel', async () => {
    const { hotel, rt, ownerToken } = await setup();
    const g = await pastStay(hotel._id, rt._id, '9811100021', 'Devendra Rathore', 'ota_mmt', 30);
    await Guest.updateOne({ _id: g._id }, { $set: { 'consent.marketing': { granted: true, at: new Date(), source: 'staff', withdrawnAt: null } } });
    const template = await MessageTemplate.create({ hotelId: hotel._id, name: 'Reunion', body: 'Namaste {{firstName}}, book direct next time!' });
    const drafts = await api()
      .post('/api/v1/crm/drafts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ templateId: String(template._id), audience: 'ota_only' });
    const sent = await api().post(`/api/v1/crm/drafts/${drafts.body.data.drafts[0].id}/sent`).set('Authorization', `Bearer ${ownerToken}`);
    expect(sent.body.data.status).toBe('sent_personally');
    expect((await api().post(`/api/v1/crm/drafts/${drafts.body.data.drafts[0].id}/sent`).set('Authorization', `Bearer ${ownerToken}`)).status).toBe(409);
    const dash = await api().get('/api/v1/crm/dashboard').set('Authorization', `Bearer ${ownerToken}`);
    expect(dash.body.data.funnel).toMatchObject({ otaGuests: 1, marketingConsent: 1, followedUp: 1, convertedToDirect: 0 });
  });
});
