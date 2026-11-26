import type { BookingPaymentStatus, BookingSource, BookingStatus } from './booking';

export interface GuestTier {
  label: string;
  level: 'new' | 'returning' | 'regular';
}

export interface GuestStats {
  totalBookings: number;
  directBookings: number;
  otaBookings: number;
  completedStays: number;
  lifetimeValuePaise: number;
  commissionSavedPaise: number;
  firstStayAt: string | null;
  lastStayAt: string | null;
}

export interface GuestLedgerItem {
  id: string;
  name: string | null;
  phoneE164: string;
  email: string | null;
  city: string | null;
  tier: GuestTier;
  isReturning: boolean;
  origin: string;
  stayPath: string;
  stats: GuestStats;
  keyPreference: string | null;
  marketingConsent: boolean;
  inHouse: { bookingId: string; roomNumber: string | null; checkOut: string } | null;
  nextStay: { bookingId: string; checkIn: string; roomTypeName: string; reference: string } | null;
}

export interface GuestProfile extends GuestLedgerItem {
  tags: string[];
  notes: { id: string; text: string; category: 'room' | 'fnb' | 'general'; createdAt: string }[];
  preferences: { id: string; category: string; key: string; value: string; source: string }[];
  consent: {
    transactional: { granted: boolean; at: string | null; source: string | null };
    marketing: { granted: boolean; at: string | null; source: string | null; withdrawnAt: string | null };
  };
  idVerification: { verified: boolean; docType: string | null; verifiedAt: string | null };
  createdAt: string;
}

export interface TimelineEvent {
  kind: 'booking' | 'stay' | 'cancellation' | 'conversation' | 'escalation' | 'request' | 'note' | 'follow_up';
  at: string;
  title: string;
  detail: string | null;
  refId: string | null;
}

export interface RosterItem {
  bookingId: string;
  reference: string;
  guestId: string;
  guestName: string;
  guestPhone: string;
  roomTypeId: string;
  roomTypeName: string;
  roomNumber: string | null;
  quantity: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  status: BookingStatus;
  source: BookingSource;
  paymentStatus: BookingPaymentStatus;
  totalPaise: number;
  specialRequests: string | null;
  tier: GuestTier;
  isReturning: boolean;
  idVerified: boolean;
}

export interface RosterCounts {
  arrivalsPending: number;
  checkInsToday: number;
  checkOutsToday: number;
  inHouseRooms: number;
  totalRooms: number;
  occupancyPercent: number;
}

export interface TodayRoster {
  date: string;
  timezone: string;
  arrivals: RosterItem[];
  inHouse: RosterItem[];
  departuresDue: RosterItem[];
  counts: RosterCounts;
}

export type DashboardPeriod = 'mtd' | '30d' | '90d' | 'ytd' | 'all';

export interface Dashboard {
  period: DashboardPeriod;
  from: string;
  to: string;
  asOf: string;
  otaCommissionRate: number;
  stays: {
    total: number;
    roomNights: number;
    direct: number;
    ota: number;
    other: number;
    directSharePercent: number | null;
    otaSharePercent: number | null;
    channelMix: { source: BookingSource; label: string; count: number; revenuePaise: number | null; percent: number | null }[];
  };
  revenue: {
    roomRevenuePaise: number | null;
    grossRevenuePaise: number | null;
    directRevenuePaise: number | null;
    otaRevenuePaise: number | null;
    directRevenueSharePercent: number | null;
    commissionSavedPaise: number | null;
    commissionPaidEstimatePaise: number | null;
    next7DaysOnBooksPaise: number | null;
  };
  guests: { distinct: number; returning: number; repeatGuestPercent: number | null };
  occupancyPercent: number | null;
  today: RosterCounts;
  contacts: { total: number; marketingConsent: number; withEmail: number };
  funnel: { otaGuests: number; contactCaptured: number; marketingConsent: number; followedUp: number; convertedToDirect: number };
  financeVisible: boolean;
}

export interface MessageTemplateView {
  id: string;
  name: string;
  purpose: 'thank_you' | 'festival_offer' | 'reunion' | 'feedback' | 'other';
  body: string;
  promoCode: string | null;
  metaTemplateName: string | null;
  metaApproved: boolean;
  isActive: boolean;
}

export interface FollowUpDraft {
  id: string;
  guestId: string;
  guestName: string | null;
  phoneE164: string;
  text: string;
  status: 'draft' | 'sent_personally' | 'sent_api' | 'discarded';
}

export type Audience = 'returning' | 'ota_converts' | 'ota_only' | 'all_consented' | 'selected';
