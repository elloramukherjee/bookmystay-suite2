import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface HotelPhoto {
  url: string;
  alt: string;
  caption: string | null;
  isHero: boolean;
}
export interface HotelReview {
  author: string;
  city: string | null;
  rating: number;
  text: string;
  stayedAt: string | null;
  roomTypeName: string | null;
  source: 'direct' | 'google' | 'ota';
  savedPaise: number;
}
export interface TaxSlab {
  upToPaise: number | null;
  ratePercent: number;
}
export interface PromoCode {
  code: string;
  percentOff: number;
  active: boolean;
  validUntil: Date | null;
}

export interface HotelShape {
  name: string;
  slug: string;
  tagline: string;
  story: string;
  starRating: number;
  verified: boolean;
  address: {
    line1: string;
    line2: string;
    locality: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
    geo: { lat: number | null; lng: number | null };
  };
  contact: { phone: string | null; whatsapp: string | null; email: string | null };
  gstin: string | null;
  timezone: string;
  currency: string;
  totalRooms: number;
  checkInTime: string;
  checkOutTime: string;
  photos: HotelPhoto[];
  amenities: string[];
  highlights: { label: string; value: string }[];
  reviews: HotelReview[];
  modules: { booking: boolean; receptionist: boolean; crm: boolean };
  settings: {
    directDiscountPercent: number;
    otaCommissionRate: number;
    holdMinutes: number;
    freeCancellationHours: number;
    taxSlabs: TaxSlab[];
    promoCodes: PromoCode[];
  };
  integrations: { paymentProvider: 'mock' | 'razorpay'; smsProvider: 'console' | 'msg91'; whatsappPhoneNumberId: string | null };
  status: 'active' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
}

const photoSchema = new Schema<HotelPhoto>(
  {
    url: { type: String, required: true },
    alt: { type: String, required: true, maxlength: 240 },
    caption: { type: String, default: null, maxlength: 120 },
    isHero: { type: Boolean, default: false },
  },
  { _id: false },
);

const reviewSchema = new Schema<HotelReview>(
  {
    author: { type: String, required: true, maxlength: 80 },
    city: { type: String, default: null, maxlength: 60 },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, required: true, maxlength: 600 },
    stayedAt: { type: String, default: null }, // "2024-09"
    roomTypeName: { type: String, default: null },
    source: { type: String, enum: ['direct', 'google', 'ota'], default: 'direct' },
    savedPaise: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const taxSlabSchema = new Schema<TaxSlab>(
  {
    /** Upper bound (inclusive) of the per-night tariff for this slab, in paise; null = no upper bound. */
    upToPaise: { type: Number, default: null },
    ratePercent: { type: Number, required: true, min: 0, max: 40 },
  },
  { _id: false },
);

const promoSchema = new Schema<PromoCode>(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 24 },
    percentOff: { type: Number, required: true, min: 1, max: 50 },
    active: { type: Boolean, default: true },
    validUntil: { type: Date, default: null },
  },
  { _id: false },
);

const hotelSchema = new Schema<HotelShape>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    tagline: { type: String, default: '', maxlength: 160 },
    story: { type: String, default: '', maxlength: 2000 },
    starRating: { type: Number, min: 0, max: 5, default: 0 },
    verified: { type: Boolean, default: false },
    address: {
      line1: { type: String, default: '' },
      line2: { type: String, default: '' },
      locality: { type: String, default: '' },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, default: '' },
      country: { type: String, default: 'IN' },
      geo: { lat: { type: Number, default: null }, lng: { type: Number, default: null } },
    },
    contact: {
      phone: { type: String, default: null },
      whatsapp: { type: String, default: null },
      email: { type: String, default: null },
    },
    gstin: { type: String, default: null },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    totalRooms: { type: Number, min: 1, max: 500, required: true },
    checkInTime: { type: String, default: '13:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    checkOutTime: { type: String, default: '11:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    photos: { type: [photoSchema], default: [] },
    amenities: { type: [String], default: [] },
    highlights: { type: [new Schema({ label: String, value: String }, { _id: false })], default: [] },
    reviews: { type: [reviewSchema], default: [] },
    modules: {
      booking: { type: Boolean, default: true },
      receptionist: { type: Boolean, default: true },
      crm: { type: Boolean, default: true },
    },
    settings: {
      directDiscountPercent: { type: Number, min: 0, max: 50, default: 10 },
      otaCommissionRate: { type: Number, min: 0, max: 40, default: 18 },
      holdMinutes: { type: Number, min: 5, max: 120, default: 15 },
      freeCancellationHours: { type: Number, min: 0, max: 720, default: 48 },
      taxSlabs: {
        type: [taxSlabSchema],
        default: () => [
          { upToPaise: 100000, ratePercent: 0 },
          { upToPaise: 750000, ratePercent: 5 },
          { upToPaise: null, ratePercent: 18 },
        ],
      },
      promoCodes: { type: [promoSchema], default: [] },
    },
    integrations: {
      paymentProvider: { type: String, enum: ['mock', 'razorpay'], default: 'mock' },
      smsProvider: { type: String, enum: ['console', 'msg91'], default: 'console' },
      whatsappPhoneNumberId: { type: String, default: null },
    },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  },
  { timestamps: true },
);

hotelSchema.index({ slug: 1 }, { unique: true });
hotelSchema.index({ status: 1 });

export type HotelAttrs = HotelShape;
export type HotelLean = HotelShape & { _id: Types.ObjectId };
export type HotelDocument = HydratedDocument<HotelShape>;
export const Hotel = model<HotelShape>('Hotel', hotelSchema);
