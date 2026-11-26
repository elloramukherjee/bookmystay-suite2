import { BedDouble, CalendarDays, MessageCircle, Star } from 'lucide-react';
import { Link } from 'react-router';
import type { GuestLedgerItem } from '../types/crm';
import { formatDay } from '../utils/dates';
import { cn, formatINR, formatPhone, initials, whatsappLink } from '../utils/format';
import { StatusBadge } from './StatusBadge';

export function TierBadge({ tier }: { tier: GuestLedgerItem['tier'] }) {
  return (
    <StatusBadge
      tone={tier.level === 'regular' ? 'accent' : tier.level === 'returning' ? 'forest' : 'neutral'}
      icon={tier.level !== 'new' ? <Star className="size-3" aria-hidden /> : undefined}
    >
      {tier.label}
    </StatusBadge>
  );
}

/** Compact guest summary for phones and side lists (Stitch ledger row, stacked). */
export function GuestCard({ guest, showMoney }: { guest: GuestLedgerItem; showMoney?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/app/guests/${guest.id}`} className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full text-label-md',
              guest.isReturning ? 'bg-forest text-white' : 'bg-forest-50 text-forest',
            )}
          >
            {initials(guest.name ?? '?')}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-label-lg text-ink">{guest.name ?? 'Unnamed guest'}</span>
            <span className="num block text-body-sm text-slate">
              {formatPhone(guest.phoneE164)}
              {guest.city ? ` · ${guest.city}` : ''}
            </span>
          </span>
        </Link>
        <a
          href={whatsappLink(guest.phoneE164)}
          target="_blank"
          rel="noreferrer"
          className="rounded-full p-2 text-emerald hover:bg-emerald-50"
          aria-label={`WhatsApp ${guest.name ?? 'guest'}`}
        >
          <MessageCircle className="size-5" />
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TierBadge tier={guest.tier} />
        <StatusBadge tone="neutral">{guest.origin}</StatusBadge>
        {guest.inHouse && (
          <StatusBadge tone="success" icon={<BedDouble className="size-3" aria-hidden />}>
            In-house{guest.inHouse.roomNumber ? ` · ${guest.inHouse.roomNumber}` : ''}
          </StatusBadge>
        )}
      </div>
      {guest.stayPath && <p className="text-body-sm text-slate">{guest.stayPath}</p>}
      {guest.nextStay && (
        <p className="flex items-center gap-1 text-body-sm text-forest">
          <CalendarDays className="size-3.5 text-terracotta" aria-hidden /> Next: {formatDay(guest.nextStay.checkIn)} · {guest.nextStay.roomTypeName}
        </p>
      )}
      {guest.keyPreference && <p className="line-clamp-1 text-body-sm text-slate">“{guest.keyPreference}”</p>}
      {showMoney && guest.stats.commissionSavedPaise > 0 && (
        <p className="num text-label-md text-terracotta">Saved {formatINR(guest.stats.commissionSavedPaise)} in commission</p>
      )}
    </div>
  );
}
