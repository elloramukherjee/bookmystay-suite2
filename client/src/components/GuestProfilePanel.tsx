import { BedDouble, CalendarDays, MessageCircle, Phone, Star } from 'lucide-react';
import type { ConversationDetail } from '../types/chat';
import { formatDay } from '../utils/dates';
import { formatINR, formatPhone, initials, whatsappLink } from '../utils/format';
import { BookingStatusBadge, SourceBadge } from './BookingStatus';
import { StatusBadge } from './StatusBadge';

/**
 * The guest + stay context staff need so the guest never has to repeat themselves (PRD: "context handoff").
 */
export function GuestProfilePanel({
  guest,
  booking,
  fallbackName,
  compact,
}: {
  guest: ConversationDetail['guest'];
  booking: ConversationDetail['booking'];
  fallbackName?: string | null;
  compact?: boolean;
}) {
  const name = guest?.name ?? fallbackName ?? 'Unidentified guest';
  return (
    <section className="rounded-[var(--radius-card)] bg-forest-50 p-4" aria-label="Guest context">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white font-serif text-label-lg text-forest ring-1 ring-line">
            {initials(name)}
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 font-serif text-headline-sm text-forest">
              {name}
              {guest?.isReturning && (
                <StatusBadge tone="forest" icon={<Star className="size-3" aria-hidden />}>
                  Returning · {guest.stats.completedStays} stay{guest.stats.completedStays > 1 ? 's' : ''}
                </StatusBadge>
              )}
            </p>
            {guest ? (
              <p className="num flex items-center gap-1 text-body-sm text-slate">
                <Phone className="size-3.5" aria-hidden /> {formatPhone(guest.phoneE164)}
                {guest.city ? ` · ${guest.city}` : ''}
              </p>
            ) : (
              <p className="text-body-sm text-slate">Not linked to a guest profile yet (web visitor).</p>
            )}
          </div>
        </div>
        {guest && (
          <a
            href={whatsappLink(guest.phoneE164)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-label-md text-emerald ring-1 ring-line hover:ring-emerald"
          >
            <MessageCircle className="size-4" aria-hidden /> Call on WhatsApp
          </a>
        )}
      </div>

      {booking ? (
        <div className="mt-3 grid gap-2 rounded-lg bg-white p-3 text-body-sm sm:grid-cols-2">
          <p className="flex items-center gap-1.5">
            <BedDouble className="size-4 text-terracotta" aria-hidden />
            {booking.roomNumber ? <strong className="font-semibold">Room {booking.roomNumber}</strong> : null} {booking.roomTypeName}
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-4 text-terracotta" aria-hidden />
            {formatDay(booking.checkIn, { day: 'numeric', month: 'short' })} → {formatDay(booking.checkOut, { day: 'numeric', month: 'short' })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <BookingStatusBadge status={booking.status} />
            <SourceBadge source={booking.source} />
          </div>
          <p className="num text-slate">
            {booking.reference} · {formatINR(booking.totalPaise)}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-body-sm text-slate">No verified booking linked to this chat.</p>
      )}

      {!compact && guest && (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white p-2">
            <dt className="text-label-sm uppercase text-sage">Bookings</dt>
            <dd className="num text-label-lg text-forest">{guest.stats.totalBookings}</dd>
          </div>
          <div className="rounded-lg bg-white p-2">
            <dt className="text-label-sm uppercase text-sage">Direct</dt>
            <dd className="num text-label-lg text-forest">{guest.stats.directBookings}</dd>
          </div>
          <div className="rounded-lg bg-white p-2">
            <dt className="text-label-sm uppercase text-sage">Lifetime</dt>
            <dd className="num text-label-lg text-forest">{formatINR(guest.stats.lifetimeValuePaise)}</dd>
          </div>
        </dl>
      )}
      {!compact && guest && guest.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {guest.notes.map((n, i) => (
            <li key={i} className="rounded-lg bg-white px-3 py-2 text-body-sm text-slate">
              <span className="text-label-sm uppercase text-terracotta">{n.category}</span> · {n.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
