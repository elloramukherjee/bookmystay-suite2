import { createHmac } from 'node:crypto';
import { safeEqual } from '../../../utils/crypto.js';
import { PaymentProviderUnavailableError, type CreatedOrder, type CreateOrderInput, type NormalizedEvent, type PaymentProvider } from './types.js';

interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl?: string;
}

/**
 * Razorpay Orders API + webhook adapter (UPI, cards, netbanking).
 *   Orders:   POST /v1/orders  (HTTP Basic key_id:key_secret), amount in paise
 *   Webhook:  X-Razorpay-Signature = HMAC-SHA256(rawBody, webhookSecret), hex
 *   Events:   payment.captured, payment.failed (payload.payment.entity)
 * The browser opens Razorpay Checkout with { key: keyId, order_id } — UPI is shown first by Razorpay
 * for INR orders.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: RazorpayConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.razorpay.com';
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const auth = Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/orders`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: input.amountPaise, currency: 'INR', receipt: input.receipt, notes: input.notes }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new PaymentProviderUnavailableError(`Razorpay unreachable: ${(err as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429) throw new PaymentProviderUnavailableError(`Razorpay returned ${res.status}`);
    if (!res.ok) throw new Error(`Razorpay order creation failed with ${res.status}`);
    const order = (await res.json()) as { id: string };
    return { providerOrderId: order.id, checkout: { kind: 'razorpay', orderId: order.id, keyId: this.config.keyId } };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headers['x-razorpay-signature'];
    if (typeof sig !== 'string') return false;
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');
    return safeEqual(sig, expected);
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; error_description?: string } } };
    };
    const entity = body.payload?.payment?.entity;
    const eventIdHeader = headers['x-razorpay-event-id'];
    const type = body.event === 'payment.captured' || body.event === 'payment.failed' ? body.event : 'ignored';
    return {
      eventId: typeof eventIdHeader === 'string' ? eventIdHeader : `${body.event}:${entity?.id ?? 'unknown'}`,
      type,
      providerOrderId: entity?.order_id ?? null,
      providerPaymentId: entity?.id ?? null,
      amountPaise: entity?.amount ?? null,
      failureReason: entity?.error_description ?? null,
    };
  }
}
