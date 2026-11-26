import { ArrowLeft, BedDouble, CalendarSearch, ShieldCheck, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { describeGuests } from '../../components/GuestCountSelector';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { RoomCard } from '../../components/RoomCard';
import { usePublicHotel } from '../../hooks/usePublicHotel';
import { useAvailability } from '../../modules/booking/hooks';
import { StaySearchBar } from '../../modules/booking/StaySearchBar';
import { stayQueryString, useStayParams } from '../../modules/booking/useStayParams';
import { ApiError, errorMessage } from '../../services/api';
import { formatDay } from '../../utils/dates';
import { cn, whatsappLink } from '../../utils/format';

export function RoomListingPage() {
  const hotel = usePublicHotel();
  const stay = useStayParams();
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const search = useAvailability(hotel.data?.id, stay);
  const [filter, setFilter] = useState<string>('all');
  const [plans, setPlans] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (hotel.data) document.title = `Rooms · ${hotel.data.name}`;
  }, [hotel.data]);

  if (hotel.isLoading) return <LoadingSkeleton variant="card" count={3} className="page-container py-10" label="Loading rooms" />;
  if (!hotel.data) {
    return (
      <div className="page-container py-16">
        <EmptyState tone="error" title="We couldn’t load this property" description={errorMessage(hotel.error)} />
      </div>
    );
  }
  const h = hotel.data;
  const promoError = search.error instanceof ApiError && Array.isArray(search.error.details) && search.error.details.some((d) => d.path === 'promoCode');
  const results = search.data?.results ?? [];
  const visible = filter === 'all' ? results : results.filter((r) => r.roomType.id === filter);
  const bookableCount = results.filter((r) => r.bookable).length;

  return (
    <div className="page-container pb-16">
      <div className="flex items-center gap-2 pt-5 pb-4">
        <Link to={`/h/${h.slug}`} className="inline-flex items-center gap-1 text-label-md text-forest">
          <ArrowLeft className="size-4" aria-hidden /> {h.name}
        </Link>
      </div>

      <StaySearchBar
        key={stayQueryString(stay)}
        initial={stay}
        directDiscountPercent={h.policies.directDiscountPercent}
        submitLabel="Update"
        onSearch={(s) => setParams(new URLSearchParams(stayQueryString(s)), { replace: true })}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="results-title" aria-busy={search.isFetching}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 id="results-title" className="text-headline-md">
                Available rooms
              </h1>
              <p className="text-body-sm text-slate">
                {formatDay(stay.checkIn)} → {formatDay(stay.checkOut)} · {describeGuests(stay)}
              </p>
            </div>
            {search.data && (
              <p className="text-label-md text-terracotta">
                {bookableCount ? `${bookableCount} room type${bookableCount > 1 ? 's' : ''} available` : 'Fully booked for these dates'}
              </p>
            )}
          </div>

          {results.length > 1 && (
            <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Filter by room type">
              {[{ id: 'all', name: `All rooms (${results.length})` }, ...results.map((r) => ({ id: r.roomType.id, name: r.roomType.name }))].map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'shrink-0 rounded-full border px-4 py-2 text-label-md transition-colors',
                    filter === f.id ? 'border-forest bg-forest text-white' : 'border-line bg-white text-slate hover:border-forest',
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-5">
            {search.isLoading ? (
              <LoadingSkeleton variant="card" count={2} label="Checking live availability" />
            ) : search.error ? (
              <div className="card">
                <EmptyState
                  tone="error"
                  icon={<CalendarSearch className="size-6" />}
                  title={promoError ? 'That promo code isn’t valid' : 'We couldn’t check availability'}
                  description={errorMessage(search.error)}
                  action={
                    promoError ? (
                      <Button onClick={() => setParams(new URLSearchParams(stayQueryString({ ...stay, promoCode: '' })), { replace: true })}>
                        Search without the code
                      </Button>
                    ) : (
                      <Button onClick={() => void search.refetch()}>Try again</Button>
                    )
                  }
                />
              </div>
            ) : !results.length ? (
              <div className="card">
                <EmptyState
                  icon={<BedDouble className="size-6" />}
                  title="No rooms are listed yet"
                  description="Please message the hotel directly on WhatsApp."
                />
              </div>
            ) : (
              visible.map((r) => (
                <RoomCard
                  key={r.roomType.id}
                  result={r}
                  nights={search.data!.nights}
                  rooms={stay.rooms}
                  selectedPlanId={plans[r.roomType.id] ?? r.ratePlans[0]?.ratePlan?.id ?? null}
                  onSelectPlan={(id) => setPlans((p) => ({ ...p, [r.roomType.id]: id }))}
                  chatHref={
                    h.contact.whatsapp
                      ? whatsappLink(
                          h.contact.whatsapp,
                          `Namaste! A question about the ${r.roomType.name} for ${formatDay(stay.checkIn)}–${formatDay(stay.checkOut)}.`,
                        )
                      : undefined
                  }
                  onBook={(option) =>
                    navigate(
                      `/h/${h.slug}/book?${stayQueryString(stay, { roomTypeId: r.roomType.id, ...(option.ratePlan ? { ratePlanId: option.ratePlan.id } : {}) })}`,
                    )
                  }
                />
              ))
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start" aria-label="Why book direct">
          <div className="card p-5">
            <h2 className="text-headline-sm">Booking direct with {h.name}</h2>
            <ul className="mt-3 flex flex-col gap-3 text-body-sm text-slate">
              <li className="flex gap-2">
                <ShieldCheck className="size-4 shrink-0 text-emerald" aria-hidden />
                {h.policies.directDiscountPercent}% direct-booking saving is already included in every price shown.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="size-4 shrink-0 text-emerald" aria-hidden />
                GST is shown separately. No convenience fee on UPI.
              </li>
              {h.policies.freeCancellationHours > 0 && (
                <li className="flex gap-2">
                  <ShieldCheck className="size-4 shrink-0 text-emerald" aria-hidden />
                  Free cancellation up to {h.policies.freeCancellationHours} hours before check-in.
                </li>
              )}
              <li className="flex gap-2">
                <Wifi className="size-4 shrink-0 text-emerald" aria-hidden />
                Instant confirmation on WhatsApp.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
