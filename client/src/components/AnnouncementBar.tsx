import { BadgeCheck } from 'lucide-react';

/** The slim forest strip above the header in every Stitch screen. Only factual, non-numeric claims here. */
export function AnnouncementBar({ city }: { city?: string | undefined }) {
  return (
    <div className="bg-forest text-white">
      <div className="flex h-8 items-center justify-between gap-4 px-4 text-label-sm lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold">
            <BadgeCheck className="size-4 text-forest-200" aria-hidden />
            0% OTA commission on direct bookings
          </span>
          <span className="hidden text-forest-200 md:inline" aria-hidden>
            •
          </span>
          <span className="hidden truncate text-forest-200 md:inline">Transparent GST pricing, no hidden fees</span>
        </div>
        {city && (
          <span className="hidden shrink-0 rounded-full bg-forest-deep px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider sm:inline-block">
            {city}
          </span>
        )}
      </div>
    </div>
  );
}
