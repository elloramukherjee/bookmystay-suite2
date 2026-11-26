import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, CirclePause, Hand, Lock, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { errorMessage } from '../services/api';
import { deskService } from '../services/chat.service';
import { runOrQueue } from '../services/offlineQueue';
import type { ConversationDetail } from '../types/chat';
import { cn } from '../utils/format';
import { Button } from './Button';
import { ChatWindow } from './ChatWindow';
import { EmptyState } from './EmptyState';
import { GuestProfilePanel } from './GuestProfilePanel';
import { LoadingSkeleton } from './LoadingSkeleton';
import { StatusBadge } from './StatusBadge';

const CATEGORY_LABEL: Record<string, string> = {
  complaint: 'Complaint',
  safety: 'Safety / security',
  medical: 'Medical',
  payment_dispute: 'Payment dispute',
  refund: 'Refund request',
  negative_sentiment: 'Unhappy guest',
  unknown_fact: 'AI didn’t know the answer',
  guest_request: 'Guest asked for a person',
  ai_unavailable: 'AI unavailable',
};

const REQUEST_LABEL: Record<string, string> = {
  housekeeping: 'Housekeeping',
  towels: 'Towels',
  extra_bed: 'Extra bed',
  late_checkout: 'Late checkout',
  early_checkin: 'Early check-in',
  maintenance: 'Maintenance',
  food: 'Food',
  transport: 'Transport',
  other: 'Request',
};

/** One-click replies (Stitch "1-click interventions"). Each sends immediately as the signed-in staff member. */
const QUICK_REPLIES = [
  'I’m so sorry about this — our technician is on the way to your room right now.',
  'We’d be happy to move you to another room. Shall I arrange that?',
  'Some complimentary refreshments are on their way while we sort this out.',
  'Thank you for your patience — this has been taken care of.',
];

function StatusLine({ d }: { d: ConversationDetail }) {
  const s = d.conversation.status;
  if (s === 'ai_active')
    return (
      <StatusBadge tone="success" icon={<Bot className="size-3" aria-hidden />}>
        AI handling
      </StatusBadge>
    );
  if (s === 'escalated')
    return (
      <StatusBadge tone="danger" dot>
        Staff alert
      </StatusBadge>
    );
  if (s === 'staff_active')
    return (
      <StatusBadge tone="forest" icon={<Hand className="size-3" aria-hidden />}>
        Staff handling
      </StatusBadge>
    );
  return <StatusBadge tone="neutral">Resolved</StatusBadge>;
}

