import { Schema, model, type Types } from 'mongoose';

export type NotificationChannel = 'whatsapp' | 'sms' | 'email';
export type NotificationStatus = 'queued' | 'sending' | 'sent' | 'simulated' | 'failed' | 'dead';

export interface NotificationShape {
  hotelId: Types.ObjectId;
  channel: NotificationChannel;
  /** E.164 phone or email address. */
  to: string;
  template: string;
  body: string;
  relatedEntity: { type: string; id: Types.ObjectId } | null;
  /** `simulated` = a development provider accepted it; nothing was actually delivered. */
  status: NotificationStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  providerMessageId: string | null;
  fallbackChannel: NotificationChannel | null;
  /** Guest email, used when the chain reaches the email channel (WhatsApp → SMS → email). */
  fallbackEmail: string | null;
  /** Values for a Meta-approved WhatsApp template ({{1}}, {{2}}…), when one is configured for `template`. */
  templateParams: string[] | null;
  /**
   * Set when every channel failed or none can actually deliver (no SMS/email provider): staff must
   * contact the guest themselves. Cleared by a staff member once done.
   */
  manualFollowUp: { required: boolean; reason: string; resolvedAt: Date | null; resolvedBy: Types.ObjectId | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Outbox: messages are written in the same request as the business change, then delivered by a worker
 * with retries. A WhatsApp/SMS outage therefore never blocks or loses a booking confirmation.
 */
const notificationSchema = new Schema<NotificationShape>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    to: { type: String, required: true },
    template: { type: String, required: true },
    body: { type: String, required: true, maxlength: 4000 },
    relatedEntity: {
      type: new Schema({ type: String, id: Schema.Types.ObjectId }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: ['queued', 'sending', 'sent', 'simulated', 'failed', 'dead'], default: 'queued' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    lastError: { type: String, default: null, maxlength: 500 },
    providerMessageId: { type: String, default: null },
    fallbackChannel: { type: String, enum: ['whatsapp', 'sms', 'email', null], default: null },
    fallbackEmail: { type: String, default: null },
    templateParams: { type: [String], default: null },
    manualFollowUp: {
      type: new Schema(
        {
          required: Boolean,
          reason: { type: String, maxlength: 300 },
          resolvedAt: { type: Date, default: null },
          resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ status: 1, nextAttemptAt: 1 });
notificationSchema.index({ hotelId: 1, createdAt: -1 });
notificationSchema.index({ 'relatedEntity.type': 1, 'relatedEntity.id': 1 });
notificationSchema.index({ providerMessageId: 1 });
notificationSchema.index({ hotelId: 1, 'manualFollowUp.required': 1, 'manualFollowUp.resolvedAt': 1 });

export type NotificationLean = NotificationShape & { _id: Types.ObjectId };
export const Notification = model<NotificationShape>('Notification', notificationSchema);
