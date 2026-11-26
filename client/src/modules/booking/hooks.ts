import { useQuery } from '@tanstack/react-query';
import { publicBookingService } from '../../services/booking.service';
import type { StayParams } from './useStayParams';

export function useAvailability(hotelId: string | undefined, stay: StayParams) {
  return useQuery({
    queryKey: ['availability', hotelId, stay],
    queryFn: () =>
      publicBookingService.search({
        hotelId: hotelId!,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        adults: stay.adults,
        children: stay.children,
        rooms: stay.rooms,
        promoCode: stay.promoCode || undefined,
      }),
    enabled: Boolean(hotelId),
    // Live inventory: always refetch, but keep showing the last result while it loads.
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}

export function usePolicies(slug: string | undefined) {
  return useQuery({
    queryKey: ['policies', slug],
    queryFn: () => publicBookingService.policies(slug!),
    enabled: Boolean(slug),
    staleTime: 10 * 60_000,
  });
}

export function useGuestBooking(bookingId: string | undefined, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['guest-booking', bookingId],
    queryFn: () => publicBookingService.get(bookingId!),
    enabled: Boolean(bookingId),
    refetchInterval: options.poll ? 4000 : false,
  });
}
