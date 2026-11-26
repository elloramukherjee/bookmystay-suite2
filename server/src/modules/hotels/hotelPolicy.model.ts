import { Schema, model, type Types } from 'mongoose';

export const POLICY_TYPES = ['cancellation', 'checkin', 'pets', 'parking', 'smoking', 'children', 'payment', 'id_proof', 'other'] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export interface HotelPolicyShape {
  hotelId: Types.ObjectId;
  type: PolicyType;
  title: string;
  body: string;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Plain-language policies. The booking site shows them and the AI receptionist answers only from them. */
const hotelPolicySchema = new Schema<HotelPolicyShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    type: { type: String, enum: POLICY_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

hotelPolicySchema.index({ hotelId: 1, type: 1 }, { unique: true });

export type HotelPolicyLean = HotelPolicyShape & { _id: Types.ObjectId };
export const HotelPolicy = model<HotelPolicyShape>('HotelPolicy', hotelPolicySchema);