export function StaffTakeoverPanel({ conversationId, className }: { conversationId: string; className?: string }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [internal, setInternal] = useState(false);

  const detail = useQuery({ queryKey: ['conversation', conversationId], queryFn: () => deskService.get(conversationId), refetchInterval: 4000 });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    await queryClient.invalidateQueries({ queryKey: ['desk-stats'] });
  };
  const onError = (err: unknown) => toast.error(errorMessage(err), 'Couldn’t complete that');

  const takeover = useMutation({ mutationFn: () => deskService.takeover(conversationId), onSuccess: refresh, onError });
  const reply = useMutation({ mutationFn: (text: string) => deskService.reply(conversationId, text, internal), onSuccess: refresh, onError });
  const resolve = useMutation({
    mutationFn: (resumeAi: boolean) => deskService.resolve(conversationId, resumeAi),
    onSuccess: async (_d, resumeAi) => {
      await refresh();
      toast.success(resumeAi ? 'Resolved. The AI concierge is back on this chat.' : 'Marked resolved.');
    },
    onError,
  });
  const updateRequest = useMutation({
    networkMode: 'always',
    mutationFn: (v: { id: string; status: 'done' | 'declined' | 'acknowledged'; label: string }) =>
      runOrQueue(user?.id ?? '', v.label, { kind: 'serviceRequest', payload: { id: v.id, status: v.status } }),
    onSuccess: async (outcome, v) => {
      if (outcome.queued) {
        toast.show('Saved on this device — the guest will be updated when you’re back online.', 'info', 'Saved offline');
        return;
      }
      await refresh();
      toast.success(
        v.status === 'done' ? 'Marked done — the guest has been told.' : v.status === 'declined' ? 'Declined — the guest has been told.' : 'Acknowledged.',
      );
    },
    onError,
  });

  if (detail.isLoading) return <LoadingSkeleton variant="lines" count={8} className={className} label="Loading conversation" />;
  if (detail.error || !detail.data) {
    return (
      <div className={cn('card', className)}>
        <EmptyState tone="error" title="Couldn’t load this conversation" description={errorMessage(detail.error)} />
      </div>
    );
  }
  const d = detail.data;
  const c = d.conversation;
  const needsManager = c.status === 'escalated' && !can('conversations.escalations');
  const canAct = can('conversations.reply') && !needsManager;
  const openRequests = d.serviceRequests.filter((r) => r.status === 'open' || r.status === 'acknowledged');

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {c.status === 'escalated' && c.escalation && (
        <div
          role="alert"
          className={cn(
            'flex flex-wrap items-start gap-3 rounded-[var(--radius-card)] p-4',
            c.escalation.priority === 'urgent' ? 'bg-danger text-white' : 'bg-danger-50 text-danger',
          )}
        >
          <CirclePause className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-headline-sm">AI autopilot paused{c.roomNumber ? ` for room ${c.roomNumber}` : ''}</p>
            <p className="text-body-sm">
              Trigger: {CATEGORY_LABEL[c.escalation.category]} — {c.escalation.reason}
              {c.escalation.by === 'rule' ? ' (safety guardrail)' : c.escalation.by === 'ai' ? ' (flagged by AI)' : ''}
            </p>
          </div>
          <StatusBadge tone={c.escalation.priority === 'urgent' ? 'neutral' : 'danger'}>{c.escalation.priority}</StatusBadge>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusLine d={d} />
          <StatusBadge tone="neutral">{c.channel === 'simulator' ? 'WhatsApp simulator' : c.channel === 'web' ? 'Website chat' : 'WhatsApp'}</StatusBadge>
          {!d.aiConfigured && <StatusBadge tone="warning">AI not configured</StatusBadge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canAct && c.status !== 'staff_active' && (
            <Button size="sm" variant="accent" icon={<Hand className="size-4" aria-hidden />} loading={takeover.isPending} onClick={() => takeover.mutate()}>
              Take over chat
            </Button>
          )}
          {canAct && (c.status === 'staff_active' || c.status === 'escalated') && (
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<Sparkles className="size-4" aria-hidden />}
                loading={resolve.isPending && resolve.variables === true}
                onClick={() => resolve.mutate(true)}
              >
                Resolve &amp; resume AI
              </Button>
              <Button size="sm" variant="ghost" loading={resolve.isPending && resolve.variables === false} onClick={() => resolve.mutate(false)}>
                Resolve
              </Button>
            </>
          )}
        </div>
      </div>

      {needsManager && (
        <p className="flex items-center gap-2 rounded-lg bg-warning-50 px-3 py-2 text-body-sm text-warning">
          <ShieldAlert className="size-4" aria-hidden /> Escalated chats are handled by a manager. You can read the conversation.
        </p>
      )}

      <GuestProfilePanel guest={d.guest} booking={d.booking} fallbackName={c.guestName} />

      {openRequests.length > 0 && (
        <section aria-labelledby={`req-${c.id}`} className="card p-4">
          <h3 id={`req-${c.id}`} className="eyebrow mb-2">
            Open requests from this chat
          </h3>
          <ul className="flex flex-col gap-2">
            {openRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-parchment-alt/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-label-lg text-ink">
                    {REQUEST_LABEL[r.type] ?? r.type}
                    {r.roomNumber ? ` · Room ${r.roomNumber}` : ''}
                  </p>
                  <p className="text-body-sm text-slate">{r.details}</p>
                </div>
                {can('stays.manage') && (
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="whatsapp"
                      icon={<Check className="size-3.5" aria-hidden />}
                      loading={updateRequest.isPending && updateRequest.variables?.id === r.id && updateRequest.variables.status === 'done'}
                      onClick={() => updateRequest.mutate({ id: r.id, status: 'done', label: `${REQUEST_LABEL[r.type] ?? r.type} request done` })}
                    >
                      Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X className="size-3.5" aria-hidden />}
                      onClick={() => updateRequest.mutate({ id: r.id, status: 'declined', label: `${REQUEST_LABEL[r.type] ?? r.type} request declined` })}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ChatWindow
        className="h-[480px] lg:h-[560px]"
        messages={d.messages}
        perspective="staff"
        onSend={canAct ? (text) => reply.mutateAsync(text) : undefined}
        sending={reply.isPending}
        composerPlaceholder={
          internal ? 'Internal note — only staff can see this' : c.status === 'staff_active' ? 'Reply to the guest…' : 'Replying will take over from the AI…'
        }
        composerExtra={
          canAct && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-label-md text-slate">
                <input type="checkbox" className="size-4 accent-[var(--color-forest)]" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                <Lock className="size-3.5" aria-hidden /> Internal note
              </label>
              <span className="text-sage" aria-hidden>
                ·
              </span>
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={reply.isPending || internal}
                  onClick={() => reply.mutate(q)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-forest hover:border-forest disabled:opacity-40"
                  title={`Send: ${q}`}
                >
                  {q.split(' — ')[0]!.slice(0, 32)}…
                </button>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}
