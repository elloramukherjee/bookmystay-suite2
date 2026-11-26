import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../../shared/audit/audit.service.js';
import { AppError, notFound } from '../../../shared/errors.js';
import type { AuthContext } from '../../../types/express.js';
import { Guest, type GuestLean } from '../../guests/guest.model.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { FollowUp } from '../models/followUp.model.js';
import { MessageTemplate, type MessageTemplateLean, type TemplatePurpose } from '../models/messageTemplate.model.js';

const MAX_DRAFTS = 200;

const templateView = (t: MessageTemplateLean) => ({
  id: String(t._id),
  name: t.name,
  purpose: t.purpose,
  body: t.body,
  promoCode: t.promoCode,
  metaTemplateName: t.metaTemplateName,
  metaApproved: t.metaApproved,
  isActive: t.isActive,
});

export async function listTemplates(hotelId: Types.ObjectId) {
  return (await MessageTemplate.find({ hotelId }).sort({ isActive: -1, name: 1 }).lean()).map(templateView);
}

export interface TemplateInput {
  name: string;
  purpose: TemplatePurpose;
  body: string;
  promoCode?: string | null | undefined;
  isActive?: boolean | undefined;
}

export async function createTemplate(actor: AuthContext, hotelId: Types.ObjectId, input: TemplateInput, req: Request) {
  const t = await MessageTemplate.create({ ...input, hotelId });
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'template.created',
    entity: { type: 'MessageTemplate', id: t._id },
    req,
  });
  return templateView(t.toObject() as MessageTemplateLean);
}

export async function updateTemplate(actor: AuthContext, hotelId: Types.ObjectId, id: string, input: Partial<TemplateInput>, req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Template');
  // Editing the text invalidates any Meta approval: approval is for exact wording.
  const changesText = input.body !== undefined;
  const t = await MessageTemplate.findOneAndUpdate(
    { _id: id, hotelId },
    { $set: { ...input, ...(changesText ? { metaApproved: false } : {}) } },
    { new: true, runValidators: true },
  ).lean();
  if (!t) throw notFound('Template');
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'template.updated',
    entity: { type: 'MessageTemplate', id: t._id },
    req,
  });
  return templateView(t);
}

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const hasMarketingConsent = (g: Pick<GuestLean, 'consent'>) => Boolean(g.consent.marketing?.granted && !g.consent.marketing?.withdrawnAt);

export type Audience = 'returning' | 'ota_converts' | 'ota_only' | 'all_consented' | 'selected';

/**
 * Prepares personalised follow-up drafts (PRD: "pre-written WhatsApp messages the owner sends personally").
 * Consent is enforced here — guests without marketing consent (or who said STOP) are never drafted —
 * and the response reports how many were excluded, so the owner understands why.
 */
export async function createDrafts(
  actor: AuthContext,
  hotelId: Types.ObjectId,
  input: { templateId: string; audience: Audience; guestIds?: string[] | undefined },
  req: Request,
) {
  if (!Types.ObjectId.isValid(input.templateId)) throw notFound('Template');
  const [hotel, template] = await Promise.all([
    Hotel.findById(hotelId).select('name').lean(),
    MessageTemplate.findOne({ _id: input.templateId, hotelId, isActive: true }).lean(),
  ]);
  if (!hotel || !template) throw notFound('Template');

  const filter: Record<string, unknown> = { hotelId, 'privacy.anonymisedAt': null };
  switch (input.audience) {
    case 'returning':
      filter['stats.completedStays'] = { $gte: 1 };
      break;
    case 'ota_converts':
      filter['stats.otaBookings'] = { $gte: 1 };
      filter['stats.directBookings'] = { $gte: 1 };
      break;
    case 'ota_only':
      filter['stats.otaBookings'] = { $gte: 1 };
      filter['stats.directBookings'] = 0;
      break;
    case 'selected':
      if (!input.guestIds?.length) throw new AppError(400, 'VALIDATION_ERROR', 'Choose at least one guest', [{ path: 'guestIds', message: 'Required' }]);
      filter._id = { $in: input.guestIds.filter((id) => Types.ObjectId.isValid(id)) };
      break;
    case 'all_consented':
      break;
  }
  const candidates = await Guest.find(filter)
    .sort({ 'stats.lastStayAt': -1 })
    .limit(MAX_DRAFTS * 3)
    .lean();
  const eligible = candidates.filter(hasMarketingConsent).slice(0, MAX_DRAFTS);
  const excludedNoConsent = candidates.filter((g) => !hasMarketingConsent(g)).length;

  const drafts = await FollowUp.insertMany(
    eligible.map((g) => ({
      hotelId,
      templateId: template._id,
      guestId: g._id,
      createdBy: actor.userId,
      text: renderTemplate(template.body, {
        firstName: (g.name ?? 'there').split(' ')[0]!,
        hotelName: hotel.name,
        code: template.promoCode ?? '',
      }),
    })),
  );
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'follow_up.drafted',
    entity: { type: 'MessageTemplate', id: template._id },
    metadata: { audience: input.audience, drafted: drafts.length, excludedNoConsent },
    req,
  });
  return {
    template: templateView(template),
    drafted: drafts.length,
    excludedNoConsent,
    drafts: drafts.map((d) => {
      const g = eligible.find((x) => x._id.equals(d.guestId))!;
      return { id: String(d._id), guestId: String(g._id), guestName: g.name, phoneE164: g.phoneE164, text: d.text, status: d.status };
    }),
  };
}

/** Owner confirms they sent a draft from their own WhatsApp (we can't observe a personal send). */
export async function markSent(actor: AuthContext, hotelId: Types.ObjectId, id: string, status: 'sent_personally' | 'discarded', req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('Draft');
  const draft = await FollowUp.findOne({ _id: id, hotelId }).lean();
  if (!draft) throw notFound('Draft');
  if (status === 'sent_personally') {
    // Re-check consent at send time: the guest may have opted out since the draft was made.
    const guest = await Guest.findById(draft.guestId).select('consent').lean();
    if (!guest || !hasMarketingConsent(guest)) throw new AppError(409, 'CONFLICT', 'This guest has withdrawn marketing consent. Do not send.');
  }
  const updated = await FollowUp.findOneAndUpdate(
    { _id: id, hotelId, status: 'draft' },
    { $set: { status, sentAt: status === 'sent_personally' ? new Date() : null } },
    { new: true },
  ).lean();
  if (!updated) throw new AppError(409, 'CONFLICT', 'This draft was already handled.');
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: `follow_up.${status}`,
    entity: { type: 'FollowUp', id: updated._id },
    req,
  });
  return { id: String(updated._id), status: updated.status, sentAt: updated.sentAt?.toISOString() ?? null };
}
