import type { ReactNode } from 'react';
import { cn } from '../utils/format';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'error';
  className?: string;
}

export function EmptyState({ icon, title, description, action, tone = 'default', className }: EmptyStateProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div
          className={cn('flex size-14 items-center justify-center rounded-full', tone === 'error' ? 'bg-danger-50 text-danger' : 'bg-forest-50 text-forest')}
        >
          {icon}
        </div>
      )}
      <h3 className="text-headline-sm">{title}</h3>
      {description && <p className="max-w-md text-body-md text-slate">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
