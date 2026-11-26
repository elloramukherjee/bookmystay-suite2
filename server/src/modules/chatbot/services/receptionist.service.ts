import type { Types } from 'mongoose';
import { logger } from '../../../config/logger.js';
import { audit } from '../../../shared/audit/audit.service.js';
import { appendMessage } from '../../../shared/conversationLog.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { enqueue } from '../../notifications/notification.service.js';
import { ChatMessage } from '../models/chatMessage.model.js';
import { Conversation, type ConversationLean, type EscalationCategory } from '../models/conversation.model.js';
import { ServiceRequest } from '../models/serviceRequest.model.js';
import { loadGuestContext, loadKnowledge } from './context.service.js';
import { GeminiUnavailableError, generateReceptionistReply, isGeminiConfigured, type LlmTurn } from './gemini.service.js';
import { buildSystemInstruction } from './prompt.js';
import { detectSensitive, PRIORITY_FOR } from './safety.js';
import { createToolHandler, RECEPTIONIST_TOOLS, type ToolEffects } from './tools.js';

const HISTORY_LIMIT = 20;

const REQUEST_LABELS: Record<string, string> = {
  housekeeping: 'housekeeping',
  towels: 'towels',
  extra_bed: 'extra bed',
  late_checkout: 'late checkout',
  early_checkin: 'early check-in',
  maintenance: 'maintenance',
  food: 'food',
  transport: 'transport',
  other: '',
};
const joinLabels = (labels: string[]) => {
  const l = [...new Set(labels.filter(Boolean))];
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} and ${l.at(-1)}`;
};

export interface TurnOutcome {
  aiReplied: boolean;
  escalated: boolean;
  status: ConversationLean['status'];
}

/**
 * Moves a conversation into "escalated": AI replies pause, staff are alerted, the guest's context is kept.
 * Idempotent — a conversation already with staff isn't re-escalated.
 */
export async function escalate(
  conversation: Pick<ConversationLean, '_id' | 'hotelId' | 'guestName' | 'channelUserId'>,
  input: { category: EscalationCategory; reason: string; by: 'rule' | 'ai' | 'staff' | 'system' },
): Promise<boolean> {
  const priority = PRIORITY_FOR[input.category];
  const updated = await Conversation.findOneAndUpdate(
    { _id: conversation._id, status: { $in: ['ai_active', 'resolved'] } },
    { $set: { status: 'escalated', escalation: { ...input, at: new Date(), priority }, everEscalated: true, resolvedAt: null } },
    { new: true },
  ).lean();
  if (!updated) return false;

  await appendMessage(updated, {
    sender: 'system',
    text: `Escalated to staff (${input.category.replace(/_/g, ' ')}): ${input.reason}`,
    visibleToGuest: false,
  });

  // Alert the property on its own WhatsApp (delivered via the outbox; simulated in development).
  const hotel = await Hotel.findById(conversation.hotelId).select('contact.whatsapp name').lean();
  if (hotel?.contact.whatsapp) {
    await enqueue({
      hotelId: conversation.hotelId,
      channel: 'whatsapp',
      fallbackChannel: 'sms',
      to: hotel.contact.whatsapp,
      template: 'staff_escalation_alert',
      // Template "staff_escalation_alert": {{1}} reason and guest.
      templateParams: [`${priority === 'urgent' ? 'URGENT: ' : ''}${input.reason}${updated.guestName ? ` (${updated.guestName})` : ''}`],
      body: `${priority === 'urgent' ? '🚨 URGENT' : '⚠️'} Guest chat needs staff: ${input.reason}${updated.guestName ? ` — ${updated.guestName}` : ''}. Open the Concierge Desk to take over.`,
      relatedEntity: { type: 'Conversation', id: conversation._id },
    });
  }
  await audit({
    hotelId: conversation.hotelId,
    actor: { type: input.by === 'ai' ? 'ai' : 'system' },
    action: 'conversation.escalated',
    entity: { type: 'Conversation', id: conversation._id },
    metadata: { category: input.category, priority },
  });
  return true;
}

function holdingReply(category: EscalationCategory, hotelPhone: string | null): string {
  if (category === 'medical') {
    return `I'm alerting our duty manager right now. If this is a medical emergency, please call 112 immediately${hotelPhone ? ` or the front desk on ${hotelPhone}` : ''}.`;
  }
  if (category === 'safety') {
    return `Your safety comes first — I've alerted our duty manager this moment. If you are in danger, please call 112${hotelPhone ? ` or the front desk on ${hotelPhone}` : ''}.`;
  }
  if (category === 'ai_unavailable') return 'Thank you for your message! A member of our team will reply here shortly.';
  return "I'm really sorry about this. I've alerted our duty manager, who will personally reply here shortly.";
}

