import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { maskPhone } from '../../utils/phone.js';
import { WhatsAppCloudProvider, isWhatsAppLive } from '../whatsapp/cloudApi.provider.js';
import type { NotificationChannel } from './notification.model.js';

export { PermanentSendError } from './sendErrors.js';

export interface SendResult {
  /** true when a real provider accepted the message; false for development simulators. */
  delivered: boolean;
  providerMessageId: string | null;
}

/** Business-initiated message context: lets WhatsApp use a Meta-approved template instead of free text. */
export interface SendOptions {
  /** Internal message type, e.g. "booking_confirmed". */
  template: string;
  /** Ordered values for the approved template's {{1}}, {{2}}… placeholders. */
  params: string[] | null;
}

export interface MessageProvider {
  readonly channel: NotificationChannel;
  readonly name: string;
  /** false for console simulators: the outbox never counts them as a way to reach a guest. */
  readonly live: boolean;
  send(to: string, body: string, options?: SendOptions): Promise<SendResult>;
}

/**
 * Development providers: they log a masked recipient and report `delivered: false`, so the system marks
 * the message "simulated" — never claiming a guest actually received it.
 */
class ConsoleProvider implements MessageProvider {
  readonly live = false;
  constructor(
    readonly channel: NotificationChannel,
    readonly name: string,
  ) {}

  async send(to: string, body: string): Promise<SendResult> {
    const recipient = to.includes('@') ? `${to.slice(0, 2)}•••@${to.split('@')[1]}` : maskPhone(to);
    logger.info({ channel: this.channel, to: recipient, preview: body.slice(0, 80) }, `[DEV ${this.channel.toUpperCase()} SIMULATOR] message not sent`);
    return { delivered: false, providerMessageId: null };
  }
}

const simulators: Record<NotificationChannel, MessageProvider> = {
  whatsapp: new ConsoleProvider('whatsapp', 'dev-whatsapp-simulator'),
  sms: new ConsoleProvider('sms', 'dev-sms-console'),
  email: new ConsoleProvider('email', 'dev-email-console'),
};
const overrides = new Map<NotificationChannel, MessageProvider>();

/** True when this channel can actually reach someone (not a console simulator). */
export function isChannelLive(channel: NotificationChannel): boolean {
  return providerFor(channel).live;
}
let cloud: { key: string; provider: WhatsAppCloudProvider } | null = null;

/** Replaces a channel's provider (tests, or a future SMS/email integration). */
export function registerProvider(provider: MessageProvider): void {
  overrides.set(provider.channel, provider);
}
export function resetProviders(): void {
  overrides.clear();
  cloud = null;
}

/**
 * WhatsApp goes through Meta's Cloud API as soon as all four WHATSAPP_* credentials are set; until then
 * the simulator keeps every flow working end-to-end without sending anything.
 */
export function providerFor(channel: NotificationChannel): MessageProvider {
  const override = overrides.get(channel);
  if (override) return override;
  if (channel === 'whatsapp' && isWhatsAppLive()) {
    const key = `${env.WHATSAPP_PHONE_NUMBER_ID}:${env.WHATSAPP_API_VERSION}:${env.WHATSAPP_ACCESS_TOKEN?.slice(-6)}`;
    if (cloud?.key !== key) {
      cloud = {
        key,
        provider: new WhatsAppCloudProvider({
          accessToken: env.WHATSAPP_ACCESS_TOKEN!,
          phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
          apiVersion: env.WHATSAPP_API_VERSION,
        }),
      };
    }
    return cloud.provider;
  }
  return simulators[channel];
}
