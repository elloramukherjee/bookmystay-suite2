import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../App';
import { ApiError } from '../../services/api';
import { authService } from '../../services/auth.service';
import { crmService, guestService } from '../../services/crm.service';
import type { Dashboard } from '../../types/crm';
import { hotelService, usersService } from '../../services/hotel.service';
import { meFixture, settingsFixture } from '../../test/fixtures';
import { routes } from '../router';

vi.mock('../../services/auth.service', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn() },
}));
vi.mock('../../services/crm.service', () => ({
  crmService: { dashboard: vi.fn(() => new Promise(() => {})), today: vi.fn(() => new Promise(() => {})), templates: vi.fn().mockResolvedValue([]) },
  guestService: { list: vi.fn() },
}));
vi.mock('../../services/hotel.service', () => ({
  hotelService: { getPublic: vi.fn(), getSettings: vi.fn(), update: vi.fn() },
  usersService: { list: vi.fn(), update: vi.fn() },
}));

const dashboardFixture = (finance: boolean): Dashboard => ({
  period: 'mtd',
  from: '2026-11-01',
  to: '2026-11-23',
  asOf: '2026-11-23',
  otaCommissionRate: 18,
  stays: {
    total: 10,
    roomNights: 24,
    direct: 6,
    ota: 4,
    other: 0,
    directSharePercent: 60,
    otaSharePercent: 40,
    channelMix: [
      { source: 'direct', label: 'Direct', count: 6, revenuePaise: finance ? 5000000 : null, percent: 60 },
      { source: 'ota_mmt', label: 'MakeMyTrip', count: 4, revenuePaise: finance ? 3000000 : null, percent: 40 },
    ],
  },
  revenue: {
    roomRevenuePaise: finance ? 8000000 : null,
    grossRevenuePaise: finance ? 8960000 : null,
    directRevenuePaise: finance ? 5000000 : null,
    otaRevenuePaise: finance ? 3000000 : null,
    directRevenueSharePercent: finance ? 62.5 : null,
    commissionSavedPaise: finance ? 900000 : null,
    commissionPaidEstimatePaise: finance ? 540000 : null,
    next7DaysOnBooksPaise: finance ? 1200000 : null,
  },
  guests: { distinct: 9, returning: 3, repeatGuestPercent: 33 },
  occupancyPercent: 41,
  today: { arrivalsPending: 2, checkInsToday: 1, checkOutsToday: 1, inHouseRooms: 4, totalRooms: 10, occupancyPercent: 40 },
  contacts: { total: 42, marketingConsent: 17, withEmail: 30 },
  funnel: { otaGuests: 20, contactCaptured: 20, marketingConsent: 8, followedUp: 5, convertedToDirect: 3 },
  financeVisible: finance,
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(hotelService.getSettings).mockResolvedValue(settingsFixture);
  vi.mocked(usersService.list).mockResolvedValue({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } });
});

describe('staff area protection', () => {
  it('redirects anonymous visitors from /app to the login page', async () => {
    const router = renderAt('/app/staff');
    expect(await screen.findByRole('heading', { name: 'Staff sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('validates the login form before calling the API', async () => {
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('shows the server error message on bad credentials', async () => {
    vi.mocked(authService.login).mockRejectedValue(new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'));
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@test.example');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
  });

  it('signs in and returns the user to the page they wanted', async () => {
    vi.mocked(authService.login).mockResolvedValue({ accessToken: 't', expiresIn: 900, user: meFixture('owner').user });
    vi.mocked(authService.me).mockResolvedValue(meFixture('owner'));
    const router = renderAt('/app/staff');

    await userEvent.type(await screen.findByLabelText('Email'), 'owner@test.example');
    await userEvent.type(screen.getByLabelText('Password'), 'Courtyard2024');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app/staff'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Staff' })).toBeInTheDocument();
  });
});

describe('role-based navigation', () => {
  async function signInAs(role: 'owner' | 'front_desk', path = '/app') {
    vi.mocked(authService.login).mockResolvedValue({ accessToken: 't', expiresIn: 900, user: meFixture(role).user });
    vi.mocked(authService.me).mockResolvedValue(meFixture(role));
    const router = renderAt(path);
    await userEvent.type(await screen.findByLabelText('Email'), `${role}@test.example`);
    await userEvent.type(screen.getByLabelText('Password'), 'Courtyard2024');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    return router;
  }

  it('owners see staff management and settings in the sidebar', async () => {
    await signInAs('owner');
    const sidebar = await screen.findByRole('complementary', { name: 'Sections' });
    expect(sidebar).toHaveTextContent('Staff');
    expect(sidebar).toHaveTextContent('Hotel Settings');
    expect(sidebar).toHaveTextContent('Rates & Availability');
  });

  it('front desk does not see staff or rates, and is blocked from the staff page', async () => {
    await signInAs('front_desk', '/app/staff');
    expect(await screen.findByText("This section isn't available for your role")).toBeInTheDocument();
    const sidebar = screen.getByRole('complementary', { name: 'Sections' });
    expect(sidebar).not.toHaveTextContent('Staff');
    expect(sidebar).not.toHaveTextContent('Rates & Availability');
    expect(usersService.list).not.toHaveBeenCalled();
  });

  it('opens the guest CRM ledger with manager-only filters for owners', async () => {
    vi.mocked(guestService.list).mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await signInAs('owner', '/app/guests');
    expect(await screen.findByRole('heading', { level: 1, name: 'Guests' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'OTA → direct' })).toBeInTheDocument();
    expect(await screen.findByText('No guests here yet')).toBeInTheDocument();
    expect(guestService.list).toHaveBeenCalledWith(expect.objectContaining({ filter: 'all', page: 1 }));
  });

  it('front desk sees the guest ledger without marketing filters', async () => {
    vi.mocked(guestService.list).mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    await signInAs('front_desk', '/app/guests');
    expect(await screen.findByRole('heading', { level: 1, name: 'Guests' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Opted in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Personal follow-ups/ })).not.toBeInTheDocument();
  });

  it('owner dashboard shows commission saved and the OTA→direct funnel from the API', async () => {
    vi.mocked(crmService.dashboard).mockResolvedValue(dashboardFixture(true));
    await signInAs('owner');
    expect(await screen.findByText('Commission saved')).toBeInTheDocument();
    expect(screen.getByText('₹9,000')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'OTA → direct guest journey' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Direct 60%, MakeMyTrip 40%' })).toBeInTheDocument();
  });

  it('front desk dashboard hides revenue figures', async () => {
    vi.mocked(crmService.dashboard).mockResolvedValue(dashboardFixture(false));
    await signInAs('front_desk');
    expect(await screen.findByText('Direct booking share')).toBeInTheDocument();
    expect(screen.queryByText('Commission saved')).not.toBeInTheDocument();
    expect(screen.queryByText('Room revenue')).not.toBeInTheDocument();
    expect(screen.getByText('Revenue figures are visible to the owner.', { exact: false })).toBeInTheDocument();
  });
});
