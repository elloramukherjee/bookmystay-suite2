import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BedDouble,
  CalendarDays,
  CalendarX,
  Headset,
  Mail,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  Phone,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { Link, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/FormField';
import { TierBadge } from '../../components/GuestCard';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { crmService, guestService } from '../../services/crm.service';
import type { GuestProfile, TimelineEvent } from '../../types/crm';
import { formatDay, formatInstant } from '../../utils/dates';
import { cn, formatINR, formatPhone, initials, whatsappLink } from '../../utils/format';

const PREF_CATEGORIES = [
  { key: 'room', label: 'Room' },
  { key: 'fnb', label: 'Food & drink' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'communication', label: 'Communication' },
  { key: 'other', label: 'Other' },
] as const;

const NOTE_CATEGORIES = [
  { key: 'general', label: 'General' },
  { key: 'room', label: 'Room' },
  { key: 'fnb', label: 'Food & drink' },
] as const;

const EVENT_ICON: Record<TimelineEvent['kind'], ComponentType<{ className?: string }>> = {
  booking: CalendarDays,
  stay: BedDouble,
  cancellation: CalendarX,
  conversation: MessagesSquare,
  escalation: TriangleAlert,
  request: Headset,
  note: NotebookPen,
  follow_up: Send,
};

function useGuestMutation<V>(id: string, fn: (v: V) => Promise<GuestProfile>, success?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (g) => {
      queryClient.setQueryData(['guest', id], g);
      void queryClient.invalidateQueries({ queryKey: ['guests'] });
      void queryClient.invalidateQueries({ queryKey: ['guest-history', id] });
      if (success) toast.success(success);
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t save'),
  });
}

