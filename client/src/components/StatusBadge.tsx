import type { ReactNode } from 'react';
import { cn } from '../utils/format';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'upi' | 'accent' | 'forest' | 'trust';

const TONES: Record<BadgeTone, string> = {
  success: 'bg-emerald-50 text-emerald',
  warning: 'bg-warning-50 text-warning',
  danger: 'bg-danger-50 text-danger',
  info: 'bg-forest-50 text-forest',
  neutral: 'bg-parchment-alt text-slate',
  upi: 'bg-upi-50 text-upi',
  accent: 'bg-terracotta text-white',
  forest: 'bg-forest text-white',
  // "Trust Verified Stamp": parchment pill with forest text (DESIGN.md)
  trust: 'bg-parchment-alt text-forest',
};

interface StatusBadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ tone = 'neutral', children, icon, dot, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-label-sm uppercase', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}
