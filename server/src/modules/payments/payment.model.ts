import { Schema, model, type Types } from 'mongoose';

export const PAYMENT_METHODS = ['upi', 'card', 'netbanking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentEvent {
  providerEventId: string;
  type: string;
  receivedAt: Date;
}

export interface PaymentShape {
  hotelId: Types.ObjectId;
  bookingId: Types.ObjectId;
  provider: 'mock' | 'razorpay';
  method: PaymentMethod;
  providerOrderId: string;
  providerPaymentId: string | null;
  amountPaise: number;
  currency: 'INR';
  status: 'created' | 'pending' | 'captured' | 'failed' | 'refunded';
  events: PaymentEvent[];
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Payments are stored separately from bookings: a booking can have several attempts. */
const paymentSchema = new Schema<PaymentShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    provider: { type: String, enum: ['mock', 'razorpay'], required: true },
    method: { type: String, enum: ['upi', 'card', 'netbanking'], required: true },
    providerOrderId: { type: String, required: true },
    providerPaymentId: { type: String, default: null },
    amountPaise: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'pending', 'captured', 'failed', 'refunded'], default: 'created' },
    events: { type: [new Schema({ providerEventId: String, type: String, receivedAt: Date }, { _id: false })], default: [] },
    failureReason: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true },
);

paymentSchema.index({ hotelId: 1, bookingId: 1, createdAt: -1 });
paymentSchema.index({ provider: 1, providerOrderId: 1 }, { unique: true });
paymentSchema.index({ 'events.providerEventId': 1 });

export type PaymentLean = PaymentShape & { _id: Types.ObjectId };
export const Payment = model<PaymentShape>('Payment', paymentSchema);
