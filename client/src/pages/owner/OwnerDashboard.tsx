import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BedDouble, Contact, IndianRupee, Plane, Repeat, Send, ShieldCheck, Smartphone, TrendingUp, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { StatCard } from '../../components/StatCard';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { FollowUpPanel } from '../../modules/crm/FollowUpPanel';
import { QuickCheckInStation } from '../../modules/crm/QuickCheckInStation';
import { ManualFollowUpAlert } from '../../modules/messaging/ManualFollowUps';
import { errorMessage } from '../../services/api';
import { crmService } from '../../services/crm.service';
import type { Dashboard, DashboardPeriod } from '../../types/crm';
import { formatDay } from '../../utils/dates';
import { cn, formatINR } from '../../utils/format';

const PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: 'mtd', label: 'This month' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'ytd', label: 'This year' },
  { key: 'all', label: 'All time' },
];

/** Channel colours: direct = forest, OTAs = terracotta shades, other = sage (Stitch direct-share bar). */
const CHANNEL_COLOR: Record<string, string> = {
  direct: 'bg-forest',
  ota_mmt: 'bg-terracotta',
  ota_bookingcom: 'bg-terracotta-deep',
  ota_agoda: 'bg-[#e8946f]',
  ota_goibibo: 'bg-[#d97a52]',
  ota_other: 'bg-[#f0b79b]',
  walk_in: 'bg-sage',
  phone: 'bg-line-strong',
};

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function ChannelBar({ d }: { d: Dashboard }) {
  if (!d.stays.total) return <div className="h-2.5 rounded-full bg-parchment-alt" aria-label="No stays in this period" />;
  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-parchment-alt"
        role="img"
        aria-label={d.stays.channelMix.map((c) => `${c.label} ${c.percent}%`).join(', ')}
      >
        {d.stays.channelMix.map((c) => (
          <span key={c.source} className={cn('h-full', CHANNEL_COLOR[c.source] ?? 'bg-sage')} style={{ width: `${c.percent ?? 0}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-label-sm text-slate">
        {d.stays.channelMix.map((c) => (
          <li key={c.source} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full', CHANNEL_COLOR[c.source] ?? 'bg-sage')} aria-hidden />
            {c.label} <span className="num">({c.percent}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Funnel({ d }: { d: Dashboard }) {
  const steps = [
    { icon: Plane, label: 'Booked via an OTA', value: d.funnel.otaGuests, note: 'Guests who first came through MakeMyTrip, Booking.com…' },
    { icon: Smartphone, label: 'Contact captured', value: d.funnel.contactCaptured, note: 'Phone number on file — every guest record has one' },
    { icon: Send, label: 'Opted in & followed up', value: d.funnel.followedUp, note: `${d.funnel.marketingConsent} agreed to hear from you` },
    { icon: Repeat, label: 'Came back direct', value: d.funnel.convertedToDirect, note: 'Booked at least once on your own website' },
  ];
  return (
    <section className="card p-5 lg:p-6" aria-labelledby="funnel-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="funnel-title" className="text-headline-sm">
          OTA → direct guest journey
        </h2>
        <p className="text-body-sm text-slate">All time</p>
      </div>
      <p className="text-body-sm text-slate">How guests who first found you on travel sites become your own direct guests.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cn('flex flex-col gap-1 rounded-[var(--radius-card)] p-4', i === steps.length - 1 ? 'bg-forest text-white' : 'bg-forest-50')}
          >
            <div className="flex items-center justify-between">
              <span className={cn('text-label-sm uppercase', i === steps.length - 1 ? 'text-forest-200' : 'text-sage')}>Step {i + 1}</span>
              <s.icon className={cn('size-4', i === steps.length - 1 ? 'text-forest-200' : 'text-terracotta')} aria-hidden />
            </div>
            <p className={cn('font-serif text-label-lg', i === steps.length - 1 ? 'text-white' : 'text-forest')}>{s.label}</p>
            <p className="num text-[28px] font-bold leading-9">{s.value}</p>
            <p className={cn('text-body-sm', i === steps.length - 1 ? 'text-forest-100' : 'text-slate')}>{s.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Stitch screen 3 "Guest CRM & Performance Desk". Every number comes from /crm/dashboard (MongoDB).
 * Revenue figures appear only for roles with finance access; everyone gets today's operations.
 */
export function OwnerDashboard() {
  const { user, hotel, can } = useAuth();
  const [period, setPeriod] = useState<DashboardPeriod>('mtd');
  const dash = useQuery({ queryKey: ['crm-dashboard', period], queryFn: () => crmService.dashboard(period), refetchInterval: 60_000 });
  const d = dash.data;

  return (
    <>
      <section className="card mb-6 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
        <div>
          <p className="eyebrow text-terracotta">
            {hotel?.name} · {hotel?.city}
          </p>
          <h1 className="text-headline-md lg:text-headline-lg">
            {greeting()}, {user?.name.split(' ')[0]}
          </h1>
          <p className="text-body-sm text-slate">
            {d ? `As of ${formatDay(d.asOf, { weekday: 'long', day: 'numeric', month: 'long' })}` : 'Your property at a glance'}
          </p>
        </div>
        {d && (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-forest-50 px-4 py-2 text-label-md text-forest">
              <BedDouble className="size-4" aria-hidden />
              <span className="num">{d.today.checkInsToday}</span> check-ins · <span className="num">{d.today.checkOutsToday}</span> check-outs today
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-forest-50 px-4 py-2 text-label-md text-forest">
              <span className="size-2 rounded-full bg-emerald" aria-hidden />
              <span className="num">{d.today.inHouseRooms}</span> of <span className="num">{d.today.totalRooms}</span> rooms occupied (
              <span className="num">{d.today.occupancyPercent}%</span>)
            </span>
          </div>
        )}
      </section>

      {can('hotel.read') && <ManualFollowUpAlert className="mb-6" />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-headline-sm">Performance</h2>
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-label-md',
                period === p.key ? 'border-forest bg-forest text-white' : 'border-line bg-white text-slate',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {dash.isLoading ? (
        <LoadingSkeleton variant="stats" count={4} label="Loading performance" />
      ) : dash.error || !d ? (
        <div className="card">
          <EmptyState
            tone="error"
            title="Couldn’t load your numbers"
            description={errorMessage(dash.error)}
            action={<Button onClick={() => void dash.refetch()}>Try again</Button>}
          />
        </div>
      ) : (
        <div className={cn('flex flex-col gap-6', dash.isFetching && 'opacity-80')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d.financeVisible ? (
              <StatCard
                label="Commission saved"
                value={formatINR(d.revenue.commissionSavedPaise ?? 0)}
                icon={<IndianRupee className="size-5" />}
                description={`At a ${d.otaCommissionRate}% OTA commission on ${formatINR(d.revenue.directRevenuePaise ?? 0)} of direct room revenue`}
                footer={
                  d.revenue.commissionPaidEstimatePaise ? (
                    <span className="text-slate">
                      OTA stays this period cost about <span className="num text-terracotta">{formatINR(d.revenue.commissionPaidEstimatePaise)}</span>
                    </span>
                  ) : (
                    <span className="text-emerald">No OTA commission this period</span>
                  )
                }
              />
            ) : (
              <StatCard
                label="Stays"
                value={d.stays.total}
                unit="bookings"
                icon={<BedDouble className="size-5" />}
                description={`${d.stays.roomNights} room-nights in this period`}
              />
            )}
            <StatCard
              label="Direct booking share"
              value={d.stays.directSharePercent !== null ? `${d.stays.directSharePercent}%` : '—'}
              unit="of stays"
              icon={<TrendingUp className="size-5" />}
              description={<ChannelBar d={d} />}
            />
            <StatCard
              label="Returning guests"
              value={d.guests.repeatGuestPercent !== null ? `${d.guests.repeatGuestPercent}%` : '—'}
              unit={d.guests.distinct ? `${d.guests.returning} of ${d.guests.distinct} guests` : undefined}
              icon={<Users className="size-5" />}
              description="Guests in this period who had stayed or booked with you before"
            />
            <StatCard
              label="Your guest register"
              value={d.contacts.total}
              unit="contacts"
              icon={<Contact className="size-5" />}
              description={`${d.contacts.marketingConsent} agreed to hear from you · ${d.contacts.withEmail} with email`}
              footer={
                <span className="inline-flex items-center gap-1 text-slate">
                  <ShieldCheck className="size-3.5 text-emerald" aria-hidden /> Owned by you, not the OTA
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Stays" value={d.stays.total} unit={`${d.stays.direct} direct · ${d.stays.ota} OTA`} />
            <StatCard label="Occupancy" value={d.occupancyPercent !== null ? `${d.occupancyPercent}%` : '—'} unit="room-nights sold" />
            {d.financeVisible && <StatCard label="Room revenue" value={formatINR(d.revenue.roomRevenuePaise ?? 0)} unit="excl. GST" />}
            {d.financeVisible && <StatCard label="Next 7 days on the books" value={formatINR(d.revenue.next7DaysOnBooksPaise ?? 0)} unit="room revenue" />}
            {!d.financeVisible && <StatCard label="Check-ins today" value={d.today.checkInsToday} />}
            {!d.financeVisible && <StatCard label="Check-outs today" value={d.today.checkOutsToday} />}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {can('stays.manage') && <QuickCheckInStation />}
            {can('campaigns.manage') ? (
              <FollowUpPanel marketingContacts={d.contacts.marketingConsent} />
            ) : (
              <section className="card flex flex-col justify-between gap-3 p-5">
                <div>
                  <h2 className="text-headline-sm">Guests</h2>
                  <p className="text-body-sm text-slate">Profiles, preferences and stay history for everyone staying around now.</p>
                </div>
                <Link to="/app/guests" className="inline-flex items-center gap-1 text-label-lg text-forest">
                  Open guest register <ArrowRight className="size-4" aria-hidden />
                </Link>
              </section>
            )}
          </div>

          {d.financeVisible && <Funnel d={d} />}
          {!d.financeVisible && (
            <p className="flex items-center gap-2 text-body-sm text-slate">
              <StatusBadge tone="neutral">Note</StatusBadge> Revenue figures are visible to the owner.
            </p>
          )}
        </div>
      )}
    </>
  );
}
