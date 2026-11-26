import type { Request } from 'express';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { audit } from '../../shared/audit/audit.service.js';
import { AppError, notFound } from '../../shared/errors.js';
import { normalizePhone } from '../../utils/phone.js';
import type { AuthContext } from '../../types/express.js';
import { toHotelSettings, toPublicHotel } from './hotel.mapper.js';
import { Hotel } from './hotel.model.js';
import { HotelPolicy, type PolicyType } from './hotelPolicy.model.js';
import { RoomType } from '../rooms/roomType.model.js';
import type { UpdateHotelInput } from './hotel.validation.js';

export async function getPublicHotelBySlug(slug: string) {
  const hotel = await Hotel.findOne({ slug, status: 'active' }).lean();
  if (!hotel) throw notFound('Hotel');
  return toPublicHotel(hotel);
}

function integrationStatus() {
  return {
    geminiConfigured: env.geminiConfigured,
    whatsappConfigured: env.whatsappConfigured,
    paymentMode: env.PAYMENT_PROVIDER === 'mock' ? 'development-mock' : env.PAYMENT_PROVIDER,
    smsMode: env.SMS_PROVIDER === 'console' ? 'development-console' : env.SMS_PROVIDER,
  };
}

export async function getHotelSettings(hotelId: Types.ObjectId) {
  const hotel = await Hotel.findById(hotelId).lean();
  if (!hotel) throw notFound('Hotel');
  return toHotelSettings(hotel, integrationStatus());
}

/** Flattens nested partial objects into `$set` paths so a partial `address` update doesn't wipe other fields. */
function toSetPaths(input: Record<string, unknown>, prefix = '', out: Record<string, unknown> = {}) {
  const nestedObjects = new Set(['address', 'contact', 'modules', 'settings']);
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (!prefix && nestedObjects.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      toSetPaths(value as Record<string, unknown>, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

export async function updateHotel(actor: AuthContext, hotelId: Types.ObjectId, input: UpdateHotelInput, req: Request) {
  const patch = { ...input } as Record<string, unknown>;
  if (input.contact) {
    const contact = { ...input.contact };
    for (const key of ['phone', 'whatsapp'] as const) {
      const raw = contact[key];
      if (raw) {
        const normalized = normalizePhone(raw);
        if (!normalized) throw new AppError(400, 'VALIDATION_ERROR', `Invalid ${key} number`, [{ path: `contact.${key}`, message: 'Invalid phone' }]);
        contact[key] = normalized;
      }
    }
    patch.contact = contact;
  }

  const $set = toSetPaths(patch);
  const hotel = await Hotel.findByIdAndUpdate(hotelId, { $set }, { new: true, runValidators: true }).lean();
  if (!hotel) throw notFound('Hotel');

  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'hotel.updated',
    entity: { type: 'Hotel', id: hotelId },
    metadata: { fields: Object.keys($set) },
    req,
  });
  return toHotelSettings(hotel, integrationStatus());
}

/** Public directory of active properties (the suite landing page). */
export async function listPublicHotels() {
  const hotels = await Hotel.find({ status: 'active', 'modules.booking': true }).sort({ name: 1 }).limit(50).lean();
  const minRates = await RoomType.aggregate<{ _id: unknown; min: number }>([
    { $match: { hotelId: { $in: hotels.map((h) => h._id) }, isActive: true } },
    { $group: { _id: '$hotelId', min: { $min: '$baseRatePaise' } } },
  ]);
  const minBy = new Map(minRates.map((r) => [String(r._id), r.min]));
  return hotels.map((h) => {
    const pub = toPublicHotel(h);
    return {
      id: pub.id,
      name: pub.name,
      slug: pub.slug,
      tagline: pub.tagline,
      city: pub.address.city,
      state: pub.address.state,
      locality: pub.address.locality,
      verified: pub.verified,
      rating: pub.rating,
      heroPhoto: h.photos.find((p) => p.isHero) ?? h.photos[0] ?? null,
      fromRatePaise: minBy.get(String(h._id)) ?? null,
      directDiscountPercent: h.settings.directDiscountPercent,
    };
  });
}

export async function listPolicies(hotelId: Types.ObjectId, includeUnpublished = false) {
  const policies = await HotelPolicy.find({ hotelId, ...(includeUnpublished ? {} : { published: true }) })
    .sort({ type: 1 })
    .lean();
  return policies.map((p) => ({ type: p.type, title: p.title, body: p.body, published: p.published, updatedAt: p.updatedAt.toISOString() }));
}

export async function getPublicPolicies(slug: string) {
  const hotel = await Hotel.findOne({ slug, status: 'active' }).select('_id').lean();
  if (!hotel) throw notFound('Hotel');
  return listPolicies(hotel._id);
}

export async function upsertPolicy(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  type: PolicyType,
  input: { title: string; body: string; published: boolean },
  req: Request,
) {
  await HotelPolicy.updateOne({ hotelId, type }, { $set: { ...input, hotelId, type } }, { upsert: true, runValidators: true });
  await audit({ hotelId, actor: { type: 'user', id: actor.userId, role: actor.role }, action: 'policy.updated', metadata: { type }, req });
  return listPolicies(hotelId, true);
}
