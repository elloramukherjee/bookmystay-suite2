import { CheckCheck, Lock, Sparkles, Wrench } from 'lucide-react';
import type { ChatMessageView } from '../types/chat';
import { cn } from '../utils/format';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/**
 * One chat bubble. `perspective` decides alignment: in the guest view the guest's own messages sit on the
 * right (WhatsApp convention); in the staff console the hotel's side (AI/staff) sits on the right.
 */
export function ChatMessage({ message, perspective }: { message: ChatMessageView; perspective: 'guest' | 'staff' }) {
  const m = message;
  if (m.sender === 'system') {
    return (
      <div className="flex justify-center px-2">
        <p
          className={cn(
            'max-w-[90%] rounded-2xl px-3 py-1.5 text-center text-body-sm',
            m.visibleToGuest ? 'bg-forest-50 text-slate' : 'border border-dashed border-warning/50 bg-warning-50 text-warning',
          )}
        >
          {!m.visibleToGuest && <Lock className="mr-1 inline size-3" aria-label="Internal" />}
          {m.text}
          <span className="ml-2 text-[10px] text-sage">{time(m.createdAt)}</span>
        </p>
      </div>
    );
  }

  const fromHotel = m.sender === 'ai' || m.sender === 'staff';
  const right = perspective === 'guest' ? !fromHotel : fromHotel;
  const internal = m.sender === 'staff' && !m.visibleToGuest;

  return (
    <div className={cn('flex', right ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 shadow-soft sm:max-w-[75%]',
          internal
            ? 'border border-dashed border-warning/60 bg-warning-50'
            : m.sender === 'guest'
              ? cn('bg-forest-100 text-ink', right ? 'rounded-br-md' : 'rounded-bl-md')
              : m.sender === 'staff'
                ? cn('bg-white text-ink ring-1 ring-terracotta/30', right ? 'rounded-br-md' : 'rounded-bl-md')
                : cn('bg-white text-ink', right ? 'rounded-br-md' : 'rounded-bl-md'),
        )}
      >
        {m.sender === 'ai' && (
          <p className="mb-1 flex items-center gap-1 text-label-sm text-terracotta">
            <Sparkles className="size-3" aria-hidden /> AI Concierge
            {perspective === 'staff' && m.latencyMs !== null && <span className="text-sage">({(m.latencyMs / 1000).toFixed(1)}s)</span>}
          </p>
        )}
        {m.sender === 'staff' && (
          <p className="mb-1 text-label-sm text-forest">
            {internal ? 'Internal note · ' : ''}
            {m.staffName ?? 'Front desk'}
            {perspective === 'guest' ? ' · Front desk' : ''}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-body-md">{m.text}</p>
        {perspective === 'staff' && m.toolCalls.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {m.toolCalls.map((t, i) => (
              <li
                key={i}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                  t.ok ? 'bg-emerald-50 text-emerald' : 'bg-danger-50 text-danger',
                )}
              >
                <Wrench className="size-3" aria-hidden /> {t.summary}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-sage">
          {time(m.createdAt)}
          {m.sender === 'guest' && perspective === 'guest' && <CheckCheck className="size-3 text-emerald" aria-label="Sent" />}
        </p>
      </div>
    </div>
  );
}
