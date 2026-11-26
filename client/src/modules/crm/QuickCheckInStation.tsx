import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, KeyRound, LogOut, Search, Zap } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/FormField';
import { TierBadge } from '../../components/GuestCard';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { staffBookingService } from '../../services/booking.service';
import { crmService } from '../../services/crm.service';
import { runOrQueue } from '../../services/offlineQueue';
import type { RosterItem } from '../../types/crm';
import { formatDay } from '../../utils/dates';
import { cn, formatINR, formatPhone } from '../../utils/format';

function CheckInDialog({ item, onClose }: { item: RosterItem; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const rooms = useQuery({ queryKey: ['available-rooms', item.roomTypeId], queryFn: () => crmService.availableRooms(item.roomTypeId) });
  const [roomId, setRoomId] = useState('');
  const [idVerified, setIdVerified] = useState(item.idVerified);
  const [idDocType, setIdDocType] = useState('aadhaar');
  const [sendWelcome, setSendWelcome] = useState(true);
  const checkIn = useMutation({
    // "always": run even when the browser says offline, so the action can be queued on this device.
    networkMode: 'always',
    mutationFn: () =>
      runOrQueue<RosterItem>(user?.id ?? '', `Check in ${item.guestName}`, {
        kind: 'checkIn',
        payload: { bookingId: item.bookingId, roomId: roomId || undefined, idVerified, idDocType: idVerified ? idDocType : undefined, sendWelcome },
      }),
    onSuccess: async (outcome) => {
      if (outcome.queued) {
        toast.show(`Saved on this device. ${item.guestName} will be checked in as soon as you’re back online.`, 'info', 'Saved offline');
        onClose();
        return;
      }
      const r = outcome.result;
      await queryClient.invalidateQueries({ queryKey: ['crm-today'] });
      await queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['guests'] });
      toast.success(`${r.guestName} is in room ${r.roomNumber}.${sendWelcome ? ' Welcome sent on WhatsApp.' : ''}`, 'Checked in');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t check in'),
  });
  const [confirmNoShow, setConfirmNoShow] = useState(false);
  const noShow = useMutation({
    mutationFn: () => staffBookingService.markNoShow(item.bookingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['crm-today'] });
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
      toast.success(`${item.guestName} marked as no-show. The room is back on sale.`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t mark no-show'),
  });
  const clean = rooms.data?.filter((r) => r.status === 'available') ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      title={`Check in ${item.guestName}`}
      description={`${item.quantity} × ${item.roomTypeName} · ${formatDay(item.checkIn)} → ${formatDay(item.checkOut)} · ${item.reference}`}
      dismissible={!checkIn.isPending}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-danger hover:bg-danger-50"
            loading={noShow.isPending}
            onClick={() => (confirmNoShow ? noShow.mutate() : setConfirmNoShow(true))}
          >
            {confirmNoShow ? 'Tap again: mark no-show' : 'Didn’t arrive?'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<KeyRound className="size-4" aria-hidden />}
            loading={checkIn.isPending}
            onClick={() => checkIn.mutate()}
            disabled={rooms.isLoading || (rooms.isSuccess && !clean.length && !roomId)}
          >
            Confirm check-in &amp; hand key
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={item.tier} />
          {item.paymentStatus === 'pay_at_hotel' && <StatusBadge tone="warning">Pay at hotel · {formatINR(item.totalPaise)}</StatusBadge>}
        </div>
        {item.specialRequests && <p className="rounded-lg bg-terracotta-50 px-3 py-2 text-body-sm text-terracotta-deep">Requests: {item.specialRequests}</p>}
        {rooms.isLoading ? (
          <LoadingSkeleton variant="lines" count={2} />
        ) : (
          <SelectField
            label="Room"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            hint={
              clean.length
                ? 'Leave as automatic to take the first clean room.'
                : 'No clean room of this type — pick one being cleaned, or mark a room available under Rooms.'
            }
          >
            <option value="">{clean.length ? `Automatic (room ${clean[0]!.number})` : 'Choose a room'}</option>
            {rooms.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number}
                {r.floor ? ` · ${r.floor}` : ''}
                {r.status === 'cleaning' ? ' (being cleaned)' : ''}
              </option>
            ))}
          </SelectField>
        )}
        <label className="flex items-center gap-2 text-body-md">
          <input type="checkbox" className="size-5 accent-[var(--color-forest)]" checked={idVerified} onChange={(e) => setIdVerified(e.target.checked)} />
          Photo ID checked for all adults
        </label>
        {idVerified && (
          <SelectField label="ID seen" value={idDocType} onChange={(e) => setIdDocType(e.target.value)} hint="Only the type is recorded — never the ID number.">
            <option value="aadhaar">Aadhaar</option>
            <option value="passport">Passport</option>
            <option value="driving_licence">Driving licence</option>
            <option value="voter_id">Voter ID</option>
            <option value="other">Other</option>
          </SelectField>
        )}
        <label className="flex items-center gap-2 text-body-md">
          <input type="checkbox" className="size-5 accent-[var(--color-forest)]" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} />
          Send welcome &amp; room number on WhatsApp
        </label>
      </div>
    </Modal>
  );
}

