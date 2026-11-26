import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../../shared/audit/audit.service.js';
import { appendMessage } from '../../../shared/conversationLog.js';
import { forbidden, notFound } from '../../../shared/errors.js';
import { requirePhone } from '../../../shared/guestIdentity.js';
import { escapeRegex, pageMeta } from '../../../shared/pagination.js';
import type { AuthContext } from '../../../types/express.js';
import { maskPhone } from '../../../utils/phone.js';
import { Booking } from '../../bookings/booking.model.js';
import { Guest } from '../../guests/guest.model.js';
import { User } from '../../users/user.model.js';
import { ChatMessage, type ChatMessageLean } from '../models/chatMessage.model.js';
import { Conversation, type ConversationLean, type ConversationStatus } from '../models/conversation.model.js';
import { ServiceRequest, type ServiceRequestLean } from '../models/serviceRequest.model.js';
import { isGeminiConfigured } from './gemini.service.js';
import { openPhoneConversation } from './phoneConversation.js';
import { processGuestMessage } from './receptionist.service.js';

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 } as const;

async function loadOwned(hotelId: Types.ObjectId, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Conversation');
  const conv = await Conversation.findOne({ _id: id, hotelId }).lean();
  if (!conv) throw notFound('Conversation');
  return conv;
}

/** Escalated conversations need a manager-level permission to take over or answer. */
function assertCanHandle(actor: AuthContext, conv: ConversationLean) {
  if (conv.status === 'escalated' && !actor.permissions.has('conversations.escalations')) {
    throw forbidden('A manager needs to take over escalated conversations');
  }
}

async function staffName(userId: Types.ObjectId): Promise<string> {
  const u = await User.findById(userId).select('name').lean();
  return u?.name ?? 'Front desk';
}

export function toMessageView(m: ChatMessageLean, audience: 'staff' | 'guest') {
  return {
    id: String(m._id),
    sender: m.sender,
    text: m.text,
    // Guests see the staff member's first name only.
    staffName: m.staffName ? (audience === 'guest' ? m.staffName.split(' ')[0] : m.staffName) : null,
    latencyMs: audience === 'staff' ? m.latencyMs : null,
    toolCalls: audience === 'staff' ? m.toolCalls : [],
    visibleToGuest: m.visibleToGuest,
    deliveryStatus: m.deliveryStatus,
    createdAt: m.createdAt.toISOString(),
  };
}

function toListItem(c: ConversationLean, extra: { roomNumber: string | null; bookingRef: string | null; guestPhone: string | null; returning: boolean }) {
  return {
    id: String(c._id),
    channel: c.channel,
    status: c.status,
    guestName: c.guestName,
    guestPhoneMasked: extra.guestPhone ? maskPhone(extra.guestPhone) : null,
    roomNumber: extra.roomNumber,
    bookingReference: extra.bookingRef,
    isReturning: extra.returning,
    escalation: c.escalation,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessagePreview: c.lastMessagePreview,
    lastSender: c.lastSender,
    unreadForStaff: c.unreadForStaff,
    assignedTo: c.assignedTo ? String(c.assignedTo) : null,
  };
}

