import { Schema, model, type Types } from 'mongoose';

export interface HotelFaqShape {
  hotelId: Types.ObjectId;
  question: string;
  answer: string;
  category: 'arrival' | 'amenities' | 'dining' | 'local' | 'policies' | 'services' | 'other';
  keywords: string[];
  published: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The AI receptionist's factual knowledge source. Only `published` entries reach the model. */
const hotelFaqSchema = new Schema<HotelFaqShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: String, enum: ['arrival', 'amenities', 'dining', 'local', 'policies', 'services', 'other'], default: 'other' },
    keywords: { type: [String], default: [] },
    published: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

hotelFaqSchema.index({ hotelId: 1, published: 1, category: 1, sortOrder: 1 });
hotelFaqSchema.index({ question: 'text', answer: 'text', keywords: 'text' });

export type HotelFaqLean = HotelFaqShape & { _id: Types.ObjectId };
export const HotelFaq = model<HotelFaqShape>('HotelFaq', hotelFaqSchema);
