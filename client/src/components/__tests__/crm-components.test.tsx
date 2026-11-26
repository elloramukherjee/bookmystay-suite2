import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../App';
import { FollowUpPanel } from '../../modules/crm/FollowUpPanel';
import { QuickCheckInStation } from '../../modules/crm/QuickCheckInStation';
import { crmService } from '../../services/crm.service';
import { offlineQueue } from '../../services/offlineQueue';
import type { GuestLedgerItem, RosterItem, TodayRoster } from '../../types/crm';
import { GuestCard } from '../GuestCard';

vi.mock('../../services/auth.service', () => ({ authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn() } }));
vi.mock('../../services/crm.service', () => ({
  crmService: {
    today: vi.fn(),
    deskSearch: vi.fn(),
    availableRooms: vi.fn(),
    checkIn: vi.fn(),
    checkOut: vi.fn(),
    templates: vi.fn(),
    drafts: vi.fn(),
    markSent: vi.fn(),
    discard: vi.fn(),
  },
  guestService: {},
}));

function renderInApp(ui: ReactNode) {
  const router = createMemoryRouter([{ path: '/', element: ui }], { initialEntries: ['/'] });
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

const roster = (over: Partial<RosterItem>): RosterItem => ({
  bookingId: 'b1',
  reference: 'BMS-AAA111',
  guestId: 'g1',
  guestName: 'Arjun Mehta',
  guestPhone: '+919820244552',
  roomTypeId: 'rt1',
  roomTypeName: 'Deluxe Courtyard',
  roomNumber: null,
  quantity: 1,
  adults: 2,
  children: 0,
  checkIn: '2026-11-23',
  checkOut: '2026-11-25',
  nights: 2,
  status: 'confirmed',
  source: 'direct',
  paymentStatus: 'paid',
  totalPaise: 900000,
  specialRequests: null,
  tier: { label: 'Returning · 2 stays', level: 'returning' },
  isReturning: true,
  idVerified: false,
  ...over,
});

const todayFixture = (over: Partial<TodayRoster> = {}): TodayRoster => ({
  date: '2026-11-23',
  timezone: 'Asia/Kolkata',
  arrivals: [roster({})],
  inHouse: [],
  departuresDue: [roster({ bookingId: 'b2', guestName: 'Priya Nair', roomNumber: '104', paymentStatus: 'pay_at_hotel', status: 'checked_in' })],
  counts: { arrivalsPending: 1, checkInsToday: 0, checkOutsToday: 0, inHouseRooms: 1, totalRooms: 10, occupancyPercent: 10 },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(crmService.availableRooms).mockResolvedValue([{ id: 'r1', number: '101', floor: '1', status: 'available' }]);
});

describe('QuickCheckInStation', () => {
  it('lists today’s arrivals and checks a guest in with ID type and welcome message', async () => {
    vi.mocked(crmService.today).mockResolvedValue(todayFixture());
    vi.mocked(crmService.checkIn).mockResolvedValue(roster({ roomNumber: '101', status: 'checked_in' }));
    renderInApp(<QuickCheckInStation />);

    expect(await screen.findByText('Arjun Mehta')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Check in' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Check in Arjun Mehta' });
    await userEvent.click(within(dialog).getByLabelText('Photo ID checked for all adults'));
    const confirm = within(dialog).getByRole('button', { name: /Confirm check-in/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(crmService.checkIn).toHaveBeenCalledWith({ bookingId: 'b1', roomId: undefined, idVerified: true, idDocType: 'aadhaar', sendWelcome: true }),
    );
    expect(await screen.findByText(/is in room 101/)).toBeInTheDocument();
  });

  it('when the desk is offline, the check-in is saved on the device instead of failing', async () => {
    vi.mocked(crmService.today).mockResolvedValue(todayFixture());
    offlineQueue.reset();
    renderInApp(<QuickCheckInStation />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Check in' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Check in Arjun Mehta' });
    const confirm = within(dialog).getByRole('button', { name: /Confirm check-in/ });
    await waitFor(() => expect(confirm).toBeEnabled());

    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      await userEvent.click(confirm);
      expect(await screen.findByText(/will be checked in as soon as you’re back online/)).toBeInTheDocument();
      expect(crmService.checkIn).not.toHaveBeenCalled();
      expect(offlineQueue.getState().items).toMatchObject([{ label: 'Check in Arjun Mehta', action: { kind: 'checkIn', payload: { bookingId: 'b1' } } }]);
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      offlineQueue.reset();
    }
  });

  it('will not check out a pay-at-hotel guest until payment is marked collected', async () => {
    vi.mocked(crmService.today).mockResolvedValue(todayFixture({ arrivals: [] }));
    renderInApp(<QuickCheckInStation />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check out Priya Nair' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm check-out' });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeEnabled();
  });
});

