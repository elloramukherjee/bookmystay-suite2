import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../utils/format';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'whatsapp' | 'accent' | 'danger' | 'upi';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-forest text-white hover:bg-forest-deep disabled:bg-forest/50',
  secondary: 'bg-parchment border-[1.5px] border-forest text-forest hover:bg-forest-50',
  ghost: 'text-forest hover:bg-forest-50',
  whatsapp: 'bg-emerald text-white hover:bg-emerald/90',
  accent: 'bg-terracotta text-white hover:bg-terracotta-deep',
  danger: 'bg-danger text-white hover:bg-danger/90',
  upi: 'bg-upi text-white hover:bg-upi/90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-label-md gap-1.5',
  md: 'h-11 px-5 text-label-lg gap-2',
  // 48px minimum for primary mobile thumb targets (DESIGN.md)
  lg: 'h-12 px-6 text-label-lg gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
