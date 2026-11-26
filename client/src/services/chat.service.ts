import type { PageMeta } from '../types/api';
import type { ChatMessageView, ConversationDetail, ConversationListItem, DeskStats, FaqView, GuestChatSession, ServiceRequestView } from '../types/chat';
import { api, request } from './api';
import { guestTokens } from './booking.service';

/** One anonymous web-chat session per hotel per tab (sessionStorage), so a refresh keeps the conversation. */
const chatKey = (hotelId: string) => `bms_chat_${hotelId}`;
export const chatSessions = {
  get(hotelId: string): string | null {
    try {
      return sessionStorage.getItem(chatKey(hotelId));
    } catch {
      return null;
    }
  },
  set(hotelId: string, token: string) {
    try {
      sessionStorage.setItem(chatKey(hotelId), token);
    } catch {
      /* storage blocked — the chat still works for this page view */
    }
  },
  clear(hotelId: string) {
    try {
      sessionStorage.removeItem(chatKey(hotelId));
    } catch {
      /* ignore */
    }
  },
};

export const guestChatService = {
  send: async (input: { hotelId: string; text: string; name?: string; phone?: string; consent?: boolean; bookingId?: string }) => {
    const token = chatSessions.get(input.hotelId);
    const bookingToken = input.bookingId ? guestTokens.get(input.bookingId) : null;
    const { bookingId: _ignored, ...body } = input;
    void _ignored;
    const data = await request<GuestChatSession>({
      method: 'POST',
      url: '/chatbot/message',
      data: token ? { hotelId: body.hotelId, text: body.text } : body,
      headers: { ...(token ? { 'X-Chat-Token': token } : {}), ...(bookingToken ? { 'X-Guest-Token': bookingToken } : {}) },
    });
    if (data.chatToken) chatSessions.set(input.hotelId, data.chatToken);
    return data;
  },
  session: (hotelId: string) => {
    const token = chatSessions.get(hotelId);
    return request<GuestChatSession>({ method: 'GET', url: '/chatbot/session', headers: token ? { 'X-Chat-Token': token } : {} });
  },
  verify: (hotelId: string, reference: string, phone: string) =>
    request<GuestChatSession>({
      method: 'POST',
      url: '/chatbot/verify',
      data: { reference, phone },
      headers: { 'X-Chat-Token': chatSessions.get(hotelId) ?? '' },
    }),
};

export const deskService = {
  stats: () => request<DeskStats>({ method: 'GET', url: '/chatbot/stats' }),
  list: async (params: { status?: string; channel?: string; q?: string; page?: number; limit?: number }) => {
    const res = await api.get<{ data: ConversationListItem[]; meta: PageMeta }>('/chatbot/conversations', { params });
    return res.data;
  },
  get: (id: string) => request<ConversationDetail>({ method: 'GET', url: `/chatbot/conversations/${id}` }),
  takeover: (id: string) => request<ConversationDetail>({ method: 'POST', url: `/chatbot/conversations/${id}/takeover` }),
  reply: (id: string, text: string, internal = false) =>
    request<ChatMessageView>({ method: 'POST', url: `/chatbot/conversations/${id}/reply`, data: { text, internal } }),
  resolve: (id: string, resumeAi: boolean, note?: string) =>
    request<ConversationDetail>({ method: 'POST', url: `/chatbot/conversations/${id}/resolve`, data: { resumeAi, note } }),
  simulate: (input: { phone: string; name?: string; text: string }) =>
    request<{ conversationId: string; aiReplied: boolean; escalated: boolean; status: string }>({ method: 'POST', url: '/chatbot/simulate', data: input }),
  serviceRequests: (status?: string) => request<ServiceRequestView[]>({ method: 'GET', url: '/chatbot/service-requests', params: status ? { status } : {} }),
  updateServiceRequest: (id: string, status: 'acknowledged' | 'done' | 'declined', message?: string) =>
    request<ServiceRequestView>({ method: 'PATCH', url: `/chatbot/service-requests/${id}`, data: { status, ...(message ? { message } : {}) } }),
};

export const faqService = {
  list: () => request<FaqView[]>({ method: 'GET', url: '/chatbot/faqs' }),
  create: (input: Omit<FaqView, 'id' | 'updatedAt'>) => request<FaqView>({ method: 'POST', url: '/chatbot/faqs', data: input }),
  update: (id: string, input: Partial<Omit<FaqView, 'id' | 'updatedAt'>>) => request<FaqView>({ method: 'PUT', url: `/chatbot/faqs/${id}`, data: input }),
  remove: (id: string) => api.delete(`/chatbot/faqs/${id}`),
};
