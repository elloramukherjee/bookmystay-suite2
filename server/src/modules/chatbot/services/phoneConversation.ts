import type { Types } from 'mongoose';
import { findGuestByPhone, upsertGuest } from '../../../shared/guestIdentity.js';
import { todayInTimeZone } from '../../../utils/dates.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { Conversation, type ConversationLean } from '../models/conversation.model.js';
import { findRelevantBooking } from './context.service.js';

/**
 * Finds (or starts) the conversation for a phone-based channel. On WhatsApp the sender's number is
 * verified by WhatsApp itself, so the guest's in-house or next booking becomes the chat context — and is
 * refreshed on every message, so a guest who chatted before booking is recognised once they book.
 */
export async function openPhoneConversation(
  hotelId: Types.ObjectId,
  channel: 'whatsapp' | 'simulator',
  phoneE164: string,
  name?: string | null,
): Promise<{ conversation: ConversationLean; created: boolean }> {
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const today = todayInTimeZone(hotel?.timezone ?? 'Asia/Kolkata');
  const guest = (await findGuestByPhone(hotelId, phoneE164)) ?? (await upsertGuest({ hotelId, phone: phoneE164, name, source: 'chat' }));
  if (!guest.name && name?.trim()) await upsertGuest({ hotelId, phone: phoneE164, name, source: 'chat' });
  const booking = await findRelevantBooking(hotelId, guest._id, today);

  const existing = await Conversation.findOne({ hotelId, channel, channelUserId: phoneE164 }).sort({ lastMessageAt: -1 }).lean<ConversationLean>();
  if (existing) {
    const bookingId = booking?._id ?? null;
    if (String(existing.bookingId ?? '') !== String(bookingId ?? '')) {
      await Conversation.updateOne({ _id: existing._id }, { $set: { bookingId } });
      existing.bookingId = bookingId;
    }
    return { conversation: existing, created: false };
  }
  const created = await Conversation.create({
    hotelId,
    channel,
    channelUserId: phoneE164,
    guestId: guest._id,
    bookingId: booking?._id ?? null,
    guestName: guest.name ?? name ?? null,
  });
  return { conversation: created.toObject() as ConversationLean, created: true };
}
