import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, PhoneCall } from 'lucide-react';
import { Button } from '../../components/Button';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { messagingService, type ManualFollowUp } from '../../services/messaging.service';
import { formatInstant } from '../../utils/dates';
import { cn, formatPhone } from '../../utils/format';

/** Guests no message channel could reach. Staff call them, then mark it done. */
export function ManualFollowUpList({ items, compact }: { items: ManualFollowUp[]; compact?: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: (id: string) => messagingService.resolveFollowUp(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messaging-status'] });
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Marked as called.');
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t update'),
  });

  return (
    <ul className="flex flex-col gap-2">
      {items.map((f) => (
        <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border border-warning/30 bg-warning-50 p-3">
          <div className="min-w-0">
            <p className="text-label-lg text-ink">
              {f.guestName ?? 'Guest'}
              {f.bookingReference && <span className="num font-normal text-slate"> · {f.bookingReference}</span>}
            </p>
            <p className="text-body-sm text-slate">
              Their {f.message} couldn’t be delivered · {formatInstant(f.at)}
            </p>
            {!compact && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-body-sm text-slate">“{f.body}”</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {f.phone && (
              <a href={`tel:${f.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-forest px-4 text-label-md text-white">
                <PhoneCall className="size-4" aria-hidden /> <span className="num">{formatPhone(f.phone)}</span>
              </a>
            )}
            {can('stays.manage') && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Check className="size-4" aria-hidden />}
                loading={resolve.isPending && resolve.variables === f.id}
                onClick={() => resolve.mutate(f.id)}
              >
                Mark called
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Dashboard alert: shown only when at least one guest needs a call. */
export function ManualFollowUpAlert({ className }: { className?: string }) {
  const status = useQuery({ queryKey: ['messaging-status'], queryFn: messagingService.status, refetchInterval: 60_000 });
  const items = status.data?.manualFollowUps ?? [];
  if (!items.length) return null;
  return (
    <section className={cn('card p-4 lg:p-5', className)} aria-labelledby="followups-title" role="region">
      <h2 id="followups-title" className="mb-1 flex items-center gap-2 text-headline-sm">
        <PhoneCall className="size-5 text-warning" aria-hidden /> {items.length} guest{items.length === 1 ? '' : 's'} to call
      </h2>
      <p className="mb-3 text-body-sm text-slate">
        These messages couldn’t be delivered on WhatsApp and no SMS or email service is set up, so please phone the guest.
      </p>
      <ManualFollowUpList items={items.slice(0, 5)} compact />
    </section>
  );
}
