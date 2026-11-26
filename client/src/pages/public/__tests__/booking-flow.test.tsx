import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../../App';
import { routes } from '../../../routes/router';
import { ApiError } from '../../../services/api';
import { publicBookingService } from '../../../services/booking.service';
import { hotelService } from '../../../services/hotel.service';
import { settingsFixture } from '../../../test/fixtures';
import type { AvailabilitySearch } from '../../../types/booking';
import { addDaysIso, todayIso } from '../../../utils/dates';

vi.mock('../../../services/hotel.service', () => ({
  hotelService: { getPublic: vi.fn(), getSettings: vi.fn(), update: vi.fn() },
  usersService: { list: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../services/booking.service', async (orig) => {
  const actual = await orig<typeof import('../../../services/booking.service')>();
  return {
    ...actual,
    publicBookingService: { search: vi.fn(), policies: vi.fn(), create: vi.fn(), roomTypes: vi.fn(), get: vi.fn(), listHotels: vi.fn() },
  };
});

const checkIn = addDaysIso(todayIso(), 10);
const checkOut = addDaysIso(todayIso(), 12);

const search: AvailabilitySearch = {
  hotelId: 'h1',
  checkIn,
  checkOut,
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
        sizeSqft: null,
        maxAdults: 2,
        maxChildren: 1,
        maxOccupancy: 3,
        bedType: '',
        view: '',
        amenities: [],
        photos: [],
        tags: [],
        directPrivilege: '',
        baseRatePaise: 480_000,
        otaRatePaise: null,
      },
      available: 3,
      bookable: true,
      reason: null,
      ratePlans: [
        {
          ratePlan: null,
          quote: {
            nightly: [],
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
          },
        },
      ],
    },
  ],
};

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
  vi.mocked(hotelService.getPublic).mockResolvedValue(settingsFixture);
  vi.mocked(publicBookingService.search).mockResolvedValue(search);
  vi.mocked(publicBookingService.policies).mockResolvedValue([]);
});

describe('BookingPage', () => {
  const path = `/h/test-haveli/book?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0&rooms=1&roomTypeId=rt1`;

  it('validates the guest form before creating a booking', async () => {
    renderAt(path);
    await userEvent.click(await screen.findByRole('button', { name: /Continue to secure payment/ }));
    expect(await screen.findByText('Enter your 10-digit WhatsApp number')).toBeInTheDocument();
    expect(screen.getByText('Please accept to continue')).toBeInTheDocument();
    expect(publicBookingService.create).not.toHaveBeenCalled();
  });

  it('sends guest details without any price and moves to payment', async () => {
    vi.mocked(publicBookingService.create).mockResolvedValue({
      booking: { id: 'b123' } as never,
      guestToken: 't',
      guestTokenExpiresIn: 7200,
    });
    const router = renderAt(path);
    await userEvent.type(await screen.findByLabelText(/WhatsApp mobile number/), '98112 34567');
    await userEvent.type(screen.getByLabelText(/Full name/), 'Rajesh Kumar');
    await userEvent.click(screen.getByLabelText(/I agree to the booking terms/));
    await userEvent.click(screen.getByRole('button', { name: /Continue to secure payment/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/booking/b123/pay'));
    const [input, key] = vi.mocked(publicBookingService.create).mock.calls[0]!;
    expect(input).toMatchObject({
      hotelId: 'h1',
      roomTypeId: 'rt1',
      checkIn,
      checkOut,
      guest: { name: 'Rajesh Kumar', phone: '98112 34567' },
      consent: { transactional: true, marketing: false },
    });
    expect(JSON.stringify(input)).not.toMatch(/Paise|price|total/i);
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('tells the guest when the last room was just taken', async () => {
    vi.mocked(publicBookingService.create).mockRejectedValue(
      new ApiError(409, 'ROOM_UNAVAILABLE', 'Sorry, this room type is no longer available for your dates.'),
    );
    renderAt(path);
    await userEvent.type(await screen.findByLabelText(/WhatsApp mobile number/), '9811234567');
    await userEvent.type(screen.getByLabelText(/Full name/), 'Rajesh Kumar');
    await userEvent.click(screen.getByLabelText(/I agree to the booking terms/));
    await userEvent.click(screen.getByRole('button', { name: /Continue to secure payment/ }));
    expect(await screen.findByText(/someone just booked the last room/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See other rooms' })).toBeInTheDocument();
  });
});
