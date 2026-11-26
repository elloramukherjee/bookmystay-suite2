import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { requirePhone, upsertGuest } from '../../shared/guestIdentity.js';
import { escapeRegex, pageMeta } from '../../shared/pagination.js';
import type { AuthContext } from '../../types/express.js';
import { addDays, todayInTimeZone } from '../../utils/dates.js';
import { normalizePhone } from '../../utils/phone.js';
import { Booking, type BookingLean } from '../bookings/booking.model.js';
import { Conversation } from '../chatbot/models/conversation.model.js';
import { Hotel } from '../hotels/hotel.model.js';
import { Guest, type GuestLean } from './guest.model.js';
import { GuestPreference } from './guestPreference.model.js';

const STAY_STATUSES = ['confirmed', 'checked_in', 'checked_out'] as const;

export const SOURCE_LABEL: Record<string, string> = {
  direct: 'Direct',
  ota_mmt: 'MakeMyTrip',
  ota_goibibo: 'Goibibo',
  ota_bookingcom: 'Booking.com',
  ota_agoda: 'Agoda',
  ota_other: 'OTA',
  walk_in: 'Walk-in',
  phone: 'Phone',
  chat: 'Chat',
  manual: 'Added by staff',
};

/** Plain-language tiers (PRD: no CRM jargon for owners). */
export function guestTier(completedStays: number): { label: string; level: 'new' | 'returning' | 'regular' } {
  if (completedStays >= 3) return { label: `Regular · ${completedStays} stays`, level: 'regular' };
  if (completedStays >= 1) return { label: `Returning · ${completedStays} stay${completedStays > 1 ? 's' : ''}`, level: 'returning' };
  return { label: 'New guest', level: 'new' };
}

/** "MakeMyTrip → Direct ×3": how this guest's relationship moved between channels. */
export function stayPath(sources: string[]): string {
  const groups: { label: string; n: number }[] = [];
  for (const s of sources) {
    const label = SOURCE_LABEL[s] ?? s;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.n++;
    else groups.push({ label, n: 1 });
  }
  return groups.map((g) => (g.n > 1 ? `${g.label} ×${g.n}` : g.label)).join(' → ');
}

/**
 * Front desk sees "relevant" guests only (PRD/ARCHITECTURE): anyone with a stay from 7 days ago to 30 days
 * ahead, or an open conversation. Owners/managers (`guests.read_all`) see the whole register.
 */
export async function relevantGuestIds(hotelId: Types.ObjectId, timezone: string): Promise<Types.ObjectId[]> {
  const today = todayInTimeZone(timezone);
  const [fromBookings, fromChats] = await Promise.all([
    Booking.distinct('guestId', {
      hotelId,
      status: { $in: ['pending_payment', ...STAY_STATUSES] },
      checkOut: { $gte: addDays(today, -7) },
      checkIn: { $lte: addDays(today, 30) },
    }),
    Conversation.distinct('guestId', { hotelId, status: { $in: ['ai_active', 'escalated', 'staff_active'] }, guestId: { $ne: null } }),
  ]);
  const seen = new Set<string>();
  return [...fromBookings, ...fromChats].filter((id) => id && !seen.has(String(id)) && seen.add(String(id))) as Types.ObjectId[];
}

export async function assertCanSee(actor: AuthContext, hotelId: Types.ObjectId, guestId: Types.ObjectId) {
  if (actor.permissions.has('guests.read_all')) return;
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const ids = await relevantGuestIds(hotelId, hotel?.timezone ?? 'Asia/Kolkata');
  if (!ids.some((id) => id.equals(guestId))) throw notFound('Guest');
}

export interface GuestListQuery {
  q?: string | undefined;
  filter?: 'all' | 'returning' | 'direct' | 'ota' | 'ota_converts' | 'in_house' | 'marketing' | undefined;
  page: number;
  limit: number;
}

