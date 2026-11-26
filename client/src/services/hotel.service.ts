import type { HotelSettings, PageMeta, PublicHotel, StaffRole, User } from '../types/api';
import { api, request } from './api';

export type HotelUpdate = Partial<{
  name: string;
  tagline: string;
  story: string;
  checkInTime: string;
  checkOutTime: string;
  contact: { phone?: string | null; whatsapp?: string | null; email?: string | null };
  address: Partial<{ line1: string; line2: string; locality: string; city: string; state: string; pincode: string }>;
  gstin: string | null;
  settings: Partial<{ directDiscountPercent: number; otaCommissionRate: number; holdMinutes: number; freeCancellationHours: number }>;
}>;

export const hotelService = {
  getPublic: (slug: string) => request<PublicHotel>({ method: 'GET', url: `/hotels/${encodeURIComponent(slug)}` }),
  getSettings: (hotelId: string) => request<HotelSettings>({ method: 'GET', url: `/hotels/${hotelId}/settings` }),
  update: (hotelId: string, input: HotelUpdate) => request<HotelSettings>({ method: 'PUT', url: `/hotels/${hotelId}`, data: input }),
};

export const usersService = {
  list: async (params: { page?: number; limit?: number; q?: string; role?: StaffRole }) => {
    const res = await api.get<{ data: User[]; meta: PageMeta }>('/users', { params });
    return res.data;
  },
  update: (id: string, input: Partial<{ name: string; role: StaffRole; isActive: boolean }>) =>
    request<{ user: User }>({ method: 'PATCH', url: `/users/${id}`, data: input }),
  /** Owner sets a new password for a staff member who forgot theirs; their sessions end immediately. */
  resetPassword: (id: string, newPassword: string) => api.put(`/users/${id}/password`, { newPassword }),
};
