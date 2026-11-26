import { Link } from 'react-router';
import { cn } from '../utils/format';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1D3327" />
      <path d="M14 46V28l18-12 18 12v18" fill="none" stroke="#FAF8F4" strokeWidth="4" strokeLinejoin="round" />
      <path d="M26 46V34a6 6 0 0 1 12 0v12" fill="none" stroke="#C25E38" strokeWidth="4" />
    </svg>
  );
}

export function Logo({ to = '/', subtitle = 'Suite for Independent Hotels', compact = false }: { to?: string; subtitle?: string; compact?: boolean }) {
  return (
    <Link to={to} className="flex min-w-0 items-center gap-2.5" aria-label="BookMyStay home">
      <LogoMark />
      <span className="flex min-w-0 flex-col">
        <span className="font-serif text-headline-sm leading-none tracking-tight text-forest">BookMyStay</span>
        {!compact && <span className="mt-0.5 truncate text-label-sm font-medium normal-case tracking-normal text-slate">{subtitle}</span>}
      </span>
    </Link>
  );
}
