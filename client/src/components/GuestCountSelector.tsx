import { Minus, Plus } from 'lucide-react';

interface Row {
  key: 'adults' | 'children' | 'rooms';
  label: string;
  hint?: string;
  min: number;
  max: number;
}

const ROWS: Row[] = [
  { key: 'adults', label: 'Adults', hint: '13 years and above', min: 1, max: 20 },
  { key: 'children', label: 'Children', hint: 'Under 13', min: 0, max: 10 },
  { key: 'rooms', label: 'Rooms', min: 1, max: 5 },
];

export interface GuestCounts {
  adults: number;
  children: number;
  rooms: number;
}

/** Large ±48px steppers: easy to hit on a phone, no tiny dropdowns. */
export function GuestCountSelector({ value, onChange }: { value: GuestCounts; onChange: (v: GuestCounts) => void }) {
  const set = (key: Row['key'], next: number) => {
    const v = { ...value, [key]: next };
    // Every room needs at least one adult.
    if (key === 'rooms' && v.adults < next) v.adults = next;
    if (key === 'adults' && v.rooms > next) v.rooms = next;
    onChange(v);
  };
  return (
    <div className="flex flex-col divide-y divide-line">
      {ROWS.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-label-lg text-ink">{row.label}</p>
            {row.hint && <p className="text-body-sm text-slate">{row.hint}</p>}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => set(row.key, value[row.key] - 1)}
              disabled={value[row.key] <= row.min}
              className="flex size-10 items-center justify-center rounded-full border-[1.5px] border-line-strong text-forest disabled:opacity-30"
              aria-label={`Fewer ${row.label.toLowerCase()}`}
            >
              <Minus className="size-4" />
            </button>
            <span className="num w-6 text-center text-label-lg" aria-live="polite" aria-label={`${value[row.key]} ${row.label.toLowerCase()}`}>
              {value[row.key]}
            </span>
            <button
              type="button"
              onClick={() => set(row.key, value[row.key] + 1)}
              disabled={value[row.key] >= row.max}
              className="flex size-10 items-center justify-center rounded-full border-[1.5px] border-line-strong text-forest disabled:opacity-30"
              aria-label={`More ${row.label.toLowerCase()}`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function describeGuests({ adults, children, rooms }: GuestCounts): string {
  const parts = [`${adults} adult${adults > 1 ? 's' : ''}`];
  if (children) parts.push(`${children} child${children > 1 ? 'ren' : ''}`);
  parts.push(`${rooms} room${rooms > 1 ? 's' : ''}`);
  return parts.join(', ');
}
