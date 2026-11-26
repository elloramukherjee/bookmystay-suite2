import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const BOOKING_SOURCES = ['direct', 'ota_mmt', 'ota_goibibo', 'ota_bookingcom', 'ota_agoda', 'ota_other', 'walk_in', 'phone'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export const isOtaSource = (s: string) => s.startsWith('ota_');

export const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'unpaid',
  'pending',
  'paid',
  'pay_at_hotel',
  'collected_by_ota',
  'refund_pending',
  'refunded',
  'provider_unavailable',
] as const;
export type BookingPaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface BookingAmounts {
  nightly: { date: string; ratePaise: number }[];
  subtotalPaise: number;
  directDiscountPercent: number;
  directDiscountPaise: number;
  promoCode: string | null;
  promoDiscountPaise: number;
  taxablePaise: number;
  /** Single slab rate if every night falls in the same slab, otherwise null (mixed). */
  taxRatePercent: number | null;
  taxPaise: number;
  totalPaise: number;
  /** What the same stay would roughly cost through an OTA, for the "you saved" message. */
  otaEquivalentPaise: number | null;
}

export interface BookingShape {
  hotelId: Types.ObjectId;
  reference: string;
  guestId: Types.ObjectId;
  guestSnapshot: { name: string; phoneE164: string; email: string | null };
  roomTypeId: Types.ObjectId;
  roomTypeName: string;
  ratePlanId: Types.ObjectId | null;
  ratePlanName: string | null;
  roomId: Types.ObjectId | null;
  roomNumber: string | null;
  quantity: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  source: BookingSource;
  otaReference: string | null;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  amounts: BookingAmounts;
  /** Whether inventory for this booking is currently counted as `held` or `sold` (or released). */
  inventoryState: 'held' | 'sold' | 'released';
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  cancelledBy: 'guest' | 'staff' | 'system' | null;
  refundDuePaise: number;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  specialRequests: string | null;
  consentSnapshot: { transactional: boolean; marketing: boolean; noticeVersion: string };
  needsAttention: string | null;
  idempotencyKey: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const amountsSchema = new Schema<BookingAmounts>(
  {
    nightly: { type: [new Schema({ date: String, ratePaise: Number }, { _id: false })], default: [] },
    subtotalPaise: { type: Number, required: true, min: 0 },
    directDiscountPercent: { type: Number, default: 0 },
    directDiscountPaise: { type: Number, default: 0, min: 0 },
    promoCode: { type: String, default: null },
    promoDiscountPaise: { type: Number, default: 0, min: 0 },
    taxablePaise: { type: Number, required: true, min: 0 },
    taxRatePercent: { type: Number, default: null },
    taxPaise: { type: Number, required: true, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    otaEquivalentPaise: { type: Number, default: null },
  },
  { _id: false },
);

const bookingSchema = new Schema<BookingShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    reference: { type: String, required: true, uppercase: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    guestSnapshot: {
      name: { type: String, required: true },
      phoneE164: { type: String, required: true },
      email: { type: String, default: null },
    },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    roomTypeName: { type: String, required: true },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', default: null },
    ratePlanName: { type: String, default: null },
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', default: null },
    roomNumber: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1, max: 10 },
    adults: { type: Number, required: true, min: 1 },
    children: { type: Number, default: 0, min: 0 },
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
    nights: { type: Number, required: true, min: 1 },
    source: { type: String, enum: BOOKING_SOURCES, required: true },
    otaReference: { type: String, default: null, maxlength: 60 },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    amounts: { type: amountsSchema, required: true },
    inventoryState: { type: String, enum: ['held', 'sold', 'released'], required: true },
    holdExpiresAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null, maxlength: 300 },
    cancelledBy: { type: String, enum: ['guest', 'staff', 'system', null], default: null },
    refundDuePaise: { type: Number, default: 0, min: 0 },
    checkedInAt: { type: Date, default: null },
    checkedOutAt: { type: Date, default: null },
    specialRequests: { type: String, default: null, maxlength: 500 },
    consentSnapshot: {
      transactional: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
      noticeVersion: { type: String, default: '2026-11' },
    },
    needsAttention: { type: String, default: null, maxlength: 300 },
    idempotencyKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

bookingSchema.index({ reference: 1 }, { unique: true });
bookingSchema.index({ hotelId: 1, status: 1, checkIn: 1 });
bookingSchema.index({ hotelId: 1, guestId: 1, checkIn: -1 });
bookingSchema.index({ hotelId: 1, checkOut: 1 });
bookingSchema.index({ hotelId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, holdExpiresAt: 1 });
bookingSchema.index({ hotelId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });

export type BookingLean = BookingShape & { _id: Types.ObjectId };
export type BookingDocument = HydratedDocument<BookingShape>;
export const Booking = model<BookingShape>('Booking', bookingSchema);
