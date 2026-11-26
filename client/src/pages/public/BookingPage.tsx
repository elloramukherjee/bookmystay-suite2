import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CalendarCheck, Lock, MessageCircle, ShieldCheck, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TextAreaField, TextField } from '../../components/FormField';
import { describeGuests } from '../../components/GuestCountSelector';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { PricingBreakdown } from '../../components/PricingBreakdown';
import { usePublicHotel } from '../../hooks/usePublicHotel';
import { useAvailability, usePolicies } from '../../modules/booking/hooks';
import { stayQueryString, useStayParams } from '../../modules/booking/useStayParams';
import { ApiError, errorMessage } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';
import { formatDay } from '../../utils/dates';
import { formatTime } from '../../utils/format';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your full name as on your ID').max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => /^(\+?\d[\d\s-]{8,15})$/.test(v), 'Enter your 10-digit WhatsApp number'),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  specialRequests: z.string().trim().max(500),
  agree: z.literal(true, { error: 'Please accept to continue' }),
  marketing: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function BookingPage() {
  const hotel = usePublicHotel();
  const stay = useStayParams();
  const [params] = useSearchParams();
  const roomTypeId = params.get('roomTypeId') ?? '';
  const ratePlanId = params.get('ratePlanId') ?? undefined;
  const navigate = useNavigate();
  const search = useAvailability(hotel.data?.id, stay);
  const policies = usePolicies(hotel.data?.slug);
  // One key per checkout attempt: double taps and network retries can never create two bookings.
  const [idempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', phone: '', email: '', specialRequests: '', marketing: false } });

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      publicBookingService.create(
        {
          hotelId: hotel.data!.id,
          roomTypeId,
          ratePlanId,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: stay.adults,
          children: stay.children,
          rooms: stay.rooms,
          promoCode: stay.promoCode || undefined,
          guest: { name: v.name, phone: v.phone, email: v.email || undefined },
          specialRequests: v.specialRequests || undefined,
          consent: { transactional: true, marketing: v.marketing },
        },
        idempotencyKey,
      ),
    // Pay-at-hotel properties confirm straight away; otherwise continue to the payment step.
    onSuccess: (data) => navigate(data.booking.status === 'confirmed' ? `/booking/${data.booking.id}` : `/booking/${data.booking.id}/pay`),
    onError: (err) => {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors;
        if (fe['guest.phone']) setError('phone', { message: fe['guest.phone'] });
        if (fe['guest.name']) setError('name', { message: fe['guest.name'] });
        if (fe['guest.email']) setError('email', { message: fe['guest.email'] });
      }
    },
  });

  useEffect(() => {
    document.title = 'Your details · Book direct';
  }, []);

  if (hotel.isLoading || search.isLoading) return <LoadingSkeleton variant="lines" count={8} className="page-container py-10" label="Preparing your booking" />;
  const result = search.data?.results.find((r) => r.roomType.id === roomTypeId);
  const option = result?.ratePlans.find((p) => (p.ratePlan?.id ?? undefined) === ratePlanId) ?? result?.ratePlans[0];
  const backToRooms = hotel.data ? `/h/${hotel.data.slug}/rooms?${stayQueryString(stay)}` : '/';

  if (!hotel.data || !result || !option) {
    return (
      <div className="page-container py-16">
        <EmptyState
          tone="error"
          title="This room isn’t available to book"
          description={search.error ? errorMessage(search.error) : 'The link may be outdated. Please pick a room again.'}
          action={
            <Link to={backToRooms} className="text-label-lg text-forest underline underline-offset-4">
              See available rooms
            </Link>
          }
        />
      </div>
    );
  }
  const h = hotel.data;
  const payAtHotel = h?.paymentMode === 'pay_at_hotel';
  const cancellation = policies.data?.find((p) => p.type === 'cancellation');
  const unavailable = !result.bookable || (create.error instanceof ApiError && create.error.code === 'ROOM_UNAVAILABLE');

  return (
    <div className="page-container pt-5 pb-32 lg:pb-16">
      <Link to={backToRooms} className="inline-flex items-center gap-1 text-label-md text-forest">
        <ArrowLeft className="size-4" aria-hidden /> Change room
      </Link>
      <h1 className="mt-3 text-headline-md lg:text-headline-lg">Almost there</h1>
      <p className="text-body-md text-slate">
        {result.roomType.name} at {h.name} · {formatDay(stay.checkIn)} → {formatDay(stay.checkOut)} · {describeGuests(stay)}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <form id="guest-details" onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="card flex flex-col gap-5 p-5 lg:p-6">
          <div>
            <p className="eyebrow text-terracotta">Step 1 · Primary guest details</p>
            <p className="mt-1 text-body-sm text-slate">We only ask for what we need to confirm your stay.</p>
          </div>

          {unavailable && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 p-4 text-body-sm text-danger">
              {result.reason ?? 'Sorry — someone just booked the last room for these dates.'}{' '}
              <Link to={backToRooms} className="font-semibold underline">
                See other rooms
              </Link>
            </div>
          )}
          {create.error && !unavailable && !(create.error instanceof ApiError && Object.keys(create.error.fieldErrors).length) && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 p-4 text-body-sm text-danger">
              {errorMessage(create.error)}
            </div>
          )}

          <TextField
            label="WhatsApp mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98201 44552"
            required
            leading={<MessageCircle className="size-4 text-emerald" />}
            hint="Your booking voucher and updates arrive here. This number is how the hotel recognises you."
            error={errors.phone?.message}
            {...register('phone')}
          />
          <TextField label="Full name (as on ID)" autoComplete="name" required error={errors.name?.message} {...register('name')} />
          <TextField
            label="Email (optional)"
            type="email"
            autoComplete="email"
            hint="For a copy of your GST invoice."
            error={errors.email?.message}
            {...register('email')}
          />
          <TextAreaField
            label="Special requests (optional)"
            rows={3}
            placeholder="Early arrival, dietary needs, celebrating something…"
            error={errors.specialRequests?.message}
            {...register('specialRequests')}
          />

          <div className="flex flex-col gap-3 rounded-lg bg-parchment-alt/70 p-4">
            <label className="flex items-start gap-3 text-body-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--color-forest)]"
                {...register('agree')}
                aria-invalid={errors.agree ? true : undefined}
              />
              <span>
                I agree to the booking terms and cancellation policy, and to {h.name} using my name and phone number to manage this booking.
                {errors.agree && (
                  <span role="alert" className="mt-1 block text-danger">
                    {errors.agree.message}
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-3 text-body-sm text-slate">
              <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--color-forest)]" {...register('marketing')} />
              <span>Send me occasional offers from this hotel on WhatsApp (optional, reply STOP anytime).</span>
            </label>
          </div>

          {payAtHotel && (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-body-sm text-ink">
              <Wallet className="mt-0.5 size-4 shrink-0 text-emerald" aria-hidden />
              <span>
                <strong>No online payment needed.</strong> Your booking is confirmed right away. Pay{' '}
                <span className="num">₹{(option.quote.totalPaise / 100).toLocaleString('en-IN')}</span> at the hotel by cash, UPI or card.
              </span>
            </p>
          )}

          {cancellation && (
            <details className="rounded-lg border border-line p-4">
              <summary className="cursor-pointer text-label-lg text-forest">{cancellation.title}</summary>
              <p className="mt-2 text-body-sm text-slate">{cancellation.body}</p>
            </details>
          )}

          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={create.isPending}
            disabled={unavailable}
            icon={payAtHotel ? <CalendarCheck className="size-4" aria-hidden /> : <Lock className="size-4" aria-hidden />}
            className="hidden lg:inline-flex"
          >
            {payAtHotel ? 'Confirm booking' : 'Continue to secure payment'}
          </Button>
        </form>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start" aria-label="Price summary">
          <div className="card p-5">
            <p className="eyebrow">Your stay</p>
            <p className="mt-1 text-label-lg text-ink">
              Check-in {formatDay(stay.checkIn)} from {formatTime(h.checkInTime)}
            </p>
            <p className="text-label-lg text-ink">
              Check-out {formatDay(stay.checkOut)} by {formatTime(h.checkOutTime)}
            </p>
            <PricingBreakdown
              className="mt-4"
              amounts={option.quote}
              nights={search.data!.nights}
              rooms={stay.rooms}
              roomName={`${result.roomType.name}${option.ratePlan ? ` · ${option.ratePlan.name}` : ''}`}
            />
            <p className="mt-3 flex items-start gap-2 text-body-sm text-slate">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald" aria-hidden />
              Final price is confirmed by the hotel’s system when you continue. Your room is held for a few minutes while you pay.
            </p>
          </div>
        </aside>
      </div>

      {/* Mobile sticky checkout bar (DESIGN.md: 80px safe area) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-ambient backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="num text-[20px] font-bold leading-6 text-forest">₹{(option.quote.totalPaise / 100).toLocaleString('en-IN')}</p>
            <p className="text-label-sm text-sage">incl. GST</p>
          </div>
          <Button type="submit" form="guest-details" size="lg" loading={create.isPending} disabled={unavailable}>
            {payAtHotel ? 'Confirm booking' : 'Continue to pay'}
          </Button>
        </div>
      </div>
    </div>
  );
}