function Preferences({ guest, editable }: { guest: GuestProfile; editable: boolean }) {
  const [category, setCategory] = useState<(typeof PREF_CATEGORIES)[number]['key']>('room');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const save = useGuestMutation(guest.id, () => guestService.setPreference(guest.id, { category, key, value }), 'Preference saved.');
  const remove = useGuestMutation(guest.id, (prefId: string) => guestService.deletePreference(guest.id, prefId));
  return (
    <section className="card p-5" aria-labelledby="prefs-title">
      <h2 id="prefs-title" className="flex items-center gap-2 text-headline-sm">
        <Sparkles className="size-5 text-terracotta" aria-hidden /> Preferences
      </h2>
      <p className="mb-3 text-body-sm text-slate">The little things that make them feel remembered.</p>
      {guest.preferences.length === 0 ? (
        <p className="text-body-sm text-slate">Nothing recorded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {guest.preferences.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 py-2">
              <div>
                <p className="text-label-md text-ink">
                  {p.key}{' '}
                  <span className="text-label-sm font-normal uppercase text-sage">
                    · {PREF_CATEGORIES.find((c) => c.key === p.category)?.label ?? p.category}
                  </span>
                </p>
                <p className="text-body-sm text-slate">{p.value}</p>
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => remove.mutate(p.id)}
                  className="rounded-full p-2 text-slate hover:bg-danger-50 hover:text-danger"
                  aria-label={`Remove ${p.key}`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[140px_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, {
              onSuccess: () => {
                setKey('');
                setValue('');
              },
            });
          }}
        >
          <SelectField label="Type" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {PREF_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <TextField label="What" placeholder="e.g. Pillow" value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="sm:col-span-2">
            <TextField label="Preference" placeholder="e.g. Two extra soft pillows" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" size="sm" loading={save.isPending} disabled={key.trim().length < 2 || !value.trim()}>
              Save preference
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Notes({ guest, editable }: { guest: GuestProfile; editable: boolean }) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<(typeof NOTE_CATEGORIES)[number]['key']>('general');
  const add = useGuestMutation(guest.id, () => guestService.addNote(guest.id, text, category), 'Note added.');
  return (
    <section className="card p-5" aria-labelledby="notes-title">
      <h2 id="notes-title" className="flex items-center gap-2 text-headline-sm">
        <NotebookPen className="size-5 text-terracotta" aria-hidden /> Staff notes
      </h2>
      <p className="mb-3 text-body-sm text-slate">Visible to your team only — never shown to the guest or the AI receptionist.</p>
      {guest.notes.length === 0 ? (
        <p className="text-body-sm text-slate">No notes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {guest.notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-parchment-alt/60 px-3 py-2">
              <p className="whitespace-pre-wrap text-body-sm text-ink">{n.text}</p>
              <p className="mt-0.5 text-label-sm text-slate">
                {NOTE_CATEGORIES.find((c) => c.key === n.category)?.label} ·{' '}
                {formatInstant(n.createdAt, undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(undefined, { onSuccess: () => setText('') });
          }}
        >
          <TextAreaField
            label="Add a note"
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Celebrating anniversary on 12 Dec"
          />
          <div className="flex items-end gap-3">
            <SelectField label="About" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} containerClassName="w-40">
              {NOTE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <Button type="submit" variant="secondary" loading={add.isPending} disabled={text.trim().length < 2}>
              Add note
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function Timeline({ guestId }: { guestId: string }) {
  const history = useQuery({ queryKey: ['guest-history', guestId], queryFn: () => crmService.history(guestId) });
  return (
    <section className="card p-5" aria-labelledby="history-title">
      <h2 id="history-title" className="mb-3 text-headline-sm">
        History
      </h2>
      {history.isLoading ? (
        <LoadingSkeleton variant="lines" count={4} />
      ) : history.error ? (
        <EmptyState tone="error" title="Couldn’t load history" description={errorMessage(history.error)} />
      ) : !history.data?.events.length ? (
        <p className="text-body-sm text-slate">Nothing yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-l border-line pl-6">
          {history.data.events.map((ev, i) => {
            const Icon = EVENT_ICON[ev.kind];
            return (
              <li key={`${ev.kind}-${ev.refId ?? i}-${ev.at}`} className="relative">
                <span
                  className={cn(
                    'absolute -left-[37px] flex size-6 items-center justify-center rounded-full ring-4 ring-white',
                    ev.kind === 'escalation' || ev.kind === 'cancellation' ? 'bg-danger-50 text-danger' : 'bg-forest-50 text-forest',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <p className="text-label-md text-ink">{ev.title}</p>
                {ev.detail && <p className="text-body-sm text-slate">{ev.detail}</p>}
                <p className="text-label-sm text-sage">{formatInstant(ev.at)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Guest profile: who they are, what they like, and everything that's happened with them. */
export function GuestDetailsPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const editable = can('guests.write');
  const finance = can('finance.read');
  const guest = useQuery({ queryKey: ['guest', id], queryFn: () => guestService.get(id) });
  const consent = useGuestMutation(id, (granted: boolean) => guestService.update(id, { marketingConsent: granted }), 'Consent updated.');
  const g = guest.data;

  return (
    <>
      <Link to="/app/guests" className="mb-4 inline-flex items-center gap-1 text-label-md text-forest">
        <ArrowLeft className="size-4" aria-hidden /> All guests
      </Link>
      {guest.isLoading ? (
        <LoadingSkeleton variant="card" count={2} />
      ) : guest.error || !g ? (
        <EmptyState
          tone="error"
          title="Couldn’t open this guest"
          description={errorMessage(guest.error)}
          action={<Button onClick={() => void guest.refetch()}>Retry</Button>}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="flex flex-col gap-6">
            <section className="card flex flex-col gap-4 p-5 lg:p-6" aria-label="Guest profile">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <span
                    className={cn(
                      'flex size-14 items-center justify-center rounded-full text-headline-sm',
                      g.isReturning ? 'bg-forest text-white' : 'bg-forest-50 text-forest',
                    )}
                  >
                    {initials(g.name ?? '?')}
                  </span>
                  <div>
                    <h1 className="text-headline-md">{g.name ?? 'Unnamed guest'}</h1>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <TierBadge tier={g.tier} />
                      <StatusBadge tone="neutral">First came: {g.origin}</StatusBadge>
                      {g.idVerification.verified && (
                        <StatusBadge tone="trust" icon={<ShieldCheck className="size-3" aria-hidden />}>
                          ID checked
                        </StatusBadge>
                      )}
                      {g.tags.map((t) => (
                        <StatusBadge key={t} tone="accent">
                          {t}
                        </StatusBadge>
                      ))}
                    </div>
                  </div>
                </div>
                <a href={whatsappLink(g.phoneE164)} target="_blank" rel="noreferrer">
                  <Button variant="whatsapp" icon={<MessageCircle className="size-4" aria-hidden />} tabIndex={-1}>
                    WhatsApp
                  </Button>
                </a>
              </div>
              <dl className="grid gap-3 text-body-sm sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Phone className="size-4 text-terracotta" aria-hidden />
                  <dt className="sr-only">Mobile</dt>
                  <dd className="num">{formatPhone(g.phoneE164)}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-terracotta" aria-hidden />
                  <dt className="sr-only">Email</dt>
                  <dd className="truncate">{g.email ?? '—'}</dd>
                </div>
                <div>
                  <dt className="sr-only">City</dt>
                  <dd>{g.city ?? 'City not recorded'}</dd>
                </div>
              </dl>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Stays', value: String(g.stats.completedStays) },
                  { label: 'Bookings', value: String(g.stats.totalBookings) },
                  { label: 'Direct', value: String(g.stats.directBookings) },
                  finance
                    ? { label: 'Commission saved', value: formatINR(g.stats.commissionSavedPaise) }
                    : { label: 'Via OTA', value: String(g.stats.otaBookings) },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-parchment-alt/60 px-3 py-2">
                    <p className="text-label-sm uppercase text-sage">{s.label}</p>
                    <p className="num text-headline-sm text-forest">{s.value}</p>
                  </div>
                ))}
              </div>
              {g.stayPath && <p className="text-body-sm text-slate">Journey: {g.stayPath}</p>}
              {(g.inHouse || g.nextStay) && (
                <div className="rounded-[var(--radius-card)] bg-forest-50 px-4 py-3 text-body-sm text-forest">
                  {g.inHouse ? (
                    <p className="flex items-center gap-2">
                      <BedDouble className="size-4" aria-hidden /> In-house{g.inHouse.roomNumber ? ` in room ${g.inHouse.roomNumber}` : ''} · checks out{' '}
                      {formatDay(g.inHouse.checkOut)}
                    </p>
                  ) : (
                    g.nextStay && (
                      <p className="flex items-center gap-2">
                        <CalendarDays className="size-4" aria-hidden /> Next stay {formatDay(g.nextStay.checkIn)} · {g.nextStay.roomTypeName} ·{' '}
                        <span className="num">{g.nextStay.reference}</span>
                      </p>
                    )
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <div>
                  <p className="text-label-md text-ink">Offers on WhatsApp</p>
                  <p className="text-body-sm text-slate">
                    {g.consent.marketing.granted
                      ? `Agreed${g.consent.marketing.at ? ` on ${formatInstant(g.consent.marketing.at, undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}${g.consent.marketing.source ? ` (${g.consent.marketing.source})` : ''}`
                      : g.consent.marketing.withdrawnAt
                        ? `Withdrawn on ${formatInstant(g.consent.marketing.withdrawnAt, undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : 'Not given — booking messages only'}
                  </p>
                </div>
                {editable && (
                  <Button
                    size="sm"
                    variant={g.consent.marketing.granted ? 'ghost' : 'secondary'}
                    loading={consent.isPending}
                    onClick={() => consent.mutate(!g.consent.marketing.granted)}
                  >
                    {g.consent.marketing.granted ? 'Record withdrawal' : 'Guest agreed'}
                  </Button>
                )}
              </div>
            </section>
            <Timeline guestId={g.id} />
          </div>
          <div className="flex flex-col gap-6">
            <Preferences guest={g} editable={editable} />
            <Notes guest={g} editable={editable} />
          </div>
        </div>
      )}
    </>
  );
}
