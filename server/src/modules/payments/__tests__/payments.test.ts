import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { bookingPayload, createBookingViaApi, createRoomTypeWithUnits } from '../../../test/booking-fixtures.js';
import { api, createHotel, useTestDatabase } from '../../../test/helpers.js';
import { Availability } from '../../availability/availability.model.js';
import { Booking } from '../../bookings/booking.model.js';
import { expireStaleHolds } from '../../bookings/booking.service.js';
import { Guest } from '../../guests/guest.model.js';
import { Notification } from '../../notifications/notification.model.js';
import { processOutbox } from '../../notifications/notification.service.js';
import { MOCK_SIGNATURE_HEADER, MockPaymentProvider, signMockWebhook } from '../providers/mock.provider.js';
import { RazorpayProvider } from '../providers/razorpay.provider.js';

useTestDatabase();

afterEach(() => {
  MockPaymentProvider.failNextCreate = false;
});

async function startPayment(hotelId: Parameters<typeof createRoomTypeWithUnits>[0], units = 1) {
  const rt = await createRoomTypeWithUnits(hotelId, units);
  const { booking, guestToken } = await createBookingViaApi(hotelId, rt._id);
  const pay = await api().post('/api/v1/payments/create').set('X-Guest-Token', guestToken).send({ bookingId: booking.id, method: 'upi' });
  return { rt, booking, guestToken, pay };
}

