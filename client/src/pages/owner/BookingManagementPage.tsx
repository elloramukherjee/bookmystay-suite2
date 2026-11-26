import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MessageCircle, Plus, Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BookingCard } from '../../components/BookingCard';
import { BookingStatusBadge, PaymentStatusBadge, SOURCE_LABELS, SourceBadge } from '../../components/BookingStatus';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { PricingBreakdown } from '../../components/PricingBreakdown';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ApiError, errorMessage } from '../../services/api';
import { roomsService, staffBookingService } from '../../services/booking.service';
import type { BookingListItem, BookingSource } from '../../types/booking';
import { addDaysIso, formatDay, todayIso } from '../../utils/dates';
import { cn, formatINR, formatPhone, whatsappLink } from '../../utils/format';

type FilterKey = 'all' | 'arrivals' | 'pending' | 'confirmed' | 'attention' | 'ota';
const FILTERS: { key: FilterKey; label: string; params: () => Record<string, string | boolean> }[] = [
  { key: 'all', label: 'All', params: () => ({}) },
  { key: 'arrivals', label: 'Arriving today', params: () => ({ from: todayIso(), to: todayIso(), status: 'confirmed,checked_in', sort: 'checkIn' }) },
  { key: 'pending', label: 'Awaiting payment', params: () => ({ status: 'pending_payment' }) },
  { key: 'confirmed', label: 'Upcoming', params: () => ({ status: 'confirmed', from: todayIso(), sort: 'checkIn' }) },
  { key: 'attention', label: 'Needs attention', params: () => ({ attention: true }) },
  { key: 'ota', label: 'OTA', params: () => ({ source: 'ota' }) },
];

function BookingDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['booking', id], queryFn: () => staffBookingService.get(id) });
  const [cancelling, setCancelling] = useState(false);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [reason, setReason] = useState('');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['bookings'] });
    await queryClient.invalidateQueries({ queryKey: ['booking', id] });
  };
  const confirm = useMutation({
    mutationFn: () => staffBookingService.confirmPayAtHotel(id),
    onSuccess: async () => {
      await refresh();
      toast.success('Confirmed as pay-at-hotel. The guest gets a WhatsApp confirmation.');
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t confirm'),
  });
  const cancel = useMutation({
    mutationFn: () => staffBookingService.cancel(id, reason || undefined),
    onSuccess: async (b) => {
      setCancelling(false);
      await refresh();
      toast.success(b.refundDuePaise > 0 ? `Cancelled. Refund due: ${formatINR(b.refundDuePaise)}.` : 'Booking cancelled and rooms released.');
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t cancel'),
  });

  const noShow = useMutation({
    mutationFn: () => staffBookingService.markNoShow(id),
    onSuccess: async () => {
      setMarkingNoShow(false);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['crm-today'] });
      toast.success('Marked as no-show. Tonight and later nights are back on sale.');
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t mark no-show'),
  });

  const b = detail.data;
  // From the check-in day on, a confirmed guest who hasn't arrived can be marked a no-show (after check-in time
  // the booking can no longer be cancelled).
  const canMarkNoShow = Boolean(b && can('stays.manage') && b.status === 'confirmed' && b.checkIn <= todayIso(b.hotel.timezone));
  return (
    <Modal open onClose={onClose} title={b ? `${b.guest.name} · ${b.reference}` : 'Booking'} size="lg">
      {detail.isLoading || !b ? (
        detail.error ? (
          <EmptyState tone="error" title="Couldn’t load booking" description={errorMessage(detail.error)} />
        ) : (
          <LoadingSkeleton variant="lines" count={6} />
        )
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-wrap gap-2">
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentStatus} />
            <SourceBadge source={b.source} />
            {b.guest.isReturning && <StatusBadge tone="forest">Returning guest</StatusBadge>}
          </div>
          {b.needsAttention && (
            <p className="flex items-start gap-2 rounded-lg bg-danger-50 p-3 text-body-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {b.needsAttention}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-sage">Stay</dt>
              <dd className="text-ink">
                {formatDay(b.checkIn)} → {formatDay(b.checkOut)} · {b.nights} night{b.nights > 1 ? 's' : ''}
              </dd>
            </div>
            <div>
              <dt className="text-sage">Room</dt>
              <dd className="text-ink">
                {b.quantity} × {b.roomTypeName}
                {b.roomNumber ? ` · Room ${b.roomNumber}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-sage">Guests</dt>
              <dd className="text-ink">
                {b.adults} adult{b.adults > 1 ? 's' : ''}
                {b.children ? `, ${b.children} child${b.children > 1 ? 'ren' : ''}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-sage">Contact</dt>
              <dd className="num text-ink">
                {formatPhone(b.guest.phoneE164)}
                {b.guest.email ? ` · ${b.guest.email}` : ''}
              </dd>
            </div>
            {b.otaReference && (
              <div>
                <dt className="text-sage">OTA reference</dt>
                <dd className="num text-ink">{b.otaReference}</dd>
              </div>
            )}
            {b.specialRequests && (
              <div className="sm:col-span-2">
                <dt className="text-sage">Special requests</dt>
                <dd className="text-ink">{b.specialRequests}</dd>
              </div>
            )}
            {b.cancellationReason && (
              <div className="sm:col-span-2">
                <dt className="text-sage">Cancellation reason</dt>
                <dd className="text-ink">{b.cancellationReason}</dd>
              </div>
            )}
          </dl>
          <PricingBreakdown amounts={b.amounts} nights={b.nights} rooms={b.quantity} showOtaSaving={false} />
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <a
              href={whatsappLink(b.guest.phoneE164, `Namaste ${b.guest.name.split(' ')[0]}, this is ${b.hotel.name} regarding your booking ${b.reference}.`)}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="whatsapp" size="sm" icon={<MessageCircle className="size-4" aria-hidden />} tabIndex={-1}>
                WhatsApp guest
              </Button>
            </a>
            {can('bookings.manage') && b.status === 'pending_payment' && b.inventoryState === 'held' && (
              <Button size="sm" variant="secondary" loading={confirm.isPending} onClick={() => confirm.mutate()}>
                Confirm · pay at hotel
              </Button>
            )}
            {can('bookings.manage') && b.cancellation.cancellable && (
              <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-50" onClick={() => setCancelling(true)}>
                Cancel booking
              </Button>
            )}
            {canMarkNoShow && (
              <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-50" onClick={() => setMarkingNoShow(true)}>
                Mark no-show
              </Button>
            )}
          </div>
          <ConfirmDialog
            open={markingNoShow}
            title={`${b.guest.name} didn’t arrive?`}
            tone="danger"
            confirmLabel="Mark no-show"
            cancelLabel="Keep booking"
            loading={noShow.isPending}
            onCancel={() => setMarkingNoShow(false)}
            onConfirm={() => noShow.mutate()}
            message={
              <p>
                Tonight{b.nights > 1 ? ' and the remaining nights' : ''} go back on sale. No message is sent to the guest.
                {b.paymentStatus === 'paid' ? ' The online payment is kept; refund manually if your policy allows.' : ''}
              </p>
            }
          />
          <ConfirmDialog
            open={cancelling}
            title={`Cancel ${b.reference}?`}
            tone="danger"
            confirmLabel="Cancel booking"
            cancelLabel="Keep"
            loading={cancel.isPending}
            onCancel={() => setCancelling(false)}
            onConfirm={() => cancel.mutate()}
            message={
              <div className="flex flex-col gap-3">
                <p>
                  Rooms are released immediately{b.paymentStatus === 'paid' ? ' and a refund is recorded per the cancellation policy' : ''}. The guest is
                  notified on WhatsApp.
                </p>
                <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
              </div>
            }
          />
        </div>
      )}
    </Modal>
  );
}

const manualSchema = z
  .object({
    roomTypeId: z.string().min(1, 'Choose a room type'),
    source: z.enum(['ota_mmt', 'ota_goibibo', 'ota_bookingcom', 'ota_agoda', 'ota_other', 'walk_in', 'phone']),
    otaReference: z.string().trim().max(60),
    checkIn: z.string().min(10, 'Choose a date'),
    checkOut: z.string().min(10, 'Choose a date'),
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(10),
    rooms: z.number().int().min(1).max(10),
    nightlyRate: z.number().min(0).max(1_000_000).optional(),
    name: z.string().trim().min(2, 'Enter the guest’s name').max(120),
    phone: z.string().trim().min(8, 'Enter a mobile number').max(20),
    specialRequests: z.string().trim().max(500),
    sendConfirmation: z.boolean(),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: 'Check-out must be after check-in', path: ['checkOut'] });
type ManualForm = z.infer<typeof manualSchema>;

function ManualBookingForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: roomsService.list });
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ManualForm>({
    resolver: zodResolver(manualSchema),
    defaultValues: {
      roomTypeId: '',
      source: 'ota_mmt',
      otaReference: '',
      checkIn: todayIso(),
      checkOut: addDaysIso(todayIso(), 1),
      adults: 2,
      children: 0,
      rooms: 1,
      name: '',
      phone: '',
      specialRequests: '',
      sendConfirmation: true,
    },
  });
  const source = watch('source');
  const num = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };

  const onSubmit = async (v: ManualForm) => {
    try {
      await staffBookingService.createManual({
        roomTypeId: v.roomTypeId,
        checkIn: v.checkIn,
        checkOut: v.checkOut,
        adults: v.adults,
        children: v.children,
        rooms: v.rooms,
        source: v.source,
        otaReference: v.otaReference || undefined,
        nightlyRatePaise: v.nightlyRate !== undefined ? Math.round(v.nightlyRate * 100) : undefined,
        guest: { name: v.name, phone: v.phone },
        specialRequests: v.specialRequests || undefined,
        sendConfirmation: v.sendConfirmation,
      });
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      toast.success('Booking added. Rooms are now marked as sold for those nights.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors['guest.phone']) return setError('phone', { message: err.fieldErrors['guest.phone'] });
      setError('root', { message: errorMessage(err) });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add an OTA, walk-in or phone booking"
      description="So every stay — not just direct ones — is in your guest register and inventory."
      size="lg"
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="manual-booking" loading={isSubmitting}>
            Add booking
          </Button>
        </>
      }
    >
      <form id="manual-booking" onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {errors.root && (
          <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-body-sm text-danger">
            {errors.root.message}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Source" {...register('source')}>
            {(['ota_mmt', 'ota_goibibo', 'ota_bookingcom', 'ota_agoda', 'ota_other', 'walk_in', 'phone'] as const).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s as BookingSource]}
              </option>
            ))}
          </SelectField>
          {source.startsWith('ota_') && <TextField label="OTA booking ID" error={errors.otaReference?.message} {...register('otaReference')} />}
          <SelectField label="Room type" error={errors.roomTypeId?.message} {...register('roomTypeId')}>
            <option value="">Choose…</option>
            {rooms.data
              ?.filter((r) => r.isActive)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </SelectField>
          <TextField label="Rooms" type="number" error={errors.rooms?.message} {...register('rooms', num)} />
          <TextField label="Check-in" type="date" error={errors.checkIn?.message} {...register('checkIn')} />
          <TextField label="Check-out" type="date" error={errors.checkOut?.message} {...register('checkOut')} />
          <TextField label="Adults" type="number" error={errors.adults?.message} {...register('adults', num)} />
          <TextField label="Children" type="number" error={errors.children?.message} {...register('children', num)} />
          <TextField label="Guest name" error={errors.name?.message} {...register('name')} />
          <TextField label="Guest mobile (WhatsApp)" type="tel" error={errors.phone?.message} {...register('phone')} />
          <TextField
            label="Nightly rate sold at (₹, optional)"
            type="number"
            hint="Leave blank to use your current rate"
            error={errors.nightlyRate?.message}
            {...register('nightlyRate', num)}
          />
        </div>
        <TextAreaField label="Notes / special requests" rows={2} {...register('specialRequests')} />
        <label className="flex items-center gap-2 text-body-sm text-slate">
          <input type="checkbox" className="size-4 accent-[var(--color-forest)]" {...register('sendConfirmation')} /> Send the guest a WhatsApp confirmation
          with our direct contact
        </label>
      </form>
    </Modal>
  );
}

