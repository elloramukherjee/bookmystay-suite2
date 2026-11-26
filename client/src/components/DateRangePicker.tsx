import { CalendarDays } from 'lucide-react';
import { useId } from 'react';
import { addDaysIso, formatDay, nightsBetween } from '../utils/dates';
import { cn } from '../utils/format';

interface DateRangePickerProps {
  checkIn: string;
  checkOut: string;
  onChange: (range: { checkIn: string; checkOut: string }) => void;
  min: string;
  max?: string;
  maxNights?: number;
  error?: string | undefined;
  compact?: boolean;
}

/**
 * Native date inputs: the fastest, most familiar picker on budget Android phones, zero extra JS, and
 * fully accessible. Moving check-in past check-out pushes check-out forward instead of erroring.
 */
export function DateRangePicker({ checkIn, checkOut, onChange, min, max, maxNights = 30, error, compact }: DateRangePickerProps) {
  const id = useId();
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;

  const setCheckIn = (value: string) => {
    if (!value) return;
    const out = nightsBetween(value, checkOut) >= 1 ? checkOut : addDaysIso(value, 1);
    onChange({ checkIn: value, checkOut: nightsBetween(value, out) > maxNights ? addDaysIso(value, maxNights) : out });
  };
  const setCheckOut = (value: string) => {
    if (!value) return;
    onChange({ checkIn, checkOut: value });
  };

  const box = 'flex flex-col gap-1 rounded-lg border-[1.5px] border-line-strong bg-white px-3.5 py-2 focus-within:border-forest';
  return (
    <div>
      <div className={cn('grid grid-cols-2 gap-2', compact ? '' : 'sm:gap-3')}>
        <label htmlFor={`${id}-in`} className={box}>
          <span className="flex items-center gap-1.5 text-label-sm uppercase text-sage">
            <CalendarDays className="size-3.5 text-terracotta" aria-hidden /> Check-in
          </span>
          <input
            id={`${id}-in`}
            type="date"
            value={checkIn}
            min={min}
            max={max}
            onChange={(e) => setCheckIn(e.target.value)}
            className="w-full bg-transparent text-label-lg text-ink outline-none"
            aria-describedby={`${id}-summary`}
          />
        </label>
        <label htmlFor={`${id}-out`} className={box}>
          <span className="flex items-center gap-1.5 text-label-sm uppercase text-sage">
            <CalendarDays className="size-3.5 text-terracotta" aria-hidden /> Check-out
          </span>
          <input
            id={`${id}-out`}
            type="date"
            value={checkOut}
            min={checkIn ? addDaysIso(checkIn, 1) : min}
            max={checkIn ? addDaysIso(checkIn, maxNights) : max}
            onChange={(e) => setCheckOut(e.target.value)}
            className="w-full bg-transparent text-label-lg text-ink outline-none"
            aria-describedby={`${id}-summary`}
          />
        </label>
      </div>
      <p id={`${id}-summary`} className={cn('mt-1.5 text-body-sm', error ? 'text-danger' : 'text-slate')} role={error ? 'alert' : undefined}>
        {error ??
          (nights > 0 ? (
            <>
              <span className="num font-semibold text-forest">{nights}</span> night{nights > 1 ? 's' : ''} · {formatDay(checkIn)} → {formatDay(checkOut)}
            </>
          ) : (
            'Choose your dates'
          ))}
      </p>
    </div>
  );
}
