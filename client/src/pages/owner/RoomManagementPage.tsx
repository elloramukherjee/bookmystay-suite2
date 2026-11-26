import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, Pencil, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/FormField';
import { ImageWithFallback } from '../../components/ImageWithFallback';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ApiError, errorMessage } from '../../services/api';
import { roomsService, type RoomTypeInput } from '../../services/booking.service';
import type { RoomUnit, StaffRoomType } from '../../types/booking';
import { cn, formatINR } from '../../utils/format';

const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter a name').max(80),
    description: z.string().trim().max(1000),
    baseRate: z.number({ error: 'Enter the nightly rate' }).min(100, 'At least ₹100').max(1_000_000),
    otaRate: z.number().min(0).max(1_000_000).optional(),
    maxAdults: z.number().int().min(1).max(10),
    maxChildren: z.number().int().min(0).max(10),
    maxOccupancy: z.number().int().min(1).max(12),
    sizeSqft: z.number().int().min(50).max(10000).optional(),
    bedType: z.string().trim().max(60),
    view: z.string().trim().max(80),
    amenities: z.string().max(800),
    photoUrl: z.union([z.literal(''), z.url({ protocol: /^https$/, error: 'Use an https:// image link' })]),
    directPrivilege: z.string().trim().max(160),
    units: z.string().max(600),
  })
  .refine((v) => v.maxOccupancy >= v.maxAdults, { message: 'Must be at least the number of adults', path: ['maxOccupancy'] });
type FormValues = z.infer<typeof schema>;

const toForm = (rt?: StaffRoomType): FormValues => ({
  name: rt?.name ?? '',
  description: rt?.description ?? '',
  baseRate: rt ? rt.baseRatePaise / 100 : (undefined as unknown as number),
  otaRate: rt?.otaRatePaise ? rt.otaRatePaise / 100 : undefined,
  maxAdults: rt?.maxAdults ?? 2,
  maxChildren: rt?.maxChildren ?? 1,
  maxOccupancy: rt?.maxOccupancy ?? 3,
  sizeSqft: rt?.sizeSqft ?? undefined,
  bedType: rt?.bedType ?? '',
  view: rt?.view ?? '',
  amenities: rt?.amenities.join(', ') ?? '',
  photoUrl: rt?.photos[0]?.url ?? '',
  directPrivilege: rt?.directPrivilege ?? '',
  units: '',
});