export async function listGuests(actor: AuthContext, hotelId: Types.ObjectId, query: GuestListQuery) {
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const timezone = hotel?.timezone ?? 'Asia/Kolkata';
  const filter: Record<string, unknown> = { hotelId, 'privacy.anonymisedAt': null };
  const and: Record<string, unknown>[] = [];

  if (!actor.permissions.has('guests.read_all')) and.push({ _id: { $in: await relevantGuestIds(hotelId, timezone) } });

  switch (query.filter) {
    case 'returning':
      and.push({ 'stats.completedStays': { $gte: 1 } });
      break;
    case 'direct':
      and.push({ 'stats.directBookings': { $gte: 1 } });
      break;
    case 'ota':
      and.push({ 'stats.otaBookings': { $gte: 1 } });
      break;
    case 'ota_converts':
      and.push({ 'stats.otaBookings': { $gte: 1 }, 'stats.directBookings': { $gte: 1 } });
      break;
    case 'marketing':
      and.push({ 'consent.marketing.granted': true });
      break;
    case 'in_house':
      and.push({ _id: { $in: await Booking.distinct('guestId', { hotelId, status: 'checked_in' }) } });
      break;
  }

  if (query.q) {
    const q = query.q.trim();
    const or: Record<string, unknown>[] = [{ name: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }];
    const phone = normalizePhone(q);
    const digits = q.replace(/\D/g, '');
    if (phone) or.push({ phoneE164: phone });
    else if (digits.length >= 4) or.push({ phoneE164: new RegExp(`${escapeRegex(digits)}$`) });
    if (/^BMS-?[A-Z0-9]{3,}/i.test(q)) {
      const ids = await Booking.distinct('guestId', { hotelId, reference: new RegExp(`^${escapeRegex(q.toUpperCase().replace(/^BMS-?/, 'BMS-'))}`) });
      or.push({ _id: { $in: ids } });
    }
    and.push({ $or: or });
  }
  if (and.length) filter.$and = and;

  const [guests, total] = await Promise.all([
    Guest.find(filter)
      .sort({ 'stats.lastStayAt': -1, updatedAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    Guest.countDocuments(filter),
  ]);
  return { items: await toLedgerItems(hotelId, guests, timezone), meta: pageMeta(query.page, query.limit, total) };
}

/** Ledger rows enriched with stay path, current/next stay and the key preference (Stitch "Guest Intelligence Ledger"). */
async function toLedgerItems(hotelId: Types.ObjectId, guests: GuestLean[], timezone: string) {
  if (!guests.length) return [];
  const ids = guests.map((g) => g._id);
  const today = todayInTimeZone(timezone);
  const [bookings, prefs] = await Promise.all([
    Booking.find({ hotelId, guestId: { $in: ids }, status: { $in: [...STAY_STATUSES] } })
      .select('guestId source checkIn checkOut status roomNumber roomTypeName reference')
      .sort({ checkIn: 1 })
      .lean(),
    GuestPreference.find({ hotelId, guestId: { $in: ids } })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);
  return guests.map((g) => {
    const mine = bookings.filter((b) => b.guestId.equals(g._id));
    const inHouse = mine.find((b) => b.status === 'checked_in') ?? null;
    const next = mine.find((b) => b.status === 'confirmed' && b.checkIn >= today) ?? null;
    const pref = prefs.find((p) => p.guestId.equals(g._id));
    const latestNote = g.notes.at(-1);
    return {
      id: String(g._id),
      name: g.name,
      phoneE164: g.phoneE164,
      email: g.email,
      city: g.city,
      tier: guestTier(g.stats.completedStays),
      isReturning: g.stats.completedStays >= 1,
      // How they first booked; a chat or walk-in enquiry can create the profile before any booking exists.
      origin: SOURCE_LABEL[mine[0]?.source ?? g.firstSource] ?? mine[0]?.source ?? g.firstSource,
      stayPath: stayPath(mine.map((b) => b.source)),
      stats: g.stats,
      keyPreference: pref ? `${pref.key}: ${pref.value}` : (latestNote?.text ?? null),
      marketingConsent: Boolean(g.consent.marketing?.granted && !g.consent.marketing?.withdrawnAt),
      inHouse: inHouse ? { bookingId: String(inHouse._id), roomNumber: inHouse.roomNumber, checkOut: inHouse.checkOut } : null,
      nextStay: next ? { bookingId: String(next._id), checkIn: next.checkIn, roomTypeName: next.roomTypeName, reference: next.reference } : null,
    };
  });
}

export async function getGuestProfile(actor: AuthContext, hotelId: Types.ObjectId, id: string, req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Guest');
  const guest = await Guest.findOne({ _id: id, hotelId }).lean();
  if (!guest) throw notFound('Guest');
  await assertCanSee(actor, hotelId, guest._id);
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const [item] = await toLedgerItems(hotelId, [guest], hotel?.timezone ?? 'Asia/Kolkata');
  const prefs = await GuestPreference.find({ hotelId, guestId: guest._id }).sort({ category: 1, key: 1 }).lean();
  if (actor.role === 'front_desk') {
    await audit({
      hotelId,
      actor: { type: 'user', id: actor.userId, role: actor.role },
      action: 'guest.viewed',
      entity: { type: 'Guest', id: guest._id },
      req,
    });
  }
  return {
    ...item!,
    tags: guest.tags,
    notes: guest.notes
      .map((n) => ({ id: String((n as unknown as { _id: Types.ObjectId })._id), text: n.text, category: n.category, createdAt: n.createdAt.toISOString() }))
      .reverse(),
    preferences: prefs.map((p) => ({ id: String(p._id), category: p.category, key: p.key, value: p.value, source: p.source })),
    consent: {
      transactional: {
        granted: guest.consent.transactional?.granted ?? false,
        at: guest.consent.transactional?.at?.toISOString() ?? null,
        source: guest.consent.transactional?.source ?? null,
      },
      marketing: {
        granted: Boolean(guest.consent.marketing?.granted && !guest.consent.marketing?.withdrawnAt),
        at: guest.consent.marketing?.at?.toISOString() ?? null,
        source: guest.consent.marketing?.source ?? null,
        withdrawnAt: guest.consent.marketing?.withdrawnAt?.toISOString() ?? null,
      },
    },
    idVerification: {
      verified: guest.idVerification.verified,
      docType: guest.idVerification.docType,
      verifiedAt: guest.idVerification.verifiedAt?.toISOString() ?? null,
    },
    createdAt: guest.createdAt.toISOString(),
  };
}

export interface GuestInput {
  phone: string;
  name?: string | undefined;
  email?: string | undefined;
  city?: string | undefined;
  marketingConsent?: boolean | undefined;
}

/** Manual registration (walk-in, phone enquiry). Same phone → same profile; never a duplicate. */
export async function createGuest(actor: AuthContext, hotelId: Types.ObjectId, input: GuestInput, req: Request) {
  const phoneE164 = requirePhone(input.phone);
  if (await Guest.exists({ hotelId, phoneE164 })) throw conflict('A guest with this phone number already exists');
  const guest = await upsertGuest({
    hotelId,
    phone: phoneE164,
    name: input.name,
    email: input.email,
    source: 'manual',
    consent: { marketing: input.marketingConsent },
  });
  if (input.city) await Guest.updateOne({ _id: guest._id }, { $set: { city: input.city } });
  await audit({ hotelId, actor: { type: 'user', id: actor.userId, role: actor.role }, action: 'guest.created', entity: { type: 'Guest', id: guest._id }, req });
  return getGuestProfile(actor, hotelId, String(guest._id), req);
}

export interface GuestUpdate {
  name?: string | undefined;
  email?: string | null | undefined;
  city?: string | null | undefined;
  tags?: string[] | undefined;
  marketingConsent?: boolean | undefined;
}

export async function updateGuest(actor: AuthContext, hotelId: Types.ObjectId, id: string, input: GuestUpdate, req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Guest');
  const guest = await Guest.findOne({ _id: id, hotelId });
  if (!guest) throw notFound('Guest');
  await assertCanSee(actor, hotelId, guest._id);
  if (input.name !== undefined) guest.name = input.name;
  if (input.email !== undefined) guest.email = input.email || null;
  if (input.city !== undefined) guest.city = input.city || null;
  if (input.tags !== undefined) guest.tags = input.tags;
  if (input.marketingConsent !== undefined) {
    const now = new Date();
    guest.set(
      'consent.marketing',
      input.marketingConsent
        ? { granted: true, at: now, source: 'staff', withdrawnAt: null }
        : { granted: false, at: guest.consent.marketing?.at ?? null, source: guest.consent.marketing?.source ?? null, withdrawnAt: now },
    );
  }
  await guest.save();
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: input.marketingConsent === false ? 'guest.marketing_consent_withdrawn' : 'guest.updated',
    entity: { type: 'Guest', id: guest._id },
    metadata: { fields: Object.keys(input) },
    req,
  });
  return getGuestProfile(actor, hotelId, id, req);
}

export async function addNote(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  id: string,
  input: { text: string; category: 'room' | 'fnb' | 'general' },
  req: Request,
) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Guest');
  const guest = await Guest.findOne({ _id: id, hotelId }).select('_id').lean();
  if (!guest) throw notFound('Guest');
  await assertCanSee(actor, hotelId, guest._id);
  await Guest.updateOne(
    { _id: guest._id },
    { $push: { notes: { text: input.text, category: input.category, authorId: actor.userId, createdAt: new Date() } } },
  );
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'guest.note_added',
    entity: { type: 'Guest', id: guest._id },
    req,
  });
  return getGuestProfile(actor, hotelId, id, req);
}

