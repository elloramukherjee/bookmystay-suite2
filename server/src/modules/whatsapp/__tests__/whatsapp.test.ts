import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../config/env.js';
import { Types } from 'mongoose';
import { createBookingViaApi, createRoomTypeWithUnits } from '../../../test/booking-fixtures.js';
import { Booking } from '../../bookings/booking.model.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { ChatMessage } from '../../chatbot/models/chatMessage.model.js';
import { Conversation } from '../../chatbot/models/conversation.model.js';
import { resetGeminiClient } from '../../chatbot/services/gemini.service.js';
import { Guest } from '../../guests/guest.model.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { Notification } from '../../notifications/notification.model.js';
import { enqueue, processOutbox } from '../../notifications/notification.service.js';
import { registerProvider, resetProviders } from '../../notifications/providers.js';
import { PermanentSendError } from '../../notifications/sendErrors.js';
import { WhatsAppMessage } from '../whatsappMessage.model.js';
import { recoverInbound, whatsappIdle } from '../whatsapp.service.js';

// Only the two external services are faked: Gemini (SDK) and Meta's Graph API (fetch).
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));
const textReply = (text: string) => ({ text, functionCalls: undefined, candidates: [{ content: { role: 'model', parts: [{ text }] } }] });

const fetchMock = vi.fn();
const PHONE_NUMBER_ID = '109876543210';
const CREDS = {
  WHATSAPP_ACCESS_TOKEN: 'test-wa-token',
  WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_APP_SECRET: 'app-secret',
};
const setCreds = (on: boolean) => {
  for (const [k, v] of Object.entries(CREDS)) {
    if (on) (env as Record<string, unknown>)[k] = v;
    else delete (env as Record<string, unknown>)[k];
  }
  resetProviders();
};

useTestDatabase();

