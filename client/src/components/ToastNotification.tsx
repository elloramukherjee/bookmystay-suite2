import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../utils/format';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  title?: string | undefined;
  message: string;
  tone: ToastTone;
}

const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info } as const;
const ACCENT = { success: 'text-emerald', error: 'text-danger', info: 'text-forest' } as const;

export function ToastNotification({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const Icon = ICONS[toast.tone];
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-white p-4 shadow-ambient animate-slide-up"
    >
      <Icon className={cn('mt-0.5 size-5 shrink-0', ACCENT[toast.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        {toast.title && <p className="text-label-lg text-ink">{toast.title}</p>}
        <p className="text-body-sm text-slate">{toast.message}</p>
      </div>
      <button type="button" onClick={() => onDismiss(toast.id)} className="rounded-full p-1 text-sage hover:bg-parchment-alt" aria-label="Dismiss notification">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    // Sits above the 80px mobile bottom-nav safe area.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
    >
      {toasts.map((t) => (
        <ToastNotification key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
