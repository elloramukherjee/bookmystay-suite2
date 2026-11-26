import { Schema, model, type Types } from 'mongoose';

export type WaDirection = 'in' | 'out';
export type WaStatus = 'received' | 'processing' | 'processed' | 'ignored' | 'failed' | 'sent' | 'delivered' | 'read';

export interface WhatsAppMessageShape {
  hotelId: Types.ObjectId | null;
  direction: WaDirection;
  /** Meta's message id (wamid.…). Unique, which makes webhook redelivery idempotent. */
  waMessageId: string;
  phoneNumberId: string | null;
  /** Guest number in E.164. */
  phoneE164: string;
  type: string;
  text: string | null;
  profileName: string | null;
  status: WaStatus;
  statusHistory: { status: string; at: Date; error: string | null }[];
  conversationId: Types.ObjectId | null;
  notificationId: Types.ObjectId | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Raw WhatsApp channel log: every inbound message and every outbound message Meta accepted, plus its
 * delivery receipts. Inbound rows double as a durable work queue, so a message acknowledged to Meta is
 * never lost even if the process dies before the AI replies.
 */
const whatsappMessageSchema = new Schema<WhatsAppMessageShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    direction: { type: String, enum: ['in', 'out'], required: true },
    waMessageId: { type: String, required: true, maxlength: 200 },
    phoneNumberId: { type: String, default: null },
    phoneE164: { type: String, required: true },
    type: { type: String, required: true, maxlength: 40 },
    text: { type: String, default: null, maxlength: 4096 },
    profileName: { type: String, default: null, maxlength: 120 },
    status: { type: String, enum: ['received', 'processing', 'processed', 'ignored', 'failed', 'sent', 'delivered', 'read'], required: true },
    statusHistory: {
      type: [new Schema({ status: String, at: Date, error: { type: String, default: null } }, { _id: false })],
      default: [],
    },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', default: null },
    error: { type: String, default: null, maxlength: 500 },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

whatsappMessageSchema.index({ waMessageId: 1 }, { unique: true });
whatsappMessageSchema.index({ direction: 1, status: 1, updatedAt: 1 });
whatsappMessageSchema.index({ hotelId: 1, createdAt: -1 });

export type WhatsAppMessageLean = WhatsAppMessageShape & { _id: Types.ObjectId };
export const WhatsAppMessage = model<WhatsAppMessageShape>('WhatsAppMessage', whatsappMessageSchema);
