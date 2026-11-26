import { Loader2, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ChatMessageView } from '../types/chat';
import { cn } from '../utils/format';
import { ChatMessage } from './ChatMessage';

interface ChatWindowProps {
  messages: ChatMessageView[];
  perspective: 'guest' | 'staff';
  onSend?: (text: string) => void | Promise<unknown>;
  sending?: boolean;
  header?: ReactNode;
  quickPrompts?: string[];
  composerPlaceholder?: string;
  composerDisabled?: boolean;
  composerNote?: ReactNode;
  /** Shown as a typing indicator under the last message. */
  typing?: boolean;
  emptyState?: ReactNode;
  className?: string;
  composerExtra?: ReactNode;
}

/** Scrollable transcript + composer, shared by the guest chat, the dev simulator and the staff console. */
export function ChatWindow({
  messages,
  perspective,
  onSend,
  sending,
  header,
  quickPrompts,
  composerPlaceholder = 'Type a message…',
  composerDisabled,
  composerNote,
  typing,
  emptyState,
  className,
  composerExtra,
}: ChatWindowProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll only the transcript (not the page) so new messages never yank a phone user's viewport.
  useEffect(() => {
    const el = listRef.current;
    // With no messages the welcome/empty state should be read from the top.
    if (el && (messages.length > 0 || typing)) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !onSend || sending || composerDisabled) return;
    setDraft('');
    await onSend(text);
  };

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white', className)}>
      {header}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,var(--color-forest-50),var(--color-parchment))] px-3 py-4"
        aria-live="polite"
        aria-label="Messages"
      >
        {messages.length === 0 && emptyState}
        <div className="flex flex-col gap-2.5">
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} perspective={perspective} />
          ))}
          {typing && (
            <div className="flex justify-start" aria-label="Concierge is typing">
              <span className="inline-flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-soft">
                <span className="size-1.5 animate-bounce rounded-full bg-sage [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-sage [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-sage" />
              </span>
            </div>
          )}
        </div>
      </div>

      {onSend && (
        <div className="border-t border-line bg-white p-3">
          {quickPrompts && quickPrompts.length > 0 && (
            <div className="scrollbar-none -mx-1 mb-2 flex gap-2 overflow-x-auto px-1">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={sending || composerDisabled}
                  onClick={() => void onSend(p)}
                  className="shrink-0 rounded-full border border-line bg-parchment px-3 py-1.5 text-label-md text-forest hover:border-forest disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
          {composerExtra}
          <form onSubmit={submit} className="flex items-end gap-2">
            <label className="sr-only" htmlFor={`composer-${perspective}`}>
              Message
            </label>
            <textarea
              id={`composer-${perspective}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              disabled={composerDisabled}
              placeholder={composerPlaceholder}
              className="max-h-32 min-h-12 flex-1 resize-none rounded-3xl border-[1.5px] border-line-strong bg-parchment px-4 py-3 text-body-md focus:border-forest focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending || composerDisabled}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-forest text-white disabled:opacity-40"
              aria-label="Send message"
            >
              {sending ? <Loader2 className="size-5 animate-spin" /> : <SendHorizontal className="size-5" />}
            </button>
          </form>
          {composerNote && <div className="mt-2 text-body-sm text-slate">{composerNote}</div>}
        </div>
      )}
    </section>
  );
}
