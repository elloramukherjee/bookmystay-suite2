import { Schema, model, type Types } from 'mongoose';

export type MessageSender = 'guest' | 'ai' | 'staff' | 'system';

export interface ChatMessageShape {
  hotelId: Types.ObjectId;
  conversationId: Types.ObjectId;
  sender: MessageSender;
  staffId: Types.ObjectId | null;
  staffName: string | null;
  text: string;
  latencyMs: number | null;
  toolCalls: { name: string; ok: boolean; summary: string }[];
  /** For staff/system messages: whether the guest can see it (internal notes are not shown). */
  visibleToGuest: boolean;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'simulated' | null;
  waMessageId: string | null;
  createdAt: Date;
}

const chatMessageSchema = new Schema<ChatMessageShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    sender: { type: String, enum: ['guest', 'ai', 'staff', 'system'], required: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    staffName: { type: String, default: null },
    text: { type: String, required: true, maxlength: 4000 },
    latencyMs: { type: Number, default: null },
    toolCalls: { type: [new Schema({ name: String, ok: Boolean, summary: String }, { _id: false })], default: [] },
    visibleToGuest: { type: Boolean, default: true },
    deliveryStatus: { type: String, enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'simulated', null], default: null },
    waMessageId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
chatMessageSchema.index({ hotelId: 1, sender: 1, createdAt: -1 });

export type ChatMessageLean = ChatMessageShape & { _id: Types.ObjectId };
export const ChatMessage = model<ChatMessageShape>('ChatMessage', chatMessageSchema);
