import type { PaymentMethod } from '../payment.model.js';

export interface CreateOrderInput {
  amountPaise: number;
  receipt: string; // booking reference
  method: PaymentMethod;
  notes: Record<string, string>;
}

export interface CheckoutInstructions {
  /** "mock" renders the development simulator; "razorpay" loads Razorpay Checkout with `orderId` + `keyId`. */
  kind: 'mock' | 'razorpay';
  orderId: string;
  keyId?: string;
  /** UPI deep link for "pay with any UPI app" (mock shows a clearly fake VPA). */
  upiIntent?: string;
}

export interface CreatedOrder {
  providerOrderId: string;
  checkout: CheckoutInstructions;
}

export type NormalizedEventType = 'payment.captured' | 'payment.failed' | 'ignored';

export interface NormalizedEvent {
  eventId: string;
  type: NormalizedEventType;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'razorpay';
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** Verifies the webhook signature over the *raw* request body. Must be constant-time. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent;
}

export class PaymentProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}
