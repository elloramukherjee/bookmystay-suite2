import { Schema, model, type Types } from 'mongoose';

export interface GuestPreferenceShape {
  hotelId: Types.ObjectId;
  guestId: Types.ObjectId;
  category: 'room' | 'fnb' | 'accessibility' | 'communication' | 'other';
  key: string;
  value: string;
  source: 'staff' | 'chat' | 'booking';
  createdBy: Types.ObjectId | null;
}

const guestPreferenceSchema = new Schema<GuestPreferenceShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    category: { type: String, enum: ['room', 'fnb', 'accessibility', 'communication', 'other'], required: true },
    key: { type: String, required: true, trim: true, maxlength: 60 },
    value: { type: String, required: true, trim: true, maxlength: 300 },
    source: { type: String, enum: ['staff', 'chat', 'booking'], default: 'staff' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

guestPreferenceSchema.index({ hotelId: 1, guestId: 1, category: 1, key: 1 }, { unique: true });

export const GuestPreference = model<GuestPreferenceShape>('GuestPreference', guestPreferenceSchema);
