import type { BookingPaymentStatus, BookingSource, BookingStatus } from './booking';

export type ConversationStatus = 'ai_active' | 'escalated' | 'staff_active' | 'resolved';
export type MessageSender = 'guest' | 'ai' | 'staff' | 'system';
export type EscalationCategory =
  'complaint' | 'safety' | 'medical' | 'payment_dispute' | 'refund' | 'negative_sentiment' | 'unknown_fact' | 'guest_request' | 'ai_unavailable';

export interface ChatMessageView {
  id: string;
  sender: MessageSender;
  text: string;
  staffName: string | null;
  latencyMs: number | null;
  toolCalls: { name: string; ok: boolean; summary: string }[];
  visibleToGuest: boolean;
  deliveryStatus: string | null;
  createdAt: string;
}

export interface Escalation {
  category: EscalationCategory;
  reason: string;
  at: string;
  by: 'rule' | 'ai' | 'staff' | 'system';
  priority: 'urgent' | 'high' | 'normal';
}

export interface ConversationListItem {
  id: string;
  channel: 'web' | 'whatsapp' | 'simulator';
  status: ConversationStatus;
  guestName: string | null;
  guestPhoneMasked: string | null;
  roomNumber: string | null;
  bookingReference: string | null;
  isReturning: boolean;
  escalation: Escalation | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastSender: MessageSender;
  unreadForStaff: number;
  assignedTo: string | null;
}

export interface ServiceRequestView {
  id: string;
  shortId: string;
  type: string;
  details: string;
  status: 'open' | 'acknowledged' | 'done' | 'declined';
  roomNumber: string | null;
  conversationId: string | null;
  bookingId: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ConversationDetail {
  conversation: ConversationListItem;
  messages: ChatMessageView[];
  guest: {
    id: string;
    name: string | null;
    phoneE164: string;
    email: string | null;
    city: string | null;
    stats: {
      totalBookings: number;
      directBookings: number;
      otaBookings: number;
      completedStays: number;
      lifetimeValuePaise: number;
      commissionSavedPaise: number;
      firstStayAt: string | null;
      lastStayAt: string | null;
    };
    isReturning: boolean;
    tags: string[];
    notes: { text: string; category: string; createdAt: string }[];
  } | null;
  booking: {
    id: string;
    reference: string;
    roomTypeName: string;
    roomNumber: string | null;
    checkIn: string;
    checkOut: string;
    status: BookingStatus;
    source: BookingSource;
    paymentStatus: BookingPaymentStatus;
    totalPaise: number;
    adults: number;
    children: number;
  } | null;
  serviceRequests: ServiceRequestView[];
  aiConfigured: boolean;
}

export interface DeskStats {
  window: string;
  conversations: number;
  resolvedWithoutStaff: number;
  automatedResolutionRate: number | null;
  avgAiLatencyMs: number | null;
  aiRepliesUnder4sPercent: number | null;
  inFlight: { total: number; aiActive: number; staffActive: number };
  escalationQueue: { total: number; urgent: number };
  openServiceRequests: number;
  aiConfigured: boolean;
}

export interface GuestChatSession {
  chatToken?: string;
  conversationId: string;
  status: ConversationStatus;
  withStaff: boolean;
  verifiedBooking: { reference: string; checkIn: string; checkOut: string; roomTypeName: string } | null;
  messages: ChatMessageView[];
  aiAvailable: boolean;
}

export interface FaqView {
  id: string;
  question: string;
  answer: string;
  category: 'arrival' | 'amenities' | 'dining' | 'local' | 'policies' | 'services' | 'other';
  keywords: string[];
  published: boolean;
  updatedAt: string;
}
