import { AppError } from '../../shared/errors.js';
import { percentOf } from '../../utils/money.js';
import type { HotelShape, TaxSlab } from '../hotels/hotel.model.js';
import type { BookingAmounts } from './booking.model.js';

export interface QuoteInput {
  nightly: { date: string; ratePaise: number }[];
  quantity: number;
  /** Direct discount applies only to direct bookings (the whole point of booking direct). */
  applyDirectDiscount: boolean;
  promoCode?: string | null | undefined;
  /** Typical OTA nightly price for comparison; null if unknown. */
  otaNightlyPaise: number | null;
  settings: Pick<HotelShape['settings'], 'directDiscountPercent' | 'taxSlabs' | 'promoCodes'>;
  now?: Date;
}

export function gstRateForTariff(perNightPaise: number, slabs: TaxSlab[]): number {
  const slab = slabs.find((s) => s.upToPaise === null || perNightPaise <= s.upToPaise);
  if (!slab) throw new AppError(500, 'INTERNAL', 'Tax slabs are misconfigured');
  return slab.ratePercent;
}

export function resolvePromo(code: string | null | undefined, settings: QuoteInput['settings'], now = new Date()) {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  const promo = settings.promoCodes.find((p) => p.code === normalized);
  if (!promo || !promo.active || (promo.validUntil && promo.validUntil.getTime() < now.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This promo code is not valid', [{ path: 'promoCode', message: 'Invalid or expired code' }]);
  }
  return promo;
}

/**
 * Server-side price quote. Discounts are applied to the room subtotal first. GST is then computed per
 * night per room on the *discounted* tariff, because GST slabs for accommodation depend on the actual
 * per-night transaction value. All values are integer paise.
 */
export function quoteStay(input: QuoteInput): BookingAmounts {
  const { nightly, quantity, settings } = input;
  if (!nightly.length) throw new AppError(400, 'VALIDATION_ERROR', 'A stay must be at least one night');

  const perRoomSubtotal = nightly.reduce((sum, n) => sum + n.ratePaise, 0);
  const subtotalPaise = perRoomSubtotal * quantity;

  const directDiscountPercent = input.applyDirectDiscount ? settings.directDiscountPercent : 0;
  const directDiscountPaise = percentOf(subtotalPaise, directDiscountPercent);

  const promo = resolvePromo(input.promoCode, settings, input.now);
  const promoDiscountPaise = promo ? percentOf(subtotalPaise - directDiscountPaise, promo.percentOff) : 0;

  const taxablePaise = subtotalPaise - directDiscountPaise - promoDiscountPaise;
  const factor = subtotalPaise === 0 ? 0 : taxablePaise / subtotalPaise;

  const rates = new Set<number>();
  let taxPaise = 0;
  for (const night of nightly) {
    const netNight = Math.round(night.ratePaise * factor);
    const rate = gstRateForTariff(netNight, settings.taxSlabs);
    rates.add(rate);
    taxPaise += percentOf(netNight, rate) * quantity;
  }

  let otaEquivalentPaise: number | null = null;
  if (input.otaNightlyPaise && input.otaNightlyPaise > 0) {
    const otaRate = gstRateForTariff(input.otaNightlyPaise, settings.taxSlabs);
    const otaSubtotal = input.otaNightlyPaise * nightly.length * quantity;
    otaEquivalentPaise = otaSubtotal + percentOf(input.otaNightlyPaise, otaRate) * nightly.length * quantity;
  }

  return {
    nightly,
    subtotalPaise,
    directDiscountPercent,
    directDiscountPaise,
    promoCode: promo?.code ?? null,
    promoDiscountPaise,
    taxablePaise,
    taxRatePercent: rates.size === 1 ? [...rates][0]! : null,
    taxPaise,
    totalPaise: taxablePaise + taxPaise,
    otaEquivalentPaise,
  };
}
