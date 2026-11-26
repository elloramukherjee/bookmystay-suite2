import { BadgeCheck } from 'lucide-react';
import type { BookingAmounts } from '../types/booking';
import { cn, formatINR } from '../utils/format';

interface PricingBreakdownProps {
  amounts: BookingAmounts;
  nights: number;
  rooms: number;
  roomName?: string;
  className?: string;
  /** Show the "₹X lower than OTA" chip (only when the comparison is meaningful). */
  showOtaSaving?: boolean;
}

/**
 * The Stitch "pricing breakdown matrix": base × nights, green savings lines, GST shown separately, bold net
 * payable. Every number comes from the server quote — this component never does price arithmetic beyond
 * the display of an average night.
 */
export function PricingBreakdown({ amounts, nights, rooms, roomName, className, showOtaSaving = true }: PricingBreakdownProps) {
  const avgNight = Math.round(amounts.subtotalPaise / Math.max(1, nights * rooms));
  const otaSaving = amounts.otaEquivalentPaise ? amounts.otaEquivalentPaise - amounts.totalPaise : 0;
  const row = 'flex items-baseline justify-between gap-4 text-body-sm';

  return (
    <div className={cn('rounded-lg bg-parchment-alt/60 p-4', className)}>
      {roomName && (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className="text-label-lg text-forest">{roomName}</p>
          <p className="text-label-md text-terracotta">
            {nights} night{nights > 1 ? 's' : ''}
            {rooms > 1 ? ` × ${rooms} rooms` : ''}
          </p>
        </div>
      )}
      <dl className="flex flex-col gap-2">
        <div className={row}>
          <dt className="text-slate">
            Room rate ({formatINR(avgNight)} avg × {nights}
            {rooms > 1 ? ` × ${rooms}` : ''})
          </dt>
          <dd className="num text-ink">{formatINR(amounts.subtotalPaise)}</dd>
        </div>
        {amounts.directDiscountPaise > 0 && (
          <div className={row}>
            <dt className="text-emerald">Direct booking saving ({amounts.directDiscountPercent}%)</dt>
            <dd className="num font-semibold text-emerald">−{formatINR(amounts.directDiscountPaise)}</dd>
          </div>
        )}
        {amounts.promoDiscountPaise > 0 && (
          <div className={row}>
            <dt className="text-emerald">Code {amounts.promoCode}</dt>
            <dd className="num font-semibold text-emerald">−{formatINR(amounts.promoDiscountPaise)}</dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-slate">GST {amounts.taxRatePercent !== null ? `(${amounts.taxRatePercent}%)` : '(per-night slabs)'}</dt>
          <dd className="num text-ink">{formatINR(amounts.taxPaise)}</dd>
        </div>
        <div className={row}>
          <dt className="text-slate">Convenience fee</dt>
          <dd className="num text-emerald">₹0</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="num text-[20px] font-bold leading-7 text-forest">{formatINR(amounts.totalPaise)}</p>
          <p className="text-label-sm uppercase text-sage">Total payable · GST included</p>
        </div>
        {showOtaSaving && otaSaving > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-terracotta px-3 py-1 text-label-sm uppercase text-white">
            <BadgeCheck className="size-3.5" aria-hidden />
            {formatINR(otaSaving)} lower than OTA
          </span>
        )}
      </div>
    </div>
  );
}