beforeAll(() => {
  (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = 'test-key';
  resetGeminiClient();
  vi.stubGlobal('fetch', fetchMock);
});
afterAll(() => {
  delete (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
  resetGeminiClient();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  setCreds(true);
  generateContent.mockReset();
  fetchMock.mockReset();
  let n = 0;
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${++n}` }] }), { status: 200 }));
});
afterEach(() => setCreds(false));

const sign = (raw: string, secret = CREDS.WHATSAPP_APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

function inbound(
  from: string,
  id: string,
  message: Record<string, unknown> = { type: 'text', text: { body: 'Hello' } },
  name = 'Rajesh Kumar',
  phoneNumberId = PHONE_NUMBER_ID,
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '919876543210', phone_number_id: phoneNumberId },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [{ from, id, timestamp: '1764000000', ...message }],
            },
          },
        ],
      },
    ],
  };
}
function receipt(id: string, status: string, errors?: unknown[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              statuses: [{ id, status, timestamp: '1764000001', recipient_id: '919811234567', errors }],
            },
          },
        ],
      },
    ],
  };
}
async function post(body: unknown) {
  const raw = JSON.stringify(body);
  const res = await api().post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
  await whatsappIdle();
  return res;
}

async function setupHotel() {
  const hotel = await createHotel();
  await Hotel.updateOne({ _id: hotel._id }, { $set: { 'integrations.whatsappPhoneNumberId': PHONE_NUMBER_ID, 'contact.phone': '+919876543210' } });
  await createRoomTypeWithUnits(hotel._id, 2);
  return hotel;
}

describe('webhook security', () => {
  it('answers 404 in simulator mode (no credentials)', async () => {
    setCreds(false);
    expect((await api().get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' })).status).toBe(404);
    expect((await api().post('/api/v1/webhooks/whatsapp').send({})).body.error.code).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('completes Meta’s verification handshake only with the right token', async () => {
    const ok = await api().get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '8812345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('8812345');
    expect((await api().get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).status).toBe(
      403,
    );
  });

  it('rejects unsigned or tampered payloads without storing anything', async () => {
    await setupHotel();
    const raw = JSON.stringify(inbound('919811234567', 'wamid.A'));
    expect((await api().post('/api/v1/webhooks/whatsapp').set('Content-Type', 'application/json').send(raw)).status).toBe(401);
    const forged = await api()
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(raw, 'other-secret'))
      .send(raw);
    expect(forged.status).toBe(401);
    expect(await WhatsAppMessage.countDocuments()).toBe(0);
  });
});

describe('inbound guest messages', () => {
  it('replies through the AI receptionist and the Cloud API, then tracks delivery receipts', async () => {
    const hotel = await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Namaste! Check-in is from 1 PM.'));

    const res = await post(inbound('919811234567', 'wamid.IN1', { type: 'text', text: { body: 'What time is check-in?' } }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ messages: 1, duplicates: 0 });

    const conv = await Conversation.findOne({ hotelId: hotel._id }).lean();
    expect(conv).toMatchObject({ channel: 'whatsapp', channelUserId: '+919811234567', guestName: 'Rajesh Kumar' });
    const guest = await Guest.findById(conv!.guestId).lean();
    expect(guest).toMatchObject({ phoneE164: '+919811234567', name: 'Rajesh Kumar' });
    expect((await WhatsAppMessage.findOne({ waMessageId: 'wamid.IN1' }).lean())!.status).toBe('processed');

    const aiMsg = await ChatMessage.findOne({ conversationId: conv!._id, sender: 'ai' }).lean();
    expect(aiMsg).toMatchObject({ text: 'Namaste! Check-in is from 1 PM.', deliveryStatus: 'pending' });

    await processOutbox();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-wa-token');
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919811234567',
      type: 'text',
      text: { body: 'Namaste! Check-in is from 1 PM.' },
    });

    const note = await Notification.findOne({ template: 'chat_reply' }).lean();
    expect(note).toMatchObject({ status: 'sent', providerMessageId: 'wamid.OUT1' });
    expect((await ChatMessage.findById(aiMsg!._id).lean())!.deliveryStatus).toBe('sent');

    await post(receipt('wamid.OUT1', 'delivered'));
    expect((await ChatMessage.findById(aiMsg!._id).lean())!.deliveryStatus).toBe('delivered');
    await post(receipt('wamid.OUT1', 'read'));
    await post(receipt('wamid.OUT1', 'delivered')); // late, out-of-order receipt must not move it back
    expect((await ChatMessage.findById(aiMsg!._id).lean())!.deliveryStatus).toBe('read');
    const out = await WhatsAppMessage.findOne({ waMessageId: 'wamid.OUT1' }).lean();
    expect(out).toMatchObject({ direction: 'out', status: 'read' });
    expect(out!.statusHistory.map((s) => s.status)).toEqual(['sent', 'delivered', 'read', 'delivered']);
  });

  it('ignores Meta redelivering the same message', async () => {
    await setupHotel();
    generateContent.mockResolvedValue(textReply('Hello!'));
    await post(inbound('919811234567', 'wamid.DUP'));
    const again = await post(inbound('919811234567', 'wamid.DUP'));
    expect(again.body.data).toMatchObject({ messages: 0, duplicates: 1 });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(await ChatMessage.countDocuments({ sender: 'guest' })).toBe(1);
  });

  it('STOP withdraws marketing consent and START restores it, without calling the AI', async () => {
    const hotel = await setupHotel();
    await Guest.create({
      hotelId: hotel._id,
      phoneE164: '+919811234567',
      name: 'Rajesh',
      firstSource: 'direct',
      lastSource: 'direct',
      consent: { marketing: { granted: true, at: new Date(), source: 'booking' } },
    });

    await post(inbound('919811234567', 'wamid.S1', { type: 'text', text: { body: 'STOP' } }));
    let guest = await Guest.findOne({ hotelId: hotel._id }).lean();
    expect(guest!.consent.marketing).toMatchObject({ granted: false, source: 'whatsapp_keyword' });
    expect(guest!.consent.marketing.withdrawnAt).toBeInstanceOf(Date);
    expect(await ChatMessage.findOne({ sender: 'system' }).lean()).toMatchObject({
      text: expect.stringContaining('won’t receive offers'),
      deliveryStatus: 'pending',
    });

    await post(inbound('919811234567', 'wamid.S2', { type: 'text', text: { body: 'start' } }));
    guest = await Guest.findOne({ hotelId: hotel._id }).lean();
    expect(guest!.consent.marketing).toMatchObject({ granted: true, withdrawnAt: null });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('logs photos and voice notes for staff with a short note to the guest', async () => {
    await setupHotel();
    await post(inbound('919811234567', 'wamid.IMG', { type: 'image', image: { id: 'media1', mime_type: 'image/jpeg' } }));
    const msgs = await ChatMessage.find().sort({ createdAt: 1 }).lean();
    expect(msgs.map((m) => m.sender)).toEqual(['guest', 'system']);
    expect(msgs[0]!.text).toContain('[image received on WhatsApp');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('ignores messages for a number not linked to any property', async () => {
    await setupHotel();
    await createHotel(); // two properties, so the .env number cannot be assumed
    const res = await post(inbound('919811234567', 'wamid.X', undefined, 'X', '999'));
    expect(res.status).toBe(200);
    expect((await WhatsAppMessage.findOne({ waMessageId: 'wamid.X' }).lean())!.status).toBe('ignored');
    expect(await Conversation.countDocuments()).toBe(0);
  });

  it('a message saved but not processed (process restarted) is picked up by the recovery job', async () => {
    const hotel = await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Yes, we have parking.'));
    await WhatsAppMessage.collection.insertOne({
      hotelId: hotel._id,
      direction: 'in',
      waMessageId: 'wamid.LOST',
      phoneNumberId: PHONE_NUMBER_ID,
      phoneE164: '+919811234567',
      type: 'text',
      text: 'Do you have parking?',
      profileName: null,
      status: 'received',
      statusHistory: [],
      attempts: 0,
      createdAt: new Date(Date.now() - 120_000),
      updatedAt: new Date(Date.now() - 120_000),
    });
    expect(await recoverInbound()).toBe(1);
    expect((await WhatsAppMessage.findOne({ waMessageId: 'wamid.LOST' }).lean())!.status).toBe('processed');
    expect(await ChatMessage.findOne({ sender: 'ai' }).lean()).toMatchObject({ text: 'Yes, we have parking.' });
  });
});

/** Stand-in for a real SMS/email gateway (none is integrated in this version). */
function liveProvider(
  channel: 'sms' | 'email',
  send: () => Promise<{ delivered: boolean; providerMessageId: string | null }> = async () => ({ delivered: true, providerMessageId: `${channel}-1` }),
) {
  registerProvider({ channel, name: `test-${channel}`, live: true, send });
}

describe('outbox fallback chain (WhatsApp → SMS → email)', () => {
  it('outside the 24-hour window (131047) moves on at once, without retries, to the next channel that can deliver', async () => {
    const hotel = await setupHotel();
    liveProvider('sms');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }));
    await enqueue({
      hotelId: hotel._id,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      fallbackEmail: 'rajesh@test.example',
      to: '+919811234567',
      template: 'booking_confirmed',
      body: 'Confirmed BMS-1',
    });
    await processOutbox();
    const [wa, sms] = await Notification.find().sort({ createdAt: 1 }).lean();
    expect(wa).toMatchObject({ channel: 'whatsapp', status: 'dead', attempts: 1 });
    expect(wa!.lastError).toContain('131047');
    expect(sms).toMatchObject({ channel: 'sms', to: '+919811234567', status: 'sent', fallbackChannel: 'email', fallbackEmail: 'rajesh@test.example' });
  });

  it('skips channels with no real provider: SMS not set up, so it goes straight to email', async () => {
    const hotel = await setupHotel();
    liveProvider('email');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131026, message: 'Undeliverable' } }), { status: 400 }));
    await enqueue({
      hotelId: hotel._id,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      fallbackEmail: 'rajesh@test.example',
      to: '+919811234567',
      template: 'booking_confirmed',
      body: 'Confirmed BMS-1',
    });
    await processOutbox();
    const rows = await Notification.find().sort({ createdAt: 1 }).lean();
    expect(rows.map((r) => [r.channel, r.status, r.to])).toEqual([
      ['whatsapp', 'dead', '+919811234567'],
      ['email', 'sent', 'rajesh@test.example'],
    ]);
  });

  it('when SMS also fails permanently the message goes out by email', async () => {
    const hotel = await setupHotel();
    liveProvider('sms', () => Promise.reject(new PermanentSendError('DND number')));
    liveProvider('email');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131026, message: 'Undeliverable' } }), { status: 400 }));
    await enqueue({
      hotelId: hotel._id,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      fallbackEmail: 'rajesh@test.example',
      to: '+919811234567',
      template: 'booking_confirmed',
      body: 'Confirmed BMS-1',
    });
    await processOutbox();
    const rows = await Notification.find().sort({ createdAt: 1 }).lean();
    expect(rows.map((r) => [r.channel, r.status, r.to])).toEqual([
      ['whatsapp', 'dead', '+919811234567'],
      ['sms', 'dead', '+919811234567'],
      ['email', 'sent', 'rajesh@test.example'],
    ]);
  });

  it('with no SMS/email provider (this MVP), an undeliverable confirmation becomes a staff call task', async () => {
    const hotel = await setupHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const rt = await createRoomTypeWithUnits(hotel._id, 1);
    const { booking } = await createBookingViaApi(hotel._id, rt._id);
    await Booking.updateOne({ _id: booking.id }, { $set: { status: 'confirmed', paymentStatus: 'paid' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }));
    await enqueue({
      hotelId: hotel._id,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      fallbackEmail: 'rajesh@test.example',
      to: '+919811234567',
      template: 'booking_confirmed',
      body: 'Confirmed',
      relatedEntity: { type: 'Booking', id: new Types.ObjectId(booking.id) },
    });
    await processOutbox();

    // Nothing is pretended: no simulated SMS/email rows, and staff are told to call.
    expect(await Notification.countDocuments({ channel: { $in: ['sms', 'email'] } })).toBe(0);
    const wa = await Notification.findOne({ channel: 'whatsapp' }).lean();
    expect(wa!.manualFollowUp).toMatchObject({ required: true, resolvedAt: null });
    expect(wa!.manualFollowUp!.reason).toContain('no sms and email provider configured');
    expect((await Booking.findById(booking.id).lean())!.needsAttention).toBe(
      'The booking confirmation couldn’t be delivered to the guest. Please call them on +91 98112 34567.',
    );

    const status = await api().get('/api/v1/whatsapp/status').set('Authorization', `Bearer ${token}`);
    expect(status.body.data.manualFollowUps).toEqual([
      expect.objectContaining({ message: 'booking confirmation', phone: '+919811234567', guestName: 'Rajesh Kumar', bookingReference: booking.reference }),
    ]);
    expect(status.body.data.recentFailures[0]).toMatchObject({ staffFollowUp: true, fellBackTo: null });

    const resolved = await api().post(`/api/v1/whatsapp/follow-ups/${wa!._id}/resolve`).set('Authorization', `Bearer ${token}`);
    expect(resolved.status).toBe(200);
    expect((await Booking.findById(booking.id).lean())!.needsAttention).toBeNull();
    expect((await api().get('/api/v1/whatsapp/status').set('Authorization', `Bearer ${token}`)).body.data.manualFollowUps).toEqual([]);
    expect((await api().post(`/api/v1/whatsapp/follow-ups/${wa!._id}/resolve`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });

  it('sends a Meta-approved template when one is mapped for the message type', async () => {
    const hotel = await setupHotel();
    (env as { WHATSAPP_TEMPLATES?: string }).WHATSAPP_TEMPLATES = 'booking_confirmed=bms_booking_confirmed:en_US';
    try {
      await enqueue({
        hotelId: hotel._id,
        channel: 'whatsapp',
        to: '+919811234567',
        template: 'booking_confirmed',
        body: 'Namaste Rajesh!\nConfirmed',
        templateParams: [
          'Rajesh',
          'Test Haveli',
          'BMS-ABC123',
          '1 × Deluxe, 2 nights',
          '2026-12-14 from 13:00',
          '2026-12-16 by 11:00',
          'Line one\nLine    two',
        ],
      });
      await enqueue({ hotelId: hotel._id, channel: 'whatsapp', to: '+919811234567', template: 'chat_reply', body: 'Plain reply' });
      await processOutbox();
      const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
      expect(bodies[0]).toMatchObject({
        type: 'template',
        template: {
          name: 'bms_booking_confirmed',
          language: { code: 'en_US' },
          components: [{ type: 'body', parameters: expect.arrayContaining([{ type: 'text', text: 'BMS-ABC123' }]) }],
        },
      });
      // Template values may not contain newlines or long runs of spaces.
      expect(bodies[0].template.components[0].parameters[6].text).toBe('Line one · Line two');
      expect(bodies[1]).toMatchObject({ type: 'text', text: { body: 'Plain reply' } });
    } finally {
      delete (env as { WHATSAPP_TEMPLATES?: string }).WHATSAPP_TEMPLATES;
    }
  });

  it('retries temporary errors with backoff, then falls back after the last attempt', async () => {
    const hotel = await setupHotel();
    liveProvider('sms');
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 131000, message: 'Something went wrong' } }), { status: 500 }));
    await enqueue({ hotelId: hotel._id, channel: 'whatsapp', fallbackChannel: 'sms', to: '+919811234567', template: 'checkin_welcome', body: 'Welcome' });
    await processOutbox();
    let wa = await Notification.findOne({ channel: 'whatsapp' }).lean();
    expect(wa).toMatchObject({ status: 'failed', attempts: 1 });
    expect(wa!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await Notification.countDocuments({ channel: 'sms' })).toBe(0);

    await Notification.updateOne({ _id: wa!._id }, { $set: { attempts: 4, nextAttemptAt: new Date() } });
    await processOutbox();
    wa = await Notification.findById(wa!._id).lean();
    expect(wa).toMatchObject({ status: 'dead', attempts: 5 });
    expect(await Notification.countDocuments({ channel: 'sms' })).toBe(1);
  });

  it('a "failed" receipt after Meta accepted a chat reply marks it failed and texts the guest instead', async () => {
    await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Your towels are on the way.'));
    await post(inbound('919811234567', 'wamid.T1', { type: 'text', text: { body: 'Need towels' } }));
    await processOutbox();
    const chatReply = await Notification.findOne({ template: 'chat_reply' }).lean();
    expect(chatReply!.status).toBe('sent');

    await post(
      receipt(chatReply!.providerMessageId!, 'failed', [
        { code: 131049, title: 'Ecosystem engagement', error_data: { details: 'Not delivered to maintain healthy ecosystem' } },
      ]),
    );
    expect((await Notification.findById(chatReply!._id).lean())!.status).toBe('dead');
    expect((await ChatMessage.findOne({ sender: 'ai' }).lean())!.deliveryStatus).toBe('failed');
    // chat replies have no fallback channel, so nothing else is queued
    expect(await Notification.countDocuments({ channel: 'sms' })).toBe(0);
  });
});

describe('messaging status', () => {
  it('reports simulator mode and outbox counts to staff', async () => {
    setCreds(false);
    const hotel = await setupHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    await enqueue({ hotelId: hotel._id, channel: 'whatsapp', fallbackChannel: 'sms', to: '+919811234567', template: 'booking_confirmed', body: 'x' });
    await processOutbox();

    const res = await api().get('/api/v1/whatsapp/status').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mode: 'simulator', phoneNumberId: null, webhookPath: '/api/v1/webhooks/whatsapp' });
    expect(res.body.data.channels[0]).toMatchObject({ channel: 'whatsapp', provider: 'Simulator (not sent)', simulated: 1, sent: 0 });
    expect((await api().get('/api/v1/whatsapp/status')).status).toBe(401);
  });

  it('reports live mode with a masked number id', async () => {
    const hotel = await setupHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const res = await api().get('/api/v1/whatsapp/status').set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toMatchObject({ mode: 'live', phoneNumberId: '••••3210', linkedToProperty: true });
    expect(JSON.stringify(res.body)).not.toContain('test-wa-token');
  });
});
