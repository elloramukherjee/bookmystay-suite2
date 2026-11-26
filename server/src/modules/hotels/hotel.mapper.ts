import { env } from '../../config/env.js';
import type { HotelAttrs, HotelLean } from './hotel.model.js';

export function ratingSummary(reviews: HotelAttrs['reviews']): { average: number | null; count: number } {
  if (!reviews.length) return { average: null, count: 0 };
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { average: Math.round(avg * 10) / 10, count: reviews.length };
}

/** Fields safe for anonymous visitors. Settings internals, integrations and GSTIN are excluded. */
export function toPublicHotel(h: HotelLean) {
  return {
    id: String(h._id),
    name: h.name,
    slug: h.slug,
    tagline: h.tagline,
    story: h.story,
    starRating: h.starRating,
    verified: h.verified,
    address: {
      line1: h.address.line1,
      line2: h.address.line2,
      locality: h.address.locality,
      city: h.address.city,
      state: h.address.state,
      pincode: h.address.pincode,
      geo: h.address.geo,
    },
    contact: { phone: h.contact?.phone ?? null, whatsapp: h.contact?.whatsapp ?? null, email: h.contact?.email ?? null },
    totalRooms: h.totalRooms,
    checkInTime: h.checkInTime,
    checkOutTime: h.checkOutTime,
    photos: h.photos,
    amenities: h.amenities,
    highlights: h.highlights,
    reviews: h.reviews,
    rating: ratingSummary(h.reviews),
    modules: h.modules,
    /** "pay_at_hotel": no online payment step; bookings confirm immediately and are paid at the property. */
    paymentMode: env.PAYMENT_PROVIDER === 'pay_at_hotel' ? ('pay_at_hotel' as const) : ('online' as const),
    policies: {
      directDiscountPercent: h.settings.directDiscountPercent,
      freeCancellationHours: h.settings.freeCancellationHours,
    },
  };
}

/** Full view for the hotel's own staff. Integration secrets never live on the hotel document, only flags. */
export function toHotelSettings(h: HotelLean, integrationStatus: Record<string, boolean | string>) {
  return {
    ...toPublicHotel(h),
    gstin: h.gstin,
    timezone: h.timezone,
    currency: h.currency,
    status: h.status,
    settings: h.settings,
    integrations: { ...h.integrations, ...integrationStatus },
  };
}
