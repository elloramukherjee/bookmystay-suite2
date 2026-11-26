import { env } from '../../../config/env.js';
import { AppError } from '../../../shared/errors.js';
import { isIsoDay } from '../../../utils/dates.js';
import { formatINR } from '../../../utils/money.js';
import { searchAvailability } from '../../availability/inventory.service.js';
import type { ConversationLean, EscalationCategory } from '../models/conversation.model.js';
import { ESCALATION_CATEGORIES } from '../models/conversation.model.js';
import { SERVICE_REQUEST_TYPES, ServiceRequest, type ServiceRequestType } from '../models/serviceRequest.model.js';
import type { GuestContext, Knowledge } from './context.service.js';
import type { LlmTool } from './gemini.service.js';

export const RECEPTIONIST_TOOLS: LlmTool[] = [
  {
    name: 'check_availability_and_price',
    description:
      'Get LIVE room availability and exact prices (including GST and the direct-booking discount) from the hotel system. The only allowed source for any availability or price statement.',
    parameters: {
      type: 'object',
      properties: {
        check_in: { type: 'string', description: 'Check-in date, YYYY-MM-DD' },
        check_out: { type: 'string', description: 'Check-out date, YYYY-MM-DD' },
        adults: { type: 'integer', minimum: 1, maximum: 20 },
        children: { type: 'integer', minimum: 0, maximum: 10 },
        rooms: { type: 'integer', minimum: 1, maximum: 5 },
      },
      required: ['check_in', 'check_out', 'adults'],
    },
  },
  {
    name: 'create_service_request',
    description:
      'Log an operational request from a verified staying/arriving guest with the front desk (housekeeping, towels, extra bed, late checkout, early check-in, maintenance, food, transport). Returns ok:true when logged. Does NOT mean it is completed or approved.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...SERVICE_REQUEST_TYPES] },
        details: { type: 'string', description: 'What exactly the guest wants, including quantity and preferred time.' },
      },
      required: ['type', 'details'],
    },
  },
  {
    name: 'escalate_to_staff',
    description:
      'Hand the conversation to a human staff member. Use for complaints, safety, medical, payment disputes, refunds, upset guests, questions you cannot answer from the knowledge provided, or when the guest asks for a person.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...ESCALATION_CATEGORIES.filter((c) => c !== 'ai_unavailable')] },
        reason: { type: 'string', description: 'One short sentence for staff explaining why.' },
      },
      required: ['category', 'reason'],
    },
  },
];

export interface ToolEffects {
  escalation: { category: EscalationCategory; reason: string } | null;
  serviceRequestIds: string[];
}

/**
 * Executes tool calls against the real system. Every result is what the model is allowed to say —
 * e.g. a service request result explicitly states it is logged, not completed.
 */
export function createToolHandler(conversation: ConversationLean, knowledge: Knowledge, guest: GuestContext, effects: ToolEffects) {
  return async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    switch (name) {
      case 'check_availability_and_price': {
        const checkIn = String(args.check_in ?? '');
        const checkOut = String(args.check_out ?? '');
        if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) return { ok: false, error: 'Ask the guest for exact check-in and check-out dates.' };
        const adults = Number(args.adults ?? 2);
        const children = Number(args.children ?? 0);
        const rooms = Number(args.rooms ?? 1);
        try {
          const result = await searchAvailability({ hotelId: String(conversation.hotelId), checkIn, checkOut, adults, children, rooms });
          const link = `${env.clientOrigins[0]}/h/${knowledge.hotel.slug}/rooms?checkIn=${checkIn}&checkOut=${checkOut}&adults=${adults}&children=${children}&rooms=${rooms}`;
          return {
            ok: true,
            nights: result.nights,
            options: result.results.map((r) => {
              const best = r.ratePlans[0]!;
              return {
                roomType: r.roomType.name,
                bookable: r.bookable,
                reason: r.reason,
                plans: r.ratePlans.map((p) => ({ plan: p.ratePlan?.name ?? 'Standard', totalInclGst: formatINR(p.quote.totalPaise) })),
                perNightInclGst: formatINR(Math.round(best.quote.totalPaise / Math.max(1, result.nights * rooms))),
              };
            }),
            bookingLink: link,
            note: 'Prices include GST and the direct-booking discount. Share the booking link; you cannot book or take payment in chat.',
          };
        } catch (err) {
          if (err instanceof AppError) return { ok: false, error: err.message };
          throw err;
        }
      }

      case 'create_service_request': {
        const type = String(args.type ?? 'other') as ServiceRequestType;
        const details = String(args.details ?? '').slice(0, 500);
        const b = guest.booking;
        if (!b || !['confirmed', 'checked_in'].includes(b.status)) {
          return { ok: false, error: 'not_verified', message: 'Requests can only be logged for a verified upcoming or current stay.' };
        }
        const sr = await ServiceRequest.create({
          hotelId: conversation.hotelId,
          guestId: b.guestId,
          bookingId: b._id,
          conversationId: conversation._id,
          roomNumber: b.roomNumber,
          type: SERVICE_REQUEST_TYPES.includes(type) ? type : 'other',
          details: details || 'Guest request (see conversation)',
          createdBy: 'ai',
        });
        effects.serviceRequestIds.push(String(sr._id));
        const needsApproval = ['late_checkout', 'early_checkin', 'extra_bed'].includes(sr.type);
        return {
          ok: true,
          requestId: String(sr._id).slice(-6).toUpperCase(),
          status: 'logged',
          note: needsApproval
            ? 'Logged for the front desk to review. It is NOT approved yet — the team will confirm availability.'
            : 'Logged with the front desk. It is NOT completed yet — the team will take care of it.',
        };
      }

      case 'escalate_to_staff': {
        const category = String(args.category ?? 'guest_request') as EscalationCategory;
        effects.escalation = {
          category: ESCALATION_CATEGORIES.includes(category) ? category : 'guest_request',
          reason: String(args.reason ?? 'Guest needs staff assistance').slice(0, 300),
        };
        return {
          ok: true,
          note: 'A staff member has been alerted and will reply in this chat. Tell the guest this briefly; do not promise timings or compensation.',
        };
      }

      default:
        return { ok: false, error: 'Unknown tool' };
    }
  };
}
