import type { Types } from 'mongoose';
import { todayInTimeZone } from '../../../utils/dates.js';
import { Booking, type BookingLean } from '../../bookings/booking.model.js';
import { Guest, type GuestLean } from '../../guests/guest.model.js';
import { GuestPreference } from '../../guests/guestPreference.model.js';
import { Hotel, type HotelLean } from '../../hotels/hotel.model.js';
import { HotelPolicy, type HotelPolicyLean } from '../../hotels/hotelPolicy.model.js';
import { RoomType, type RoomTypeLean } from '../../rooms/roomType.model.js';
import type { ConversationLean } from '../models/conversation.model.js';
import { HotelFaq, type HotelFaqLean } from '../models/hotelFaq.model.js';

export interface Knowledge {
  hotel: HotelLean;
  policies: HotelPolicyLean[];
  faqs: HotelFaqLean[];
  roomTypes: RoomTypeLean[];
  today: string;
}

export interface GuestContext {
  guest: GuestLean | null;
  /** Only present when the conversation is authorised for this booking. */
  booking: BookingLean | null;
  preferences: { category: string; key: string; value: string }[];
}

/** Hotel facts the receptionist may state. Unpublished FAQs/policies are never sent to the model. */
export async function loadKnowledge(hotelId: Types.ObjectId): Promise<Knowledge> {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw new Error('Hotel not found');
  const [policies, faqs, roomTypes] = await Promise.all([
    HotelPolicy.find({ hotelId, published: true }).lean(),
    HotelFaq.find({ hotelId, published: true }).sort({ category: 1, sortOrder: 1 }).limit(80).lean(),
    RoomType.find({ hotelId, isActive: true }).sort({ sortOrder: 1 }).lean(),
  ]);
  return { hotel, policies, faqs, roomTypes, today: todayInTimeZone(hotel.timezone) };
}

/**
 * Guest context is scoped to THIS conversation's verified identity. Other guests' data never enters the
 * prompt, and booking details are included only when the conversation is authorised for that booking.
 */
export async function loadGuestContext(conversation: Pick<ConversationLean, 'hotelId' | 'guestId' | 'bookingId'>): Promise<GuestContext> {
  const [guest, booking, prefs] = await Promise.all([
    conversation.guestId ? Guest.findOne({ _id: conversation.guestId, hotelId: conversation.hotelId }).lean() : null,
    conversation.bookingId ? Booking.findOne({ _id: conversation.bookingId, hotelId: conversation.hotelId }).lean() : null,
    conversation.guestId ? GuestPreference.find({ hotelId: conversation.hotelId, guestId: conversation.guestId }).limit(20).lean() : [],
  ]);
  return { guest, booking, preferences: prefs.map((p) => ({ category: p.category, key: p.key, value: p.value })) };
}

/**
 * For WhatsApp/simulator conversations the sender number is verified by the channel, so we can link the
 * guest's most relevant booking (in-house first, then the next upcoming stay).
 */
export async function findRelevantBooking(hotelId: Types.ObjectId, guestId: Types.ObjectId, today: string): Promise<BookingLean | null> {
  const inHouse = await Booking.findOne({ hotelId, guestId, status: 'checked_in' }).sort({ checkIn: -1 }).lean();
  if (inHouse) return inHouse;
  return Booking.findOne({ hotelId, guestId, status: 'confirmed', checkOut: { $gte: today } })
    .sort({ checkIn: 1 })
    .lean();
}
