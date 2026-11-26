import type { Request } from 'express';
import type { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { hashIp } from '../../utils/crypto.js';
import { AuditLog } from './auditLog.model.js';

export interface AuditEntry {
  hotelId: Types.ObjectId | null;
  actor: { type: 'user' | 'guest' | 'system' | 'ai'; id?: Types.ObjectId | null; role?: string | null };
  action: string;
  entity?: { type: string; id?: Types.ObjectId | null };
  /** Never put raw PII (phone, email, ID numbers) in metadata. */
  metadata?: Record<string, unknown>;
  req?: Request;
}

/**
 * Audit logging must never break the business operation it records, so failures are logged and swallowed.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      hotelId: entry.hotelId,
      actor: { type: entry.actor.type, id: entry.actor.id ?? null, role: entry.actor.role ?? null },
      action: entry.action,
      entity: { type: entry.entity?.type ?? null, id: entry.entity?.id ?? null },
      metadata: entry.metadata ?? {},
      ipHash: hashIp(entry.req?.ip),
      requestId: entry.req?.requestId ?? null,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'Failed to write audit log');
  }
}

/** Convenience for the common case: the authenticated staff member performed `action`. */
export function auditFromRequest(req: Request, action: string, entity?: AuditEntry['entity'], metadata?: Record<string, unknown>): Promise<void> {
  return audit({
    hotelId: req.auth?.hotelId ?? null,
    actor: { type: 'user', id: req.auth?.userId ?? null, role: req.auth?.role ?? null },
    action,
    entity,
    metadata,
    req,
  });
}
