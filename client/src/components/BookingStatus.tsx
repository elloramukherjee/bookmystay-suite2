import type { BookingPaymentStatus, BookingSource, BookingStatus } from '../types/booking';
import { StatusBadge, type BadgeTone } from './StatusBadge';

const STATUS: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  pending_payment: { label: 'Awaiting payment', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  checked_in: { label: 'In-house', tone: 'forest' },
  checked_out: { label: 'Checked out', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  expired: { label: 'Expired', tone: 'neutral' },
  no_show: { label: 'No-show', tone: 'danger' },
};

const PAYMENT: Record<BookingPaymentStatus, { label: string; tone: BadgeTone }> = {
  unpaid: { label: 'Unpaid', tone: 'neutral' },
  pending: { label: 'Payment started', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  pay_at_hotel: { label: 'Pay at hotel', tone: 'info' },
  collected_by_ota: { label: 'Paid to OTA', tone: 'info' },
  refund_pending: { label: 'Refund due', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  provider_unavailable: { label: 'Gateway down', tone: 'danger' },
};

export const SOURCE_LABELS: Record<BookingSource, string> = {
  direct: 'Direct',
  ota_mmt: 'MakeMyTrip',
  ota_goibibo: 'Goibibo',
  ota_bookingcom: 'Booking.com',
  ota_agoda: 'Agoda',
  ota_other: 'Other OTA',
  walk_in: 'Walk-in',
  phone: 'Phone',
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status];
  return (
    <StatusBadge tone={s.tone} dot>
      {s.label}
    </StatusBadge>
  );
}

export function PaymentStatusBadge({ status }: { status: BookingPaymentStatus }) {
  const s = PAYMENT[status];
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

export function SourceBadge({ source }: { source: BookingSource }) {
  return <StatusBadge tone={source === 'direct' ? 'success' : source.startsWith('ota_') ? 'accent' : 'neutral'}>{SOURCE_LABELS[source]}</StatusBadge>;
}
