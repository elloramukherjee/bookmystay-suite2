import type { Request } from 'express';
import { Types } from 'mongoose';
import { audit } from '../../../shared/audit/audit.service.js';
import { notFound } from '../../../shared/errors.js';
import type { AuthContext } from '../../../types/express.js';
import { HotelFaq, type HotelFaqLean, type HotelFaqShape } from '../models/hotelFaq.model.js';

export type FaqInput = Pick<HotelFaqShape, 'question' | 'answer' | 'category' | 'keywords' | 'published'>;

const view = (f: HotelFaqLean) => ({
  id: String(f._id),
  question: f.question,
  answer: f.answer,
  category: f.category,
  keywords: f.keywords,
  published: f.published,
  updatedAt: f.updatedAt.toISOString(),
});

export async function listFaqs(hotelId: Types.ObjectId) {
  return (await HotelFaq.find({ hotelId }).sort({ category: 1, sortOrder: 1, createdAt: 1 }).lean()).map(view);
}

export async function createFaq(actor: AuthContext, hotelId: Types.ObjectId, input: FaqInput, req: Request) {
  const faq = await HotelFaq.create({ ...input, hotelId });
  await audit({ hotelId, actor: { type: 'user', id: actor.userId, role: actor.role }, action: 'faq.created', entity: { type: 'HotelFaq', id: faq._id }, req });
  return view(faq.toObject() as HotelFaqLean);
}

export async function updateFaq(actor: AuthContext, hotelId: Types.ObjectId, id: string, input: Partial<FaqInput>, req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('FAQ');
  const faq = await HotelFaq.findOneAndUpdate({ _id: id, hotelId }, { $set: input }, { new: true, runValidators: true }).lean();
  if (!faq) throw notFound('FAQ');
  await audit({ hotelId, actor: { type: 'user', id: actor.userId, role: actor.role }, action: 'faq.updated', entity: { type: 'HotelFaq', id: faq._id }, req });
  return view(faq);
}

export async function deleteFaq(actor: AuthContext, hotelId: Types.ObjectId, id: string, req: Request) {
  if (!Types.ObjectId.isValid(id)) throw notFound('FAQ');
  const faq = await HotelFaq.findOneAndDelete({ _id: id, hotelId }).lean();
  if (!faq) throw notFound('FAQ');
  await audit({
    hotelId,
    actor: { type: 'user', id: actor.userId, role: actor.role },
    action: 'faq.deleted',
    entity: { type: 'HotelFaq', id: faq._id },
    metadata: { question: faq.question.slice(0, 80) },
    req,
  });
}
