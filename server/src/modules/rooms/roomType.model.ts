import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface RoomTypeShape {
  hotelId: Types.ObjectId;
  name: string;
  slug: string;
  description: string;
  sizeSqft: number | null;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedType: string;
  view: string;
  amenities: string[];
  photos: { url: string; alt: string }[];
  tags: string[];
  /** Perk shown as "Direct Privilege" on the room card, e.g. "Early check-in from 11 AM". */
  directPrivilege: string;
  baseRatePaise: number;
  /** Typical OTA price for the same room, used only for the comparison shown to guests. */
  otaRatePaise: number | null;
  /** Count of active physical rooms of this type (maintained by the rooms service). */
  totalRooms: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const roomTypeSchema = new Schema<RoomTypeShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 1000 },
    sizeSqft: { type: Number, default: null, min: 50, max: 10_000 },
    maxAdults: { type: Number, required: true, min: 1, max: 10 },
    maxChildren: { type: Number, default: 0, min: 0, max: 10 },
    maxOccupancy: { type: Number, required: true, min: 1, max: 12 },
    bedType: { type: String, default: '', maxlength: 60 },
    view: { type: String, default: '', maxlength: 80 },
    amenities: { type: [String], default: [] },
    photos: { type: [new Schema({ url: String, alt: String }, { _id: false })], default: [] },
    tags: { type: [String], default: [] },
    directPrivilege: { type: String, default: '', maxlength: 160 },
    baseRatePaise: { type: Number, required: true, min: 10_000, max: 100_000_000 },
    otaRatePaise: { type: Number, default: null, min: 0 },
    totalRooms: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

roomTypeSchema.index({ hotelId: 1, slug: 1 }, { unique: true });
roomTypeSchema.index({ hotelId: 1, isActive: 1, sortOrder: 1 });

export type RoomTypeLean = RoomTypeShape & { _id: Types.ObjectId };
export type RoomTypeDocument = HydratedDocument<RoomTypeShape>;
export const RoomType = model<RoomTypeShape>('RoomType', roomTypeSchema);
