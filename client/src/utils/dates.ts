/** Hotel-local calendar days as "YYYY-MM-DD" — never shifted through UTC. */
export function todayIso(timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);
}

export function isIsoDay(v: string | null | undefined): v is string {
  return Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
}

/** "2026-12-24" → "Thu, 24 Dec" (formatted in UTC so the day never shifts). */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * Formats an instant in the *hotel's* time zone — never the viewer's. A guest in Dubai or an NRI in the
 * US must see "free cancellation until 1:00 PM" exactly as the hotel means it.
 */
export function formatInstant(
  iso: string,
  timeZone = 'Asia/Kolkata',
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
): string {
  const label = new Date(iso).toLocaleString('en-IN', { ...opts, timeZone });
  return timeZone === 'Asia/Kolkata' ? `${label} IST` : label;
}
