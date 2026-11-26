import { ArrowRight, BedDouble, Check, MessageCircle, Sparkles, Users } from 'lucide-react';
import type { AvailabilityResult, RatePlanOption } from '../types/booking';
import { cn, formatINR } from '../utils/format';
import { Button } from './Button';
import { ImageWithFallback } from './ImageWithFallback';
import { StatusBadge } from './StatusBadge';

interface RoomCardProps {
  result: AvailabilityResult;
  nights: number;
  rooms: number;
  selectedPlanId: string | null;
  onSelectPlan: (planId: string | null) => void;
  onBook: (option: RatePlanOption) => void;
  chatHref?: string | undefined;
}

/**
 * Stitch room option card: 16:10 image with tags, serif name, OTA price struck through next to the direct
 * nightly price, amenity chips, a "Direct Privilege" strip and the Select & Proceed CTA.
 */
export function RoomCard({ result, nights, rooms, selectedPlanId, onSelectPlan, onBook, chatHref }: RoomCardProps) {
  const { roomType, available, bookable, reason, ratePlans } = result;
  const option = ratePlans.find((p) => (p.ratePlan?.id ?? null) === selectedPlanId) ?? ratePlans[0]!;
  const q = option.quote;
  const perNight = Math.round((q.taxablePaise + q.taxPaise) / Math.max(1, nights * rooms));
  const otaPerNight = q.otaEquivalentPaise ? Math.round(q.otaEquivalentPaise / Math.max(1, nights * rooms)) : null;
  const saving = q.otaEquivalentPaise ? q.otaEquivalentPaise - q.totalPaise : 0;
  const photo = roomType.photos[0];

  return (
    <article className={cn('card overflow-hidden', !bookable && 'opacity-80')} aria-labelledby={`room-${roomType.id}`}>
      <div className="relative">
        {photo ? (
          <ImageWithFallback src={photo.url} alt={photo.alt} className="aspect-[16/10] w-full object-cover" />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center bg-forest-50 text-forest-200">
            <BedDouble className="size-10" aria-hidden />
          </div>
        )}
        <div className="absolute inset-x-3 top-3 flex flex-wrap justify-between gap-2">
          {roomType.tags[0] ? <StatusBadge tone="forest">{roomType.tags[0]}</StatusBadge> : <span />}
          {saving > 0 && <StatusBadge tone="accent">Save {formatINR(saving)} direct</StatusBadge>}
        </div>
        {bookable && available <= 2 && (
          <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-label-sm uppercase text-terracotta">
            Only {available} left for your dates
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 id={`room-${roomType.id}`} className="text-headline-sm">
              {roomType.name}
            </h3>
            <p className="mt-1 text-body-sm text-slate">
              {[roomType.sizeSqft ? `${roomType.sizeSqft} sq ft` : null, roomType.view, roomType.bedType].filter(Boolean).join(' • ')}
            </p>
            <p className="mt-1 flex items-center gap-1 text-body-sm text-slate">
              <Users className="size-3.5" aria-hidden /> Up to {roomType.maxOccupancy} guests
            </p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            {otaPerNight && otaPerNight > perNight && <p className="num text-body-sm text-sage line-through">OTA {formatINR(otaPerNight)}</p>}
            <p>
              <span className="num text-[24px] font-bold text-forest">{formatINR(perNight)}</span>
              <span className="text-body-sm text-slate"> / night</span>
            </p>
            <p className="text-label-sm text-sage">incl. GST · {formatINR(q.totalPaise)} total</p>
          </div>
        </div>

        {roomType.amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {roomType.amenities.slice(0, 5).map((a) => (
              <li key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-label-md text-slate">
                <Check className="size-3 text-emerald" aria-hidden />
                {a}
              </li>
            ))}
          </ul>
        )}

        {ratePlans.length > 1 && (
          <fieldset>
            <legend className="mb-2 text-label-md text-slate">Choose your plan</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ratePlans.map((p) => {
                const id = p.ratePlan?.id ?? null;
                const active = id === (option.ratePlan?.id ?? null);
                return (
                  <label
                    key={id ?? 'default'}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-lg border-[1.5px] px-3 py-2.5',
                      active ? 'border-forest bg-forest-50' : 'border-line',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`plan-${roomType.id}`}
                        checked={active}
                        onChange={() => onSelectPlan(id)}
                        className="accent-[var(--color-forest)]"
                      />
                      <span className="text-label-lg text-ink">{p.ratePlan?.name ?? 'Standard'}</span>
                    </span>
                    <span className="num text-label-md text-forest">{formatINR(p.quote.totalPaise)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {roomType.directPrivilege && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-body-sm text-emerald">
            <Sparkles className="size-4 shrink-0" aria-hidden />
            <span>
              <strong className="font-semibold">Direct privilege:</strong> {roomType.directPrivilege}
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          {bookable ? (
            <Button size="lg" onClick={() => onBook(option)} icon={<ArrowRight className="size-4" aria-hidden />} className="flex-row-reverse">
              Select &amp; proceed
            </Button>
          ) : (
            <p className="text-label-lg text-terracotta">{reason}</p>
          )}
          {chatHref && (
            <a href={chatHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-label-md text-emerald">
              <MessageCircle className="size-4" aria-hidden /> Ask the host
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
