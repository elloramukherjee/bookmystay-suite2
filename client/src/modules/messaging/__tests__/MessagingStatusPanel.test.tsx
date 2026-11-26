import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../../App';
import { messagingService, type MessagingStatus } from '../../../services/messaging.service';
import { ManualFollowUpAlert } from '../ManualFollowUps';
import { MessagingStatusPanel } from '../MessagingStatusPanel';

vi.mock('../../../services/auth.service', () => ({ authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn() } }));
vi.mock('../../../services/messaging.service', () => ({ messagingService: { status: vi.fn() } }));

const base: MessagingStatus = {
  mode: 'simulator',
  phoneNumberId: null,
  linkedToProperty: null,
  hotelWhatsapp: '+919876543210',
  webhookPath: '/api/v1/webhooks/whatsapp',
  apiVersion: 'v21.0',
  lastInboundAt: null,
  lastOutboundAt: null,
  channels: [
    { channel: 'whatsapp', provider: 'Simulator (not sent)', live: false, sent: 0, simulated: 12, pending: 1, failed: 0 },
    { channel: 'sms', provider: 'Not set up (logged only, never sent)', live: false, sent: 0, simulated: 0, pending: 0, failed: 0 },
    { channel: 'email', provider: 'Not set up (logged only, never sent)', live: false, sent: 0, simulated: 0, pending: 0, failed: 0 },
  ],
  recentFailures: [],
  templates: [
    { template: 'booking_confirmed', metaTemplate: null },
    { template: 'checkin_welcome', metaTemplate: null },
  ],
  manualFollowUps: [],
};
const renderPanel = () =>
  render(
    <AppProviders queryClient={createQueryClient()}>
      <MessagingStatusPanel />
    </AppProviders>,
  );

beforeEach(() => vi.clearAllMocks());

describe('MessagingStatusPanel', () => {
  it('in simulator mode shows counts and the go-live checklist', async () => {
    vi.mocked(messagingService.status).mockResolvedValue(base);
    renderPanel();
    expect(await screen.findByText('Simulator mode')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /WhatsApp.*Simulator \(not sent\).*0.*12.*1.*0/ })).toBeInTheDocument();
    expect(screen.getByText('To go live on WhatsApp')).toBeInTheDocument();
    expect(screen.getByText(/\/api\/v1\/webhooks\/whatsapp/)).toBeInTheDocument();
  });

  it('in live mode shows the masked number and recent failures with the fallback used', async () => {
    vi.mocked(messagingService.status).mockResolvedValue({
      ...base,
      mode: 'live',
      phoneNumberId: '••••3210',
      linkedToProperty: true,
      recentFailures: [
        {
          channel: 'whatsapp',
          template: 'booking_confirmed',
          error: 'WhatsApp API 400 (code 131047): Re-engagement message',
          at: '2026-11-24T05:00:00.000Z',
          fellBackTo: 'sms',
          staffFollowUp: false,
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText('WhatsApp live')).toBeInTheDocument();
    expect(screen.getByText('••••3210')).toBeInTheDocument();
    expect(screen.getByText('Booking confirmation via WhatsApp')).toBeInTheDocument();
    expect(screen.getByText(/retried by SMS fallback/)).toBeInTheDocument();
    expect(screen.queryByText('To go live on WhatsApp')).not.toBeInTheDocument();
  });

  it('lists guests to call when no channel could deliver, and flags missing templates in live mode', async () => {
    vi.mocked(messagingService.status).mockResolvedValue({
      ...base,
      mode: 'live',
      phoneNumberId: '••••3210',
      linkedToProperty: true,
      templates: [
        { template: 'booking_confirmed', metaTemplate: 'bms_booking_confirmed' },
        { template: 'checkin_welcome', metaTemplate: null },
      ],
      manualFollowUps: [
        {
          id: 'n1',
          message: 'booking confirmation',
          phone: '+919811234567',
          email: null,
          guestName: 'Rajesh Kumar',
          bookingReference: 'BMS-ABC123',
          bookingId: 'b1',
          body: 'Namaste Rajesh! Your stay is confirmed.',
          reason: 'WhatsApp API 400 (code 131047)',
          at: '2026-11-24T05:00:00.000Z',
        },
      ],
    });
    renderPanel();
    expect(await screen.findByText('Guests to call (1)')).toBeInTheDocument();
    expect(screen.getByText('Rajesh Kumar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /98112 34567/ })).toHaveAttribute('href', 'tel:+919811234567');
    expect(screen.getByText(/No SMS or email service is set up/)).toBeInTheDocument();
    expect(screen.getByText(/1 message type has no approved WhatsApp template yet \(checkin welcome\)/)).toBeInTheDocument();
  });

  it('dashboard alert appears only when a guest needs a call', async () => {
    vi.mocked(messagingService.status).mockResolvedValue(base);
    const { unmount } = render(
      <AppProviders queryClient={createQueryClient()}>
        <ManualFollowUpAlert />
      </AppProviders>,
    );
    await waitFor(() => expect(messagingService.status).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: /to call/ })).not.toBeInTheDocument();
    unmount();

    vi.mocked(messagingService.status).mockResolvedValue({
      ...base,
      manualFollowUps: [
        {
          id: 'n1',
          message: 'check-in welcome',
          phone: '+919811234567',
          email: null,
          guestName: 'Rajesh Kumar',
          bookingReference: 'BMS-ABC123',
          bookingId: 'b1',
          body: 'Welcome',
          reason: 'x',
          at: '2026-11-24T05:00:00.000Z',
        },
      ],
    });
    render(
      <AppProviders queryClient={createQueryClient()}>
        <ManualFollowUpAlert />
      </AppProviders>,
    );
    expect(await screen.findByRole('region', { name: '1 guest to call' })).toHaveTextContent('Their check-in welcome couldn’t be delivered');
  });
});
