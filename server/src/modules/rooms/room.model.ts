import { Schema, model, type Types } from 'mongoose';

export const ROOM_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance', 'out_of_order'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export interface RoomShape {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  number: string;
  floor: string;
  status: RoomStatus;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** A physical, numbered room. Inventory is sold per room type; a room number is assigned at check-in. */
const roomSchema = new Schema<RoomShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    number: { type: String, required: true, trim: true, maxlength: 10 },
    floor: { type: String, default: '', maxlength: 20 },
    status: { type: String, enum: ROOM_STATUSES, default: 'available' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

roomSchema.index({ hotelId: 1, number: 1 }, { unique: true });
roomSchema.index({ hotelId: 1, roomTypeId: 1, status: 1 });

export type RoomLean = RoomShape & { _id: Types.ObjectId };
export const Room = model<RoomShape>('Room', roomSchema);
