import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../../shared/audit/audit.service.js';
import { appendMessage } from '../../../shared/conversationLog.js';
import { AppError, notFound } from '../../../shared/errors.js';
import { upsertGuest } from '../../../shared/guestIdentity.js';
import { normalizePhone } from '../../../utils/phone.js';
import { Booking } from '../../bookings/booking.model.js';
import type { GuestClaims } from '../../bookings/guestToken.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { signChatToken, type ChatClaims } from '../chatToken.js';
import { ChatMessage } from '../models/chatMessage.model.js';
import { Conversation, type ConversationLean } from '../models/conversation.model.js';
import { toMessageView } from './desk.service.js';
import { isGeminiConfigured } from './gemini.service.js';
import { processGuestMessage } from './receptionist.service.js';

async function publicView(conv: ConversationLean, after?: string) {
  const filter: Record<string, unknown> = { conversationId: conv._id, visibleToGuest: true };
  if (after) filter.createdAt = { $gt: new Date(after) };
  const messages = await ChatMessage.find(filter).sort({ createdAt: 1 }).limit(200).lean();
  const booking = conv.bookingId ? await Booking.findById(conv.bookingId).select('reference checkIn checkOut roomTypeName').lean() : null;
  return {
    conversationId: String(conv._id),
    status: conv.status,
    // Guests only learn that a person is handling it — not internal escalation categories.
    withStaff: conv.status === 'escalated' || conv.status === 'staff_active',
    verifiedBooking: booking
      ? { reference: booking.reference, checkIn: booking.checkIn, checkOut: booking.checkOut, roomTypeName: booking.roomTypeName }
      : null,
    messages: messages.map((m) => toMessageView(m, 'guest')),
    aiAvailable: isGeminiConfigured(),
  };
}

async function linkBooking(conv: ConversationLean, bookingId: Types.ObjectId, guestId: Types.ObjectId, guestName: string) {
  return (await Conversation.findOneAndUpdate({ _id: conv._id }, { $set: { bookingId, guestId, guestName } }, { new: true }).lean())!;
}

export interface WebMessageInput {
  hotelId: string;
  text: string;
  name?: string | undefined;
  phone?: string | undefined;
  consent?: boolean | undefined;
}

/**
 * Website chat. A new chat gets a session token scoped to its conversation. Sharing a phone number only
 * links the chat to the guest's CRM profile (so the conversation lands in their history) — it does NOT
 * unlock booking details, since anyone can type any number. Booking context needs proof: the booking
 * token from checkout, or reference + phone via verifyBooking().
 */
export async function postWebMessage(input: WebMessageInput, chat: ChatClaims | undefined, guestToken: GuestClaims | undefined, req: Request) {
  if (!Types.ObjectId.isValid(input.hotelId)) throw notFound('Hotel');
  const hotelId = new Types.ObjectId(input.hotelId);
  const hotel = await Hotel.findOne({ _id: hotelId, status: 'active' }).select('modules').lean();
  if (!hotel) throw notFound('Hotel');

  let conv: ConversationLean | null = null;
  if (chat) {
    if (chat.hid !== input.hotelId) throw new AppError(403, 'FORBIDDEN', 'This chat belongs to another property');
    conv = await Conversation.findOne({ _id: chat.cid, hotelId }).lean();
    if (!conv) throw new AppError(401, 'UNAUTHENTICATED', 'This chat session has ended. Please start a new chat.');
  } else {
    let guestId: Types.ObjectId | null = null;
    let guestName = input.name?.trim() || null;
    if (input.phone) {
      if (!normalizePhone(input.phone))
        throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid mobile number', [{ path: 'phone', message: 'Invalid phone' }]);
      if (!input.consent)
        throw new AppError(400, 'VALIDATION_ERROR', 'Please agree to the chat privacy notice to share your number', [
          { path: 'consent', message: 'Consent required' },
        ]);
      const guest = await upsertGuest({ hotelId, phone: input.phone, name: input.name, source: 'chat', consent: { transactional: true } });
      guestId = guest._id;
      guestName = guest.name ?? guestName;
    }
    conv = (await Conversation.create({ hotelId, channel: 'web', channelUserId: `web_${randomUUID()}`, guestId, guestName })).toObject() as ConversationLean;
  }

  // Arriving from the booking confirmation page: the booking token proves the stay.
  if (guestToken && guestToken.hid === input.hotelId && !conv.bookingId) {
    const b = await Booking.findOne({ _id: guestToken.bid, hotelId }).select('guestId guestSnapshot').lean();
    if (b) conv = await linkBooking(conv, b._id, b.guestId, b.guestSnapshot.name);
  }

  const since = new Date(Date.now() - 1).toISOString();
  await processGuestMessage(conv._id, input.text);
  const fresh = (await Conversation.findById(conv._id).lean())!;
  return { chatToken: signChatToken(String(conv._id), input.hotelId), ...(await publicView(fresh, chat ? since : undefined)) };
}

export async function getSession(chat: ChatClaims, after?: string) {
  const conv = await Conversation.findOne({ _id: chat.cid, hotelId: chat.hid }).lean();
  if (!conv) throw new AppError(401, 'UNAUTHENTICATED', 'This chat session has ended. Please start a new chat.');
  return publicView(conv, after);
}

/** Reference + phone proves the booking, unlocking stay-specific answers and service requests. */
export async function verifyBooking(chat: ChatClaims, reference: string, phone: string, req: Request) {
  const conv = await Conversation.findOne({ _id: chat.cid, hotelId: chat.hid }).lean();
  if (!conv) throw new AppError(401, 'UNAUTHENTICATED', 'This chat session has ended.');
  const phoneE164 = normalizePhone(phone);
  const b = phoneE164 ? await Booking.findOne({ hotelId: conv.hotelId, reference: reference.trim().toUpperCase() }).lean() : null;
  if (!b || b.guestSnapshot.phoneE164 !== phoneE164) {
    throw new AppError(404, 'NOT_FOUND', 'We couldn’t find a booking with that reference and phone number.');
  }
  const linked = await linkBooking(conv, b._id, b.guestId, b.guestSnapshot.name);
  await appendMessage(linked, { sender: 'system', text: `Booking ${b.reference} verified. You can now ask about your stay or make requests.` });
  await audit({
    hotelId: conv.hotelId,
    actor: { type: 'guest', id: b.guestId },
    action: 'chat.booking_verified',
    entity: { type: 'Conversation', id: conv._id },
    req,
  });
  return publicView(linked);
}