function CheckOutDialog({ item, onClose }: { item: RosterItem; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const payAtHotel = item.paymentStatus === 'pay_at_hotel';
  const [collected, setCollected] = useState(!payAtHotel);
  const checkOut = useMutation({
    networkMode: 'always',
    mutationFn: () =>
      runOrQueue<RosterItem>(user?.id ?? '', `Check out ${item.guestName}`, {
        kind: 'checkOut',
        payload: { bookingId: item.bookingId, paymentCollected: payAtHotel ? collected : false },
      }),
    onSuccess: async (outcome) => {
      if (outcome.queued) {
        toast.show(`Saved on this device. ${item.guestName} will be checked out as soon as you’re back online.`, 'info', 'Saved offline');
        onClose();
        return;
      }
      const r = outcome.result;
      await queryClient.invalidateQueries({ queryKey: ['crm-today'] });
      await queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['guests'] });
      toast.success(`Room ${item.roomNumber ?? ''} sent to housekeeping. ${r.guestName} is now a returning guest.`, 'Checked out');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t check out'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Check out ${item.guestName}`}
      description={`Room ${item.roomNumber ?? '—'} · ${item.roomTypeName} · booked till ${formatDay(item.checkOut)}`}
      dismissible={!checkOut.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<LogOut className="size-4" aria-hidden />}
            loading={checkOut.isPending}
            disabled={payAtHotel && !collected}
            onClick={() => checkOut.mutate()}
          >
            Confirm check-out
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-body-md">
        {payAtHotel ? (
          <label className="flex items-center gap-2 rounded-lg bg-warning-50 p-3">
            <input type="checkbox" className="size-5 accent-[var(--color-forest)]" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
            Balance of <strong className="num">{formatINR(item.totalPaise)}</strong> collected at the desk
          </label>
        ) : (
          <p className="text-slate">
            Payment:{' '}
            {item.paymentStatus === 'paid'
              ? 'paid online'
              : item.paymentStatus === 'collected_by_ota'
                ? 'collected by the OTA'
                : item.paymentStatus.replace(/_/g, ' ')}
            .
          </p>
        )}
        <p className="text-body-sm text-slate">Leaving early releases the remaining nights back to sale automatically.</p>
      </div>
    </Modal>
  );
}

function Row({ item, action }: { item: RosterItem; action: 'in' | 'out' }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-forest-50 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-lg font-serif text-label-lg',
            item.roomNumber ? 'bg-forest text-white' : 'bg-white text-sage ring-1 ring-line',
          )}
        >
          {item.roomNumber ?? <BedDouble className="size-4" aria-label="Room not assigned" />}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-label-lg text-ink">
            {item.guestName}
            {item.isReturning && <StatusBadge tone="accent">Returning</StatusBadge>}
          </p>
          <p className="num truncate text-body-sm text-slate">
            {formatPhone(item.guestPhone)} · {item.roomTypeName}
            {action === 'out' ? ` · till ${formatDay(item.checkOut, { day: 'numeric', month: 'short' })}` : ''}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={action === 'in' ? 'primary' : 'secondary'}
        icon={action === 'in' ? <KeyRound className="size-4" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {action === 'in' ? 'Check in' : 'Check out'}
      </Button>
      {open && (action === 'in' ? <CheckInDialog item={item} onClose={() => setOpen(false)} /> : <CheckOutDialog item={item} onClose={() => setOpen(false)} />)}
    </li>
  );
}

/**
 * Stitch "10-second quick check-in station": find the guest (phone, room, name or reference), confirm,
 * hand the key. No forms to fill — the booking already has everything.
 */
export function QuickCheckInStation({ className }: { className?: string }) {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const today = useQuery({ queryKey: ['crm-today'], queryFn: crmService.today, refetchInterval: 30_000 });
  const results = useQuery({ queryKey: ['desk-search', q], queryFn: () => crmService.deskSearch(q), enabled: q.length >= 2 });

  const arrivals = today.data?.arrivals ?? [];
  const departures = today.data?.departuresDue ?? [];
  return (
    <section className={cn('card flex flex-col gap-4 p-4 lg:p-5', className)} aria-labelledby="station-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="station-title" className="flex items-center gap-2 text-headline-sm">
          <Zap className="size-5 text-terracotta" aria-hidden /> 10-second check-in
        </h2>
        {today.data && (
          <p className="text-label-md text-slate">
            <span className="num">{today.data.counts.arrivalsPending}</span> to arrive · <span className="num">{departures.length}</span> due out ·{' '}
            <span className="num">{today.data.counts.occupancyPercent}%</span> occupied
          </p>
        )}
      </div>
      <label className="relative block">
        <span className="sr-only">Find a guest</span>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-terracotta" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Phone, room no., name or BMS reference"
          className="h-12 w-full rounded-full border-[1.5px] border-line-strong bg-white pr-4 pl-10 text-body-md focus:border-forest focus:outline-none"
        />
      </label>

      {q.length >= 2 ? (
        results.isLoading ? (
          <LoadingSkeleton variant="lines" count={2} />
        ) : results.data?.length ? (
          <ul className="flex flex-col gap-2">
            {results.data.map((r) => (
              <Row key={r.bookingId} item={r} action={r.status === 'checked_in' ? 'out' : 'in'} />
            ))}
          </ul>
        ) : (
          <p className="text-body-sm text-slate">No current or upcoming booking matches “{q}”.</p>
        )
      ) : today.isLoading ? (
        <LoadingSkeleton variant="lines" count={3} />
      ) : today.error ? (
        <EmptyState tone="error" title="Couldn’t load today’s roster" description={errorMessage(today.error)} />
      ) : (
        <>
          <div>
            <p className="eyebrow mb-2">Arriving today</p>
            {arrivals.length ? (
              <ul className="flex flex-col gap-2">
                {arrivals.map((a) => (
                  <Row key={a.bookingId} item={a} action="in" />
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-slate">No more arrivals today.</p>
            )}
          </div>
          {departures.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Due to check out</p>
              <ul className="flex flex-col gap-2">
                {departures.map((d) => (
                  <Row key={d.bookingId} item={d} action="out" />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
