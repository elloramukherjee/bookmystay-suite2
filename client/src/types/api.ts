export type StaffRole = 'super_admin' | 'owner' | 'manager' | 'front_desk';

export type Permission =
  | 'hotel.read'
  | 'hotel.update'
  | 'integrations.manage'
  | 'policies.manage'
  | 'staff.read'
  | 'staff.manage'
  | 'rooms.read'
  | 'rooms.manage'
  | 'rates.manage'
  | 'availability.manage'
  | 'bookings.read'
  | 'bookings.manage'
  | 'stays.manage'
  | 'guests.read'
  | 'guests.read_all'
  | 'guests.write'
  | 'finance.read'
  | 'conversations.read'
  | 'conversations.reply'
  | 'conversations.escalations'
  | 'campaigns.manage'
  | 'audit.read'
  | 'hotels.manage_all';

export interface User {
  id: string;
  hotelId: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface HotelSummary {
  id: string;
  name: string;
  slug: string;
  city: string;
  totalRooms: number;
  whatsapp: string | null;
  modules: { booking: boolean; receptionist: boolean; crm: boolean };
}

export interface MeResponse {
  user: User;
  permissions: Permission[];
  hotel: HotelSummary | null;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface HotelPhoto {
  url: string;
  alt: string;
  caption: string | null;
  isHero: boolean;
}

export interface HotelReview {
  author: string;
  city: string | null;
  rating: number;
  text: string;
  stayedAt: string | null;
  roomTypeName: string | null;
  source: 'direct' | 'google' | 'ota';
  savedPaise: number;
}

export interface PublicHotel {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  story: string;
  starRating: number;
  verified: boolean;
  address: {
    line1: string;
    line2: string;
    locality: string;
    city: string;
    state: string;
    pincode: string;
    geo: { lat: number | null; lng: number | null };
  };
  contact: { phone: string | null; whatsapp: string | null; email: string | null };
  totalRooms: number;
  checkInTime: string;
  checkOutTime: string;
  photos: HotelPhoto[];
  amenities: string[];
  highlights: { label: string; value: string }[];
  reviews: HotelReview[];
  rating: { average: number | null; count: number };
  modules: { booking: boolean; receptionist: boolean; crm: boolean };
  policies: { directDiscountPercent: number; freeCancellationHours: number };
  /** "pay_at_hotel": no online payment step; bookings are confirmed at once and paid at the property. */
  paymentMode: 'online' | 'pay_at_hotel';
}

export interface TaxSlab {
  upToPaise: number | null;
  ratePercent: number;
}

export interface HotelSettings extends PublicHotel {
  gstin: string | null;
  timezone: string;
  currency: string;
  status: 'active' | 'suspended';
  settings: {
    directDiscountPercent: number;
    otaCommissionRate: number;
    holdMinutes: number;
    freeCancellationHours: number;
    taxSlabs: TaxSlab[];
    promoCodes: { code: string; percentOff: number; active: boolean; validUntil: string | null }[];
  };
  integrations: {
    paymentProvider: string;
    smsProvider: string;
    whatsappPhoneNumberId: string | null;
    geminiConfigured: boolean;
    whatsappConfigured: boolean;
    paymentMode: string;
    smsMode: string;
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path: string; message: string }[] | Record<string, unknown>;
  requestId?: string;
}
