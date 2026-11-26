import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../config/env.js';
import { createBookingViaApi, createRoomTypeWithUnits, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { Booking } from '../../bookings/booking.model.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { HotelPolicy } from '../../hotels/hotelPolicy.model.js';
import { Notification } from '../../notifications/notification.model.js';
import { ChatMessage } from '../models/chatMessage.model.js';
import { Conversation } from '../models/conversation.model.js';
import { HotelFaq } from '../models/hotelFaq.model.js';
import { ServiceRequest } from '../models/serviceRequest.model.js';
import { resetGeminiClient } from '../services/gemini.service.js';

// ── Gemini SDK mock: the only thing faked. Tools, DB, state machine and prompts are all real. ──────
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
type GenArgs = { contents: { role: string; parts: Record<string, unknown>[] }[]; config: { systemInstruction: string } };
const callArgs = (i: number) => generateContent.mock.calls[i]![0] as GenArgs;

useTestDatabase();

beforeAll(() => {
  (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = 'test-key';
  resetGeminiClient();
});
afterAll(() => {
  delete (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
  resetGeminiClient();
});
beforeEach(() => generateContent.mockReset());

async function setupHotel() {
  const hotel = await createHotel();
  await Hotel.updateOne(
    { _id: hotel._id },
    { $set: { checkInTime: '13:00', checkOutTime: '11:00', 'contact.phone': '+919876543210', 'contact.whatsapp': '+919876543210' } },
  );
  await HotelFaq.create({
    hotelId: hotel._id,
    question: 'What are the breakfast timings?',
    answer: 'Breakfast is served 7:30 AM to 10:30 AM in the courtyard.',
    category: 'dining',
  });
  await HotelFaq.create({ hotelId: hotel._id, question: 'Secret draft FAQ', answer: 'UNPUBLISHED-ANSWER', published: false });
  await HotelPolicy.create({ hotelId: hotel._id, type: 'pets', title: 'Pets', body: 'We are unable to host pets.' });
  const rt = await createRoomTypeWithUnits(hotel._id, 3);
  return { hotel, rt };
}

const send = (hotelId: unknown, text: string, chatToken?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const req = api().post('/api/v1/chatbot/message');
  if (chatToken) req.set('X-Chat-Token', chatToken);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send({ hotelId: String(hotelId), text, ...extra });
};

describe('grounded answers', () => {
  it('answers an FAQ with Gemini, grounded on published knowledge only, and logs latency', async () => {
    const { hotel } = await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Breakfast is served 7:30 AM to 10:30 AM in the courtyard. 🙏'));

    const res = await send(hotel._id, 'What time is breakfast?');
    expect(res.status).toBe(200);
    expect(res.body.data.chatToken).toEqual(expect.any(String));
    expect(res.body.data.messages.map((m: { sender: string }) => m.sender)).toEqual(['guest', 'ai']);

    const { config, contents } = callArgs(0);
    expect(config.systemInstruction).toContain('Breakfast is served 7:30 AM to 10:30 AM');
    expect(config.systemInstruction).toContain('Check-in time: from 1:00 PM');
    expect(config.systemInstruction).toContain('We are unable to host pets.');
    expect(config.systemInstruction).not.toContain('UNPUBLISHED-ANSWER');
    expect(config.systemInstruction).not.toContain('What time is breakfast?'); // guest text never enters instructions
    expect(contents.at(-1)).toEqual({ role: 'user', parts: [{ text: 'What time is breakfast?' }] });

    const ai = await ChatMessage.findOne({ sender: 'ai' }).lean();
    expect(ai!.latencyMs).toEqual(expect.any(Number));
  });

  it('gets prices only through the availability tool, using the real pricing engine', async () => {
    const { hotel } = await setupHotel();
    generateContent
      .mockResolvedValueOnce(toolCall('check_availability_and_price', { check_in: dayFromNow(10), check_out: dayFromNow(12), adults: 2 }))
      .mockResolvedValueOnce(textReply('The Deluxe Courtyard Suite is available at ₹9,072 for 2 nights including GST.'));

    await send(hotel._id, 'Price for 2 adults on those dates?');
    const second = callArgs(1);
    const fnResponse = second.contents.at(-1)!.parts[0]!.functionResponse as {
      name: string;
      response: { ok: boolean; options: { totalInclGst?: string; plans: { totalInclGst: string }[] }[] };
    };
    expect(fnResponse.name).toBe('check_availability_and_price');
    expect(fnResponse.response.ok).toBe(true);
    expect(fnResponse.response.options[0]!.plans[0]!.totalInclGst).toBe('₹9,072');
    const ai = await ChatMessage.findOne({ sender: 'ai' }).lean();
    expect(ai!.toolCalls[0]).toMatchObject({ name: 'check_availability_and_price', ok: true });
  });

  it('never leaks another guest’s booking into the prompt', async () => {
    const { hotel, rt } = await setupHotel();
    await createBookingViaApi(hotel._id, rt._id, { guest: { name: 'Someone Else Entirely', phone: '9811100001' } });
    generateContent.mockResolvedValueOnce(textReply('Happy to help!'));
    await send(hotel._id, 'Hello');
    expect(callArgs(0).config.systemInstruction).not.toContain('Someone Else Entirely');
    expect(callArgs(0).config.systemInstruction).toContain('The guest has not been identified');
  });
});

describe('service requests', () => {
  it('refuses to log stay requests until the booking is verified, then logs (not completes) them', async () => {
    const { hotel, rt } = await setupHotel();
    const { booking } = await createBookingViaApi(hotel._id, rt._id);
    await Booking.updateOne({ _id: booking.id }, { $set: { status: 'confirmed' } });

    generateContent
      .mockResolvedValueOnce(toolCall('create_service_request', { type: 'towels', details: '2 extra towels' }))
      .mockResolvedValueOnce(textReply('Could you verify your booking first?'));
    const first = await send(hotel._id, 'Need 2 extra towels please');
    const token = first.body.data.chatToken as string;
    expect((callArgs(1).contents.at(-1)!.parts[0]!.functionResponse as { response: { error: string } }).response.error).toBe('not_verified');
    expect(await ServiceRequest.countDocuments()).toBe(0);

    const verify = await api().post('/api/v1/chatbot/verify').set('X-Chat-Token', token).send({ reference: booking.reference, phone: '98112 34567' });
    expect(verify.status).toBe(200);
    expect(verify.body.data.verifiedBooking.reference).toBe(booking.reference);

    generateContent
      .mockResolvedValueOnce(toolCall('create_service_request', { type: 'towels', details: '2 extra towels' }))
      .mockResolvedValueOnce(textReply('Logged with housekeeping — they’ll bring them shortly.'));
    await send(hotel._id, 'Need 2 extra towels please', token);
    const sr = await ServiceRequest.findOne().lean();
    expect(sr).toMatchObject({ type: 'towels', status: 'open', createdBy: 'ai' });
    const result = (callArgs(3).contents.at(-1)!.parts[0]!.functionResponse as { response: { note: string } }).response;
    expect(result.note).toMatch(/NOT completed/);
    // The verified booking is now in the model's context.
    expect(callArgs(2).config.systemInstruction).toContain(`Verified booking ${booking.reference}`);

    // Only when staff mark it done does the guest hear it's done.
    const fd = await createUser('front_desk', hotel._id);
    const { token: staffToken } = await loginAs(fd.email);
    const done = await api().patch(`/api/v1/chatbot/service-requests/${sr!._id}`).set('Authorization', `Bearer ${staffToken}`).send({ status: 'done' });
    expect(done.status).toBe(200);
    const session = await api().get('/api/v1/chatbot/session').set('X-Chat-Token', token);
    expect(session.body.data.messages.at(-1)).toMatchObject({ sender: 'staff', text: expect.stringMatching(/towels request is done/) });
  });

  it('tells the guest exactly what was logged if the AI times out after the tool ran', async () => {
    const { hotel, rt } = await setupHotel();
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);
    await Booking.updateOne({ _id: booking.id }, { $set: { status: 'checked_in', roomNumber: '204' } });
    generateContent
      .mockResolvedValueOnce(toolCall('create_service_request', { type: 'late_checkout', details: 'Till 1 PM tomorrow' }))
      .mockRejectedValueOnce(Object.assign(new Error('bad request'), { status: 400 }));
    const res = await send(hotel._id, 'Late checkout till 1 PM please', undefined, {}, { 'X-Guest-Token': guestToken });
    expect(res.body.data.messages.at(-1).text).toBe("Thank you! I've passed your late checkout request to our front desk. The team will confirm here shortly.");
    expect(await ServiceRequest.countDocuments({ type: 'late_checkout', status: 'open' })).toBe(1);
    expect((await Conversation.findOne().lean())!.status).toBe('escalated');
  });

  it('links the booking automatically when the guest arrives from the booking page', async () => {
    const { hotel, rt } = await setupHotel();
    const { booking, guestToken } = await createBookingViaApi(hotel._id, rt._id);
    generateContent.mockResolvedValueOnce(textReply('Welcome!'));
    const res = await send(hotel._id, 'Hi', undefined, {}, { 'X-Guest-Token': guestToken });
    expect(res.body.data.verifiedBooking.reference).toBe(booking.reference);
  });
});

describe('escalation', () => {
  it('escalates sensitive messages before calling the AI, pauses the bot and alerts staff', async () => {
    const { hotel } = await setupHotel();
    const res = await send(hotel._id, 'The AC is not cooling and the room is very warm');
    expect(generateContent).not.toHaveBeenCalled();
    expect(res.body.data.withStaff).toBe(true);
    expect(res.body.data.messages.at(-1).text).toMatch(/alerted our duty manager/);

    const conv = await Conversation.findOne().lean();
    expect(conv).toMatchObject({ status: 'escalated', everEscalated: true, escalation: { category: 'complaint', by: 'rule', priority: 'high' } });
    expect(await Notification.countDocuments({ template: 'staff_escalation_alert', to: '+919876543210' })).toBe(1);
    // Internal note is not visible to the guest.
    expect(res.body.data.messages.some((m: { text: string }) => m.text.startsWith('Escalated to staff'))).toBe(false);

    // While escalated, guest messages are logged but the AI stays silent.
    const again = await send(hotel._id, 'Hello? anyone?', res.body.data.chatToken);
    expect(generateContent).not.toHaveBeenCalled();
    expect(again.body.data.messages.map((m: { sender: string }) => m.sender)).toEqual(['guest']);
  });

  it('gives an emergency-number holding reply for medical issues', async () => {
    const { hotel } = await setupHotel();
    const res = await send(hotel._id, 'My mother fainted, we need a doctor');
    expect(res.body.data.messages.at(-1).text).toMatch(/call 112/);
    expect((await Conversation.findOne().lean())!.escalation).toMatchObject({ category: 'medical', priority: 'urgent' });
  });

  it('escalates when the model says the answer is unknown', async () => {
    const { hotel } = await setupHotel();
    generateContent
      .mockResolvedValueOnce(toolCall('escalate_to_staff', { category: 'unknown_fact', reason: 'Asked about a gym' }))
      .mockResolvedValueOnce(textReply('Let me check with our team — they will reply here shortly.'));
    await send(hotel._id, 'Do you have a gym?');
    expect((await Conversation.findOne().lean())!.escalation).toMatchObject({ category: 'unknown_fact', by: 'ai' });
  });

  it('does not retry permanent errors such as an unknown model', async () => {
    const { hotel } = await setupHotel();
    generateContent.mockRejectedValueOnce(Object.assign(new Error('{"error":{"code":404,"status":"NOT_FOUND"}}'), { status: 404 }));
    await send(hotel._id, 'What time is check-in?');
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect((await Conversation.findOne().lean())!.escalation).toMatchObject({ category: 'ai_unavailable' });
  });

  it('never sends a truncated answer (finishReason MAX_TOKENS)', async () => {
    const { hotel } = await setupHotel();
    generateContent.mockResolvedValueOnce({
      text: 'Namaste ji! Humari haveli mein gym ki',
      functionCalls: undefined,
      candidates: [{ finishReason: 'MAX_TOKENS', content: { role: 'model', parts: [{ text: 'Namaste ji! Humari haveli mein gym ki' }] } }],
    });
    const res = await send(hotel._id, 'Kya aapke yahan gym hai?');
    expect(res.body.data.messages.some((m: { text: string }) => m.text.includes('gym ki'))).toBe(false);
    expect((await Conversation.findOne().lean())!.escalation).toMatchObject({ category: 'ai_unavailable' });
  });

  it('retries once on a transient Gemini overload before giving up', async () => {
    const { hotel } = await setupHotel();
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 }))
      .mockResolvedValueOnce(textReply('Check-in is from 1:00 PM.'));
    const res = await send(hotel._id, 'What time is check-in?');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(res.body.data.messages.at(-1)).toMatchObject({ sender: 'ai', text: 'Check-in is from 1:00 PM.' });
  });

  it('falls back to staff with a holding reply when Gemini fails or is not configured', async () => {
    const { hotel } = await setupHotel();
    // Transient error that persists through the single retry.
    const overloaded = Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 });
    generateContent.mockRejectedValueOnce(overloaded).mockRejectedValueOnce(overloaded);
    const res = await send(hotel._id, 'What time is check-in?');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(res.body.data.messages.at(-1)).toMatchObject({ sender: 'system', text: expect.stringMatching(/team will reply/) });
    expect((await Conversation.findOne().lean())!.escalation).toMatchObject({ category: 'ai_unavailable' });

    delete (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY;
    try {
      const res2 = await send(hotel._id, 'Hello');
      expect(res2.body.data.aiAvailable).toBe(false);
      expect(res2.body.data.withStaff).toBe(true);
    } finally {
      (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = 'test-key';
    }
  });
});

