import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { Booking } from '../modules/bookings/booking.model.js';
import { ChatMessage } from '../modules/chatbot/models/chatMessage.model.js';
import { Conversation } from '../modules/chatbot/models/conversation.model.js';
import { ServiceRequest } from '../modules/chatbot/models/serviceRequest.model.js';
import { resetGeminiClient } from '../modules/chatbot/services/gemini.service.js';
import { Guest } from '../modules/guests/guest.model.js';
import { Hotel } from '../modules/hotels/hotel.model.js';
import { Notification } from '../modules/notifications/notification.model.js';
import { processOutbox } from '../modules/notifications/notification.service.js';
import { resetProviders } from '../modules/notifications/providers.js';
import { whatsappIdle } from '../modules/whatsapp/whatsapp.service.js';
import { createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../test/helpers.js';

/**
 * End-to-end guest journey across all three products, through the public HTTP API only:
 *   direct booking + UPI → WhatsApp confirmation → front-desk check-in → guest asks for towels on WhatsApp
 *   (AI with stay context logs the request) → staff see it in the CRM timeline → check-out → dashboard.
 * Only Gemini and Meta's Graph API are faked.
 */
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
const textReply = (text: string) => ({ text, functionCalls: undefined, candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
const toolCall = (name: string, args: Record<string, unknown>) => ({
  text: undefined,
  functionCalls: [{ name, args, id: `call_${name}` }],
  candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args, id: `call_${name}` } }] } }],
});

const PHONE_NUMBER_ID = '555000111';
const CREDS = {
  WHATSAPP_ACCESS_TOKEN: 'journey-token',
  WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN: 'v',
  WHATSAPP_APP_SECRET: 'journey-secret',
};
const fetchMock = vi.fn();

useTestDatabase();

