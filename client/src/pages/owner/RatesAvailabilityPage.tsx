import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { inventoryService } from '../../services/booking.service';
import type { CalendarNight } from '../../types/booking';
import { addDaysIso, formatDay, todayIso, weekdayOf } from '../../utils/dates';
import { cn, formatINR } from '../../utils/format';

const DAYS = 14;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface EditTarget {
  roomTypeId: string;
  roomTypeName: string;
  baseRatePaise: number;
  date: string;
  night: CalendarNight;
}

function EditSheet({ target, onClose }: { target: EditTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [from, setFrom] = useState(target.date);
  const [to, setTo] = useState(target.date);
  const [rate, setRate] = useState(target.night.rateOverridden ? String(target.night.ratePaise / 100) : '');
  const [resetRate, setResetRate] = useState(false);
  const [sell, setSell] = useState<'keep' | 'open' | 'stop'>('keep');
  const [blocked, setBlocked] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);

  const save = useMutation({
    mutationFn: () =>
      inventoryService.bulkUpdate({
        roomTypeId: target.roomTypeId,
        from,
        to,
        ...(resetRate ? { ratePaise: null } : rate ? { ratePaise: Math.round(Number(rate) * 100) } : {}),
        ...(sell !== 'keep' ? { stopSell: sell === 'stop' } : {}),
        ...(blocked !== '' ? { blocked: Number(blocked) } : {}),
        ...(weekdays.length ? { weekdays } : {}),
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      if (r.conflicts.length) toast.error(`Couldn’t block rooms on ${r.conflicts.length} night(s) that are already booked.`, 'Partly saved');
      else toast.success(`${r.updatedNights} night${r.updatedNights === 1 ? '' : 's'} updated. Live on your website now.`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t save'),
  });

  const nothing = !rate && !resetRate && sell === 'keep' && blocked === '';
  return (
    <Modal
      open
      onClose={onClose}
      title={target.roomTypeName}
      description={`Base rate ${formatINR(target.baseRatePaise)} · ${formatDay(target.date)}: ${target.night.sold} sold, ${target.night.held} on hold, ${target.night.blocked} blocked of ${target.night.totalRooms}`}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={nothing}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="From" type="date" min={todayIso()} value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-label-md text-slate">Only on (optional)</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={weekdays.includes(i)}
                onClick={() => setWeekdays((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))}
                className={cn(
                  'h-9 rounded-full border px-3 text-label-md',
                  weekdays.includes(i) ? 'border-forest bg-forest text-white' : 'border-line text-slate',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <TextField
          label="Nightly rate (₹, before GST)"
          type="number"
          inputMode="decimal"
          placeholder={`Leave blank to keep (${formatINR(target.night.ratePaise)})`}
          value={rate}
          disabled={resetRate}
          onChange={(e) => setRate(e.target.value)}
        />
        <label className="flex items-center gap-2 text-body-sm text-slate">
          <input type="checkbox" className="size-4 accent-[var(--color-forest)]" checked={resetRate} onChange={(e) => setResetRate(e.target.checked)} />
          Reset to base rate
        </label>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Selling" value={sell} onChange={(e) => setSell(e.target.value as typeof sell)}>
            <option value="keep">No change</option>
            <option value="open">Open for sale</option>
            <option value="stop">Stop sell</option>
          </SelectField>
          <TextField
            label="Rooms blocked"
            type="number"
            min={0}
            max={target.night.totalRooms}
            placeholder={`Now ${target.night.blocked}`}
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

export function RatesAvailabilityPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(todayIso());
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const calendar = useQuery({ queryKey: ['calendar', from], queryFn: () => inventoryService.calendar(from, DAYS), placeholderData: keepPreviousData });
  const canEdit = can('availability.manage');
  const today = todayIso();

  return (
    <>
      <PageHeader
        eyebrow="Direct booking"
        title="Rates & availability"
        description="Tap any night to change its price, stop selling, or block rooms. Changes go live on your website immediately."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label="Previous two weeks"
              disabled={from <= today}
              onClick={() => setFrom((f) => (addDaysIso(f, -DAYS) < today ? today : addDaysIso(f, -DAYS)))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-label-md text-slate">
              {formatDay(from, { day: 'numeric', month: 'short' })} – {formatDay(addDaysIso(from, DAYS - 1), { day: 'numeric', month: 'short' })}
            </span>
            <Button size="sm" variant="secondary" aria-label="Next two weeks" onClick={() => setFrom((f) => addDaysIso(f, DAYS))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {calendar.isLoading ? (
        <LoadingSkeleton variant="table" count={3} label="Loading calendar" />
      ) : calendar.error ? (
        <div className="card">
          <EmptyState
            tone="error"
            title="Couldn’t load the calendar"
            description={errorMessage(calendar.error)}
            action={<Button onClick={() => void calendar.refetch()}>Retry</Button>}
          />
        </div>
      ) : !calendar.data?.rows.length ? (
        <div className="card">
          <EmptyState title="No room types yet" description="Add room types under Rooms first." />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-4', calendar.isFetching && 'opacity-70')}>
          {calendar.data.rows.map((row) => (
            <section key={row.roomType.id} className="card overflow-hidden" aria-labelledby={`rt-${row.roomType.id}`}>
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h2 id={`rt-${row.roomType.id}`} className="text-headline-sm">
                  {row.roomType.name}
                </h2>
                <p className="text-body-sm text-slate">
                  {row.roomType.totalRooms} rooms · base {formatINR(row.roomType.baseRatePaise)}
                </p>
              </header>
              <div className="scrollbar-none overflow-x-auto">
                <ul className="flex min-w-max gap-1.5 p-3">
                  {row.nights.map((n) => {
                    const weekend = [5, 6].includes(weekdayOf(n.date));
                    const full = n.available === 0;
                    return (
                      <li key={n.date}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() =>
                            setEditing({
                              roomTypeId: row.roomType.id,
                              roomTypeName: row.roomType.name,
                              baseRatePaise: row.roomType.baseRatePaise,
                              date: n.date,
                              night: n,
                            })
                          }
                          className={cn(
                            'flex w-[76px] flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition-colors enabled:hover:border-forest',
                            n.stopSell
                              ? 'border-danger/40 bg-danger-50'
                              : full
                                ? 'border-terracotta/40 bg-terracotta-50'
                                : weekend
                                  ? 'border-line bg-parchment-alt'
                                  : 'border-line bg-white',
                          )}
                          aria-label={`${formatDay(n.date)}: ${formatINR(n.ratePaise)}, ${n.available} of ${n.totalRooms} available${n.stopSell ? ', stop sell' : ''}`}
                        >
                          <span className="text-label-sm uppercase text-sage">{formatDay(n.date, { weekday: 'short' })}</span>
                          <span className="num text-label-lg text-ink">{formatDay(n.date, { day: 'numeric' })}</span>
                          <span className={cn('num text-label-md', n.rateOverridden ? 'text-terracotta' : 'text-forest')}>
                            ₹{Math.round(n.ratePaise / 100).toLocaleString('en-IN')}
                          </span>
                          <span className={cn('text-[11px] font-semibold', n.stopSell ? 'text-danger' : full ? 'text-terracotta' : 'text-slate')}>
                            {n.stopSell ? 'Closed' : full ? 'Full' : `${n.available}/${n.totalRooms} free`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
          <p className="flex items-center gap-2 text-body-sm text-slate">
            <Info className="size-4" aria-hidden /> Rates in terracotta are overridden for that night. Weekends are shaded.
          </p>
        </div>
      )}
      {editing && <EditSheet target={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
