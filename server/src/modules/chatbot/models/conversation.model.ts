import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const CONVERSATION_STATUSES = ['ai_active', 'escalated', 'staff_active', 'resolved'] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const ESCALATION_CATEGORIES = [
  'complaint',
  'safety',
  'medical',
  'payment_dispute',
  'refund',
  'negative_sentiment',
  'unknown_fact',
  'guest_request',
  'ai_unavailable',
] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];

export type ConversationChannel = 'web' | 'whatsapp' | 'simulator';

export interface ConversationShape {
  hotelId: Types.ObjectId;
  channel: ConversationChannel;
  /** WhatsApp/simulator: sender E.164 (verified by Meta). Web: random session id. */
  channelUserId: string;
  guestId: Types.ObjectId | null;
  /** Set only when the guest proved the booking (reference + phone, booking token, or WhatsApp sender match). */
  bookingId: Types.ObjectId | null;
  guestName: string | null;
  status: ConversationStatus;
  escalation: { category: EscalationCategory; reason: string; at: Date; by: 'rule' | 'ai' | 'staff' | 'system'; priority: 'urgent' | 'high' | 'normal' } | null;
  assignedTo: Types.ObjectId | null;
  takenOverAt: Date | null;
  resolvedAt: Date | null;
  lastMessageAt: Date;
  lastMessagePreview: string;
  lastSender: 'guest' | 'ai' | 'staff' | 'system';
  unreadForStaff: number;
  messageCount: number;
  everEscalated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<ConversationShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    channel: { type: String, enum: ['web', 'whatsapp', 'simulator'], required: true },
    channelUserId: { type: String, required: true, maxlength: 80 },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', default: null },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    guestName: { type: String, default: null, maxlength: 120 },
    status: { type: String, enum: CONVERSATION_STATUSES, default: 'ai_active' },
    escalation: {
      type: new Schema(
        {
          category: { type: String, enum: ESCALATION_CATEGORIES, required: true },
          reason: { type: String, required: true, maxlength: 300 },
          at: { type: Date, required: true },
          by: { type: String, enum: ['rule', 'ai', 'staff', 'system'], required: true },
          priority: { type: String, enum: ['urgent', 'high', 'normal'], default: 'high' },
        },
        { _id: false },
      ),
      default: null,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    takenOverAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: '', maxlength: 160 },
    lastSender: { type: String, enum: ['guest', 'ai', 'staff', 'system'], default: 'guest' },
    unreadForStaff: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    everEscalated: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ hotelId: 1, status: 1, lastMessageAt: -1 });
conversationSchema.index({ hotelId: 1, guestId: 1, lastMessageAt: -1 });
conversationSchema.index({ hotelId: 1, channel: 1, channelUserId: 1, lastMessageAt: -1 });

export type ConversationLean = ConversationShape & { _id: Types.ObjectId };
export type ConversationDocument = HydratedDocument<ConversationShape>;
export const Conversation = model<ConversationShape>('Conversation', conversationSchema);