beforeAll(() => {
  Object.assign(env, CREDS, { GEMINI_API_KEY: 'test-key' });
  resetGeminiClient();
  resetProviders();
  let n = 0;
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.J${++n}` }] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(() => {
  for (const k of [...Object.keys(CREDS), 'GEMINI_API_KEY']) delete (env as Record<string, unknown>)[k];
  resetGeminiClient();
  resetProviders();
  vi.unstubAllGlobals();
});

async function whatsappFromGuest(text: string, id: string) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: '919811234567', profile: { name: 'Rajesh' } }],
              messages: [{ from: '919811234567', id, timestamp: '1764000000', type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
  const sig = `sha256=${createHmac('sha256', CREDS.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
  const res = await api().post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(raw);
  expect(res.status).toBe(200);
  await whatsappIdle();
}

describe('guest journey: booking → CRM → AI receptionist → CRM log → dashboard', () => {
  it('connects every product around one guest', async () => {
    // ── Property and staff ──
    const hotel = await createHotel();
    await Hotel.updateOne({ _id: hotel._id }, { $set: { 'integrations.whatsappPhoneNumberId': PHONE_NUMBER_ID, 'contact.phone': '+919876543210' } });
    const rt = await createRoomTypeWithUnits(hotel._id, 2);
    const owner = await createUser('owner', hotel._id);
    const desk = await createUser('front_desk', hotel._id);
    const ownerAuth = { Authorization: `Bearer ${(await loginAs(owner.email)).token}` };
    const deskAuth = { Authorization: `Bearer ${(await loginAs(desk.email)).token}` };

    // ── 1. Direct booking for tonight, paid by UPI ──
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(0), checkOut: dayFromNow(2) });
    const pay = await api().post('/api/v1/payments/create').set('X-Guest-Token', guestToken).send({ bookingId: booking.id, method: 'upi' });
    await api().post(`/api/v1/payments/${pay.body.data.id}/simulate`).set('X-Guest-Token', guestToken).send({ outcome: 'success' });
    const confirmed = await Booking.findById(booking.id).lean();
    expect(confirmed).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', source: 'direct' });

    // ── 2. Confirmation goes out on WhatsApp (Cloud API) ──
    await processOutbox();
    const confirmation = await Notification.findOne({ template: 'booking_confirmed' }).lean();
    expect(confirmation).toMatchObject({ channel: 'whatsapp', status: 'sent', to: '+919811234567' });
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).text.body).toContain(confirmed!.reference);

    // ── 3. CRM: the guest exists once, and the front desk checks them in ──
    const guests = await api().get('/api/v1/guests').query({ q: '98112 34567' }).set(deskAuth);
    expect(guests.body.data).toHaveLength(1);
    const guestId = guests.body.data[0].id as string;
    const checkIn = await api()
      .post('/api/v1/crm/check-in')
      .set(deskAuth)
      .send({ bookingId: booking.id, idVerified: true, idDocType: 'aadhaar', sendWelcome: true });
    expect(checkIn.status).toBe(200);
    const roomNumber = checkIn.body.data.roomNumber as string;
    expect(roomNumber).toBeTruthy();

    // ── 4. Guest asks for towels on WhatsApp; the AI knows the stay and logs the request ──
    generateContent
      .mockResolvedValueOnce(toolCall('create_service_request', { type: 'towels', details: '2 extra bath towels' }))
      .mockResolvedValueOnce(textReply(`Of course! Two extra towels are on their way to room ${roomNumber}.`));
    await whatsappFromGuest('Can I get 2 more towels please?', 'wamid.TOWELS');

    const conv = await Conversation.findOne({ hotelId: hotel._id, channel: 'whatsapp' }).lean();
    expect(String(conv!.guestId)).toBe(guestId);
    expect(String(conv!.bookingId)).toBe(booking.id); // the WhatsApp number identifies the in-house stay
    const prompt = (generateContent.mock.calls[0]![0] as { config: { systemInstruction: string } }).config.systemInstruction;
    expect(prompt).toContain(confirmed!.reference);
    expect(prompt).toContain(`Room number: ${roomNumber}`);

    const request = await ServiceRequest.findOne({ hotelId: hotel._id }).lean();
    expect(request).toMatchObject({ type: 'towels', status: 'open' });
    expect(String(request!.bookingId)).toBe(booking.id);
    expect((await ChatMessage.findOne({ conversationId: conv!._id, sender: 'ai' }).lean())!.text).toContain(roomNumber);

    await processOutbox(); // welcome + AI reply leave through the Cloud API
    expect(await Notification.countDocuments({ channel: 'whatsapp', status: 'sent' })).toBe(3);

    // Staff complete the request; the guest is told in the same chat.
    const done = await api()
      .patch(`/api/v1/chatbot/service-requests/${request!._id}`)
      .set(deskAuth)
      .send({ status: 'done', message: 'Delivered to your room.' });
    expect(done.status).toBe(200);

    // ── 5. CRM timeline shows booking, stay, chat and request ──
    const history = await api().get(`/api/v1/crm/guests/${guestId}/history`).set(ownerAuth);
    const kinds = new Set((history.body.data.events as { kind: string }[]).map((e) => e.kind));
    expect([...kinds]).toEqual(expect.arrayContaining(['booking', 'stay', 'conversation', 'request']));

    // ── 6. Check-out, then the owner's dashboard reflects the completed direct stay ──
    const checkOut = await api().post('/api/v1/crm/check-out').set(deskAuth).send({ bookingId: booking.id, paymentCollected: false });
    expect(checkOut.status).toBe(200);
    const guest = await Guest.findById(guestId).lean();
    expect(guest!.stats.completedStays).toBe(1);

    const dash = await api().get('/api/v1/crm/dashboard').query({ period: 'mtd' }).set(ownerAuth);
    expect(dash.status).toBe(200);
    expect(dash.body.data).toMatchObject({ financeVisible: true, stays: { direct: 1, ota: 0, directSharePercent: 100 }, contacts: { total: 1 } });
    expect(dash.body.data.today.checkOutsToday).toBe(1);
    expect(dash.body.data.revenue.commissionSavedPaise).toBeGreaterThan(0);

    // The front desk sees operations but never revenue.
    const deskDash = await api().get('/api/v1/crm/dashboard').set(deskAuth);
    expect(deskDash.body.data.revenue.commissionSavedPaise).toBeNull();
  });
});
