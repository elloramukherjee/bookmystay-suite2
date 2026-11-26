import { cn } from '../utils/format';

interface LoadingSkeletonProps {
  variant?: 'lines' | 'card' | 'stats' | 'table' | 'hero';
  count?: number;
  className?: string;
  label?: string;
}

/** Shape-matched placeholders keep layout stable on slow 3G/4G connections. */
export function LoadingSkeleton({ variant = 'lines', count = 3, className, label = 'Loading' }: LoadingSkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <div role="status" aria-live="polite" aria-label={label} className={className}>
      <span className="sr-only">{label}…</span>
      {variant === 'lines' && (
        <div className="flex flex-col gap-2.5">
          {items.map((i) => (
            <div key={i} className={cn('skeleton h-4', i === count - 1 ? 'w-2/3' : 'w-full')} />
          ))}
        </div>
      )}
      {variant === 'stats' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((i) => (
            <div key={i} className="card flex flex-col gap-3 p-5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-9 w-28" />
              <div className="skeleton h-3 w-full" />
            </div>
          ))}
        </div>
      )}
      {variant === 'card' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => (
            <div key={i} className="card overflow-hidden">
              <div className="skeleton aspect-[16/10] rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}
      {variant === 'table' && (
        <div className="card divide-y divide-line">
          {items.map((i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="skeleton size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-3 w-1/2" />
              </div>
              <div className="skeleton hidden h-6 w-20 rounded-full sm:block" />
            </div>
          ))}
        </div>
      )}
      {variant === 'hero' && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="skeleton h-6 w-48 rounded-full" />
            <div className="skeleton h-12 w-full" />
            <div className="skeleton h-12 w-3/4" />
            <div className="skeleton h-20 w-full" />
          </div>
          <div className="skeleton aspect-[4/3]" />
        </div>
      )}
    </div>
  );
}
