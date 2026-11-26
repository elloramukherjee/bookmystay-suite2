import { isChannelLive } from '../modules/notifications/providers.js';
import { isWhatsAppLive, templateMap } from '../modules/whatsapp/cloudApi.provider.js';
import { supportsTransactions } from './db.js';
import { env } from './env.js';

export interface ReadinessItem {
  level: 'ok' | 'warn' | 'error';
  area: string;
  message: string;
}

/**
 * Go-live checklist computed from the running configuration. Hard requirements (secrets, payment
 * provider, public origin) are already enforced by env validation; this covers what the MVP can run
 * without, so operators see exactly what guests will and won't get. Never includes secret values.
 */
export function readinessReport(): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const add = (level: ReadinessItem['level'], area: string, message: string) => items.push({ level, area, message });

  add(
    supportsTransactions() ? 'ok' : env.isProduction ? 'error' : 'warn',
    'database',
    supportsTransactions() ? 'Replica set: multi-document transactions available' : 'Standalone MongoDB: use a replica set (e.g. MongoDB Atlas) in production',
  );
  add(
    env.geminiConfigured ? 'ok' : 'warn',
    'ai',
    env.geminiConfigured ? `Gemini configured (${env.GEMINI_MODEL})` : 'No GEMINI_API_KEY: every guest chat goes straight to staff',
  );

  if (isWhatsAppLive()) {
    add('ok', 'whatsapp', 'WhatsApp Cloud API live');
    const mapped = templateMap();
    const missing = ['booking_confirmed', 'booking_cancelled', 'checkin_welcome', 'staff_escalation_alert'].filter((t) => !mapped.has(t));
    if (missing.length) add('warn', 'whatsapp', `No approved template mapped for: ${missing.join(', ')} (only delivered inside the 24-hour window)`);
  } else {
    add(env.isProduction ? 'warn' : 'ok', 'whatsapp', 'Simulator mode: no WhatsApp messages reach guests until WHATSAPP_* credentials are set');
  }

  for (const channel of ['sms', 'email'] as const) {
    if (!isChannelLive(channel)) add('warn', channel, `No ${channel.toUpperCase()} provider: undeliverable WhatsApp messages become staff call tasks`);
  }

  if (env.PAYMENT_PROVIDER === 'pay_at_hotel') {
    add('ok', 'payments', 'Pay at hotel only: website bookings are confirmed without online payment; collect at the property');
  } else {
    add(
      env.PAYMENT_PROVIDER === 'razorpay' ? 'ok' : env.isProduction ? 'error' : 'warn',
      'payments',
      env.PAYMENT_PROVIDER === 'razorpay' ? 'Razorpay configured' : 'Mock payments (development only)',
    );
  }
  if (env.isProduction && env.TRUST_PROXY === 0)
    add('warn', 'network', 'TRUST_PROXY=0: behind a load balancer set it to the number of proxies, or rate limits see one IP');
  if (env.isProduction && !env.SERVE_CLIENT) add('ok', 'web', 'SERVE_CLIENT is off: host client/dist separately on the CLIENT_URL origin');
  return items;
}
