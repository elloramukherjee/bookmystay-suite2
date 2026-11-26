import { request } from './api';

export interface ChannelStats {
  channel: 'whatsapp' | 'sms' | 'email';
  provider: string;
  /** false = no real provider: messages on this channel are only logged. */
  live: boolean;
  sent: number;
  simulated: number;
  pending: number;
  failed: number;
}

export interface MessagingStatus {
  mode: 'live' | 'simulator';
  phoneNumberId: string | null;
  linkedToProperty: boolean | null;
  hotelWhatsapp: string | null;
  webhookPath: string;
  apiVersion: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  channels: ChannelStats[];
  recentFailures: { channel: string; template: string; error: string | null; at: string; fellBackTo: string | null; staffFollowUp: boolean }[];
  templates: { template: string; metaTemplate: string | null }[];
  manualFollowUps: ManualFollowUp[];
}

/** A guest no channel could reach: staff must call them. */
export interface ManualFollowUp {
  id: string;
  message: string;
  phone: string | null;
  email: string | null;
  guestName: string | null;
  bookingReference: string | null;
  bookingId: string | null;
  body: string;
  reason: string;
  at: string;
}

export const messagingService = {
  status: () => request<MessagingStatus>({ method: 'GET', url: '/whatsapp/status' }),
  resolveFollowUp: (id: string) => request<{ id: string; resolved: boolean }>({ method: 'POST', url: `/whatsapp/follow-ups/${id}/resolve` }),
};