describe('FollowUpPanel', () => {
  it('prepares consent-gated drafts and lets staff mark each one sent', async () => {
    vi.mocked(crmService.templates).mockResolvedValue([
      {
        id: 't1',
        name: 'Thank you for staying',
        purpose: 'thank_you',
        body: 'Thank you {{firstName}}',
        promoCode: null,
        metaTemplateName: null,
        metaApproved: false,
        isActive: true,
      },
      {
        id: 't2',
        name: 'Long weekend getaway',
        purpose: 'festival_offer',
        body: 'Use {{code}}',
        promoCode: 'DIRECTSTAY',
        metaTemplateName: null,
        metaApproved: false,
        isActive: true,
      },
    ]);
    vi.mocked(crmService.drafts).mockResolvedValue({
      template: { id: 't2' },
      drafted: 1,
      excludedNoConsent: 2,
      drafts: [{ id: 'd1', guestId: 'g1', guestName: 'Arjun Mehta', phoneE164: '+919820244552', text: 'Hi Arjun, use DIRECTSTAY', status: 'draft' }],
    } as never);
    vi.mocked(crmService.markSent).mockResolvedValue({ id: 'd1', status: 'sent_personally' });
    renderInApp(<FollowUpPanel />);

    await userEvent.click(await screen.findByRole('radio', { name: /Long weekend getaway/ }));
    await userEvent.selectOptions(screen.getByLabelText('Send to'), 'ota_only');
    await userEvent.click(screen.getByRole('button', { name: 'Prepare messages' }));

    expect(crmService.drafts).toHaveBeenCalledWith({ templateId: 't2', audience: 'ota_only' });
    const dialog = await screen.findByRole('dialog', { name: '1 personal message ready' });
    expect(dialog).toHaveTextContent('2 guests were skipped — no marketing consent.');
    expect(within(dialog).getByRole('link')).toHaveAttribute('href', expect.stringContaining('wa.me/919820244552'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark sent' }));
    expect(await within(dialog).findByText('Sent')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done (1/1)' })).toBeInTheDocument();
  });
});

describe('GuestCard', () => {
  const guest: GuestLedgerItem = {
    id: 'g1',
    name: 'Devendra Patel',
    phoneE164: '+919724533219',
    email: null,
    city: 'Ahmedabad',
    tier: { label: 'Regular · 3 stays', level: 'regular' },
    isReturning: true,
    origin: 'MakeMyTrip',
    stayPath: 'MakeMyTrip → Direct ×2',
    stats: {
      totalBookings: 3,
      directBookings: 2,
      otaBookings: 1,
      completedStays: 3,
      lifetimeValuePaise: 2400000,
      commissionSavedPaise: 360000,
      firstStayAt: null,
      lastStayAt: null,
    },
    keyPreference: 'Ground floor room',
    marketingConsent: true,
    inHouse: { bookingId: 'b9', roomNumber: '102', checkOut: '2026-11-25' },
    nextStay: null,
  };

  it('shows tier, journey and in-house room, and hides money unless allowed', () => {
    const { rerender } = render(
      <AppProviders queryClient={createQueryClient()}>
        <RouterProvider router={createMemoryRouter([{ path: '/', element: <GuestCard guest={guest} /> }])} />
      </AppProviders>,
    );
    expect(screen.getByText('Regular · 3 stays')).toBeInTheDocument();
    expect(screen.getByText('MakeMyTrip → Direct ×2')).toBeInTheDocument();
    expect(screen.getByText('In-house · 102')).toBeInTheDocument();
    expect(screen.queryByText(/in commission/)).not.toBeInTheDocument();
    rerender(
      <AppProviders queryClient={createQueryClient()}>
        <RouterProvider router={createMemoryRouter([{ path: '/', element: <GuestCard guest={guest} showMoney /> }])} />
      </AppProviders>,
    );
    expect(screen.getByText(/Saved .*3,600 in commission/)).toBeInTheDocument();
  });
});
