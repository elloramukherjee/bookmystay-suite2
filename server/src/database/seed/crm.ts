import type { Types } from 'mongoose';
import { MessageTemplate } from '../../modules/crm/models/messageTemplate.model.js';
import { Guest } from '../../modules/guests/guest.model.js';
import { GuestPreference } from '../../modules/guests/guestPreference.model.js';

export const SEED_TEMPLATES = [
  {
    name: 'Thank you for staying',
    purpose: 'thank_you' as const,
    body: 'Namaste {{firstName}}! Thank you for staying with us at {{hotelName}}. It was a pleasure hosting you. Whenever you are back in Jaipur, book directly with us for our best rate — just reply here.',
    promoCode: null,
  },
  {
    name: 'Long weekend getaway',
    purpose: 'festival_offer' as const,
    body: 'Padharo sa, {{firstName}}! Escape to {{hotelName}} this long weekend: enjoy an extra 5% off with code {{code}} when you book direct, plus complimentary courtyard high tea and folk music evening.',
    promoCode: 'DIRECTSTAY',
  },
  {
    name: 'Winter reunion',
    purpose: 'reunion' as const,
    body: 'Namaste {{firstName}}, we loved hosting you last season! Jaipur winters are magical at {{hotelName}}. Your personal direct code {{code}} unlocks our best rate with zero platform fees.',
    promoCode: 'DIRECTSTAY',
  },
];

/** Follow-up templates and a few staff-recorded preferences (mirroring Stitch screen 3's guest panel). */
export async function seedCrm(hotelId: Types.ObjectId): Promise<{ templates: number; preferences: number }> {
  let templates = 0;
  for (const t of SEED_TEMPLATES) {
    const r = await MessageTemplate.updateOne({ hotelId, name: t.name }, { $setOnInsert: { ...t, hotelId, isActive: true } }, { upsert: true });
    templates += r.upsertedCount;
  }

  let preferences = 0;
  const arjun = await Guest.findOne({ hotelId, phoneE164: '+919820244552' }).lean();
  if (arjun) {
    const prefs = [
      { category: 'room' as const, key: 'Room placement', value: '2nd-floor courtyard wing, away from the breakfast courtyard noise' },
      { category: 'room' as const, key: 'Pillows', value: 'Feather-free micro-fibre pillows' },
      { category: 'fnb' as const, key: 'Morning chai', value: 'Double-boiled ginger chai at 7:30 AM, no refined sugar' },
    ];
    for (const p of prefs) {
      const r = await GuestPreference.updateOne(
        { hotelId, guestId: arjun._id, category: p.category, key: p.key },
        { $setOnInsert: { ...p, hotelId, guestId: arjun._id, source: 'staff' } },
        { upsert: true },
      );
      preferences += r.upsertedCount;
    }
    if (!arjun.notes.length) {
      await Guest.updateOne(
        { _id: arjun._id },
        {
          $push: { notes: { text: 'Prefers warm bajra rotis at dinner. Travels for work most quarters.', category: 'fnb', createdAt: new Date() } },
          $set: { tags: ['Corporate'] },
        },
      );
    }
  }
  const devendra = await Guest.findOne({ hotelId, phoneE164: '+919724533219' }).lean();
  if (devendra) {
    const r = await GuestPreference.updateOne(
      { hotelId, guestId: devendra._id, category: 'fnb', key: 'Diet' },
      { $setOnInsert: { hotelId, guestId: devendra._id, category: 'fnb', key: 'Diet', value: 'Pure vegetarian, Jain meals', source: 'staff' } },
      { upsert: true },
    );
    preferences += r.upsertedCount;
  }
  return { templates, preferences };
}
