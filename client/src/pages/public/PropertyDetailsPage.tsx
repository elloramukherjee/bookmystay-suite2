import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CalendarCheck2, Check, Clock3, MapPin, MessageCircle, Minus, Percent, RefreshCw, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ImageWithFallback } from '../../components/ImageWithFallback';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { usePublicHotel } from '../../hooks/usePublicHotel';
import { usePolicies } from '../../modules/booking/hooks';
import { StaySearchBar } from '../../modules/booking/StaySearchBar';
import { stayQueryString, useStayParams } from '../../modules/booking/useStayParams';
import { ApiError } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';
import type { PublicHotel } from '../../types/api';
import { formatINR, formatTime, initials, whatsappLink } from '../../utils/format';

function RatingChip({ hotel }: { hotel: PublicHotel }) {
  if (!hotel.rating.count) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-parchment-alt px-3 py-1.5 text-label-md text-forest">
      <Star className="size-3.5 fill-terracotta text-terracotta" aria-hidden />
      <span className="num">{hotel.rating.average?.toFixed(1)} / 5</span>
      <span className="text-slate">· {hotel.rating.count} direct guest reviews</span>
    </span>
  );
}

function Hero({ hotel }: { hotel: PublicHotel }) {
  const hero = hotel.photos.find((p) => p.isHero) ?? hotel.photos[0];
  return (
    <section className="page-container grid gap-6 pt-6 lg:grid-cols-[1.45fr_1fr] lg:pt-10">
      <div className="card-elevated flex flex-col gap-5 p-6 lg:p-10">
        <div className="flex flex-wrap items-center gap-2">
          <RatingChip hotel={hotel} />
          {hotel.verified && (
            <StatusBadge tone="trust" icon={<BadgeCheck className="size-3.5 text-emerald" aria-hidden />}>
              Verified property
            </StatusBadge>
          )}
          {hotel.address.locality && (
            <span className="inline-flex items-center gap-1 text-label-sm uppercase text-terracotta">
              <MapPin className="size-3.5" aria-hidden /> {hotel.address.locality}
            </span>
          )}
        </div>
        <div>
          <p className="eyebrow mb-2">{hotel.name}</p>
          <h1 className="text-display-sm lg:text-display-lg">{hotel.tagline || hotel.name}</h1>
        </div>
        {hotel.story && <p className="max-w-2xl text-body-lg text-slate">{hotel.story}</p>}
        {hotel.highlights.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
            {hotel.highlights.map((h) => (
              <div key={h.label}>
                <dt className="text-label-sm uppercase text-sage">{h.label}</dt>
                <dd className="mt-1 text-label-lg text-forest">{h.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {hero && (
          <figure className="relative overflow-hidden rounded-[var(--radius-card)] shadow-ambient">
            <ImageWithFallback
              src={hero.url}
              alt={hero.alt}
              className="aspect-[4/3] w-full object-cover lg:aspect-[5/4]"
              fetchPriority="high"
              loading="eager"
            />
            {hero.caption && (
              <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-forest-deep/85 to-transparent p-5 pt-16">
                <p className="font-serif text-headline-sm text-white">{hero.caption}</p>
                <p className="text-body-sm text-forest-100">
                  {hotel.address.city}, {hotel.address.state}
                </p>
              </figcaption>
            )}
          </figure>
        )}
        <div className="card flex items-start gap-3 p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-terracotta-50 text-terracotta">
            <Percent className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-label-lg text-forest">Book direct, save {hotel.policies.directDiscountPercent}%</p>
            <p className="text-body-sm text-slate">The direct-booking discount is applied automatically. No platform mark-ups, no convenience fees on UPI.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function StayEssentials({ hotel }: { hotel: PublicHotel }) {
  const items = [
    { icon: CalendarCheck2, label: 'Check-in', value: `From ${formatTime(hotel.checkInTime)}` },
    { icon: Clock3, label: 'Check-out', value: `By ${formatTime(hotel.checkOutTime)}` },
    {
      icon: RefreshCw,
      label: 'Cancellation',
      value: hotel.policies.freeCancellationHours > 0 ? `Free up to ${hotel.policies.freeCancellationHours}h before check-in` : 'See booking terms',
    },
    { icon: ShieldCheck, label: 'Pricing', value: 'GST shown separately, before you pay' },
  ];
  return (
    <section aria-labelledby="essentials" className="page-container mt-8">
      <h2 id="essentials" className="sr-only">
        Stay essentials
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, label, value }) => (
          <li key={label} className="card flex items-center gap-3 p-4">
            <Icon className="size-5 shrink-0 text-terracotta" aria-hidden />
            <div>
              <p className="text-label-sm uppercase text-sage">{label}</p>
              <p className="text-label-lg text-forest">{value}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Gallery({ hotel }: { hotel: PublicHotel }) {
  const photos = hotel.photos.filter((p) => !p.isHero).slice(0, 5);
  if (!photos.length) return null;
  return (
    <section aria-labelledby="gallery" className="page-container mt-14">
      <p className="eyebrow text-terracotta">Real photos, taken at the property</p>
      <h2 id="gallery" className="mt-1 text-headline-md lg:text-headline-lg">
        Inside {hotel.name}
      </h2>
      <div className="scrollbar-none mt-6 -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-4 md:grid-rows-2 md:overflow-visible md:px-0">
        {photos.map((p, i) => (
          <figure
            key={p.url}
            className={`relative w-[78%] shrink-0 snap-start overflow-hidden rounded-[var(--radius-card)] md:w-auto ${i === 0 ? 'md:col-span-2 md:row-span-2' : ''}`}
          >
            <ImageWithFallback src={p.url} alt={p.alt} className="aspect-[16/10] h-full w-full object-cover md:aspect-auto" />
            {p.caption && (
              <figcaption className="absolute bottom-2 left-2 rounded-full bg-white/90 px-3 py-1 text-label-md text-forest backdrop-blur">
                {p.caption}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}

function Amenities({ hotel }: { hotel: PublicHotel }) {
  if (!hotel.amenities.length) return null;
  return (
    <section aria-labelledby="amenities" className="page-container mt-14">
      <h2 id="amenities" className="text-headline-md">
        What’s included
      </h2>
      <ul className="mt-5 flex flex-wrap gap-2">
        {hotel.amenities.map((a) => (
          <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-label-md text-forest">
            <Sparkles className="size-3.5 text-terracotta" aria-hidden />
            {a}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Stitch "Why booking direct is superior" table — but only with facts we actually hold: the owner's own
 * direct vs typical OTA tariff for the entry room, and the hotel's own policies. No claims about OTAs'
 * terms that we can't verify.
 */
function DirectComparison({ hotel }: { hotel: PublicHotel }) {
  const { data: rooms } = useQuery({ queryKey: ['room-types', hotel.id], queryFn: () => publicBookingService.roomTypes(hotel.id), staleTime: 5 * 60_000 });
  const entry = rooms?.find((r) => r.otaRatePaise) ?? rooms?.[0];
  if (!entry) return null;
  const direct = Math.round(entry.baseRatePaise * (1 - hotel.policies.directDiscountPercent / 100));
  const rows: { label: string; direct: React.ReactNode; ota: React.ReactNode }[] = [
    {
      label: `Room tariff per night (${entry.name})`,
      direct: <span className="num font-semibold text-forest">{formatINR(direct)}</span>,
      ota: entry.otaRatePaise ? <span className="num">{formatINR(entry.otaRatePaise)}</span> : '—',
    },
    {
      label: 'Direct-booking privilege',
      direct: entry.directPrivilege || 'Best available rate',
      ota: <Minus className="mx-auto size-4 text-sage" aria-label="Not included" />,
    },
    { label: 'Convenience fee on UPI', direct: <span className="text-emerald">₹0</span>, ota: 'As per platform' },
    { label: 'Talk to the hotel directly', direct: 'WhatsApp the host anytime', ota: 'Via platform support' },
    {
      label: 'Free cancellation',
      direct: hotel.policies.freeCancellationHours ? `Up to ${hotel.policies.freeCancellationHours}h before check-in` : 'See policy',
      ota: 'As per listing',
    },
  ];
  return (
    <section aria-labelledby="compare" className="page-container mt-14">
      <p className="eyebrow text-center text-terracotta">Transparent value</p>
      <h2 id="compare" className="mt-1 text-center text-headline-md lg:text-headline-lg">
        Why booking direct is better
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-center text-body-md text-slate">
        Travel platforms charge hotels a commission on every booking. When you book here, that saving comes back to you.
      </p>
      <div className="card mt-6 overflow-hidden">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr>
              <th scope="col" className="bg-parchment-alt px-4 py-3 font-sans text-label-md text-slate">
                <span className="sr-only">Benefit</span>
              </th>
              <th scope="col" className="bg-forest px-4 py-3 text-center font-sans text-label-md text-white">
                Book direct
              </th>
              <th scope="col" className="bg-parchment-alt px-4 py-3 text-center font-sans text-label-md text-slate">
                Typical OTA listing
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className="px-4 py-3 font-sans font-normal text-slate">
                  {r.label}
                </th>
                <td className="bg-forest-50/60 px-4 py-3 text-center text-ink">
                  <span className="inline-flex items-center gap-1">
                    <Check className="size-3.5 text-emerald" aria-hidden /> {r.direct}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-slate">{r.ota}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Policies({ slug }: { slug: string }) {
  const { data } = usePolicies(slug);
  if (!data?.length) return null;
  const order = ['cancellation', 'checkin', 'id_proof', 'children', 'parking', 'pets', 'smoking', 'payment'];
  const sorted = [...data].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return (
    <section aria-labelledby="policies" className="page-container mt-14">
      <h2 id="policies" className="text-headline-md">
        Good to know
      </h2>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {sorted.map((p) => (
          <details key={p.type} className="card group p-4" open={p.type === 'cancellation'}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-label-lg text-forest">
              {p.title}
              <span className="text-sage transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-2 text-body-sm text-slate">{p.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Reviews({ hotel }: { hotel: PublicHotel }) {
  if (!hotel.reviews.length) return null;
  return (
    <section aria-labelledby="reviews" className="page-container mt-14">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-terracotta">Unfiltered guest experiences</p>
          <h2 id="reviews" className="mt-1 text-headline-md lg:text-headline-lg">
            Honest words from direct bookers
          </h2>
        </div>
        {hotel.rating.average !== null && (
          <p className="flex items-center gap-1 text-label-lg text-forest">
            <span className="num">{hotel.rating.average.toFixed(1)}</span>
            <span className="flex" aria-label={`${hotel.rating.average} out of 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  className={`size-4 ${i < Math.round(hotel.rating.average!) ? 'fill-terracotta text-terracotta' : 'text-line-strong'}`}
                  aria-hidden
                />
              ))}
            </span>
          </p>
        )}
      </div>
      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {hotel.reviews.map((r) => (
          <li key={`${r.author}-${r.text.slice(0, 12)}`} className="card flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-forest-50 text-label-md text-forest">{initials(r.author)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-lg text-ink">{r.author}</p>
                <p className="text-body-sm text-slate">
                  {[r.city, r.stayedAt && `Stayed ${new Date(`${r.stayedAt}-01`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              </div>
              {r.source === 'direct' && <StatusBadge tone="success">Direct guest</StatusBadge>}
            </div>
            <blockquote className="font-serif text-body-md text-ink italic">“{r.text}”</blockquote>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-body-sm">
              <span className="text-slate">{r.roomTypeName}</span>
              {r.savedPaise > 0 && <span className="num font-semibold text-terracotta">Saved {formatINR(r.savedPaise)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Contact({ hotel }: { hotel: PublicHotel }) {
  const address = [
    hotel.address.line1,
    hotel.address.line2,
    hotel.address.locality,
    `${hotel.address.city} ${hotel.address.pincode}`.trim(),
    hotel.address.state,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <section aria-labelledby="contact" className="page-container mt-14 mb-16">
      <div className="flex flex-col gap-6 rounded-[var(--radius-card)] bg-forest p-6 text-white md:flex-row md:items-center md:justify-between lg:p-10">
        <div>
          <h2 id="contact" className="text-headline-md text-white">
            Questions before you book?
          </h2>
          <p className="mt-2 max-w-xl text-body-md text-forest-100">{address}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to={`/h/${hotel.slug}/chat`}>
            <Button
              variant="secondary"
              size="lg"
              icon={<Sparkles className="size-5" aria-hidden />}
              tabIndex={-1}
              className="border-white bg-transparent text-white hover:bg-white/10"
            >
              Ask our AI concierge
            </Button>
          </Link>
          {hotel.contact.whatsapp && (
            <a href={whatsappLink(hotel.contact.whatsapp, `Namaste! I'd like to know more about ${hotel.name}.`)} target="_blank" rel="noreferrer">
              <Button variant="whatsapp" size="lg" icon={<MessageCircle className="size-5" aria-hidden />} tabIndex={-1}>
                Chat with Host on WhatsApp
              </Button>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

export function PropertyDetailsPage() {
  const { data: hotel, isLoading, error, refetch } = usePublicHotel();
  const stay = useStayParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (hotel) document.title = `${hotel.name} · Book direct`;
  }, [hotel]);

  if (isLoading) {
    return (
      <div className="page-container py-10">
        <LoadingSkeleton variant="hero" label="Loading hotel" />
      </div>
    );
  }
  if (error || !hotel) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page-container py-16">
        <EmptyState
          tone={notFound ? 'default' : 'error'}
          icon={<MapPin className="size-6" />}
          title={notFound ? 'We couldn’t find this property' : 'This page didn’t load'}
          description={notFound ? 'The link may be outdated. Please check with the hotel.' : 'Your connection may be slow. Please try again.'}
          action={!notFound && <Button onClick={() => void refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <>
      <Hero hotel={hotel} />
      <section aria-label="Check availability" className="page-container mt-6">
        <StaySearchBar
          initial={stay}
          directDiscountPercent={hotel.policies.directDiscountPercent}
          onSearch={(s) => navigate(`/h/${hotel.slug}/rooms?${stayQueryString(s)}`)}
        />
      </section>
      <StayEssentials hotel={hotel} />
      <Gallery hotel={hotel} />
      <Amenities hotel={hotel} />
      <DirectComparison hotel={hotel} />
      <Reviews hotel={hotel} />
      <Policies slug={hotel.slug} />
      <Contact hotel={hotel} />
    </>
  );
}
