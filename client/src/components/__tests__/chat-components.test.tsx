import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../App';
import { authService } from '../../services/auth.service';
import { deskService } from '../../services/chat.service';
import { meFixture } from '../../test/fixtures';
import type { ChatMessageView, ConversationDetail } from '../../types/chat';
import { ChatMessage } from '../ChatMessage';
import { ChatWindow } from '../ChatWindow';
import { StaffTakeoverPanel } from '../StaffTakeoverPanel';

vi.mock('../../services/auth.service', () => ({ authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn() } }));
vi.mock('../../services/chat.service', async (orig) => {
  const actual = await orig<typeof import('../../services/chat.service')>();
  return { ...actual, deskService: { get: vi.fn(), takeover: vi.fn(), reply: vi.fn(), resolve: vi.fn(), updateServiceRequest: vi.fn() } };
});

const msg = (over: Partial<ChatMessageView>): ChatMessageView => ({
  id: Math.random().toString(36),
  sender: 'guest',
  text: 'Hello',
  staffName: null,
  latencyMs: null,
  toolCalls: [],
  visibleToGuest: true,
  deliveryStatus: null,
  createdAt: '2026-11-24T05:00:00.000Z',
  ...over,
});

describe('ChatMessage', () => {
  it('labels AI replies with latency for staff and hides it from guests', () => {
    const m = msg({ sender: 'ai', text: 'Breakfast is 7:30–10:30', latencyMs: 2100, toolCalls: [{ name: 'check', ok: true, summary: 'Checked dates' }] });
    const { rerender } = render(<ChatMessage message={m} perspective="staff" />);
    expect(screen.getByText('(2.1s)')).toBeInTheDocument();
    expect(screen.getByText('Checked dates')).toBeInTheDocument();
    rerender(<ChatMessage message={m} perspective="guest" />);
    expect(screen.queryByText('(2.1s)')).not.toBeInTheDocument();
    expect(screen.queryByText('Checked dates')).not.toBeInTheDocument();
  });

  it('marks internal staff notes', () => {
    render(<ChatMessage message={msg({ sender: 'staff', staffName: 'Meera R', text: 'Refund approved', visibleToGuest: false })} perspective="staff" />);
    expect(screen.getByText(/Internal note/)).toBeInTheDocument();
  });
});

describe('ChatWindow', () => {
  it('sends on Enter and via quick prompts, and clears the draft', async () => {
    const onSend = vi.fn();
    render(<ChatWindow messages={[]} perspective="guest" onSend={onSend} quickPrompts={['Wi-Fi details']} />);
    await userEvent.type(screen.getByLabelText('Message'), 'Is parking free?{Enter}');
    expect(onSend).toHaveBeenCalledWith('Is parking free?');
    expect(screen.getByLabelText('Message')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Wi-Fi details' }));
    expect(onSend).toHaveBeenCalledWith('Wi-Fi details');
  });
});

const escalated: ConversationDetail = {
  conversation: {
    id: 'c1',
    channel: 'whatsapp',
    status: 'escalated',
    guestName: 'Rajesh Kumar',
    guestPhoneMasked: '+91•••••34567',
    roomNumber: '108',
    bookingReference: 'BMS-AB12CD',
    isReturning: true,
    escalation: { category: 'complaint', reason: 'Guest complaint', at: '2026-11-24T05:00:00.000Z', by: 'rule', priority: 'high' },
    lastMessageAt: '2026-11-24T05:00:00.000Z',
    lastMessagePreview: 'AC not cooling',
    lastSender: 'guest',
    unreadForStaff: 1,
    assignedTo: null,
  },
  messages: [msg({ text: 'The AC is not cooling' })],
  guest: {
    id: 'g1',
    name: 'Rajesh Kumar',
    phoneE164: '+919811234567',
    email: null,
    city: 'Gurugram',
    stats: {
      totalBookings: 2,
      directBookings: 2,
      otaBookings: 0,
      completedStays: 1,
      lifetimeValuePaise: 1_800_000,
      commissionSavedPaise: 0,
      firstStayAt: null,
      lastStayAt: null,
    },
    isReturning: true,
    tags: [],
    notes: [],
  },
  booking: {
    id: 'b1',
    reference: 'BMS-AB12CD',
    roomTypeName: 'Deluxe Courtyard Suite',
    roomNumber: '108',
    checkIn: '2026-11-24',
    checkOut: '2026-11-27',
    status: 'checked_in',
    source: 'direct',
    paymentStatus: 'paid',
    totalPaise: 1_360_800,
    adults: 2,
    children: 1,
  },
  serviceRequests: [],
  aiConfigured: true,
};

async function renderPanelAs(role: 'owner' | 'front_desk') {
  vi.mocked(authService.login).mockResolvedValue({ accessToken: 't', expiresIn: 900, user: meFixture(role).user });
  vi.mocked(authService.me).mockResolvedValue(meFixture(role));
  vi.mocked(deskService.get).mockResolvedValue(escalated);
  const router = createMemoryRouter(
    [
      { path: '/', element: <LoginTrigger /> },
      { path: '/panel', element: <StaffTakeoverPanel conversationId="c1" /> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'login' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/panel'));
}

import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router';
function LoginTrigger() {
  const { login } = useAuth();
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void login('x@test.example', 'pw').then(() => navigate('/panel'))}>
      login
    </button>
  );
}

describe('StaffTakeoverPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the paused-autopilot alert and guest context, and lets a manager take over', async () => {
    await renderPanelAs('owner');
    expect(await screen.findByText(/AI autopilot paused for room 108/)).toBeInTheDocument();
    expect(screen.getByText(/Trigger: Complaint/)).toBeInTheDocument();
    expect(screen.getByText(/Returning · 1 stay/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Take over chat/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('front desk can read an escalated chat but not answer it', async () => {
    await renderPanelAs('front_desk');
    expect(await screen.findByText(/handled by a manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take over chat/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });
});