export function BookingManagementPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const params = { ...FILTERS.find((f) => f.key === filter)!.params(), page, limit: 20, ...(q ? { q } : {}) };
  const list = useQuery({
    queryKey: ['bookings', params],
    queryFn: () => staffBookingService.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const columns: Column<BookingListItem>[] = [
    {
      key: 'guest',
      header: 'Guest',
      render: (b) => (
        <div>
          <p className="text-label-lg text-ink">{b.guestName}</p>
          <p className="num text-body-sm text-slate">
            {b.reference} · {formatPhone(b.guestPhone)}
          </p>
        </div>
      ),
    },
    {
      key: 'stay',
      header: 'Stay',
      render: (b) => (
        <div>
          <p className="text-ink">
            {formatDay(b.checkIn, { day: 'numeric', month: 'short' })} → {formatDay(b.checkOut, { day: 'numeric', month: 'short' })}
          </p>
          <p className="text-body-sm text-slate">
            {b.quantity} × {b.roomTypeName}
          </p>
        </div>
      ),
    },
    { key: 'source', header: 'Source', render: (b) => <SourceBadge source={b.source} /> },
    {
      key: 'status',
      header: 'Status',
      render: (b) => (
        <div className="flex flex-col items-start gap-1">
          <BookingStatusBadge status={b.status} />
          {b.needsAttention && (
            <span className="inline-flex items-center gap-1 text-label-sm text-danger">
              <AlertTriangle className="size-3" aria-hidden /> Attention
            </span>
          )}
        </div>
      ),
    },
    { key: 'total', header: 'Total', align: 'right', render: (b) => <span className="num text-label-lg text-forest">{formatINR(b.totalPaise)}</span> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Direct booking"
        title="Bookings"
        description="Every reservation in one place, including OTA, walk-in and phone bookings you add here."
        actions={
          can('bookings.manage') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add OTA / walk-in
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0" role="tablist" aria-label="Filter bookings">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={cn(
                'shrink-0 rounded-full border px-4 py-2 text-label-md',
                filter === f.key ? 'border-forest bg-forest text-white' : 'border-line bg-white text-slate',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="md:w-72">
          <TextField
            label="Search"
            type="search"
            placeholder="Reference, name or phone"
            leading={<Search className="size-4" />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>
      <DataTable
        caption="Bookings"
        columns={columns}
        rows={list.data?.data}
        rowKey={(b) => b.id}
        loading={list.isFetching}
        meta={list.data?.meta}
        onPageChange={setPage}
        onRowClick={(b) => setOpenId(b.id)}
        error={
          list.error ? (
            <EmptyState
              tone="error"
              title="Couldn’t load bookings"
              description={errorMessage(list.error)}
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
            />
          ) : undefined
        }
        empty={{
          title: q || filter !== 'all' ? 'No bookings match' : 'No bookings yet',
          description: filter === 'all' && !q ? 'Direct bookings from your website appear here automatically.' : 'Try another filter.',
        }}
        renderMobile={(b) => <BookingCard booking={b} onOpen={(x) => setOpenId(x.id)} />}
      />
      {openId && <BookingDetail id={openId} onClose={() => setOpenId(null)} />}
      {adding && <ManualBookingForm onClose={() => setAdding(false)} />}
    </>
  );
}