export async function listConversations(hotelId: Types.ObjectId, q: { status?: string; channel?: string; q?: string; page: number; limit: number }) {
  const filter: Record<string, unknown> = { hotelId };
  if (q.status === 'open') filter.status = { $in: ['ai_active', 'escalated', 'staff_active'] };
  else if (q.status) filter.status = { $in: q.status.split(',') };
  if (q.channel) filter.channel = q.channel;
  if (q.q) filter.$or = [{ guestName: new RegExp(escapeRegex(q.q), 'i') }, { lastMessagePreview: new RegExp(escapeRegex(q.q), 'i') }];

  const [items, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    Conversation.countDocuments(filter),
  ]);
  // Escalations first (urgent before high), then most recent — the Stitch "staff intervention queue".
  items.sort((a, b) => {
    const ra = a.status === 'escalated' ? PRIORITY_RANK[a.escalation?.priority ?? 'normal'] : 9;
    const rb = b.status === 'escalated' ? PRIORITY_RANK[b.escalation?.priority ?? 'normal'] : 9;
    return ra - rb || b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });

  const bookings = await Booking.find({ _id: { $in: items.map((c) => c.bookingId).filter(Boolean) } })
    .select('reference roomNumber')
    .lean();
  const guests = await Guest.find({ _id: { $in: items.map((c) => c.guestId).filter(Boolean) } })
    .select('phoneE164 stats.completedStays')
    .lean();
  const bMap = new Map(bookings.map((b) => [String(b._id), b]));
  const gMap = new Map(guests.map((g) => [String(g._id), g]));

  return {
    items: items.map((c) => {
      const b = c.bookingId ? bMap.get(String(c.bookingId)) : undefined;
      const g = c.guestId ? gMap.get(String(c.guestId)) : undefined;
      return toListItem(c, {
        roomNumber: b?.roomNumber ?? null,
        bookingRef: b?.reference ?? null,
        guestPhone: g?.phoneE164 ?? null,
        returning: (g?.stats.completedStays ?? 0) > 0,
      });
    }),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export async function getConversation(hotelId: Types.ObjectId, id: string, actor: AuthContext, req: Request) {
  const conv = await loadOwned(hotelId, id);
  const [messages, guest, booking, requests] = await Promise.all([
    ChatMessage.find({ conversationId: conv._id }).sort({ createdAt: 1 }).limit(500).lean(),
    conv.guestId ? Guest.findById(conv.guestId).lean() : null,
    conv.bookingId ? Booking.findById(conv.bookingId).lean() : null,
    ServiceRequest.find({ conversationId: conv._id }).sort({ createdAt: -1 }).lean(),
  ]);
  if (conv.unreadForStaff) await Conversation.updateOne({ _id: conv._id }, { $set: { unreadForStaff: 0 } });
  if (actor.role === 'front_desk' && guest) {
    await audit({
      hotelId,
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action: 'guest.viewed_in_chat',
      entity: { type: 'Guest', id: guest._id },
      req,
    });
  }
  return {
    conversation: toListItem(conv, {
      roomNumber: booking?.roomNumber ?? null,
      bookingRef: booking?.reference ?? null,
      guestPhone: guest?.phoneE164 ?? null,
      returning: (guest?.stats.completedStays ?? 0) > 0,
    }),
    messages: messages.map((m) => toMessageView(m, 'staff')),
    guest: guest
      ? {
          id: String(guest._id),
          name: guest.name,
          phoneE164: guest.phoneE164,
          email: guest.email,
          city: guest.city,
          stats: guest.stats,
          isReturning: guest.stats.completedStays > 0,
          tags: guest.tags,
          notes: guest.notes.slice(-5).map((n) => ({ text: n.text, category: n.category, createdAt: n.createdAt.toISOString() })),
        }
      : null,
    booking: booking
      ? {
          id: String(booking._id),
          reference: booking.reference,
          roomTypeName: booking.roomTypeName,
          roomNumber: booking.roomNumber,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          status: booking.status,
          source: booking.source,
          paymentStatus: booking.paymentStatus,
          totalPaise: booking.amounts.totalPaise,
          adults: booking.adults,
          children: booking.children,
        }
      : null,
    serviceRequests: requests.map(toServiceRequestView),
    aiConfigured: isGeminiConfigured(),
  };
}

export async function takeOver(actor: AuthContext, hotelId: Types.ObjectId, id: string, req: Request) {
  const conv = await loadOwned(hotelId, id);
  assertCanHandle(actor, conv);
  if (conv.status === 'staff_active' && conv.assignedTo?.equals(actor.userId)) return conv;
  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id, status: { $in: ['ai_active', 'escalated', 'resolved', 'staff_active'] } },
    { $set: { status: 'staff_active', assignedTo: actor.userId, takenOverAt: new Date(), unreadForStaff: 0 } },
    { new: true },
  ).lean();
  const name = await staffName(actor.userId);
  await appendMessage(updated!, { sender: 'system', text: `${name.split(' ')[0]} from our front desk has joined the chat.` });
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'conversation.taken_over',
    entity: { type: 'Conversation', id: conv._id },
    req,
  });
  return updated!;
}

