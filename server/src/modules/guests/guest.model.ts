import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface ConsentRecord {
  granted: boolean;
  at: Date | null;
  source: string | null;
  withdrawnAt?: Date | null;
}

export interface GuestShape {
  hotelId: Types.ObjectId;
  /** The cross-module identity: WhatsApp-linked mobile in E.164. Unique per hotel. */
  phoneE164: string;
  name: string | null;
  email: string | null;
  city: string | null;
  firstSource: string;
  lastSource: string;
  tags: string[];
  notes: { text: string; category: 'room' | 'fnb' | 'general'; authorId: Types.ObjectId | null; createdAt: Date }[];
  stats: {
    totalBookings: number;
    directBookings: number;
    otaBookings: number;
    completedStays: number;
    lifetimeValuePaise: number;
    commissionSavedPaise: number;
    firstStayAt: string | null;
    lastStayAt: string | null;
  };
  consent: { transactional: ConsentRecord; marketing: ConsentRecord };
  idVerification: { verified: boolean; docType: string | null; verifiedAt: Date | null; verifiedBy: Types.ObjectId | null };
  privacy: { erasureRequestedAt: Date | null; anonymisedAt: Date | null };
  createdAt: Date;
  updatedAt: Date;
}

const consentSchema = new Schema<ConsentRecord>(
  {
    granted: { type: Boolean, default: false },
    at: { type: Date, default: null },
    source: { type: String, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  { _id: false },
);

const guestSchema = new Schema<GuestShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    phoneE164: { type: String, required: true, match: /^\+[1-9]\d{7,14}$/ },
    name: { type: String, default: null, trim: true, maxlength: 120 },
    email: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
    city: { type: String, default: null, maxlength: 80 },
    firstSource: { type: String, required: true },
    lastSource: { type: String, required: true },
    tags: { type: [String], default: [] },
    notes: {
      type: [
        new Schema(
          {
            text: { type: String, required: true, maxlength: 1000 },
            category: { type: String, enum: ['room', 'fnb', 'general'], default: 'general' },
            authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },
    stats: {
      totalBookings: { type: Number, default: 0 },
      directBookings: { type: Number, default: 0 },
      otaBookings: { type: Number, default: 0 },
      completedStays: { type: Number, default: 0 },
      lifetimeValuePaise: { type: Number, default: 0 },
      commissionSavedPaise: { type: Number, default: 0 },
      firstStayAt: { type: String, default: null },
      lastStayAt: { type: String, default: null },
    },
    consent: {
      transactional: { type: consentSchema, default: () => ({}) },
      marketing: { type: consentSchema, default: () => ({}) },
    },
    idVerification: {
      verified: { type: Boolean, default: false },
      docType: { type: String, enum: ['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other', null], default: null },
      verifiedAt: { type: Date, default: null },
      verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    },
    privacy: {
      erasureRequestedAt: { type: Date, default: null },
      anonymisedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

guestSchema.index({ hotelId: 1, phoneE164: 1 }, { unique: true });
guestSchema.index({ hotelId: 1, 'stats.lastStayAt': -1 });
guestSchema.index({ hotelId: 1, lastSource: 1 });
guestSchema.index({ hotelId: 1, name: 'text', email: 'text', phoneE164: 'text' });

export type GuestLean = GuestShape & { _id: Types.ObjectId };
export type GuestDocument = HydratedDocument<GuestShape>;
export const Guest = model<GuestShape>('Guest', guestSchema);
