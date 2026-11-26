import { Landmark, ShieldCheck } from 'lucide-react';

export function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`border-t border-line bg-parchment-alt ${className}`}>
      <div className="page-container flex flex-col gap-6 py-8 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-8">
          <p className="font-serif text-headline-sm text-forest">BookMyStay Suite</p>
          <p className="max-w-sm text-body-sm text-slate">
            © {new Date().getFullYear()} Modern Indian hospitality software, built for boutique havelis, retreats &amp; estates.
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-3 text-label-md text-forest">
          <li className="flex items-center gap-2">
            <Landmark className="size-4 text-upi" aria-hidden /> No platform fee
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-emerald" aria-hidden /> GST-transparent pricing
          </li>
        </ul>
      </div>
    </footer>
  );
}