describe('staff takeover desk', () => {
  async function escalatedChat() {
    const { hotel } = await setupHotel();
    const res = await send(hotel._id, 'I want a refund for last night');
    const conv = await Conversation.findOne().lean();
    return { hotel, chatToken: res.body.data.chatToken as string, convId: String(conv!._id) };
  }

  it('front desk cannot take over an escalated chat; a manager can, reply, and resume the AI', async () => {
    const { hotel, chatToken, convId } = await escalatedChat();
    const fd = await createUser('front_desk', hotel._id);
    const mgr = await createUser('manager', hotel._id);
    const fdToken = (await loginAs(fd.email)).token;
    const mgrToken = (await loginAs(mgr.email)).token;

    const list = await api().get('/api/v1/chatbot/conversations?status=open').set('Authorization', `Bearer ${fdToken}`);
    expect(list.body.data[0]).toMatchObject({ id: convId, status: 'escalated', escalation: { category: 'refund' } });

    expect((await api().post(`/api/v1/chatbot/conversations/${convId}/takeover`).set('Authorization', `Bearer ${fdToken}`)).status).toBe(403);
    expect((await api().post(`/api/v1/chatbot/conversations/${convId}/reply`).set('Authorization', `Bearer ${fdToken}`).send({ text: 'hi' })).status).toBe(403);

    const take = await api().post(`/api/v1/chatbot/conversations/${convId}/takeover`).set('Authorization', `Bearer ${mgrToken}`);
    expect(take.body.data.conversation.status).toBe('staff_active');

    const reply = await api()
      .post(`/api/v1/chatbot/conversations/${convId}/reply`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ text: 'Namaste, I have arranged a full refund for last night.' });
    expect(reply.status).toBe(201);
    const note = await api()
      .post(`/api/v1/chatbot/conversations/${convId}/reply`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ text: 'Approved by owner on call', internal: true });
    expect(note.status).toBe(201);

    const guestView = await api().get('/api/v1/chatbot/session').set('X-Chat-Token', chatToken);
    const texts = guestView.body.data.messages.map((m: { text: string }) => m.text);
    expect(texts).toContain('Namaste, I have arranged a full refund for last night.');
    expect(texts).not.toContain('Approved by owner on call');
    expect(guestView.body.data.messages.find((m: { sender: string }) => m.sender === 'staff').staffName).toBe('manager'); // first name only

    // Staff own the chat: guest messages get no AI reply.
    await send(hotel._id, 'Thank you!', chatToken);
    expect(generateContent).not.toHaveBeenCalled();

    const resolved = await api()
      .post(`/api/v1/chatbot/conversations/${convId}/resolve`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ resumeAi: true, note: 'Refund processed' });
    expect(resolved.body.data.conversation.status).toBe('ai_active');

    generateContent.mockResolvedValueOnce(textReply('Breakfast is 7:30 to 10:30 AM.'));
    await send(hotel._id, 'What time is breakfast tomorrow?', chatToken);
    expect(generateContent).toHaveBeenCalledTimes(1);
    // The model sees the staff reply in history as the hotel speaking.
    expect(JSON.stringify(callArgs(0).contents)).toContain('(Staff member replied) Namaste, I have arranged a full refund');
  });

  it('front desk replying to an AI-handled chat takes it over (the bot stops talking)', async () => {
    const { hotel } = await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Hello!'));
    const res = await send(hotel._id, 'Hi there');
    const conv = await Conversation.findOne().lean();
    const fd = await createUser('front_desk', hotel._id);
    const { token } = await loginAs(fd.email);
    expect(
      (await api().post(`/api/v1/chatbot/conversations/${conv!._id}/reply`).set('Authorization', `Bearer ${token}`).send({ text: 'Mohan here from the desk!' }))
        .status,
    ).toBe(201);
    expect((await Conversation.findById(conv!._id).lean())!.status).toBe('staff_active');
    await send(hotel._id, 'Great, thanks', res.body.data.chatToken);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('isolates conversations by property and chat token', async () => {
    const { hotel, chatToken, convId } = await escalatedChat();
    const other = await createHotel();
    const otherMgr = await createUser('manager', other._id);
    const { token } = await loginAs(otherMgr.email);
    expect((await api().get(`/api/v1/chatbot/conversations/${convId}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
    expect((await api().get('/api/v1/chatbot/conversations').set('Authorization', `Bearer ${token}`)).body.data).toEqual([]);
    // A chat token can't be replayed against another hotel or forged.
    expect((await send(other._id, 'hi', chatToken)).status).toBe(403);
    expect((await api().get('/api/v1/chatbot/session').set('X-Chat-Token', 'forged')).status).toBe(401);
    expect((await api().get('/api/v1/chatbot/session')).status).toBe(401);
    void hotel;
  });

  it('simulates an inbound WhatsApp message, identifying the guest and their stay by phone', async () => {
    const { hotel, rt } = await setupHotel();
    const { booking } = await createBookingViaApi(hotel._id, rt._id, { checkIn: dayFromNow(0), checkOut: dayFromNow(2) });
    await Booking.updateOne({ _id: booking.id }, { $set: { status: 'checked_in', roomNumber: '108' } });
    const mgr = await createUser('manager', hotel._id);
    const { token } = await loginAs(mgr.email);

    generateContent.mockResolvedValueOnce(textReply('Namaste Rajesh ji!'));
    const sim = await api()
      .post('/api/v1/chatbot/simulate')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+91 98112 34567', text: 'Hello from room 108' });
    expect(sim.status).toBe(201);
    expect(callArgs(0).config.systemInstruction).toContain(`Verified booking ${booking.reference}`);
    expect(callArgs(0).config.systemInstruction).toContain('Room number: 108');

    const detail = await api().get(`/api/v1/chatbot/conversations/${sim.body.data.conversationId}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.data).toMatchObject({
      conversation: { channel: 'simulator', roomNumber: '108' },
      booking: { reference: booking.reference },
      guest: { phoneE164: '+919811234567' },
    });

    const fd = await createUser('front_desk', hotel._id);
    const fdToken = (await loginAs(fd.email)).token;
    expect((await api().post('/api/v1/chatbot/simulate').set('Authorization', `Bearer ${fdToken}`).send({ phone: '9811234567', text: 'x' })).status).toBe(403);
  });

  it('computes desk KPIs from the database', async () => {
    const { hotel } = await setupHotel();
    generateContent.mockResolvedValueOnce(textReply('Hello!'));
    await send(hotel._id, 'Hi');
    await send(hotel._id, 'I was charged twice!');
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const stats = await api().get('/api/v1/chatbot/stats').set('Authorization', `Bearer ${token}`);
    expect(stats.body.data).toMatchObject({
      conversations: 2,
      resolvedWithoutStaff: 1,
      automatedResolutionRate: 50,
      escalationQueue: { total: 1 },
      aiConfigured: true,
    });
    expect(stats.body.data.avgAiLatencyMs).toEqual(expect.any(Number));
  });
});

describe('knowledge base', () => {
  it('owners manage FAQs; front desk can read but not edit', async () => {
    const { hotel } = await setupHotel();
    const owner = await createUser('owner', hotel._id);
    const fd = await createUser('front_desk', hotel._id);
    const ownerToken = (await loginAs(owner.email)).token;
    const fdToken = (await loginAs(fd.email)).token;

    const created = await api()
      .post('/api/v1/chatbot/faqs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ question: 'Do you have a gym?', answer: 'No gym, but yoga on the rooftop at 7 AM.', category: 'amenities' });
    expect(created.status).toBe(201);
    expect((await api().get('/api/v1/chatbot/faqs').set('Authorization', `Bearer ${fdToken}`)).body.data).toHaveLength(3);
    expect((await api().post('/api/v1/chatbot/faqs').set('Authorization', `Bearer ${fdToken}`).send({ question: 'Hack question?', answer: 'x' })).status).toBe(
      403,
    );

    generateContent.mockResolvedValueOnce(textReply('No gym, but rooftop yoga at 7 AM!'));
    await send(hotel._id, 'Is there a gym?');
    expect(callArgs(0).config.systemInstruction).toContain('yoga on the rooftop at 7 AM');
  });
});
