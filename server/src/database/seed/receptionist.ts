import type { Types } from 'mongoose';
import { Booking } from '../../modules/bookings/booking.model.js';
import { ChatMessage } from '../../modules/chatbot/models/chatMessage.model.js';
import { Conversation } from '../../modules/chatbot/models/conversation.model.js';
import { HotelFaq, type HotelFaqShape } from '../../modules/chatbot/models/hotelFaq.model.js';
import { ServiceRequest } from '../../modules/chatbot/models/serviceRequest.model.js';
import { Guest } from '../../modules/guests/guest.model.js';

type Faq = Pick<HotelFaqShape, 'question' | 'answer' | 'category' | 'keywords'>;

export const SEED_FAQS: Faq[] = [
  {
    category: 'arrival',
    question: 'How do I reach the hotel from Jaipur airport or railway station?',
    answer:
      'The haveli is about 13 km (35–45 minutes) from Jaipur International Airport and 4 km (15 minutes) from Jaipur Junction railway station. We can arrange a pickup: ₹1,200 one way by sedan, ₹1,800 by SUV (Innova). Book it with us at least 6 hours in advance.',
    keywords: ['directions', 'airport', 'station', 'pickup', 'taxi'],
  },
  {
    category: 'arrival',
    question: 'Can I check in early?',
    answer:
      'Standard check-in is from 1:00 PM. Early check-in depends on the room being ready. Direct bookers get complimentary early check-in from 11:00 AM when the room is available; before that, we can store your luggage and you can freshen up in the lounge.',
    keywords: ['early check-in', 'arrive early'],
  },
  {
    category: 'arrival',
    question: 'Can I get a late checkout?',
    answer:
      'Standard check-out is by 11:00 AM. Direct bookers can request a complimentary late check-out until 2:00 PM, subject to availability — the front desk confirms on the morning of departure. Later than 2 PM is charged at 50% of the nightly rate.',
    keywords: ['late checkout', 'leave late'],
  },
  {
    category: 'amenities',
    question: 'Is there Wi-Fi?',
    answer:
      'Yes, free high-speed Wi-Fi throughout the haveli. The network is "HeritageCourtyard_Guest"; the password is printed on your room key card and is also given at check-in.',
    keywords: ['wifi', 'internet', 'password'],
  },
  {
    category: 'amenities',
    question: 'Do you have a swimming pool or spa?',
    answer:
      'There is no shared swimming pool; the Royal Haveli Penthouse has a private plunge pool. Our Ayurvedic spa is open 9:00 AM to 8:00 PM — treatments start at ₹1,800; please book at the front desk.',
    keywords: ['pool', 'spa', 'massage'],
  },
  {
    category: 'amenities',
    question: 'Is there power backup?',
    answer: 'Yes, the entire property has full generator power backup, including air conditioning.',
    keywords: ['power cut', 'electricity'],
  },
  {
    category: 'dining',
    question: 'What are the breakfast timings?',
    answer: 'Breakfast is served 7:30 AM to 10:30 AM in the courtyard. It is included in the Bed & breakfast plan; otherwise it is ₹650 per person.',
    keywords: ['breakfast', 'morning'],
  },
  {
    category: 'dining',
    question: 'Do you have a restaurant and room service?',
    answer:
      'Our farm-to-thali restaurant serves lunch 12:30–3:00 PM and dinner 7:30–10:30 PM (Rajasthani thali and à la carte, pure vegetarian options available, Jain food on request). In-room dining is available 7:00 AM to 11:00 PM. Masala chai is available round the clock.',
    keywords: ['restaurant', 'dinner', 'lunch', 'room service', 'chai', 'jain'],
  },
  {
    category: 'services',
    question: 'Do you offer laundry?',
    answer: 'Yes, same-day laundry if handed over before 10:00 AM. Prices are listed in the room folder.',
    keywords: ['laundry', 'washing', 'ironing'],
  },
  {
    category: 'services',
    question: 'Is a doctor available?',
    answer:
      'A doctor on call can visit the hotel; the nearest multispeciality hospital is about 3 km away. Please tell the front desk and we will arrange it immediately.',
    keywords: ['doctor', 'medical'],
  },
  {
    category: 'local',
    question: 'What should I see nearby?',
    answer:
      'Hawa Mahal (2 km), City Palace and Jantar Mantar (2.5 km) are a short rickshaw ride away; Amber Fort is 11 km. For shopping, Johari Bazaar for jewellery and Bapu Bazaar for textiles and mojaris. For sweets and kachoris, Laxmi Misthan Bhandar in Johari Bazaar. Our folk music evening on the rooftop is daily at 7:00 PM.',
    keywords: ['sightseeing', 'places', 'shopping', 'things to do', 'recommend'],
  },
  {
    category: 'local',
    question: 'Can you arrange a city tour or cab?',
    answer:
      'Yes. A full-day Jaipur sightseeing car with driver is ₹3,200 (sedan, 8 hours / 80 km). We can also book a licensed guide for ₹1,500. Ask the front desk a day in advance.',
    keywords: ['tour', 'cab', 'car', 'guide', 'sightseeing'],
  },
  {
    category: 'policies',
    question: 'Is the hotel suitable for elderly guests or wheelchair users?',
    answer:
      'Ground-floor Deluxe Courtyard Suites have step-free access from the courtyard. Upper floors are reached by stairs only (heritage building, no lift). Please let us know in advance so we can allocate a ground-floor room.',
    keywords: ['elderly', 'wheelchair', 'stairs', 'lift', 'accessibility'],
  },
];

