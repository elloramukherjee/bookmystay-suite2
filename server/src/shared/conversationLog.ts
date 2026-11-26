import type { Types } from 'mongoose';
import { ChatMessage, type ChatMessageLean, type MessageSender } from '../modules/chatbot/models/chatMessage.model.js';
import { Conversation, type ConversationLean } from '../modules/chatbot/models/conversation.model.js';
import { enqueue } from '../modules/notifications/notification.service.js';

export interface AppendInput {
  sender: MessageSender;
  text: string;
  staffId?: Types.ObjectId | null;
  staffName?: string | null;
  latencyMs?: number | null;
  toolCalls?: { name: string; ok: boolean; summary: string }[];
  visibleToGuest?: boolean;
}

/**
 * Single write path for chat messages from every channel (web, WhatsApp, simulator). It keeps the
 * conversation summary fields in step and — for WhatsApp conversations — queues outbound guest-visible
 * messages for delivery through the notification outbox (Phase 5 swaps in the Cloud API provider).
 * Because conversations carry guestId, every exchange becomes part of the guest's CRM history.
 */
export async function appendMessage(
  conversation: Pick<ConversationLean, '_id' | 'hotelId' | 'channel' | 'channelUserId'>,
  input: AppendInput,
): Promise<ChatMessageLean> {
  const visible = input.visibleToGuest ?? true;
  const outbound = input.sender !== 'guest' && visible && conversation.channel === 'whatsapp';
  const msg = await ChatMessage.create({
    hotelId: conversation.hotelId,
    conversationId: conversation._id,
    sender: input.sender,
    staffId: input.staffId ?? null,
    staffName: input.staffName ?? null,
    text: input.text.slice(0, 4000),
    latencyMs: input.latencyMs ?? null,
    toolCalls: input.toolCalls ?? [],
    visibleToGuest: visible,
    deliveryStatus: outbound ? 'pending' : null,
  });

  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessageAt: msg.createdAt, lastMessagePreview: input.text.slice(0, 160), lastSender: input.sender },
      $inc: { messageCount: 1, unreadForStaff: input.sender === 'guest' ? 1 : 0 },
    },
  );

  if (outbound) {
    await enqueue({
      hotelId: conversation.hotelId,
      channel: 'whatsapp',
      to: conversation.channelUserId,
      template: 'chat_reply',
      body: input.text,
      relatedEntity: { type: 'ChatMessage', id: msg._id },
    });
  }
  return msg.toObject() as ChatMessageLean;
}