/** Recent visible messages as model turns. Staff replies are shown to the model as the hotel speaking. */
async function buildHistory(conversationId: Types.ObjectId): Promise<LlmTurn[]> {
  const recent = await ChatMessage.find({ conversationId, visibleToGuest: true }).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).lean();
  const turns: LlmTurn[] = [];
  for (const m of recent.reverse()) {
    const role = m.sender === 'guest' ? 'user' : 'model';
    const text = m.sender === 'staff' ? `(Staff member replied) ${m.text}` : m.text;
    const last = turns[turns.length - 1];
    // Gemini expects alternating roles; merge consecutive messages from the same side.
    if (last && last.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  }
  // History must start with the user.
  while (turns.length && turns[0]!.role !== 'user') turns.shift();
  return turns;
}

/**
 * Processes one guest message on any channel:
 *   log it → if staff own the chat, stop (no AI) → safety rules → Gemini (grounded, with tools) → log reply
 *   → apply escalation requested by the model.
 * Any AI failure falls back to a holding reply plus escalation: the guest is never left without an answer
 * and the bot never guesses.
 */
export async function processGuestMessage(conversationId: Types.ObjectId, text: string): Promise<TurnOutcome> {
  let conv = await Conversation.findById(conversationId).lean();
  if (!conv) throw new Error('Conversation not found');
  await appendMessage(conv, { sender: 'guest', text });

  if (conv.status === 'escalated' || conv.status === 'staff_active') {
    return { aiReplied: false, escalated: conv.status === 'escalated', status: conv.status };
  }
  if (conv.status === 'resolved') {
    conv = (await Conversation.findOneAndUpdate({ _id: conv._id }, { $set: { status: 'ai_active' } }, { new: true }).lean())!;
  }

  const hotel = await Hotel.findById(conv.hotelId).select('contact.phone modules').lean();
  const hotelPhone = hotel?.contact.phone ?? null;

  const sensitive = detectSensitive(text);
  if (sensitive) {
    await appendMessage(conv, {
      sender: 'system',
      text: holdingReply(sensitive.category, hotelPhone),
      toolCalls: [{ name: 'safety_rule', ok: true, summary: sensitive.reason }],
    });
    await escalate(conv, { category: sensitive.category, reason: sensitive.reason, by: 'rule' });
    return { aiReplied: false, escalated: true, status: 'escalated' };
  }

  if (!isGeminiConfigured() || hotel?.modules.receptionist === false) {
    await appendMessage(conv, { sender: 'system', text: holdingReply('ai_unavailable', hotelPhone) });
    await escalate(conv, {
      category: 'ai_unavailable',
      reason: isGeminiConfigured() ? 'AI receptionist is switched off for this property' : 'AI receptionist is not configured (no Gemini API key)',
      by: 'system',
    });
    return { aiReplied: false, escalated: true, status: 'escalated' };
  }

  const [knowledge, guest, history] = await Promise.all([loadKnowledge(conv.hotelId), loadGuestContext(conv), buildHistory(conv._id)]);
  const effects: ToolEffects = { escalation: null, serviceRequestIds: [] };

  try {
    const reply = await generateReceptionistReply({
      systemInstruction: buildSystemInstruction(knowledge, guest),
      history,
      tools: RECEPTIONIST_TOOLS,
      handleTool: createToolHandler(conv, knowledge, guest, effects),
    });
    await appendMessage(conv, {
      sender: 'ai',
      text: reply.text,
      latencyMs: reply.latencyMs,
      toolCalls: reply.toolCalls.map((t) => ({ name: t.name, ok: t.result.ok === true, summary: summarise(t.name, t.args, t.result) })),
    });
  } catch (err) {
    if (!(err instanceof GeminiUnavailableError)) throw err;
    logger.warn({ reason: err.reason, conversationId: String(conv._id) }, 'AI reply failed; handing over to staff');
    // If tools already did real work this turn (e.g. requests logged), say exactly that — never less, never more.
    const logged = effects.serviceRequestIds.length
      ? await ServiceRequest.find({ _id: { $in: effects.serviceRequestIds } })
          .select('type')
          .lean()
      : [];
    const holding = logged.length
      ? `Thank you! I've passed your ${joinLabels(logged.map((r) => REQUEST_LABELS[r.type] ?? 'request'))} request${logged.length > 1 ? 's' : ''} to our front desk. The team will confirm here shortly.`
      : holdingReply('ai_unavailable', hotelPhone);
    await appendMessage(conv, { sender: 'system', text: holding });
    await escalate(conv, { category: 'ai_unavailable', reason: `AI could not answer (${err.reason.replace('_', ' ')})`, by: 'system' });
    return { aiReplied: false, escalated: true, status: 'escalated' };
  }

  if (effects.escalation) {
    await escalate(conv, { ...effects.escalation, by: 'ai' });
    return { aiReplied: true, escalated: true, status: 'escalated' };
  }
  return { aiReplied: true, escalated: false, status: 'ai_active' };
}

function summarise(name: string, args: Record<string, unknown>, result: Record<string, unknown>): string {
  if (name === 'check_availability_and_price') return `Checked ${String(args.check_in)} → ${String(args.check_out)}`;
  if (name === 'create_service_request') return result.ok ? `Logged ${String(args.type)} request` : `Request not logged (${String(result.error)})`;
  if (name === 'escalate_to_staff') return `Escalated: ${String(args.category)}`;
  return name;
}
