import { env } from '../../config/env.js';
import { maskPhone } from '../../utils/phone.js';
import type { MessageProvider, SendOptions, SendResult } from '../notifications/providers.js';
import { PermanentSendError } from '../notifications/sendErrors.js';

/** True only when all four Meta credentials are present (read at call time, so `.env` changes need just a restart). */
export function isWhatsAppLive(): boolean {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET);
}

/**
 * Meta error codes that retrying will not fix. 131047: more than 24 hours since the guest last wrote
 * (needs an approved template). 131026: number not on WhatsApp / undeliverable. 131051: unsupported
 * message type. 100: invalid parameter (e.g. malformed number). 131030: number not in the test allow-list.
 */
const PERMANENT_CODES = new Set([100, 131026, 131030, 131047, 131051]);

/** Parses WHATSAPP_TEMPLATES ("booking_confirmed=bms_booking_confirmed:en,…") into internal type → Meta template. */
export function templateMap(raw = env.WHATSAPP_TEMPLATES): Map<string, { name: string; language: string }> {
  const map = new Map<string, { name: string; language: string }>();
  for (const pair of (raw ?? '').split(',')) {
    const [key, value] = pair.split('=').map((v) => v?.trim());
    if (!key || !value) continue;
    const [name, language] = value.split(':').map((v) => v.trim());
    if (name) map.set(key, { name, language: language || 'en' });
  }
  return map;
}

/** Template parameters may not contain newlines, tabs or 4+ consecutive spaces (Meta error 132018). */
const templateText = (v: string) =>
  v
    .replace(/[\r\n\t]+/g, ' · ')
    .replace(/ {4,}/g, ' ')
    .trim()
    .slice(0, 1000) || '-';

interface GraphError {
  error?: { code?: number; message?: string; error_data?: { details?: string } };
}

export class WhatsAppCloudProvider implements MessageProvider {
  readonly channel = 'whatsapp' as const;
  readonly name = 'whatsapp-cloud-api';
  readonly live = true;

  constructor(private readonly cfg: { accessToken: string; phoneNumberId: string; apiVersion: string; timeoutMs?: number }) {}

  async send(to: string, body: string, options?: SendOptions): Promise<SendResult> {
    const approved = options?.params ? templateMap().get(options.template) : undefined;
    const content = approved
      ? {
          type: 'template',
          template: {
            name: approved.name,
            language: { code: approved.language },
            components: [{ type: 'body', parameters: options!.params!.map((text) => ({ type: 'text', text: templateText(text) })) }],
          },
        }
      : { type: 'text', text: { preview_url: false, body: body.slice(0, 4096) } };
    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          ...content,
        }),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 10_000),
      });
    } catch (err) {
      // Network error or timeout: retryable.
      throw new Error(`WhatsApp API unreachable: ${err instanceof Error ? err.message : 'network error'}`);
    }

    const json = (await res.json().catch(() => ({}))) as GraphError & { messages?: { id: string }[] };
    if (res.ok) return { delivered: true, providerMessageId: json.messages?.[0]?.id ?? null };

    const code = json.error?.code;
    const detail = json.error?.error_data?.details ?? json.error?.message ?? res.statusText;
    const message = `WhatsApp API ${res.status}${code ? ` (code ${code})` : ''} to ${maskPhone(to)}: ${detail}`;
    if (code !== undefined && PERMANENT_CODES.has(code)) throw new PermanentSendError(message);
    // 429 / 5xx / expired token (190) / throughput limits (130429, 131056): retry with backoff, then fall back.
    throw new Error(message);
  }
}
