import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { hotelService } from '../services/hotel.service';

/** Public hotel profile for routes under `/h/:slug`. Disabled on pages that aren't about one property. */
export function usePublicHotel() {
  const { slug } = useParams();
  return useQuery({
    queryKey: ['hotel', 'public', slug],
    queryFn: () => hotelService.getPublic(slug!),
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
  });
}
