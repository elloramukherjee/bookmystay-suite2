import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, Clock, Copy, MapPin, MessageCircle, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BookingStatusBadge, PaymentStatusBadge } from '../../components/BookingStatus';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { PricingBreakdown } from '../../components/PricingBreakdown';
import { useToast } from '../../context/ToastContext';
import { useGuestBooking } from '../../modules/booking/hooks';
import { ApiError, errorMessage } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';
import type { GuestBookingView } from '../../types/booking';
import { formatDay, formatInstant } from '../../utils/dates';
import { formatINR, formatTime, whatsappLink } from '../../utils/format';

function MessageStatus({ b }: { b: GuestBookingView }) {
  const msg = b.confirmationMessages.find((m) => m.template === 'booking_confirmed');
  if (!msg) return null;
  const text =
    msg.status === 'sent'
      ? 'Confirmation sent to your WhatsApp.'
      : msg.status === 'simulated'
        ? 'Confirmation message generated (development simulator — not actually sent).'
        : msg.status === 'dead'
          ? 'We couldn’t reach you on WhatsApp — the hotel will contact you.'
          : 'Sending your confirmation on WhatsApp…';
  return (
    <p className="flex items-center gap-2 text-body-sm text-emerald">
      <MessageCircle className="size-4" aria-hidden /> {text}
    </p>
  );
}

