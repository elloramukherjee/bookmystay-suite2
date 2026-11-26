import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { addDaysIso, isIsoDay, nightsBetween, todayIso } from '../../utils/dates';

export interface StayParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  promoCode: string;
}

const clampInt = (v: string | null, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Stay search lives in the URL so it survives refreshes and can be shared on WhatsApp. */
export function useStayParams(): StayParams {
  const [params] = useSearchParams();
  return useMemo(() => {
    const today = todayIso();
    let checkIn = params.get('checkIn');
    let checkOut = params.get('checkOut');
    if (!isIsoDay(checkIn) || checkIn < today) checkIn = addDaysIso(today, 1);
    if (!isIsoDay(checkOut) || nightsBetween(checkIn, checkOut) < 1 || nightsBetween(checkIn, checkOut) > 30) checkOut = addDaysIso(checkIn, 2);
    return {
      checkIn,
      checkOut,
      adults: clampInt(params.get('adults'), 1, 20, 2),
      children: clampInt(params.get('children'), 0, 10, 0),
      rooms: clampInt(params.get('rooms'), 1, 5, 1),
      promoCode: (params.get('promo') ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 24),
    };
  }, [params]);
}

export function stayQueryString(stay: StayParams, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: String(stay.adults),
    children: String(stay.children),
    rooms: String(stay.rooms),
    ...(stay.promoCode ? { promo: stay.promoCode } : {}),
    ...extra,
  });
  return q.toString();
}
