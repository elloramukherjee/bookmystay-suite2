import { describe, expect, it } from 'vitest';
import { gstRateForTariff, quoteStay } from '../pricing.service.js';

const settings = {
  directDiscountPercent: 10,
  taxSlabs: [
    { upToPaise: 100_000, ratePercent: 0 },
    { upToPaise: 750_000, ratePercent: 5 },
    { upToPaise: null, ratePercent: 18 },
  ],
  promoCodes: [
    { code: 'DIRECTSTAY', percentOff: 5, active: true, validUntil: null },
    { code: 'OLDCODE', percentOff: 20, active: true, validUntil: new Date('2020-01-01') },
    { code: 'PAUSED', percentOff: 20, active: false, validUntil: null },
  ],
};
const nights = (rates: number[]) => rates.map((ratePaise, i) => ({ date: `2026-12-${String(10 + i).padStart(2, '0')}`, ratePaise }));

describe('gstRateForTariff', () => {
  it.each([
    [100_000, 0],
    [100_100, 5],
    [750_000, 5],
    [750_100, 18],
  ])('₹%i paise/night → %i%%', (tariff, rate) => {
    expect(gstRateForTariff(tariff, settings.taxSlabs)).toBe(rate);
  });
});

describe('quoteStay', () => {
  it('applies direct discount then GST on the discounted tariff (2 nights, Deluxe ₹4,800)', () => {
    const q = quoteStay({ nightly: nights([480_000, 480_000]), quantity: 1, applyDirectDiscount: true, otaNightlyPaise: 590_000, settings });
    expect(q.subtotalPaise).toBe(960_000);
    expect(q.directDiscountPaise).toBe(96_000);
    expect(q.taxablePaise).toBe(864_000);
    expect(q.taxRatePercent).toBe(5);
    expect(q.taxPaise).toBe(43_200);
    expect(q.totalPaise).toBe(907_200);
    // OTA: 5,900 × 2 + 5% GST = 12,390
    expect(q.otaEquivalentPaise).toBe(1_239_000);
  });

  it('drops a tariff into a lower slab when the discount brings it under ₹7,500', () => {
    const q = quoteStay({ nightly: nights([800_000]), quantity: 1, applyDirectDiscount: true, otaNightlyPaise: null, settings });
    // 8,000 − 10% = 7,200 → 5% slab (not 18%)
    expect(q.taxRatePercent).toBe(5);
    expect(q.taxPaise).toBe(36_000);
  });

  it('reports mixed slabs per night and multiplies by room count', () => {
    const q = quoteStay({ nightly: nights([700_000, 1_190_000]), quantity: 2, applyDirectDiscount: false, otaNightlyPaise: null, settings });
    expect(q.taxRatePercent).toBeNull();
    expect(q.taxPaise).toBe((35_000 + 214_200) * 2);
    expect(q.totalPaise).toBe(q.taxablePaise + q.taxPaise);
  });

  it('stacks a valid promo after the direct discount and rejects expired/inactive codes', () => {
    const q = quoteStay({ nightly: nights([480_000]), quantity: 1, applyDirectDiscount: true, promoCode: ' directstay ', otaNightlyPaise: null, settings });
    expect(q.promoCode).toBe('DIRECTSTAY');
    expect(q.promoDiscountPaise).toBe(21_600); // 5% of 4,320
    expect(() =>
      quoteStay({ nightly: nights([480_000]), quantity: 1, applyDirectDiscount: true, promoCode: 'OLDCODE', otaNightlyPaise: null, settings }),
    ).toThrow(/not valid/);
    expect(() =>
      quoteStay({ nightly: nights([480_000]), quantity: 1, applyDirectDiscount: true, promoCode: 'PAUSED', otaNightlyPaise: null, settings }),
    ).toThrow(/not valid/);
  });

  it('keeps every amount an integer number of paise', () => {
    const q = quoteStay({
      nightly: nights([333_333, 333_337, 299_999]),
      quantity: 3,
      applyDirectDiscount: true,
      promoCode: 'DIRECTSTAY',
      otaNightlyPaise: 410_001,
      settings,
    });
    for (const v of [q.subtotalPaise, q.directDiscountPaise, q.promoDiscountPaise, q.taxablePaise, q.taxPaise, q.totalPaise, q.otaEquivalentPaise!]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
