import { AlertTriangle, CalendarDays, Users } from 'lucide-react';
import type { BookingListItem } from '../types/booking';
import { formatDay } from '../utils/dates';
import { formatINR } from '../utils/format';
import { BookingStatusBadge, SourceBadge } from './BookingStatus';

/** Compact booking summary used on phones and in guest histories. */
export function BookingCard({ booking, onOpen }: { booking: BookingListItem; onOpen?: (b: BookingListItem) => void }) {
  const body = (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-label-lg text-ink">{booking.guestName}</p>
          <p className="num text-body-sm text-slate">{booking.reference}</p>
        </div>
        <BookingStatusBadge status={booking.status} />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-slate">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3.5 text-terracotta" aria-hidden />
          {formatDay(booking.checkIn)} → {formatDay(booking.checkOut)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden />
          {booking.adults + booking.children} · {booking.quantity}× {booking.roomTypeName}
        </span>
      </p>
      <div className="flex items-center justify-between gap-2">
        <SourceBadge source={booking.source} />
        <span className="num text-label-lg text-forest">{formatINR(booking.totalPaise)}</span>
      </div>
      {booking.needsAttention && (
        <p className="flex items-start gap-1.5 rounded-lg bg-danger-50 px-2.5 py-2 text-body-sm text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {booking.needsAttention}
        </p>
      )}
    </div>
  );
  return onOpen ? (
    <button type="button" onClick={() => onOpen(booking)} className="w-full rounded-lg focus-visible:outline-2">
      {body}
    </button>
  ) : (
    body
  );
}
