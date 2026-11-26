import { env } from '../../../config/env.js';
import { MockPaymentProvider } from './mock.provider.js';
import { RazorpayProvider } from './razorpay.provider.js';
import { AppError } from '../../../shared/errors.js';
import type { PaymentProvider } from './types.js';

const onlinePaymentsDisabled = () =>
  new AppError(409, 'ONLINE_PAYMENTS_DISABLED', 'This property takes payment at the hotel. Your booking is confirmed without paying online.');

let instance: PaymentProvider | null = null;

export function paymentProvider(): PaymentProvider {
  if (isPayAtHotelOnly()) throw onlinePaymentsDisabled();
  if (instance) return instance;
  if (env.PAYMENT_PROVIDER === 'razorpay') {
    if (!env.PAYMENT_GATEWAY_KEY || !env.PAYMENT_GATEWAY_SECRET || !env.PAYMENT_WEBHOOK_SECRET) {
      throw new Error('Razorpay requires PAYMENT_GATEWAY_KEY, PAYMENT_GATEWAY_SECRET and PAYMENT_WEBHOOK_SECRET');
    }
    instance = new RazorpayProvider({ keyId: env.PAYMENT_GATEWAY_KEY, keySecret: env.PAYMENT_GATEWAY_SECRET, webhookSecret: env.PAYMENT_WEBHOOK_SECRET });
  } else {
    instance = new MockPaymentProvider();
  }
  return instance;
}

export const isMockPayments = () => env.PAYMENT_PROVIDER === 'mock' && !env.isProduction;
/** No online payments at all: bookings are confirmed as "pay at hotel". */
export const isPayAtHotelOnly = () => env.PAYMENT_PROVIDER === 'pay_at_hotel';
