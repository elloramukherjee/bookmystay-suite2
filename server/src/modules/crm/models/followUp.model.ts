import { Schema, model, type Types } from 'mongoose';

export interface FollowUpShape {
  hotelId: Types.ObjectId;
  templateId: Types.ObjectId;
  guestId: Types.ObjectId;
  text: string;
  /**
   * draft           — prepared, not sent
   * sent_personally — the owner opened WhatsApp and sent it from their own phone (PRD MVP workflow)
   * sent_api        — sent via WhatsApp Cloud API with an approved template (Phase 5)
   */
  status: 'draft' | 'sent_personally' | 'sent_api' | 'discarded';
  createdBy: Types.ObjectId;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Log of direct follow-up messages — what was prepared for whom, and whether it went out. */
const followUpSchema = new Schema<FollowUpShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'MessageTemplate', required: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    text: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['draft', 'sent_personally', 'sent_api', 'discarded'], default: 'draft' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

followUpSchema.index({ hotelId: 1, guestId: 1, createdAt: -1 });
followUpSchema.index({ hotelId: 1, status: 1, sentAt: -1 });

export type FollowUpLean = FollowUpShape & { _id: Types.ObjectId };
export const FollowUp = model<FollowUpShape>('FollowUp', followUpSchema);