/** A staff reply. Replying to an AI-handled chat implicitly takes it over, so the bot stops talking. */
export async function staffReply(actor: AuthContext, hotelId: Types.ObjectId, id: string, input: { text: string; internal: boolean }, req: Request) {
  let conv = await loadOwned(hotelId, id);
  assertCanHandle(actor, conv);
  if (!input.internal && conv.status !== 'staff_active') {
    conv = await takeOver(actor, hotelId, id, req);
  }
  const name = await staffName(actor.userId);
  const msg = await appendMessage(conv, { sender: 'staff', text: input.text, staffId: actor.userId, staffName: name, visibleToGuest: !input.internal });
  await Conversation.updateOne({ _id: conv._id }, { $set: { unreadForStaff: 0 } });
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: input.internal ? 'conversation.note' : 'conversation.replied',
    entity: { type: 'Conversation', id: conv._id },
    req,
  });
  return toMessageView(msg, 'staff');
}

export async function resolveConversation(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  id: string,
  input: { resumeAi: boolean; note?: string | undefined },
  req: Request,
) {
  const conv = await loadOwned(hotelId, id);
  assertCanHandle(actor, conv);
  const status: ConversationStatus = input.resumeAi ? 'ai_active' : 'resolved';
  const updated = await Conversation.findOneAndUpdate(
    { _id: conv._id },
    { $set: { status, resolvedAt: new Date(), assignedTo: null, unreadForStaff: 0 } },
    { new: true },
  ).lean();
  if (input.note) await appendMessage(updated!, { sender: 'system', text: `Resolution note: ${input.note}`, visibleToGuest: false });
  await appendMessage(updated!, {
    sender: 'system',
    text: input.resumeAi
      ? 'Our team has wrapped up here — our AI concierge is back to help with anything else.'
      : 'Our team has marked this conversation resolved. Message us anytime if you need anything else.',
  });
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'conversation.resolved',
    entity: { type: 'Conversation', id: conv._id },
    metadata: { resumeAi: input.resumeAi, category: conv.escalation?.category ?? null },
    req,
  });
  return updated!;
}

// ─── Service requests ─────────────────────────────────────────────────────────────────────────────

export function toServiceRequestView(r: ServiceRequestLean) {
  return {
    id: String(r._id),
    shortId: String(r._id).slice(-6).toUpperCase(),
    type: r.type,
    details: r.details,
    status: r.status,
    roomNumber: r.roomNumber,
    conversationId: r.conversationId ? String(r.conversationId) : null,
    bookingId: r.bookingId ? String(r.bookingId) : null,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export async function listServiceRequests(hotelId: Types.ObjectId, status?: string) {
  const filter: Record<string, unknown> = { hotelId };
  filter.status = status ? { $in: status.split(',') } : { $in: ['open', 'acknowledged'] };
  const items = await ServiceRequest.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return items.map(toServiceRequestView);
}

const REQUEST_LABEL: Record<string, string> = {
  housekeeping: 'housekeeping',
  towels: 'towels',
  extra_bed: 'extra bed',
  late_checkout: 'late checkout',
  early_checkin: 'early check-in',
  maintenance: 'maintenance',
  food: 'food order',
  transport: 'transport',
  other: 'request',
};

/**
 * Only here — when staff record the outcome — does the guest hear that something is done or approved.
 */
export async function updateServiceRequest(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  id: string,
  input: { status: 'acknowledged' | 'done' | 'declined'; message?: string | undefined },
  req: Request,
) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Request');
  const sr = await ServiceRequest.findOneAndUpdate(
    { _id: id, hotelId },
    { $set: { status: input.status, handledBy: actor.userId, completedAt: input.status === 'done' ? new Date() : null } },
    { new: true },
  ).lean();
  if (!sr) throw notFound('Request');

  if (sr.conversationId && input.status !== 'acknowledged') {
    const conv = await Conversation.findById(sr.conversationId).lean();
    if (conv) {
      const label = REQUEST_LABEL[sr.type] ?? 'request';
      const text =
        input.message?.trim() ||
        (input.status === 'done'
          ? `Update from the front desk: your ${label} request is done${['late_checkout', 'early_checkin', 'extra_bed'].includes(sr.type) ? ' — it’s confirmed' : ''}. 🙏`
          : `Update from the front desk: we’re sorry, we can’t arrange the ${label} this time.`);
      await appendMessage(conv, { sender: 'staff', text, staffId: actor.userId, staffName: await staffName(actor.userId) });
    }
  }
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'service_request.updated',
    entity: { type: 'ServiceRequest', id: sr._id },
    metadata: { status: input.status },
    req,
  });
  return toServiceRequestView(sr);
}

