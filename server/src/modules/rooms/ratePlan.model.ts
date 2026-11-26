import { Schema, model, type Types } from 'mongoose';

export interface RatePlanShape {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  name: string;
  code: string;
  /** EP = room only, CP = breakfast, MAP = breakfast + one meal, AP = all meals (Indian hotel convention). */
  mealPlan: 'EP' | 'CP' | 'MAP' | 'AP';
  /** Added per room per night to the room type's nightly rate. */
  adjustmentPaise: number;
  refundable: boolean;
  isDefault: boolean;
  isActive: boolean;
}

const ratePlanSchema = new Schema<RatePlanShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 12 },
    mealPlan: { type: String, enum: ['EP', 'CP', 'MAP', 'AP'], default: 'EP' },
    adjustmentPaise: { type: Number, default: 0, min: 0, max: 10_000_000 },
    refundable: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

ratePlanSchema.index({ hotelId: 1, roomTypeId: 1, code: 1 }, { unique: true });

export type RatePlanLean = RatePlanShape & { _id: Types.ObjectId };
export const RatePlan = model<RatePlanShape>('RatePlan', ratePlanSchema);
