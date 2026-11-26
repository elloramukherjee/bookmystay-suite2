/** All money is integer paise. Percentages are applied with round-half-up, once per line item. */
export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}
