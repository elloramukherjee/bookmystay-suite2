/**
 * Phone numbers are the guest's primary identity across all three products, so normalisation
 * must be deterministic: every write and every lookup goes through `normalizePhone`.
 *
 * Accepted Indian inputs → "+919820144552":
 *   "98201 44552", "09820144552", "919820144552", "+91-98201-44552", "0091 9820144552"
 * International (NRI) numbers must be given with "+" or "00" and are kept as E.164.
 */
export function normalizePhone(input: string, defaultCountry: 'IN' = 'IN'): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (digits.startsWith('+')) {
    const body = digits.slice(1).replace(/\D/g, '');
    if (body.startsWith('91')) return validIndianMobile(body.slice(2));
    return /^[1-9]\d{7,14}$/.test(body) ? `+${body}` : null;
  }

  digits = digits.replace(/\D/g, '');
  if (defaultCountry === 'IN') {
    if (digits.length === 11 && digits.startsWith('0')) return validIndianMobile(digits.slice(1));
    if (digits.length === 12 && digits.startsWith('91')) return validIndianMobile(digits.slice(2));
    if (digits.length === 10) return validIndianMobile(digits);
  }
  return null;
}

function validIndianMobile(national: string): string | null {
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

/** "+919820144552" → "+91 98201 44552" */
export function formatPhone(e164: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

/** "+919820144552" → "+91•••••44552" — safe for logs and partially-authorised views. */
export function maskPhone(e164: string): string {
  if (e164.length < 6) return '•••';
  return `${e164.slice(0, 3)}${'•'.repeat(Math.max(0, e164.length - 8))}${e164.slice(-5)}`;
}