/** Knowledge base + a few realistic desk conversations (mirroring Stitch screen 2) so the desk isn't empty. */
export async function seedReceptionist(hotelId: Types.ObjectId): Promise<{ faqs: number; conversations: number }> {
  let faqs = 0;
  for (const [i, f] of SEED_FAQS.entries()) {
    const r = await HotelFaq.updateOne({ hotelId, question: f.question }, { $setOnInsert: { ...f, hotelId, published: true, sortOrder: i } }, { upsert: true });
    faqs += r.upsertedCount;
  }
  if (await Conversation.exists({ hotelId })) return { faqs, conversations: 0 };

  const now = Date.now();
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);
  let conversations = 0;

  // 1) In-house guest: towel request, AI handled (Stitch "Room 204 · AI handled").
  const meera = await Guest.findOne({ hotelId, phoneE164: '+919845012399' }).lean();
  const meeraBooking = meera ? await Booking.findOne({ hotelId, guestId: meera._id, status: 'checked_in' }).lean() : null;
  if (meera && meeraBooking) {
    const c = await Conversation.create({
      hotelId,
      channel: 'whatsapp',
      channelUserId: meera.phoneE164,
      guestId: meera._id,
      bookingId: meeraBooking._id,
      guestName: meera.name,
      status: 'ai_active',
      lastMessageAt: at(2),
      lastMessagePreview: 'Your request for 2 extra towels has been sent to housekeeping…',
      lastSender: 'ai',
      messageCount: 4,
    });
    await ChatMessage.insertMany([
      { hotelId, conversationId: c._id, sender: 'guest', text: 'Namaste, is breakfast still on? And can we get 2 extra towels in room 204?', createdAt: at(4) },
      {
        hotelId,
        conversationId: c._id,
        sender: 'ai',
        text: 'Namaste Meera ji! 🙏 Breakfast is served until 10:30 AM in the courtyard. Your request for 2 extra towels has been sent to housekeeping — they’ll bring them to room 204 shortly.',
        latencyMs: 2140,
        toolCalls: [{ name: 'create_service_request', ok: true, summary: 'Logged towels request' }],
        createdAt: at(2),
      },
    ]);
    await ServiceRequest.create({
      hotelId,
      guestId: meera._id,
      bookingId: meeraBooking._id,
      conversationId: c._id,
      roomNumber: meeraBooking.roomNumber,
      type: 'towels',
      details: '2 extra towels',
      createdBy: 'ai',
      createdAt: at(2),
    });
    conversations++;
  }

  // 2) Pre-arrival direct inquiry, AI handled (Stitch "Direct inquiry · Anand Mehta").
  const anand = await Guest.findOne({ hotelId, phoneE164: '+919899876543' }).lean();
  if (anand) {
    const c = await Conversation.create({
      hotelId,
      channel: 'whatsapp',
      channelUserId: anand.phoneE164,
      guestId: anand._id,
      guestName: anand.name,
      status: 'ai_active',
      lastMessageAt: at(8),
      lastMessagePreview: 'Parking is complimentary and Innovas fit easily…',
      lastSender: 'ai',
      messageCount: 2,
    });
    await ChatMessage.insertMany([
      {
        hotelId,
        conversationId: c._id,
        sender: 'guest',
        text: 'Hi, is parking available for an Innova Crysta? Planning to come again next month.',
        createdAt: at(9),
      },
      {
        hotelId,
        conversationId: c._id,
        sender: 'ai',
        text: 'Welcome back, Anand ji! Valet parking is complimentary for one car per room inside the haveli compound, and an Innova Crysta fits easily. Share your dates and I’ll check live rates for you — booking direct also saves you 10%.',
        latencyMs: 1870,
        createdAt: at(8),
      },
    ]);
    conversations++;
  }

  // 3) Arriving guest with an AC complaint, escalated by the safety rule (Stitch "Room 108 · Staff alert").
  const rajesh = await Guest.findOne({ hotelId, phoneE164: '+919811234567' }).lean();
  const rajeshBooking = rajesh ? await Booking.findOne({ hotelId, guestId: rajesh._id, status: { $in: ['confirmed', 'checked_in'] } }).lean() : null;
  if (rajesh && rajeshBooking) {
    const c = await Conversation.create({
      hotelId,
      channel: 'whatsapp',
      channelUserId: rajesh.phoneE164,
      guestId: rajesh._id,
      bookingId: rajeshBooking._id,
      guestName: rajesh.name,
      status: 'escalated',
      everEscalated: true,
      unreadForStaff: 1,
      escalation: { category: 'complaint', reason: 'Guest complaint', at: at(1), by: 'rule', priority: 'high' },
      lastMessageAt: at(1),
      lastMessagePreview: "I'm really sorry about this. I've alerted our duty manager…",
      lastSender: 'system',
      messageCount: 3,
    });
    await ChatMessage.insertMany([
      {
        hotelId,
        conversationId: c._id,
        sender: 'guest',
        text: 'Bhaiya, we checked in twenty minutes back but the AC is not cooling and the room is quite warm. We have an elderly parent with us. Please fix quickly.',
        createdAt: at(2),
      },
      {
        hotelId,
        conversationId: c._id,
        sender: 'system',
        text: "I'm really sorry about this. I've alerted our duty manager, who will personally reply here shortly.",
        toolCalls: [{ name: 'safety_rule', ok: true, summary: 'Guest complaint' }],
        createdAt: at(1),
      },
      { hotelId, conversationId: c._id, sender: 'system', text: 'Escalated to staff (complaint): Guest complaint', visibleToGuest: false, createdAt: at(1) },
    ]);
    conversations++;
  }
  return { faqs, conversations };
}
