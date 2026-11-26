import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Building2, Clock, CreditCard, FlaskConical, Landmark, Loader2, Lock, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { PricingBreakdown } from '../../components/PricingBreakdown';
import { StatusBadge } from '../../components/StatusBadge';
import { useGuestBooking } from '../../modules/booking/hooks';
import { ApiError, errorMessage } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';
import type { PaymentView } from '../../types/booking';
import { formatDay, formatInstant } from '../../utils/dates';
import { cn, formatINR } from '../../utils/format';

type Method = 'upi' | 'card' | 'netbanking';
const UPI_APPS = ['Google Pay', 'PhonePe', 'Paytm', 'Any UPI app'];

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = Math.max(0, new Date(until).getTime() - now);
  return { ms, label: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}` };
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}

export function PaymentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const booking = useGuestBooking(id);
  const [method, setMethod] = useState<Method>('upi');
  const [upiApp, setUpiApp] = useState(UPI_APPS[0]!);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const countdown = useCountdown(booking.data?.status === 'pending_payment' ? booking.data.holdExpiresAt : null);

  // Once a payment is started, poll its status until the webhook confirms (or fails) it.
  const status = useQuery({
    queryKey: ['payment-status', payment?.id],
    queryFn: () => publicBookingService.paymentStatus(id, payment!.id),
    enabled: Boolean(payment),
    refetchInterval: (q) => (q.state.data?.booking.status === 'confirmed' || q.state.data?.status === 'failed' ? false : 3000),
  });
  const live = status.data ?? payment;

  useEffect(() => {
    if (live?.booking.status === 'confirmed') {
      void queryClient.invalidateQueries({ queryKey: ['guest-booking', id] });
      navigate(`/booking/${id}`, { replace: true });
    }
  }, [live?.booking.status, id, navigate, queryClient]);

  const start = useMutation({
    mutationFn: () => publicBookingService.createPayment(id, method),
    onSuccess: async (p) => {
      setPayment(p);
      if (p.checkout?.kind === 'razorpay' && p.checkout.keyId) {
        await loadRazorpay();
        const rzp = new window.Razorpay!({
          key: p.checkout.keyId,
          order_id: p.checkout.orderId,
          amount: p.amountPaise,
          currency: 'INR',
          name: booking.data?.hotel.name,
          description: `Booking ${p.booking.reference}`,
          config: { display: { preferences: { show_default_blocks: true } } },
          theme: { color: '#1D3327' },
          // Confirmation comes from the signed webhook, never from this browser callback.
          handler: () => void status.refetch(),
        });
        rzp.open();
      }
    },
    onError: () => void booking.refetch(),
  });

  const simulate = useMutation({
    mutationFn: (outcome: 'success' | 'failure') => publicBookingService.simulatePayment(id, payment!.id, outcome),
    onSuccess: (r) => {
      setPayment(r.payment);
      void status.refetch();
    },
  });

  if (booking.isLoading) return <LoadingSkeleton variant="lines" count={6} className="page-container py-10" label="Loading your booking" />;
  if (booking.error || !booking.data) {
    const expiredSession = booking.error instanceof ApiError && booking.error.status === 401;
    return (
      <div className="page-container py-16">
        <EmptyState
          tone="error"
          title={expiredSession ? 'Please open your booking again' : 'We couldn’t load this booking'}
          description={
            expiredSession
              ? 'For your security, payment links expire after a while. Find your booking with its reference and your phone number.'
              : errorMessage(booking.error)
          }
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
  if (b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'checked_out') return <Navigate to={`/booking/${id}`} replace />;

  const holdOver = b.status === 'expired' || (countdown !== null && countdown.ms === 0);
  if (b.status === 'cancelled' || holdOver) {
    return (
      <div className="page-container py-16">
        <EmptyState
          icon={<Clock className="size-6" />}
          title={b.status === 'cancelled' ? 'This booking was cancelled' : 'Your reservation hold has expired'}
          description="Rooms were released so other guests could book. You can search again — your room may still be available."
          action={
            <Link
              to={`/h/${b.hotel.slug}/rooms?checkIn=${b.checkIn}&checkOut=${b.checkOut}&adults=${b.adults}&children=${b.children}&rooms=${b.quantity}`}
              className="text-label-lg text-forest underline underline-offset-4"
            >
              Search again
            </Link>
          }
        />
      </div>
    );
  }

  const gatewayDown = b.paymentStatus === 'provider_unavailable' || (start.error instanceof ApiError && start.error.code === 'PAYMENT_PROVIDER_UNAVAILABLE');
  const failed = live?.status === 'failed';
  const waiting = live && !failed && live.booking.status !== 'confirmed';

  return (
    <div className="page-container pt-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-terracotta">Step 2 · Instant zero-fee payment</p>
          <h1 className="text-headline-md lg:text-headline-lg">Pay securely</h1>
          <p className="text-body-sm text-slate">
            Booking <span className="num font-semibold text-ink">{b.reference}</span> · {b.roomTypeName} · {formatDay(b.checkIn)} → {formatDay(b.checkOut)}
          </p>
        </div>
        {countdown && (
          <p
            className={cn(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-label-md',
              countdown.ms < 120_000 ? 'bg-danger-50 text-danger' : 'bg-terracotta-50 text-terracotta',
            )}
            role="timer"
            aria-live="off"
          >
            <Clock className="size-4" aria-hidden /> Room held for <span className="num">{countdown.label}</span>
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card flex flex-col gap-5 p-5 lg:p-6" aria-labelledby="pay-title">
          <h2 id="pay-title" className="sr-only">
            Payment method
          </h2>

          {gatewayDown && (
            <div role="alert" className="flex gap-3 rounded-lg border border-terracotta/40 bg-terracotta-50 p-4 text-body-sm text-terracotta-deep">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Payments are briefly unavailable</p>
                <p>Your booking request {b.reference} is saved and your room is held. We’ll send you a payment link on WhatsApp — or try again in a minute.</p>
              </div>
            </div>
          )}

          <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
            {(
              [
                { key: 'upi', label: 'UPI', icon: Smartphone },
                { key: 'card', label: 'Card', icon: CreditCard },
                { key: 'netbanking', label: 'Netbanking', icon: Building2 },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={method === m.key}
                onClick={() => {
                  setMethod(m.key);
                  setPayment(null);
                }}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border-[1.5px] px-2 py-3 text-label-md',
                  method === m.key ? (m.key === 'upi' ? 'border-upi bg-upi-50 text-upi' : 'border-forest bg-forest-50 text-forest') : 'border-line text-slate',
                )}
              >
                <m.icon className="size-5" aria-hidden />
                {m.label}
                {m.key === 'upi' && <span className="text-[10px] font-bold uppercase">Recommended</span>}
              </button>
            ))}
          </div>

          {method === 'upi' && (
            <div>
              <p className="mb-2 text-label-md text-slate">Pay with</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {UPI_APPS.map((app) => (
                  <button
                    key={app}
                    type="button"
                    onClick={() => setUpiApp(app)}
                    aria-pressed={upiApp === app}
                    className={cn(
                      'rounded-lg border-[1.5px] px-3 py-3 text-label-md',
                      upiApp === app ? 'border-upi bg-upi-50 text-upi' : 'border-line text-ink',
                    )}
                  >
                    {app}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-body-sm text-slate">Zero convenience fee on UPI and RuPay.</p>
            </div>
          )}

          {!payment || failed ? (
            <>
              {failed && (
                <p role="alert" className="rounded-lg bg-danger-50 p-3 text-body-sm text-danger">
                  Payment didn’t go through{live?.failureReason ? ` (${live.failureReason})` : ''}. No money was taken — please try again.
                </p>
              )}
              {start.error && !gatewayDown && (
                <p role="alert" className="rounded-lg bg-danger-50 p-3 text-body-sm text-danger">
                  {errorMessage(start.error)}
                </p>
              )}
              <Button
                size="lg"
                variant={method === 'upi' ? 'upi' : 'primary'}
                fullWidth
                loading={start.isPending}
                onClick={() => {
                  setPayment(null);
                  start.mutate();
                }}
                icon={<Lock className="size-4" aria-hidden />}
              >
                Pay {formatINR(b.amounts.totalPaise)} {method === 'upi' ? 'via UPI' : method === 'card' ? 'by card' : 'via netbanking'} &amp; confirm
              </Button>
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-4" aria-live="polite">
              <p className="flex items-center gap-2 text-label-lg text-ink">
                {waiting && <Loader2 className="size-4 animate-spin text-upi" aria-hidden />}
                {waiting ? 'Waiting for payment confirmation…' : 'Payment received'}
              </p>
              <p className="text-body-sm text-slate">
                Complete the payment in your {method === 'upi' ? 'UPI app' : 'bank window'}. This page updates automatically — please don’t close it.
              </p>
            </div>
          )}

          {payment?.devMode && !failed && live?.booking.status !== 'confirmed' && (
            <div className="rounded-lg border-2 border-dashed border-warning bg-warning-50 p-4" role="region" aria-label="Development payment simulator">
              <p className="flex items-center gap-2 text-label-lg text-warning">
                <FlaskConical className="size-4" aria-hidden /> DEVELOPMENT MODE — no real payment gateway
              </p>
              <p className="mt-1 text-body-sm text-ink">
                This environment uses a mock provider. No money moves. Use the buttons below to simulate what the gateway would report; it runs the same
                signed-webhook path as production.
              </p>
              {payment.checkout?.upiIntent && (
                <code className="mt-2 block overflow-x-auto rounded bg-white/70 p-2 text-[11px] text-slate">{payment.checkout.upiIntent}</code>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="whatsapp"
                  loading={simulate.isPending && simulate.variables === 'success'}
                  onClick={() => simulate.mutate('success')}
                >
                  Simulate successful payment
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  loading={simulate.isPending && simulate.variables === 'failure'}
                  onClick={() => simulate.mutate('failure')}
                >
                  Simulate failure
                </Button>
              </div>
            </div>
          )}

          <p className="flex items-center gap-2 text-body-sm text-slate">
            <Landmark className="size-4 text-upi" aria-hidden />
            Payments are processed by a licensed payment gateway. Your card or UPI details never touch the hotel’s systems.
          </p>
        </section>

        <aside className="lg:sticky lg:top-28 lg:self-start" aria-label="Price summary">
          <div className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">Booking summary</p>
              <StatusBadge tone="warning">Awaiting payment</StatusBadge>
            </div>
            <p className="mt-2 text-label-lg text-ink">{b.hotel.name}</p>
            <p className="text-body-sm text-slate">
              Guest: {b.guest.name} · {b.guest.phoneMasked}
            </p>
            <PricingBreakdown className="mt-4" amounts={b.amounts} nights={b.nights} rooms={b.quantity} roomName={b.roomTypeName} />
            <p className="mt-3 text-body-sm text-slate">
              {b.cancellation.isFree
                ? `Free cancellation until ${formatInstant(b.cancellation.freeUntil, b.hotel.timezone)}.`
                : 'This stay is inside the free-cancellation window: cancelling after payment forfeits the first night.'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
