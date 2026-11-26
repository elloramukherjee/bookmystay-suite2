import { Schema, model, type Types } from 'mongoose';

export const TEMPLATE_PURPOSES = ['thank_you', 'festival_offer', 'reunion', 'feedback', 'other'] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

export interface MessageTemplateShape {
  hotelId: Types.ObjectId;
  name: string;
  purpose: TemplatePurpose;
  /** Placeholders: {{firstName}}, {{hotelName}}, {{code}}, {{discount}} */
  body: string;
  promoCode: string | null;
  /** WhatsApp Cloud API needs Meta-approved templates for business-initiated messages (Phase 5). */
  metaTemplateName: string | null;
  metaApproved: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const messageTemplateSchema = new Schema<MessageTemplateShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    purpose: { type: String, enum: TEMPLATE_PURPOSES, default: 'other' },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    promoCode: { type: String, default: null, uppercase: true, maxlength: 24 },
    metaTemplateName: { type: String, default: null, maxlength: 120 },
    metaApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

messageTemplateSchema.index({ hotelId: 1, isActive: 1, name: 1 });

export type MessageTemplateLean = MessageTemplateShape & { _id: Types.ObjectId };
export const MessageTemplate = model<MessageTemplateShape>('MessageTemplate', messageTemplateSchema);
