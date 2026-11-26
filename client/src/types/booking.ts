import type { HotelPhoto } from './api';

export interface RoomTypePublic {
  id: string;
  name: string;
  slug: string;
  description: string;
  sizeSqft: number | null;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedType: string;
  view: string;
  amenities: string[];
  photos: { url: string; alt: string }[];
  tags: string[];
  directPrivilege: string;
  baseRatePaise: number;
  otaRatePaise: number | null;
}

export interface BookingAmounts {
  nightly: { date: string; ratePaise: number }[];
  subtotalPaise: number;
  directDiscountPercent: number;
  directDiscountPaise: number;
  promoCode: string | null;
  promoDiscountPaise: number;
  taxablePaise: number;
  taxRatePercent: number | null;
  taxPaise: number;
  totalPaise: number;
  otaEquivalentPaise: number | null;
}

export interface RatePlanOption {
  ratePlan: { id: string; name: string; code: string; mealPlan: string; refundable: boolean } | null;
  quote: BookingAmounts;
}

export interface AvailabilityResult {
  roomType: RoomTypePublic;
  available: number;
  bookable: boolean;
  reason: string | null;
  ratePlans: RatePlanOption[];
}

export interface AvailabilitySearch {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  rooms: number;
  results: AvailabilityResult[];
}

export type BookingStatus = 'pending_payment' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'expired' | 'no_show';
export type BookingPaymentStatus = 'unpaid' | 'pending' | 'paid' | 'pay_at_hotel' | 'collected_by_ota' | 'refund_pending' | 'refunded' | 'provider_unavailable';
export type BookingSource = 'direct' | 'ota_mmt' | 'ota_goibibo' | 'ota_bookingcom' | 'ota_agoda' | 'ota_other' | 'walk_in' | 'phone';

export interface GuestBookingView {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  hotel: {
    id: string;
    name: string;
    slug: string;
    checkInTime: string;
    checkOutTime: string;
    timezone: string;
    address: { line1: string; locality: string; city: string; state: string; pincode: string };
    whatsapp: string | null;
    phone: string | null;
  };
  roomTypeId: string;
  roomTypeName: string;
  ratePlanName: string | null;
  quantity: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  source: BookingSource;
  guest: { name: string; phoneMasked: string; hasEmail: boolean };
  amounts: BookingAmounts;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  refundDuePaise: number;
  specialRequests: string | null;
  cancellation: { freeUntil: string; isFree: boolean; cancellable: boolean; freeCancellationHours: number };
  confirmationMessages: { channel: string; status: string; template: string; at: string }[];
  createdAt: string;
}

export interface StaffBookingView extends Omit<GuestBookingView, 'guest'> {
  guestId: string;
  guest: { name: string; phoneE164: string; email: string | null; isReturning: boolean; totalBookings: number };
  otaReference: string | null;
  roomNumber: string | null;
  inventoryState: 'held' | 'sold' | 'released';
  needsAttention: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
}

export interface BookingListItem {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  source: BookingSource;
  guestName: string;
  guestPhone: string;
  roomTypeName: string;
  quantity: number;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalPaise: number;
  needsAttention: string | null;
  holdExpiresAt: string | null;
  createdAt: string;
}

export interface BookingCreated {
  booking: GuestBookingView;
  guestToken: string;
  guestTokenExpiresIn: number;
}

export interface PaymentView {
  id: string;
  status: 'created' | 'pending' | 'captured' | 'failed' | 'refunded';
  method: 'upi' | 'card' | 'netbanking';
  provider: 'mock' | 'razorpay';
  amountPaise: number;
  failureReason: string | null;
  devMode: boolean;
  checkout: { kind: 'mock' | 'razorpay'; orderId: string; keyId?: string; upiIntent?: string } | null;
  booking: { id: string; reference: string; status: BookingStatus; paymentStatus: BookingPaymentStatus; holdExpiresAt: string | null };
}

export interface HotelPolicyView {
  type: string;
  title: string;
  body: string;
  published: boolean;
  updatedAt: string;
}

export interface HotelListItem {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  city: string;
  state: string;
  locality: string;
  verified: boolean;
  rating: { average: number | null; count: number };
  heroPhoto: HotelPhoto | null;
  fromRatePaise: number | null;
  directDiscountPercent: number;
}

export interface RoomUnit {
  id: string;
  number: string;
  floor: string;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'out_of_order';
  isActive: boolean;
}

export interface StaffRoomType extends RoomTypePublic {
  isActive: boolean;
  sortOrder: number;
  totalRooms: number;
  units: RoomUnit[];
  ratePlans: { id: string; name: string; code: string; mealPlan: string; adjustmentPaise: number }[];
}

export interface CalendarNight {
  date: string;
  totalRooms: number;
  sold: number;
  held: number;
  blocked: number;
  available: number;
  ratePaise: number;
  rateOverridden: boolean;
  stopSell: boolean;
  minStay: number;
}

export interface AvailabilityCalendar {
  from: string;
  days: number;
  dates: string[];
  rows: { roomType: { id: string; name: string; baseRatePaise: number; totalRooms: number }; nights: CalendarNight[] }[];
}
