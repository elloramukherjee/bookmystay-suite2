import type { ClientSession, Types } from 'mongoose';
import { Guest, type GuestDocument } from '../modules/guests/guest.model.js';
import { normalizePhone } from '../utils/phone.js';
import { AppError } from './errors.js';

export interface GuestIdentityInput {
  hotelId: Types.ObjectId;
  phone: string;
  name?: string | null | undefined;
  email?: string | null | undefined;
  source: string;
  consent?: { transactional?: boolean; marketing?: boolean } | undefined;
}

export function requirePhone(phone: string, path = 'phone'): string {
  const e164 = normalizePhone(phone);
  if (!e164) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid mobile number', [{ path, message: 'Enter a valid 10-digit mobile number' }]);
  return e164;
}

/**
 * The single entry point for "who is this guest?" across booking, chat and CRM. Guests are identified
 * by normalised phone per hotel; repeated calls for the same number return the same profile.
 * Marketing consent is only ever *granted* here (explicit opt-in); withdrawal is a separate action.
 */
export async function upsertGuest(input: GuestIdentityInput, session?: ClientSession): Promise<GuestDocument> {
  const phoneE164 = requirePhone(input.phone);
  const now = new Date();

  const $set: Record<string, unknown> = { lastSource: input.source };
  if (input.name?.trim()) $set.name = input.name.trim();
  if (input.email?.trim()) $set.email = input.email.trim().toLowerCase();
  if (input.consent?.transactional) $set['consent.transactional'] = { granted: true, at: now, source: input.source, withdrawnAt: null };
  if (input.consent?.marketing) $set['consent.marketing'] = { granted: true, at: now, source: input.source, withdrawnAt: null };

  const guest = await Guest.findOneAndUpdate(
    { hotelId: input.hotelId, phoneE164 },
    { $set, $setOnInsert: { hotelId: input.hotelId, phoneE164, firstSource: input.source } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  );
  return guest!;
}

export async function findGuestByPhone(hotelId: Types.ObjectId, phone: string) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) return null;
  return Guest.findOne({ hotelId, phoneE164 });
}
