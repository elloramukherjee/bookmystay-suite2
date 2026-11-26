import type { PageMeta } from '../types/api';
import type {
  AvailabilityCalendar,
  AvailabilitySearch,
  BookingCreated,
  BookingListItem,
  BookingSource,
  GuestBookingView,
  HotelListItem,
  HotelPolicyView,
  PaymentView,
  RoomTypePublic,
  StaffBookingView,
  StaffRoomType,
} from '../types/booking';
import { api, request } from './api';

/**
 * Guest tokens unlock exactly one booking for ~2 hours. They live in sessionStorage (per tab, gone when the
 * tab closes) so a guest can refresh the payment page on a flaky connection without starting over.
 */
const KEY = (bookingId: string) => `bms_guest_${bookingId}`;
export const guestTokens = {
  get(bookingId: string): string | null {
    try {
      return sessionStorage.getItem(KEY(bookingId));
    } catch {
      return null;
    }
  },
  set(bookingId: string, token: string) {
    try {
      sessionStorage.setItem(KEY(bookingId), token);
    } catch {
      /* storage blocked (private mode) — the guest can use "Find my booking" */
    }
  },
};
const guestHeaders = (bookingId: string) => {
  const token = guestTokens.get(bookingId);
  return token ? { 'X-Guest-Token': token } : {};
};

export interface SearchParams {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  promoCode?: string | undefined;
}

export interface CreateBookingInput {
  hotelId: string;
  roomTypeId: string;
  ratePlanId?: string | undefined;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  guest: { name: string; phone: string; email?: string | undefined };
  specialRequests?: string | undefined;
  promoCode?: string | undefined;
  consent: { transactional: true; marketing: boolean };
}

export const publicBookingService = {
  listHotels: () => request<HotelListItem[]>({ method: 'GET', url: '/hotels' }),
  roomTypes: (hotelId: string) => request<RoomTypePublic[]>({ method: 'GET', url: `/hotels/${hotelId}/rooms` }),
  policies: (slug: string) => request<HotelPolicyView[]>({ method: 'GET', url: `/hotels/${encodeURIComponent(slug)}/policies` }),
  search: (params: SearchParams) => request<AvailabilitySearch>({ method: 'GET', url: '/availability', params }),
  create: async (input: CreateBookingInput, idempotencyKey: string) => {
    const data = await request<BookingCreated>({ method: 'POST', url: '/bookings', data: input, headers: { 'Idempotency-Key': idempotencyKey } });
    guestTokens.set(data.booking.id, data.guestToken);
    return data;
  },
  get: (bookingId: string) => request<GuestBookingView>({ method: 'GET', url: `/bookings/${bookingId}`, headers: guestHeaders(bookingId) }),
  lookup: async (reference: string, phone: string) => {
    const data = await request<BookingCreated>({ method: 'POST', url: '/bookings/lookup', data: { reference, phone } });
    guestTokens.set(data.booking.id, data.guestToken);
    return data;
  },
  cancel: (bookingId: string, reason?: string) =>
    request<GuestBookingView>({ method: 'POST', url: `/bookings/${bookingId}/cancel`, data: { reason }, headers: guestHeaders(bookingId) }),
  createPayment: (bookingId: string, method: 'upi' | 'card' | 'netbanking') =>
    request<PaymentView>({ method: 'POST', url: '/payments/create', data: { bookingId, method }, headers: guestHeaders(bookingId) }),
  paymentStatus: (bookingId: string, paymentId: string) =>
    request<PaymentView>({ method: 'GET', url: `/payments/${paymentId}/status`, headers: guestHeaders(bookingId) }),
  /** ⚠️ Development mock only — the server does not register this route when a real gateway is configured. */
  simulatePayment: (bookingId: string, paymentId: string, outcome: 'success' | 'failure') =>
    request<{ result: { status: string }; payment: PaymentView }>({
      method: 'POST',
      url: `/payments/${paymentId}/simulate`,
      data: { outcome },
      headers: guestHeaders(bookingId),
    }),
};

export interface ManualBookingInput {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
  source: Exclude<BookingSource, 'direct'>;
  otaReference?: string | undefined;
  nightlyRatePaise?: number | undefined;
  guest: { name: string; phone: string; email?: string | undefined };
  specialRequests?: string | undefined;
  sendConfirmation: boolean;
}

export const staffBookingService = {
  list: async (params: Record<string, string | number | boolean | undefined>) => {
    const res = await api.get<{ data: BookingListItem[]; meta: PageMeta }>('/bookings', { params });
    return res.data;
  },
  get: (id: string) => request<StaffBookingView>({ method: 'GET', url: `/bookings/${id}` }),
  cancel: (id: string, reason?: string) => request<StaffBookingView>({ method: 'POST', url: `/bookings/${id}/cancel`, data: { reason } }),
  confirmPayAtHotel: (id: string) => request<StaffBookingView>({ method: 'POST', url: `/bookings/${id}/confirm` }),
  /** The guest never arrived: tonight and later nights go back on sale. */
  markNoShow: (id: string) => request<StaffBookingView>({ method: 'POST', url: `/bookings/${id}/no-show` }),
  createManual: (input: ManualBookingInput) => request<StaffBookingView>({ method: 'POST', url: '/bookings/manual', data: input }),
};

export interface RoomTypeInput {
  name: string;
  description?: string;
  sizeSqft?: number | null;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  bedType?: string;
  view?: string;
  amenities?: string[];
  photos?: { url: string; alt: string }[];
  tags?: string[];
  directPrivilege?: string;
  baseRatePaise: number;
  otaRatePaise?: number | null;
  unitNumbers?: string[];
  isActive?: boolean;
}

export const roomsService = {
  list: () => request<StaffRoomType[]>({ method: 'GET', url: '/rooms' }),
  create: (input: RoomTypeInput) => request<StaffRoomType>({ method: 'POST', url: '/rooms', data: input }),
  update: (id: string, input: Partial<RoomTypeInput>) => request<StaffRoomType>({ method: 'PUT', url: `/rooms/${id}`, data: input }),
  deactivate: (id: string) => api.delete(`/rooms/${id}`),
  addUnit: (roomTypeId: string, input: { number: string; floor?: string }) =>
    request<StaffRoomType['units'][number]>({ method: 'POST', url: `/rooms/${roomTypeId}/units`, data: input }),
  updateUnit: (unitId: string, input: Partial<{ number: string; floor: string; status: string; isActive: boolean }>) =>
    request<StaffRoomType['units'][number]>({ method: 'PATCH', url: `/rooms/units/${unitId}`, data: input }),
};

export interface BulkAvailabilityInput {
  roomTypeId: string;
  from: string;
  to: string;
  ratePaise?: number | null;
  stopSell?: boolean;
  blocked?: number;
  minStay?: number;
  weekdays?: number[];
}

export const inventoryService = {
  calendar: (from: string, days: number) => request<AvailabilityCalendar>({ method: 'GET', url: '/availability/calendar', params: { from, days } }),
  bulkUpdate: (input: BulkAvailabilityInput) => request<{ updatedNights: number; conflicts: string[] }>({ method: 'PUT', url: '/availability', data: input }),
};
