import type { ReactNode } from 'react';
import { cn } from '../utils/format';

interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Small text to the right of the value, e.g. "of 24 rooms". */
  unit?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  tone?: 'default' | 'alert' | 'dark';
  className?: string;
}

/** KPI tile as used across the Stitch receptionist and CRM dashboards. */
export function StatCard({ label, value, unit, description, icon, badge, footer, tone = 'default', className }: StatCardProps) {
  const dark = tone === 'dark';
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border p-5',
        dark ? 'border-forest bg-forest text-white' : 'border-line bg-card',
        tone === 'alert' && 'border-terracotta/40',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className={cn('font-sans text-label-sm uppercase', dark ? 'text-forest-200' : 'text-sage')}>{label}</h3>
        {badge ?? (icon && <span className={cn('shrink-0', dark ? 'text-forest-200' : tone === 'alert' ? 'text-danger' : 'text-forest')}>{icon}</span>)}
      </header>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn('num text-[32px] font-bold leading-10', dark ? 'text-white' : tone === 'alert' ? 'text-danger' : 'text-forest')}>{value}</span>
        {unit && <span className={cn('text-body-sm', dark ? 'text-forest-200' : 'text-slate')}>{unit}</span>}
      </div>
      {description && <p className={cn('text-body-sm', dark ? 'text-forest-100' : 'text-slate')}>{description}</p>}
      {footer && <footer className={cn('mt-auto border-t pt-3 text-body-sm', dark ? 'border-white/15' : 'border-line')}>{footer}</footer>}
    </article>
  );
}
