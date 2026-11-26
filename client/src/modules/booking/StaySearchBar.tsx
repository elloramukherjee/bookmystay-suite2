import { Search, Tag, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { DateRangePicker } from '../../components/DateRangePicker';
import { describeGuests, GuestCountSelector } from '../../components/GuestCountSelector';
import { Modal } from '../../components/Modal';
import { addDaysIso, todayIso } from '../../utils/dates';
import type { StayParams } from './useStayParams';

interface StaySearchBarProps {
  initial: StayParams;
  onSearch: (stay: StayParams) => void;
  directDiscountPercent?: number | undefined;
  submitLabel?: string;
}

/** Stitch search card: dates · guests & rooms · direct promo code · "Check live rates". */
export function StaySearchBar({ initial, onSearch, directDiscountPercent, submitLabel = 'Check live rates' }: StaySearchBarProps) {
  const [stay, setStay] = useState<StayParams>(initial);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const today = todayIso();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(stay);
  };

  return (
    <form onSubmit={submit} className="card-elevated grid gap-3 p-4 lg:grid-cols-[1.6fr_1fr_1fr_auto] lg:items-start lg:p-5" aria-label="Search stays">
      <DateRangePicker
        checkIn={stay.checkIn}
        checkOut={stay.checkOut}
        min={today}
        max={addDaysIso(today, 365)}
        onChange={(r) => setStay((s) => ({ ...s, ...r }))}
        compact
      />
      <div>
        <button
          type="button"
          onClick={() => setGuestsOpen(true)}
          className="flex w-full flex-col gap-1 rounded-lg border-[1.5px] border-line-strong bg-white px-3.5 py-2 text-left focus:border-forest focus:outline-none"
          aria-haspopup="dialog"
        >
          <span className="flex items-center gap-1.5 text-label-sm uppercase text-sage">
            <Users className="size-3.5 text-terracotta" aria-hidden /> Guests &amp; rooms
          </span>
          <span className="truncate text-label-lg text-ink">{describeGuests(stay)}</span>
        </button>
      </div>
      <label className="flex flex-col gap-1 rounded-lg border-[1.5px] border-dashed border-terracotta/60 bg-terracotta-50/50 px-3.5 py-2 focus-within:border-forest">
        <span className="flex items-center justify-between gap-1.5 text-label-sm uppercase text-terracotta">
          <span className="flex items-center gap-1.5">
            <Tag className="size-3.5" aria-hidden /> Direct promo code
          </span>
          {directDiscountPercent ? (
            <span className="rounded-full bg-terracotta px-1.5 text-[10px] text-white">{directDiscountPercent}% off already</span>
          ) : null}
        </span>
        <input
          value={stay.promoCode}
          onChange={(e) =>
            setStay((s) => ({
              ...s,
              promoCode: e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 24),
            }))
          }
          placeholder="Optional"
          className="bg-transparent text-label-lg uppercase text-ink outline-none placeholder:normal-case placeholder:text-sage"
          aria-label="Promo code"
        />
      </label>
      <Button type="submit" size="lg" icon={<Search className="size-4" aria-hidden />} className="h-[60px] lg:h-[62px]">
        {submitLabel}
      </Button>

      <Modal
        open={guestsOpen}
        onClose={() => setGuestsOpen(false)}
        title="Guests & rooms"
        size="sm"
        footer={
          <Button fullWidth onClick={() => setGuestsOpen(false)}>
            Done
          </Button>
        }
      >
        <GuestCountSelector value={stay} onChange={(v) => setStay((s) => ({ ...s, ...v }))} />
      </Modal>
    </form>
  );
}
