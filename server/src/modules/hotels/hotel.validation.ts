import { z } from 'zod';
import { objectIdSchema } from '../auth/auth.validation.js';
import { POLICY_TYPES } from './hotelPolicy.model.js';

export const slugParams = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,80}$/, 'Invalid hotel'),
});
export const hotelIdParams = z.object({ id: objectIdSchema });

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h HH:MM');
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);

const photo = z.strictObject({
  url: httpsUrl,
  alt: z.string().trim().min(3).max(240),
  caption: z.string().trim().max(120).nullish(),
  isHero: z.boolean().optional(),
});

const review = z.strictObject({
  author: z.string().trim().min(2).max(80),
  city: z.string().trim().max(60).nullish(),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(10).max(600),
  stayedAt: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullish(),
  roomTypeName: z.string().trim().max(80).nullish(),
  source: z.enum(['direct', 'google', 'ota']).optional(),
  savedPaise: z.number().int().min(0).optional(),
});

const taxSlab = z.strictObject({
  upToPaise: z.number().int().positive().nullable(),
  ratePercent: z.number().min(0).max(40),
});

const promo = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,24}$/),
  percentOff: z.number().int().min(1).max(50),
  active: z.boolean().default(true),
  validUntil: z.coerce.date().nullish(),
});

export const updateHotelSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    tagline: z.string().trim().max(160).optional(),
    story: z.string().trim().max(2000).optional(),
    starRating: z.number().min(0).max(5).optional(),
    address: z
      .strictObject({
        line1: z.string().trim().max(160).optional(),
        line2: z.string().trim().max(160).optional(),
        locality: z.string().trim().max(120).optional(),
        city: z.string().trim().min(2).max(80).optional(),
        state: z.string().trim().min(2).max(80).optional(),
        pincode: z
          .string()
          .regex(/^\d{6}$/, 'Enter a 6-digit PIN code')
          .optional(),
      })
      .optional(),
    contact: z
      .strictObject({
        phone: z.string().trim().max(20).nullish(),
        whatsapp: z.string().trim().max(20).nullish(),
        email: z.email().nullish(),
      })
      .optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
      .nullish(),
    totalRooms: z.number().int().min(1).max(500).optional(),
    checkInTime: time.optional(),
    checkOutTime: time.optional(),
    photos: z.array(photo).max(30).optional(),
    amenities: z.array(z.string().trim().min(2).max(60)).max(40).optional(),
    highlights: z
      .array(z.strictObject({ label: z.string().trim().max(40), value: z.string().trim().max(60) }))
      .max(6)
      .optional(),
    reviews: z.array(review).max(30).optional(),
    modules: z.strictObject({ booking: z.boolean(), receptionist: z.boolean(), crm: z.boolean() }).partial().optional(),
    settings: z
      .strictObject({
        directDiscountPercent: z.number().min(0).max(50),
        otaCommissionRate: z.number().min(0).max(40),
        holdMinutes: z.number().int().min(5).max(120),
        freeCancellationHours: z.number().int().min(0).max(720),
        taxSlabs: z
          .array(taxSlab)
          .min(1)
          .max(6)
          .refine((s) => s[s.length - 1]?.upToPaise === null, 'The last tax slab must have no upper bound'),
        promoCodes: z.array(promo).max(20),
      })
      .partial()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type UpdateHotelInput = z.infer<typeof updateHotelSchema>;

export const policyParams = z.object({ id: objectIdSchema, type: z.enum(POLICY_TYPES) });
export const policyBody = z.strictObject({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(2000),
  published: z.boolean().default(true),
});
