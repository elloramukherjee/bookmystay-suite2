import type { PageMeta } from '../types/api';
import type {
  Audience,
  Dashboard,
  DashboardPeriod,
  FollowUpDraft,
  GuestLedgerItem,
  GuestProfile,
  MessageTemplateView,
  RosterItem,
  TimelineEvent,
  TodayRoster,
} from '../types/crm';
import { api, request } from './api';

export type GuestFilter = 'all' | 'returning' | 'direct' | 'ota' | 'ota_converts' | 'in_house' | 'marketing';

export const crmService = {
  dashboard: (period: DashboardPeriod) => request<Dashboard>({ method: 'GET', url: '/crm/dashboard', params: { period } }),
  today: () => request<TodayRoster>({ method: 'GET', url: '/crm/today' }),
  deskSearch: (q: string) => request<RosterItem[]>({ method: 'GET', url: '/crm/desk-search', params: { q } }),
  availableRooms: (roomTypeId: string) =>
    request<{ id: string; number: string; floor: string; status: string }[]>({ method: 'GET', url: '/crm/available-rooms', params: { roomTypeId } }),
  checkIn: (input: { bookingId: string; roomId?: string; idVerified: boolean; idDocType?: string; sendWelcome: boolean }) =>
    request<RosterItem>({ method: 'POST', url: '/crm/check-in', data: input }),
  checkOut: (input: { bookingId: string; paymentCollected: boolean }) => request<RosterItem>({ method: 'POST', url: '/crm/check-out', data: input }),
  history: (guestId: string) => request<{ guestId: string; events: TimelineEvent[] }>({ method: 'GET', url: `/crm/guests/${guestId}/history` }),
  templates: () => request<MessageTemplateView[]>({ method: 'GET', url: '/crm/templates' }),
  drafts: (input: { templateId: string; audience: Audience; guestIds?: string[] }) =>
    request<{ template: MessageTemplateView; drafted: number; excludedNoConsent: number; drafts: FollowUpDraft[] }>({
      method: 'POST',
      url: '/crm/drafts',
      data: input,
    }),
  markSent: (id: string) => request<{ id: string; status: string }>({ method: 'POST', url: `/crm/drafts/${id}/sent` }),
  discard: (id: string) => request<{ id: string; status: string }>({ method: 'POST', url: `/crm/drafts/${id}/discard` }),
};

export const guestService = {
  list: async (params: { q?: string; filter?: GuestFilter; page?: number; limit?: number }) => {
    const res = await api.get<{ data: GuestLedgerItem[]; meta: PageMeta }>('/guests', { params });
    return res.data;
  },
  get: (id: string) => request<GuestProfile>({ method: 'GET', url: `/guests/${id}` }),
  create: (input: { phone: string; name?: string; email?: string; city?: string; marketingConsent?: boolean }) =>
    request<GuestProfile>({ method: 'POST', url: '/guests', data: input }),
  update: (id: string, input: Partial<{ name: string; email: string | null; city: string | null; tags: string[]; marketingConsent: boolean }>) =>
    request<GuestProfile>({ method: 'PUT', url: `/guests/${id}`, data: input }),
  addNote: (id: string, text: string, category: 'room' | 'fnb' | 'general') =>
    request<GuestProfile>({ method: 'POST', url: `/guests/${id}/notes`, data: { text, category } }),
  setPreference: (id: string, input: { category: string; key: string; value: string }) =>
    request<GuestProfile>({ method: 'PUT', url: `/guests/${id}/preferences`, data: input }),
  deletePreference: (id: string, prefId: string) => request<GuestProfile>({ method: 'DELETE', url: `/guests/${id}/preferences/${prefId}` }),
};
