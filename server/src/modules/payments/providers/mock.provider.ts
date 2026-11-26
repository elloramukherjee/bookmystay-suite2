import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { safeEqual } from '../../../utils/crypto.js';
import { PaymentProviderUnavailableError, type CreatedOrder, type CreateOrderInput, type NormalizedEvent, type PaymentProvider } from './types.js';

/**
 * ⚠️ DEVELOPMENT MOCK — moves no money. Orders are fake, the UPI VPA is fake, and "payments" only happen
 * when a developer presses the simulate button (which posts a signed webhook through the real pipeline).
 * env.ts refuses to boot with this provider in production.
 */
const MOCK_SECRET = `mock-webhook:${env.JWT_REFRESH_SECRET}`;
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

export function signMockWebhook(rawBody: string): string {
  return createHmac('sha256', MOCK_SECRET).update(rawBody).digest('hex');
}

export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  /** Lets tests simulate a gateway outage. */
  static failNextCreate = false;

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    if (MockPaymentProvider.failNextCreate) {
      MockPaymentProvider.failNextCreate = false;
      throw new PaymentProviderUnavailableError('Mock gateway outage (simulated)');
    }
    const orderId = `mock_order_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    const amount = (input.amountPaise / 100).toFixed(2);
    return {
      providerOrderId: orderId,
      checkout: {
        kind: 'mock',
        orderId,
        upiIntent: `upi://pay?pa=dev-mock@notarealvpa&pn=BookMyStay%20DEV%20MOCK&am=${amount}&cu=INR&tn=${encodeURIComponent(input.receipt)}`,
      },
    };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = headers[MOCK_SIGNATURE_HEADER];
    return typeof sig === 'string' && safeEqual(sig, signMockWebhook(rawBody.toString('utf8')));
  }

  parseWebhook(rawBody: Buffer): NormalizedEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      event: 'payment.captured' | 'payment.failed';
      orderId: string;
      paymentId: string;
      amountPaise: number;
      reason?: string;
    };
    return {
      eventId: body.id,
      type: body.event === 'payment.captured' || body.event === 'payment.failed' ? body.event : 'ignored',
      providerOrderId: body.orderId,
      providerPaymentId: body.paymentId,
      amountPaise: body.amountPaise,
      failureReason: body.reason ?? null,
    };
  }
}