export function BookingConfirmationPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const booking = useGuestBooking(id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => publicBookingService.cancel(id, reason || undefined),
    onSuccess: (data) => {
      queryClient.setQueryData(['guest-booking', id], data);
      setConfirmCancel(false);
      toast.success(
        data.refundDuePaise > 0 ? `Refund of ${formatINR(data.refundDuePaise)} will be processed.` : 'Your booking has been cancelled.',
        'Cancelled',
      );
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t cancel'),
  });

  useEffect(() => {
    if (booking.data) document.title = `Booking ${booking.data.reference}`;
  }, [booking.data]);

  if (booking.isLoading) return <LoadingSkeleton variant="lines" count={8} className="page-container py-10" label="Loading your booking" />;
  if (booking.error || !booking.data) {
    const expired = booking.error instanceof ApiError && booking.error.status === 401;
    return (
      <div className="page-container py-16">
        <EmptyState
          tone={expired ? 'default' : 'error'}
          title={expired ? 'Open your booking with your phone number' : 'We couldn’t load this booking'}
          description={expired ? 'For your privacy, booking pages need your reference and phone number.' : errorMessage(booking.error)}
          action={
            <Link to="/my-booking" className="text-label-lg text-forest underline underline-offset-4">
              Find my booking
            </Link>
          }
        />
      </div>
    );
  }

  const b = booking.data;
  const confirmed = ['confirmed', 'checked_in', 'checked_out'].includes(b.status);
  const address = [b.hotel.address.line1, b.hotel.address.locality, b.hotel.address.city, b.hotel.address.pincode].filter(Boolean).join(', ');

  return (
    <div className="page-container pt-6 pb-16">
      {confirmed ? (
        <section className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] bg-emerald p-6 text-white lg:flex-row lg:items-center lg:justify-between lg:p-8">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="size-10 shrink-0" aria-hidden />
            <div>
              <h1 className="text-headline-md text-white">Your stay is confirmed</h1>
              <p className="text-body-md text-white/90">We look forward to welcoming you, {b.guest.name.split(' ')[0]}.</p>
              {b.paymentStatus === 'pay_at_hotel' && (
                <p className="mt-1 text-body-md font-semibold text-white">
                  Pay <span className="num">{formatINR(b.amounts.totalPaise)}</span> at the hotel (cash, UPI or card). Nothing was charged online.
                </p>
              )}
            </div>
          </div>
          <div className="rounded-xl bg-white/15 px-4 py-3">
            <p className="text-label-sm uppercase text-white/80">Booking reference</p>
            <p className="num flex items-center gap-2 text-headline-sm font-bold tracking-wider text-white">
              {b.reference}
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(b.reference).then(() => toast.success('Reference copied'))}
                className="rounded-full p-1 hover:bg-white/20"
                aria-label="Copy booking reference"
              >
                <Copy className="size-4" />
              </button>
            </p>
          </div>
        </section>
      ) : (
        <section className="card flex flex-col gap-2 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentStatus} />
          </div>
          <h1 className="text-headline-md">
            {b.status === 'pending_payment' ? 'Payment pending' : b.status === 'cancelled' ? 'Booking cancelled' : 'Booking not active'} ·{' '}
            <span className="num">{b.reference}</span>
          </h1>
          {b.status === 'pending_payment' && (
            <Link to={`/booking/${b.id}/pay`}>
              <Button variant="upi" tabIndex={-1}>
                Complete payment
              </Button>
            </Link>
          )}
          {b.status === 'cancelled' && b.refundDuePaise > 0 && (
            <p className="text-body-md text-slate">
              A refund of {formatINR(b.refundDuePaise)} is being processed to your original payment method (5–7 working days).
            </p>
          )}
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card flex flex-col gap-5 p-5 lg:p-6" aria-labelledby="stay-details">
          <h2 id="stay-details" className="text-headline-sm">
            {b.hotel.name}
          </h2>
          <MessageStatus b={b} />
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-parchment-alt/70 p-4">
              <dt className="flex items-center gap-1.5 text-label-sm uppercase text-sage">
                <CalendarCheck2 className="size-3.5 text-terracotta" aria-hidden /> Check-in
              </dt>
              <dd className="mt-1 text-label-lg text-ink">{formatDay(b.checkIn, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
              <dd className="text-body-sm text-slate">from {formatTime(b.hotel.checkInTime)}</dd>
            </div>
            <div className="rounded-lg bg-parchment-alt/70 p-4">
              <dt className="flex items-center gap-1.5 text-label-sm uppercase text-sage">
                <Clock className="size-3.5 text-terracotta" aria-hidden /> Check-out
              </dt>
              <dd className="mt-1 text-label-lg text-ink">{formatDay(b.checkOut, { weekday: 'long', day: 'numeric', month: 'long' })}</dd>
              <dd className="text-body-sm text-slate">by {formatTime(b.hotel.checkOutTime)}</dd>
            </div>
          </dl>
          <div className="grid gap-1 text-body-md">
            <p>
              <span className="text-slate">Room:</span> {b.quantity} × {b.roomTypeName}
              {b.ratePlanName ? ` · ${b.ratePlanName}` : ''}
            </p>
            <p>
              <span className="text-slate">Guests:</span> {b.adults} adult{b.adults > 1 ? 's' : ''}
              {b.children ? `, ${b.children} child${b.children > 1 ? 'ren' : ''}` : ''}
            </p>
            <p>
              <span className="text-slate">Booked by:</span> {b.guest.name} · {b.guest.phoneMasked}
            </p>
            {b.specialRequests && (
              <p>
                <span className="text-slate">Requests:</span> {b.specialRequests}
              </p>
            )}
          </div>
          {address && (
            <p className="flex items-start gap-2 text-body-sm text-slate">
              <MapPin className="mt-0.5 size-4 shrink-0 text-terracotta" aria-hidden /> {address}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {b.hotel.whatsapp && (
              <a href={whatsappLink(b.hotel.whatsapp, `Namaste! I have a question about my booking ${b.reference}.`)} target="_blank" rel="noreferrer">
                <Button variant="whatsapp" icon={<MessageCircle className="size-4" aria-hidden />} tabIndex={-1}>
                  Chat with the hotel
                </Button>
              </a>
            )}
            <Link to={`/h/${b.hotel.slug}/chat?booking=${b.id}`}>
              <Button variant="secondary" icon={<Sparkles className="size-4" aria-hidden />} tabIndex={-1}>
                Ask the concierge
              </Button>
            </Link>
            {b.cancellation.cancellable && (
              <Button
                variant="ghost"
                className="text-danger hover:bg-danger-50"
                icon={<XCircle className="size-4" aria-hidden />}
                onClick={() => setConfirmCancel(true)}
              >
                Cancel booking
              </Button>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Payment</p>
              <PaymentStatusBadge status={b.paymentStatus} />
            </div>
            <PricingBreakdown amounts={b.amounts} nights={b.nights} rooms={b.quantity} showOtaSaving={b.source === 'direct'} />
          </div>
          <div className="card p-5 text-body-sm text-slate">
            <p className="text-label-lg text-forest">Cancellation</p>
            <p className="mt-1">
              {b.cancellation.isFree
                ? `Free cancellation until ${formatInstant(b.cancellation.freeUntil, b.hotel.timezone)}.`
                : 'The free cancellation window has passed: cancelling now forfeits the first night.'}
            </p>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this booking?"
        tone="danger"
        confirmLabel="Yes, cancel"
        cancelLabel="Keep booking"
        loading={cancel.isPending}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate()}
        message={
          <div className="flex flex-col gap-3">
            <p>
              {b.paymentStatus === 'paid'
                ? b.cancellation.isFree
                  ? `You’ll get a full refund of ${formatINR(b.amounts.totalPaise)}.`
                  : 'The first night will be charged; the rest is refunded.'
                : 'Your reservation will be released.'}
            </p>
            <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
        }
      />
    </div>
  );
}
