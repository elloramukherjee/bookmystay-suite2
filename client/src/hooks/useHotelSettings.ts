import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { hotelService, type HotelUpdate } from '../services/hotel.service';

export function useHotelSettings() {
  const { hotel } = useAuth();
  return useQuery({
    queryKey: ['hotel', 'settings', hotel?.id],
    queryFn: () => hotelService.getSettings(hotel!.id),
    enabled: Boolean(hotel?.id),
  });
}

export function useUpdateHotel() {
  const { hotel, reload } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HotelUpdate) => hotelService.update(hotel!.id, input),
    onSuccess: async (data) => {
      queryClient.setQueryData(['hotel', 'settings', hotel?.id], data);
      await queryClient.invalidateQueries({ queryKey: ['hotel', 'public'] });
      await reload(); // header shows hotel name / WhatsApp from /auth/me
    },
  });
}