function RoomTypeForm({ roomType, onClose }: { roomType?: StaffRoomType; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(roomType) });
  const num = { setValueAs: (v: string) => (v === '' || v === null ? undefined : Number(v)) };

  const onSubmit = async (v: FormValues) => {
    const input: RoomTypeInput = {
      name: v.name,
      description: v.description,
      baseRatePaise: Math.round(v.baseRate * 100),
      otaRatePaise: v.otaRate ? Math.round(v.otaRate * 100) : null,
      maxAdults: v.maxAdults,
      maxChildren: v.maxChildren,
      maxOccupancy: v.maxOccupancy,
      sizeSqft: v.sizeSqft ?? null,
      bedType: v.bedType,
      view: v.view,
      amenities: list(v.amenities).slice(0, 20),
      photos: v.photoUrl ? [{ url: v.photoUrl, alt: `${v.name} room` }] : [],
      directPrivilege: v.directPrivilege,
    };
    try {
      if (roomType) await roomsService.update(roomType.id, input);
      else await roomsService.create({ ...input, unitNumbers: list(v.units) });
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success(roomType ? 'Room type updated. Guests see the change immediately.' : 'Room type added.', v.name);
      onClose();
    } catch (err) {
      setError('root', { message: err instanceof ApiError && err.status === 409 ? err.message : errorMessage(err) });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={roomType ? `Edit ${roomType.name}` : 'Add a room type'}
      size="lg"
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="room-type-form" loading={isSubmitting}>
            {roomType ? 'Save changes' : 'Add room type'}
          </Button>
        </>
      }
    >
      <form id="room-type-form" className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {errors.root && (
          <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-body-sm text-danger">
            {errors.root.message}
          </p>
        )}
        <TextField label="Name guests will see" required error={errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Direct nightly rate (₹, before GST)"
            type="number"
            inputMode="decimal"
            required
            error={errors.baseRate?.message}
            {...register('baseRate', num)}
          />
          <TextField
            label="Typical OTA rate (₹)"
            type="number"
            inputMode="decimal"
            hint="Shown struck-through for comparison"
            error={errors.otaRate?.message}
            {...register('otaRate', num)}
          />
          <TextField label="Max adults" type="number" error={errors.maxAdults?.message} {...register('maxAdults', num)} />
          <TextField label="Max children" type="number" error={errors.maxChildren?.message} {...register('maxChildren', num)} />
          <TextField label="Max guests in total" type="number" error={errors.maxOccupancy?.message} {...register('maxOccupancy', num)} />
          <TextField label="Size (sq ft)" type="number" error={errors.sizeSqft?.message} {...register('sizeSqft', num)} />
          <TextField label="Bed" placeholder="King four-poster" error={errors.bedType?.message} {...register('bedType')} />
          <TextField label="View" placeholder="Courtyard" error={errors.view?.message} {...register('view')} />
        </div>
        <TextAreaField label="Description" rows={3} error={errors.description?.message} {...register('description')} />
        <TextField
          label="Amenities (comma separated)"
          placeholder="King bed, Rain shower, Balcony"
          error={errors.amenities?.message}
          {...register('amenities')}
        />
        <TextField
          label="Direct-booking privilege"
          placeholder="Early check-in from 11 AM"
          error={errors.directPrivilege?.message}
          {...register('directPrivilege')}
        />
        <TextField
          label="Photo link (https)"
          placeholder="https://…"
          hint="Use a real photo of this room."
          error={errors.photoUrl?.message}
          {...register('photoUrl')}
        />
        {!roomType && (
          <TextField
            label="Room numbers (comma separated)"
            placeholder="101, 102, 103"
            hint="These rooms make up the inventory you can sell."
            error={errors.units?.message}
            {...register('units')}
          />
        )}
      </form>
    </Modal>
  );
}

const UNIT_TONE: Record<RoomUnit['status'], 'success' | 'forest' | 'warning' | 'danger' | 'neutral'> = {
  available: 'success',
  occupied: 'forest',
  cleaning: 'warning',
  maintenance: 'danger',
  out_of_order: 'danger',
};

