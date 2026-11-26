import { Schema, model, type Types } from 'mongoose';

export interface AvailabilityShape {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  /** Hotel-local night, "YYYY-MM-DD". */
  date: string;
  totalRooms: number;
  sold: number;
  /** Reserved by unpaid bookings; released by the hold-expiry sweeper. */
  held: number;
  /** Taken out of sale by staff (maintenance, owner's use). */
  blocked: number;
  /** Nightly rate override; null = room type base rate. */
  ratePaise: number | null;
  stopSell: boolean;
  minStay: number;
}

/**
 * One document per (hotel, room type, night). Invariant, enforced by guarded updates rather than reads:
 *   sold + held + blocked <= totalRooms
 */
const availabilitySchema = new Schema<AvailabilityShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    totalRooms: { type: Number, required: true, min: 0 },
    sold: { type: Number, default: 0, min: 0 },
    held: { type: Number, default: 0, min: 0 },
    blocked: { type: Number, default: 0, min: 0 },
    ratePaise: { type: Number, default: null, min: 0 },
    stopSell: { type: Boolean, default: false },
    minStay: { type: Number, default: 1, min: 1, max: 30 },
  },
  { timestamps: true },
);

availabilitySchema.index({ hotelId: 1, roomTypeId: 1, date: 1 }, { unique: true });
availabilitySchema.index({ hotelId: 1, date: 1 });

export type AvailabilityLean = AvailabilityShape & { _id: Types.ObjectId };
export const Availability = model<AvailabilityShape>('Availability', availabilitySchema);