// ─── Desk KPIs (Stitch KPI row) — all computed from MongoDB ──────────────────────────────────────

export async function deskStats(hotelId: Types.ObjectId) {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [total, escalatedEver, latency, inFlight, queue, openRequests] = await Promise.all([
    Conversation.countDocuments({ hotelId, createdAt: { $gte: since } }),
    Conversation.countDocuments({ hotelId, createdAt: { $gte: since }, everEscalated: true }),
    ChatMessage.aggregate<{ avg: number; under4: number; n: number }>([
      { $match: { hotelId, sender: 'ai', latencyMs: { $ne: null }, createdAt: { $gte: since } } },
      { $group: { _id: null, avg: { $avg: '$latencyMs' }, n: { $sum: 1 }, under4: { $sum: { $cond: [{ $lte: ['$latencyMs', 4000] }, 1, 0] } } } },
    ]),
    Conversation.aggregate<{ _id: string; n: number }>([
      { $match: { hotelId, status: { $in: ['ai_active', 'escalated', 'staff_active'] }, lastMessageAt: { $gte: new Date(Date.now() - 24 * 3_600_000) } } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]),
    Conversation.find({ hotelId, status: 'escalated' }).select('escalation').lean(),
    ServiceRequest.countDocuments({ hotelId, status: { $in: ['open', 'acknowledged'] } }),
  ]);
  const l = latency[0];
  const byStatus = Object.fromEntries(inFlight.map((s) => [s._id, s.n]));
  return {
    window: '7d',
    conversations: total,
    resolvedWithoutStaff: total - escalatedEver,
    automatedResolutionRate: total ? Math.round(((total - escalatedEver) / total) * 1000) / 10 : null,
    avgAiLatencyMs: l ? Math.round(l.avg) : null,
    aiRepliesUnder4sPercent: l && l.n ? Math.round((l.under4 / l.n) * 1000) / 10 : null,
    inFlight: {
      total: (byStatus.ai_active ?? 0) + (byStatus.escalated ?? 0) + (byStatus.staff_active ?? 0),
      aiActive: byStatus.ai_active ?? 0,
      staffActive: byStatus.staff_active ?? 0,
    },
    escalationQueue: { total: queue.length, urgent: queue.filter((c) => c.escalation?.priority === 'urgent').length },
    openServiceRequests: openRequests,
    aiConfigured: isGeminiConfigured(),
  };
}

// ─── Development / training simulator (WhatsApp-style, no Meta credentials needed) ───────────────

/**
 * Simulates an inbound WhatsApp message from a given phone. Like real WhatsApp, the sender number is
 * treated as verified, so the guest's in-house/upcoming booking becomes the chat's context.
 */
export async function simulateIncoming(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  input: { phone: string; name?: string | undefined; text: string },
  req: Request,
) {
  const phoneE164 = requirePhone(input.phone);
  const { conversation: conv, created } = await openPhoneConversation(hotelId, 'simulator', phoneE164, input.name);
  if (created) {
    await audit({
      hotelId,
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action: 'simulator.conversation_started',
      entity: { type: 'Conversation', id: conv._id },
      req,
    });
  }
  const outcome = await processGuestMessage(conv._id, input.text);
  return { conversationId: String(conv._id), ...outcome };
}
