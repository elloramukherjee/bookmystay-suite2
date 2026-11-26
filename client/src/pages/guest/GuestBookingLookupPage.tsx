import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Hash, MessageCircle, Search } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { TextField } from '../../components/FormField';
import { errorMessage } from '../../services/api';
import { publicBookingService } from '../../services/booking.service';

const schema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => (v.startsWith('BMS-') ? v : `BMS-${v.replace(/^BMS/, '')}`))
    .pipe(z.string().regex(/^BMS-[A-Z0-9]{6}$/, 'References look like BMS-7K3Q9P')),
  phone: z.string().trim().min(8, 'Enter the mobile number used for booking').max(20),
});
type FormValues = z.input<typeof schema>;

/** "Find my booking": no account, no password — just the reference and the phone used to book. */
export function GuestBookingLookupPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reference: '', phone: '' } });

  const lookup = useMutation({
    mutationFn: (v: z.output<typeof schema>) => publicBookingService.lookup(v.reference, v.phone),
    onSuccess: (data) => navigate(`/booking/${data.booking.id}`),
  });

  useEffect(() => {
    document.title = 'Find my booking · BookMyStay';
  }, []);

  return (
    <div className="page-container flex justify-center py-12">
      <div className="w-full max-w-md">
        <h1 className="text-headline-md lg:text-headline-lg">Find my booking</h1>
        <p className="mt-1 text-body-md text-slate">See your stay details, pay a pending booking or cancel. Your reference is in the WhatsApp confirmation.</p>
        <form onSubmit={handleSubmit((v) => lookup.mutate(v))} noValidate className="card-elevated mt-6 flex flex-col gap-4 p-6">
          {lookup.error && (
            <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-body-sm text-danger">
              {errorMessage(lookup.error)}
            </p>
          )}
          <TextField
            label="Booking reference"
            placeholder="BMS-7K3Q9P"
            autoCapitalize="characters"
            autoComplete="off"
            leading={<Hash className="size-4" />}
            error={errors.reference?.message}
            {...register('reference')}
          />
          <TextField
            label="Mobile number used for booking"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98201 44552"
            leading={<MessageCircle className="size-4 text-emerald" />}
            error={errors.phone?.message}
            {...register('phone')}
          />
          <Button type="submit" size="lg" fullWidth loading={lookup.isPending} icon={<Search className="size-4" aria-hidden />}>
            Find booking
          </Button>
        </form>
      </div>
    </div>
  );
}
