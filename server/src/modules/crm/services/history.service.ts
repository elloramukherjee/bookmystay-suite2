import { Types } from 'mongoose';
import { notFound } from '../../../shared/errors.js';
import type { AuthContext } from '../../../types/express.js';
import { formatINR } from '../../../utils/money.js';
import { Booking } from '../../bookings/booking.model.js';
import { ChatMessage } from '../../chatbot/models/chatMessage.model.js';
import { Conversation } from '../../chatbot/models/conversation.model.js';
import { ServiceRequest } from '../../chatbot/models/serviceRequest.model.js';
import { Guest } from '../../guests/guest.model.js';
import { assertCanSee, SOURCE_LABEL } from '../../guests/guest.service.js';
import { FollowUp } from '../models/followUp.model.js';

const NOTE_LABEL: Record<string, string> = { general: 'General', room: 'Room', fnb: 'Food & drink' };

/** Hotel-local stay day ("YYYY-MM-DD") as "14 Dec" / "17 Dec 2026". */
function stayDay(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }), timeZone: 'UTC' });
}

export type TimelineKind = 'booking' | 'stay' | 'cancellation' | 'conversation' | 'escalation' | 'request' | 'note' | 'follow_up';

export interface TimelineEvent {
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  refId: string | null;
}

/**
 * Everything the hotel knows about one guest, newest first: bookings (any channel), stays, chats (with the
 * AI or staff), requests, notes and follow-ups. This is the PRD's "every exchange becomes guest history".
 */
export async function guestHistory(actor: AuthContext, hotelId: Types.ObjectId, guestId: string): Promise<{ guestId: string; events: TimelineEvent[] }> {
  if (!Types.ObjectId.isValid(guestId)) throw notFound('Guest');
  const guest = await Guest.findOne({ _id: guestId, hotelId }).lean();
  if (!guest) throw notFound('Guest');
  await assertCanSee(actor, hotelId, guest._id);

  const [bookings, conversations, requests, followUps] = await Promise.all([
    Booking.find({ hotelId, guestId: guest._id }).lean(),
    Conversation.find({ hotelId, guestId: guest._id }).lean(),
    ServiceRequest.find({ hotelId, guestId: guest._id }).lean(),
    FollowUp.find({ hotelId, guestId: guest._id, status: { $ne: 'discarded' } }).lean(),
  ]);
  const firstMessages = await ChatMessage.aggregate<{ _id: Types.ObjectId; text: string }>([
    { $match: { conversationId: { $in: conversations.map((c) => c._id) }, sender: 'guest' } },
    { $sort: { createdAt: 1 } },
    { $group: { _id: '$conversationId', text: { $first: '$text' } } },
  ]);
  const firstText = new Map(firstMessages.map((m) => [String(m._id), m.text]));

  const events: TimelineEvent[] = [];
  for (const b of bookings) {
    const source = SOURCE_LABEL[b.source] ?? b.source;
    events.push({
      kind: 'booking',
      at: b.createdAt.toISOString(),
      title: `Booked ${b.quantity} × ${b.roomTypeName} via ${source}`,
      detail: `${stayDay(b.checkIn)} → ${stayDay(b.checkOut, true)} · ${b.reference} · ${formatINR(b.amounts.totalPaise)}`,
      refId: String(b._id),
    });
    if (b.checkedInAt)
      events.push({
        kind: 'stay',
        at: b.checkedInAt.toISOString(),
        title: `Checked in${b.roomNumber ? ` · room ${b.roomNumber}` : ''}`,
        detail: b.roomTypeName,
        refId: String(b._id),
      });
    if (b.checkedOutAt)
      events.push({
        kind: 'stay',
        at: b.checkedOutAt.toISOString(),
        title: 'Checked out',
        detail: `${b.nights} night${b.nights > 1 ? 's' : ''}`,
        refId: String(b._id),
      });
    if (b.cancelledAt)
      events.push({
        kind: 'cancellation',
        at: b.cancelledAt.toISOString(),
        title: `Cancelled ${b.reference}`,
        detail: b.cancellationReason,
        refId: String(b._id),
      });
  }
  for (const c of conversations) {
    events.push({
      kind: 'conversation',
      at: c.createdAt.toISOString(),
      title: `${c.channel === 'web' ? 'Website' : c.channel === 'simulator' ? 'Simulated WhatsApp' : 'WhatsApp'} chat (${c.messageCount} message${c.messageCount === 1 ? '' : 's'})`,
      detail: firstText.get(String(c._id)) ?? c.lastMessagePreview,
      refId: String(c._id),
    });
    if (c.escalation)
      events.push({
        kind: 'escalation',
        at: new Date(c.escalation.at).toISOString(),
        title: `Escalated to staff: ${c.escalation.category.replace(/_/g, ' ')}`,
        detail: c.escalation.reason,
        refId: String(c._id),
      });
  }
  for (const r of requests) {
    events.push({
      kind: 'request',
      at: r.createdAt.toISOString(),
      title: `Request: ${r.type.replace(/_/g, ' ')} (${r.status})`,
      detail: r.details,
      refId: String(r._id),
    });
  }
  for (const n of guest.notes) {
    events.push({ kind: 'note', at: n.createdAt.toISOString(), title: `Staff note · ${NOTE_LABEL[n.category] ?? n.category}`, detail: n.text, refId: null });
  }
  for (const f of followUps) {
    events.push({
      kind: 'follow_up',
      at: (f.sentAt ?? f.createdAt).toISOString(),
      title: f.status === 'draft' ? 'Follow-up drafted' : 'Follow-up sent',
      detail: f.text,
      refId: String(f._id),
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return { guestId: String(guest._id), events };
}
