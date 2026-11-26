import { Schema, model, type Types } from 'mongoose';

export const SERVICE_REQUEST_TYPES = [
  'housekeeping',
  'towels',
  'extra_bed',
  'late_checkout',
  'early_checkin',
  'maintenance',
  'food',
  'transport',
  'other',
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export interface ServiceRequestShape {
  hotelId: Types.ObjectId;
  guestId: Types.ObjectId | null;
  bookingId: Types.ObjectId | null;
  conversationId: Types.ObjectId | null;
  roomNumber: string | null;
  type: ServiceRequestType;
  details: string;
  /** `open` = logged, not yet acted on. Only staff move it to done/declined — the AI never claims completion. */
  status: 'open' | 'acknowledged' | 'done' | 'declined';
  createdBy: 'ai' | 'staff' | 'guest';
  handledBy: Types.ObjectId | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const serviceRequestSchema = new Schema<ServiceRequestShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
    roomNumber: { type: String, default: null, maxlength: 10 },
    type: { type: String, enum: SERVICE_REQUEST_TYPES, required: true },
    details: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['open', 'acknowledged', 'done', 'declined'], default: 'open' },
    createdBy: { type: String, enum: ['ai', 'staff', 'guest'], default: 'ai' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ hotelId: 1, status: 1, createdAt: -1 });
serviceRequestSchema.index({ conversationId: 1 });

export type ServiceRequestLean = ServiceRequestShape & { _id: Types.ObjectId };
export const ServiceRequest = model<ServiceRequestShape>('ServiceRequest', serviceRequestSchema);