export async function upsertPreference(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  id: string,
  input: { category: 'room' | 'fnb' | 'accessibility' | 'communication' | 'other'; key: string; value: string },
  req: Request,
) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Guest');
  const guest = await Guest.findOne({ _id: id, hotelId }).select('_id').lean();
  if (!guest) throw notFound('Guest');
  await assertCanSee(actor, hotelId, guest._id);
  await GuestPreference.updateOne(
    { hotelId, guestId: guest._id, category: input.category, key: input.key },
    { $set: { value: input.value, source: 'staff', createdBy: actor.userId } },
    { upsert: true },
  );
  return getGuestProfile(actor, hotelId, id, req);
}

export async function deletePreference(actor: AuthContext, hotelId: Types.ObjectId, id: string, prefId: string, req: Request) {
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(prefId)) throw notFound('Preference');
  await assertCanSee(actor, hotelId, new Types.ObjectId(id));
  const res = await GuestPreference.deleteOne({ _id: prefId, hotelId, guestId: id });
  if (!res.deletedCount) throw notFound('Preference');
  return getGuestProfile(actor, hotelId, id, req);
}

/** Today's booking context for a guest found by phone — powers the front desk "auto-fill" lookup. */
export async function lookupByPhone(actor: AuthContext, hotelId: Types.ObjectId, phone: string) {
  const e164 = normalizePhone(phone);
  if (!e164) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid mobile number', [{ path: 'phone', message: 'Invalid phone' }]);
  const guest = await Guest.findOne({ hotelId, phoneE164: e164 }).lean();
  if (!guest) return { guest: null, bookings: [] as BookingLean[] };
  await assertCanSee(actor, hotelId, guest._id);
  const hotel = await Hotel.findById(hotelId).select('timezone').lean();
  const today = todayInTimeZone(hotel?.timezone ?? 'Asia/Kolkata');
  const bookings = await Booking.find({ hotelId, guestId: guest._id, status: { $in: ['confirmed', 'checked_in'] }, checkOut: { $gte: today } })
    .sort({ checkIn: 1 })
    .limit(5)
    .lean();
  return { guest: { id: String(guest._id), name: guest.name, tier: guestTier(guest.stats.completedStays) }, bookings };
}
