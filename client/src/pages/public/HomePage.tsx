import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, MapPin, Search, Star } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ImageWithFallback } from '../../components/ImageWithFallback';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { errorMessage } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';
import { formatINR } from '../../utils/format';

/** Suite landing ("Find a stay that feels like yours" — Stitch bookmystay.html) listing live properties. */
export function HomePage() {
  const hotels = useQuery({ queryKey: ['hotels', 'public'], queryFn: publicBookingService.listHotels, staleTime: 5 * 60_000 });
  const hero = hotels.data?.[0]?.heroPhoto;

  useEffect(() => {
    document.title = 'BookMyStay — Book direct with independent hotels';
  }, []);

  return (
    <>
      <section className="relative overflow-hidden">
        {hero && (
          <ImageWithFallback src={hero.url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" loading="eager" fetchPriority="high" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-forest-deep/90 via-forest/70 to-forest/30" aria-hidden />
        <div className="page-container relative py-16 lg:py-28">
          <p className="eyebrow text-forest-200">A place to settle in</p>
          <h1 className="mt-3 max-w-2xl text-display-sm text-white lg:text-display-lg">Find a stay that feels like yours.</h1>
          <p className="mt-4 max-w-xl text-body-lg text-forest-100">
            Independent havelis, retreats and city homes. Book directly with the people who run them, with transparent GST pricing and no platform mark-up.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#collection">
              <Button size="lg" variant="accent" icon={<Search className="size-4" aria-hidden />} tabIndex={-1}>
                Explore stays
              </Button>
            </a>
            <Link
              to="/my-booking"
              className="inline-flex h-12 items-center rounded-full border-[1.5px] border-white/70 px-6 text-label-lg text-white hover:bg-white/10"
            >
              Find my booking
            </Link>
          </div>
        </div>
      </section>

      <section id="collection" aria-labelledby="collection-title" className="page-container py-14">
        <p className="eyebrow text-terracotta">The collection</p>
        <h2 id="collection-title" className="mt-1 text-headline-md lg:text-headline-lg">
          Stay a little longer.
        </h2>

        <div className="mt-8">
          {hotels.isLoading ? (
            <LoadingSkeleton variant="card" count={3} label="Loading stays" />
          ) : hotels.error ? (
            <div className="card">
              <EmptyState
                tone="error"
                title="Stays didn’t load"
                description={errorMessage(hotels.error)}
                action={<Button onClick={() => void hotels.refetch()}>Try again</Button>}
              />
            </div>
          ) : !hotels.data?.length ? (
            <div className="card">
              <EmptyState title="No properties are taking bookings yet" description="Please check back soon." />
            </div>
          ) : (
            <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {hotels.data.map((h) => (
                <li key={h.id}>
                  <Link to={`/h/${h.slug}`} className="card group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-ambient">
                    <div className="relative">
                      {h.heroPhoto ? (
                        <ImageWithFallback
                          src={h.heroPhoto.url}
                          alt={h.heroPhoto.alt}
                          className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="aspect-[16/10] bg-forest-50" />
                      )}
                      {h.directDiscountPercent > 0 && (
                        <StatusBadge tone="accent" className="absolute top-3 right-3">
                          {h.directDiscountPercent}% off direct
                        </StatusBadge>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        {h.verified && (
                          <StatusBadge tone="trust" icon={<BadgeCheck className="size-3 text-emerald" aria-hidden />}>
                            Verified
                          </StatusBadge>
                        )}
                        {h.rating.average !== null && (
                          <span className="inline-flex items-center gap-1 text-label-md text-forest">
                            <Star className="size-3.5 fill-terracotta text-terracotta" aria-hidden />
                            <span className="num">{h.rating.average.toFixed(1)}</span>
                            <span className="text-slate">({h.rating.count})</span>
                          </span>
                        )}
                      </div>
                      <h3 className="text-headline-sm">{h.name}</h3>
                      <p className="flex items-center gap-1 text-body-sm text-slate">
                        <MapPin className="size-3.5 text-terracotta" aria-hidden />
                        {[h.locality, h.city].filter(Boolean).join(', ')}
                      </p>
                      <p className="text-body-sm text-slate">{h.tagline}</p>
                      <div className="mt-auto flex items-center justify-between border-t border-line pt-3">
                        <p className="text-body-sm text-slate">
                          {h.fromRatePaise ? (
                            <>
                              From <span className="num text-label-lg text-forest">{formatINR(h.fromRatePaise)}</span> / night
                            </>
                          ) : (
                            'See rates'
                          )}
                        </p>
                        <ArrowRight className="size-4 text-forest transition-transform group-hover:translate-x-1" aria-hidden />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
