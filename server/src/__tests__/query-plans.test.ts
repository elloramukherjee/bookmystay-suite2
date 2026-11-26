import { Types, type Model } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../modules/auth/refreshToken.model.js';
import { Availability } from '../modules/availability/availability.model.js';
import { Booking } from '../modules/bookings/booking.model.js';
import { ChatMessage } from '../modules/chatbot/models/chatMessage.model.js';
import { Conversation } from '../modules/chatbot/models/conversation.model.js';
import { ServiceRequest } from '../modules/chatbot/models/serviceRequest.model.js';
import { Guest } from '../modules/guests/guest.model.js';
import { Notification } from '../modules/notifications/notification.model.js';
import { WhatsAppMessage } from '../modules/whatsapp/whatsappMessage.model.js';
import { useTestDatabase } from '../test/helpers.js';

/**
 * The hot paths (every page load, every inbound message, every outbox tick) must be served by an index.
 * A COLLSCAN here would be invisible in development and slow in production as data grows.
 */
useTestDatabase();

type Stage = { stage?: string; inputStage?: Stage; inputStages?: Stage[]; indexName?: string };
function stages(plan: Stage): Stage[] {
  return [plan, ...(plan.inputStage ? stages(plan.inputStage) : []), ...(plan.inputStages ?? []).flatMap(stages)];
}
async function planFor(model: Model<any>, filter: Record<string, unknown>, sort?: Record<string, 1 | -1>) {
  // An empty collection can still be explained; the planner picks from the declared indexes.
  await model.createIndexes();
  const q = model.find(filter);
  if (sort) q.sort(sort);
  const explained = (await q.explain('queryPlanner')) as unknown as { queryPlanner: { winningPlan: Stage & { queryPlan?: Stage } } };
  const winning = explained.queryPlanner.winningPlan;
  return stages(winning.queryPlan ?? winning);
}

const hotelId = new Types.ObjectId();
const id = new Types.ObjectId();
const CASES: [string, () => Promise<Stage[]>][] = [
  ['availability nights for a stay', () => planFor(Availability, { hotelId, roomTypeId: id, date: { $in: ['2026-12-01', '2026-12-02'] } })],
  ['booking by reference (guest lookup)', () => planFor(Booking, { reference: 'BMS-ABC123' })],
  ['today roster: in-house', () => planFor(Booking, { hotelId, status: 'checked_in' }, { checkOut: 1 })],
  ['guest history bookings', () => planFor(Booking, { hotelId, guestId: id }, { checkIn: -1 })],
  ['hold expiry sweeper', () => planFor(Booking, { status: 'pending_payment', holdExpiresAt: { $lte: new Date() } })],
  ['guest by phone (identity)', () => planFor(Guest, { hotelId, phoneE164: '+919811234567' })],
  ['outbox claim', () => planFor(Notification, { status: { $in: ['queued', 'failed'] }, nextAttemptAt: { $lte: new Date() } }, { nextAttemptAt: 1 })],
  ['WhatsApp delivery receipt', () => planFor(Notification, { channel: 'whatsapp', providerMessageId: 'wamid.X' })],
  ['open staff call tasks', () => planFor(Notification, { hotelId, 'manualFollowUp.required': true, 'manualFollowUp.resolvedAt': null })],
  ['WhatsApp dedupe by wamid', () => planFor(WhatsAppMessage, { waMessageId: 'wamid.X' })],
  ['WhatsApp inbound recovery', () => planFor(WhatsAppMessage, { direction: 'in', status: 'received', createdAt: { $lt: new Date() } })],
  ['concierge desk list', () => planFor(Conversation, { hotelId, status: 'escalated' }, { lastMessageAt: -1 })],
  ['phone conversation lookup', () => planFor(Conversation, { hotelId, channel: 'whatsapp', channelUserId: '+919811234567' }, { lastMessageAt: -1 })],
  ['chat transcript', () => planFor(ChatMessage, { conversationId: id }, { createdAt: 1 })],
  ['open service requests', () => planFor(ServiceRequest, { hotelId, status: 'open' }, { createdAt: -1 })],
  ['refresh token rotation', () => planFor(RefreshToken, { tokenHash: 'abc' })],
];

describe('query plans', () => {
  it.each(CASES)('%s uses an index', async (_name, run) => {
    const plan = await run();
    expect(plan.map((s) => s.stage)).not.toContain('COLLSCAN');
    expect(plan.some((s) => s.stage === 'IXSCAN' || s.stage === 'IDHACK' || s.stage === 'EXPRESS_IXSCAN')).toBe(true);
  });
});