function UnitsPanel({ roomType, canManage }: { roomType: StaffRoomType; canManage: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [number, setNumber] = useState('');
  const [removing, setRemoving] = useState<RoomUnit | null>(null);

  const add = useMutation({
    mutationFn: () => roomsService.addUnit(roomType.id, { number: number.trim() }),
    onSuccess: async () => {
      setNumber('');
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      toast.success(`Room added to ${roomType.name}.`);
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t add room'),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; input: Partial<{ status: string; isActive: boolean }> }) => roomsService.updateUnit(v.id, v.input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms'] }),
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t update room'),
  });

  const active = roomType.units.filter((u) => u.isActive);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2">
        {active.map((u) => (
          <li key={u.id} className="flex items-center gap-1.5 rounded-full border border-line bg-white py-1 pr-1 pl-3">
            <span className="num text-label-md text-ink">{u.number}</span>
            {canManage ? (
              <select
                aria-label={`Status of room ${u.number}`}
                value={u.status}
                onChange={(e) => update.mutate({ id: u.id, input: { status: e.target.value } })}
                className="rounded-full bg-parchment-alt px-2 py-0.5 text-label-sm uppercase text-slate"
              >
                {Object.keys(UNIT_TONE).map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            ) : (
              <StatusBadge tone={UNIT_TONE[u.status]}>{u.status.replace('_', ' ')}</StatusBadge>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setRemoving(u)}
                className="rounded-full px-2 text-label-md text-sage hover:text-danger"
                aria-label={`Remove room ${u.number}`}
              >
                ×
              </button>
            )}
          </li>
        ))}
        {!active.length && <li className="text-body-sm text-slate">No rooms yet. Add room numbers to start selling.</li>}
      </ul>
      {canManage && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (number.trim()) add.mutate();
          }}
        >
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value.slice(0, 10))}
            placeholder="Room no."
            aria-label={`New room number for ${roomType.name}`}
            className="h-10 w-28 rounded-full border-[1.5px] border-line-strong px-4 text-label-md focus:border-forest focus:outline-none"
          />
          <Button type="submit" size="sm" variant="secondary" loading={add.isPending} icon={<Plus className="size-4" aria-hidden />}>
            Add room
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove room ${removing?.number}?`}
        message="It will no longer count towards sellable inventory. If future nights are already booked beyond the remaining rooms, the change is refused."
        confirmLabel="Remove"
        tone="danger"
        loading={update.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && update.mutate({ id: removing.id, input: { isActive: false } }, { onSettled: () => setRemoving(null) })}
      />
    </div>
  );
}

export function RoomManagementPage() {
  const { can } = useAuth();
  const canManage = can('rooms.manage');
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: roomsService.list });
  const [editing, setEditing] = useState<StaffRoomType | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const visible = rooms.data?.filter((r) => showInactive || r.isActive) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Direct booking"
        title="Rooms"
        description="What guests can book on your website. Inventory is the number of active rooms in each type."
        actions={
          canManage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Add room type
            </Button>
          )
        }
      />
      {rooms.isLoading ? (
        <LoadingSkeleton variant="card" count={3} label="Loading rooms" />
      ) : rooms.error ? (
        <div className="card">
          <EmptyState
            tone="error"
            title="Couldn’t load rooms"
            description={errorMessage(rooms.error)}
            action={<Button onClick={() => void rooms.refetch()}>Retry</Button>}
          />
        </div>
      ) : !visible.length ? (
        <div className="card">
          <EmptyState
            icon={<BedDouble className="size-6" />}
            title="No room types yet"
            description="Add your first room type with its nightly rate and room numbers to open direct bookings."
            action={canManage && <Button onClick={() => setEditing('new')}>Add room type</Button>}
          />
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {visible.map((rt) => (
            <li key={rt.id} className={cn('card grid gap-4 overflow-hidden md:grid-cols-[220px_1fr]', !rt.isActive && 'opacity-60')}>
              {rt.photos[0] ? (
                <ImageWithFallback src={rt.photos[0].url} alt={rt.photos[0].alt} className="aspect-[16/10] h-full w-full object-cover md:aspect-auto" />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center bg-forest-50 text-forest-200 md:aspect-auto">
                  <BedDouble className="size-10" aria-hidden />
                </div>
              )}
              <div className="flex flex-col gap-3 p-4 md:py-5 md:pr-5 md:pl-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-headline-sm">{rt.name}</h2>
                    <p className="flex items-center gap-1 text-body-sm text-slate">
                      <Users className="size-3.5" aria-hidden /> Up to {rt.maxOccupancy} guests · {rt.totalRooms} room{rt.totalRooms === 1 ? '' : 's'}
                      {!rt.isActive && ' · Not on sale'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-headline-sm font-bold text-forest">{formatINR(rt.baseRatePaise)}</p>
                    <p className="text-body-sm text-slate">per night before GST{rt.otaRatePaise ? ` · OTA ${formatINR(rt.otaRatePaise)}` : ''}</p>
                  </div>
                </div>
                <UnitsPanel roomType={rt} canManage={canManage} />
                {canManage && (
                  <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(rt)}>
                      Edit details &amp; rate
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {rooms.data?.some((r) => !r.isActive) && (
        <div className="mt-4 max-w-xs">
          <SelectField label="Show" value={showInactive ? 'all' : 'active'} onChange={(e) => setShowInactive(e.target.value === 'all')}>
            <option value="active">Room types on sale</option>
            <option value="all">Include removed room types</option>
          </SelectField>
        </div>
      )}
      {editing && <RoomTypeForm roomType={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
