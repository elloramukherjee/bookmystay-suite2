import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../../App';
import { publicBookingService } from '../../../services/booking.service';
import { hotelService } from '../../../services/hotel.service';
import { settingsFixture } from '../../../test/fixtures';
import type { AvailabilitySearch, BookingAmounts } from '../../../types/booking';
import { BookingPage } from '../BookingPage';

vi.mock('../../../services/auth.service', () => ({ authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), register: vi.fn() } }));
vi.mock('../../../services/hotel.service', () => ({ hotelService: { getPublic: vi.fn() }, usersService: {} }));
vi.mock('../../../services/booking.service', () => ({ publicBookingService: { search: vi.fn(), policies: vi.fn(), create: vi.fn() } }));

const amounts: BookingAmounts = {
  nightly: [
    { date: '2026-12-10', ratePaise: 480_000 },
    { date: '2026-12-11', ratePaise: 480_000 },
  ],
  subtotalPaise: 960_000,
  directDiscountPercent: 10,
  directDiscountPaise: 96_000,
  promoCode: null,
  promoDiscountPaise: 0,
  taxablePaise: 864_000,
  taxRatePercent: 5,
  taxPaise: 43_200,
  totalPaise: 907_200,
  otaEquivalentPaise: null,
};
const search: AvailabilitySearch = {
  hotelId: 'h1',
  checkIn: '2026-12-10',
  checkOut: '2026-12-12',
  nights: 2,
  adults: 2,
  children: 0,
  rooms: 1,
  results: [
    {
      roomType: {
        id: 'rt1',
        name: 'Deluxe Courtyard Suite',
        slug: 'deluxe',
        description: '',
        sizeSqft: 380,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
        bedType: 'King',
        view: 'Courtyard',
        amenities: [],
        photos: [],
        tags: [],
        directPrivilege: '',
        baseRatePaise: 480_000,
        otaRatePaise: null,
      },
      available: 2,
      bookable: true,
      reason: null,
      ratePlans: [{ ratePlan: null, quote: amounts }],
    },
  ],
};

function renderBooking(paymentMode: 'online' | 'pay_at_hotel') {
  vi.mocked(hotelService.getPublic).mockResolvedValue({ ...settingsFixture, paymentMode } as never);
  const router = createMemoryRouter(
    [
      { path: '/h/:slug/book', element: <BookingPage /> },
      { path: '/booking/:id', element: <p>confirmation page</p> },
      { path: '/booking/:id/pay', element: <p>payment page</p> },
    ],
    { initialEntries: ['/h/heritage/book?checkIn=2099-12-10&checkOut=2099-12-12&roomTypeId=rt1'] },
  );
  render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

async function fillAndSubmit(buttonName: string) {
  await userEvent.type(await screen.findByLabelText(/WhatsApp mobile number/), '9811234567');
  await userEvent.type(screen.getByLabelText(/Full name/), 'Rajesh Kumar');
  await userEvent.click(screen.getByRole('checkbox', { name: /I agree to the booking terms/ }));
  await userEvent.click(screen.getAllByRole('button', { name: buttonName })[0]!);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(publicBookingService.search).mockResolvedValue(search);
  vi.mocked(publicBookingService.policies).mockResolvedValue([]);
});

describe('BookingPage payment modes', () => {
  it('pay at hotel: explains there is no online payment and goes straight to the confirmation', async () => {
    vi.mocked(publicBookingService.create).mockResolvedValue({ booking: { id: 'b1', status: 'confirmed' }, guestToken: 't' } as never);
    const router = renderBooking('pay_at_hotel');
    expect((await screen.findByText(/No online payment needed/)).closest('p')).toHaveTextContent('Pay ₹9,072 at the hotel');
    expect(screen.queryByRole('button', { name: /secure payment/ })).not.toBeInTheDocument();
    await fillAndSubmit('Confirm booking');
    await waitFor(() => expect(router.state.location.pathname).toBe('/booking/b1'));
  });

  it('online: keeps the payment step', async () => {
    vi.mocked(publicBookingService.create).mockResolvedValue({ booking: { id: 'b2', status: 'pending_payment' }, guestToken: 't' } as never);
    const router = renderBooking('online');
    await screen.findByRole('button', { name: 'Continue to secure payment' });
    expect(screen.queryByText(/No online payment needed/)).not.toBeInTheDocument();
    await fillAndSubmit('Continue to secure payment');
    await waitFor(() => expect(router.state.location.pathname).toBe('/booking/b2/pay'));
  });
});