describe('payments (mock provider through the real webhook pipeline)', () => {
  it('creates a UPI order flagged as dev mode', async () => {
    const hotel = await createHotel();
    const { pay } = await startPayment(hotel._id);
    expect(pay.status).toBe(201);
    expect(pay.body.data).toMatchObject({ status: 'created', method: 'upi', devMode: true, amountPaise: 907_200 });
    expect(pay.body.data.checkout.upiIntent).toMatch(/^upi:\/\/pay\?pa=dev-mock@notarealvpa/);
  });

  it('requires the guest token for that booking', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const a = await createBookingViaApi(hotel._id, rt._id);
    const b = await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Other', phone: '9811100001' } });
    expect((await api().post('/api/v1/payments/create').send({ bookingId: a.booking.id, method: 'upi' })).status).toBe(401);
    expect((await api().post('/api/v1/payments/create').set('X-Guest-Token', b.guestToken).send({ bookingId: a.booking.id, method: 'upi' })).status).toBe(404);
  });

  it('confirms the booking on a captured payment: held → sold, guest stats, WhatsApp confirmation queued', async () => {
    const hotel = await createHotel();
    const { rt, booking, guestToken, pay } = await startPayment(hotel._id);
    const sim = await api().post(`/api/v1/payments/${pay.body.data.id}/simulate`).set('X-Guest-Token', guestToken).send({ outcome: 'success' });

    expect(sim.status).toBe(200);
    expect(sim.body.data.result.status).toBe('confirmed');
    const saved = await Booking.findById(booking.id).lean();
    expect(saved).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', inventoryState: 'sold', holdExpiresAt: null });
    const nights = await Availability.find({ roomTypeId: rt._id }).lean();
    expect(nights.map((n) => [n.held, n.sold])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    const guest = await Guest.findById(saved!.guestId).lean();
    expect(guest!.stats).toMatchObject({ totalBookings: 1, directBookings: 1, lifetimeValuePaise: 907_200 });
    expect(guest!.stats.commissionSavedPaise).toBe(155_520); // 18% of ₹8,640 taxable

    const notes = await Notification.find({ 'relatedEntity.id': saved!._id }).lean();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ channel: 'whatsapp', fallbackChannel: 'sms', template: 'booking_confirmed', status: 'queued' });
    expect(notes[0]!.body).toContain(saved!.reference);

    // The dev outbox worker marks it "simulated" — never claims real delivery.
    await processOutbox();
    expect((await Notification.findById(notes[0]!._id).lean())!.status).toBe('simulated');

    const status = await api().get(`/api/v1/payments/${pay.body.data.id}/status`).set('X-Guest-Token', guestToken);
    expect(status.body.data).toMatchObject({ status: 'captured', booking: { status: 'confirmed' } });
  });

  it('treats a replayed webhook event as a no-op and rejects bad signatures', async () => {
    const hotel = await createHotel();
    const { pay } = await startPayment(hotel._id);
    const payment = pay.body.data;
    const order = (await import('../payment.model.js')).Payment;
    const { providerOrderId } = (await order.findById(payment.id).lean())!;
    const body = JSON.stringify({
      id: 'evt_fixed_1',
      event: 'payment.captured',
      orderId: providerOrderId,
      paymentId: 'pay_1',
      amountPaise: payment.amountPaise,
    });

    const first = await api()
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(MOCK_SIGNATURE_HEADER, signMockWebhook(body))
      .send(body);
    const replay = await api()
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(MOCK_SIGNATURE_HEADER, signMockWebhook(body))
      .send(body);
    expect(first.body.data.status).toBe('confirmed');
    expect(replay.body.data.status).toBe('duplicate');
    expect(await Notification.countDocuments({ template: 'booking_confirmed' })).toBe(1);

    const forged = await api().post('/api/v1/payments/webhook').set('Content-Type', 'application/json').set(MOCK_SIGNATURE_HEADER, 'deadbeef').send(body);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('refuses to confirm when the captured amount differs from the order', async () => {
    const hotel = await createHotel();
    const { booking, pay } = await startPayment(hotel._id);
    const { Payment } = await import('../payment.model.js');
    const { providerOrderId } = (await Payment.findById(pay.body.data.id).lean())!;
    const body = JSON.stringify({ id: 'evt_amt', event: 'payment.captured', orderId: providerOrderId, paymentId: 'pay_x', amountPaise: 100 });
    const res = await api()
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(MOCK_SIGNATURE_HEADER, signMockWebhook(body))
      .send(body);
    expect(res.body.data.status).toBe('amount_mismatch');
    const saved = await Booking.findById(booking.id).lean();
    expect(saved!.status).toBe('pending_payment');
    expect(saved!.needsAttention).toMatch(/does not match/);
  });

  it('keeps the booking and tells the guest when the gateway is down', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);
    MockPaymentProvider.failNextCreate = true;

    const res = await api().post('/api/v1/payments/create').set('X-Guest-Token', guestToken).send({ bookingId: booking.id, method: 'upi' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    const saved = await Booking.findById(booking.id).lean();
    expect(saved).toMatchObject({ status: 'pending_payment', paymentStatus: 'provider_unavailable', inventoryState: 'held' });
    expect(saved!.holdExpiresAt!.getTime()).toBeGreaterThan(new Date(booking.holdExpiresAt).getTime());
    expect(await Notification.countDocuments({ template: 'payment_link_pending' })).toBe(1);
  });

  it('honours a late payment if the room is still free, otherwise flags a refund', async () => {
    const hotel = await createHotel();
    const { rt, booking, guestToken, pay } = await startPayment(hotel._id, 1);
    await Booking.updateOne({ _id: booking.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await expireStaleHolds();

    // Someone else books the only room before the late payment lands.
    await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Faster Guest', phone: '9811100002' } });
    const sim = await api().post(`/api/v1/payments/${pay.body.data.id}/simulate`).set('X-Guest-Token', guestToken).send({ outcome: 'success' });
    expect(sim.body.data.result.status).toBe('not_confirmed:unavailable');
    const saved = await Booking.findById(booking.id).lean();
    expect(saved).toMatchObject({ status: 'expired', paymentStatus: 'refund_pending', refundDuePaise: 907_200 });
    expect(saved!.needsAttention).toMatch(/refund/i);
    // No overbooking.
    expect((await Availability.find({ roomTypeId: rt._id }).lean()).every((n) => n.sold + n.held <= n.totalRooms)).toBe(true);
  });

  it('confirms a late payment when the room is still available', async () => {
    const hotel = await createHotel();
    const { booking, guestToken, pay } = await startPayment(hotel._id, 2);
    await Booking.updateOne({ _id: booking.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    await expireStaleHolds();
    const sim = await api().post(`/api/v1/payments/${pay.body.data.id}/simulate`).set('X-Guest-Token', guestToken).send({ outcome: 'success' });
    expect(sim.body.data.result.status).toBe('confirmed');
    expect((await Booking.findById(booking.id).lean())!.status).toBe('confirmed');
  });

  it('leaves the booking payable after a failed payment', async () => {
    const hotel = await createHotel();
    const { booking, guestToken, pay } = await startPayment(hotel._id);
    await api().post(`/api/v1/payments/${pay.body.data.id}/simulate`).set('X-Guest-Token', guestToken).send({ outcome: 'failure' });
    expect(await Booking.findById(booking.id).lean()).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' });
    const retry = await api().post('/api/v1/payments/create').set('X-Guest-Token', guestToken).send({ bookingId: booking.id, method: 'card' });
    expect(retry.status).toBe(201);
  });

  it('rejects payment for an expired hold', async () => {
    const hotel = await createHotel();
    const rt = await createRoomTypeWithUnits(hotel._id);
    const created = await api().post('/api/v1/bookings').send(bookingPayload(hotel._id, rt._id));
    await Booking.updateOne({ _id: created.body.data.booking.id }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const res = await api()
      .post('/api/v1/payments/create')
      .set('X-Guest-Token', created.body.data.guestToken)
      .send({ bookingId: created.body.data.booking.id, method: 'upi' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOLD_EXPIRED');
  });
});

describe('RazorpayProvider webhook verification', () => {
  const provider = new RazorpayProvider({ keyId: 'rzp_test_x', keySecret: 'secret_x', webhookSecret: 'whsec_test' });
  const body = Buffer.from(
    JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 907200 } } } }),
  );

  it('accepts a correct HMAC-SHA256 signature and normalises the event', () => {
    const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    expect(provider.verifyWebhook(body, { 'x-razorpay-signature': sig })).toBe(true);
    expect(provider.parseWebhook(body, { 'x-razorpay-event-id': 'evt_9' })).toEqual({
      eventId: 'evt_9',
      type: 'payment.captured',
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      amountPaise: 907200,
      failureReason: null,
    });
  });

  it('rejects a tampered body or missing signature', () => {
    const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    expect(provider.verifyWebhook(Buffer.from(body.toString().replace('907200', '100')), { 'x-razorpay-signature': sig })).toBe(false);
    expect(provider.verifyWebhook(body, {})).toBe(false);
  });
});
