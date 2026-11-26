import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, Bot, CheckCircle2, MessagesSquare, Radio, Smartphone, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TextAreaField, TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { StaffTakeoverPanel } from '../../components/StaffTakeoverPanel';
import { StatCard } from '../../components/StatCard';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useHotelSettings } from '../../hooks/useHotelSettings';
import { errorMessage } from '../../services/api';
import { deskService } from '../../services/chat.service';
import type { ConversationListItem } from '../../types/chat';
import { cn, formatRelative } from '../../utils/format';

type Tab = 'open' | 'escalated' | 'resolved' | 'all';
const TABS: { key: Tab; label: string; status?: string }[] = [
  { key: 'open', label: 'In flight', status: 'open' },
  { key: 'escalated', label: 'Staff alerts', status: 'escalated' },
  { key: 'resolved', label: 'Resolved', status: 'resolved' },
  { key: 'all', label: 'All' },
];

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

function ConversationCard({ c, active, onOpen }: { c: ConversationListItem; active: boolean; onOpen: () => void }) {
  const alert = c.status === 'escalated';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={cn(
        'flex w-full flex-col gap-1.5 rounded-[var(--radius-card)] border p-4 text-left transition-colors',
        alert ? 'border-terracotta/60 bg-terracotta-50' : 'border-line bg-white hover:border-forest',
        active && 'ring-2 ring-forest',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-serif text-label-lg text-forest">{c.roomNumber ? `Room ${c.roomNumber}` : c.bookingReference ? 'Upcoming stay' : 'Enquiry'}</p>
        {alert ? (
          <StatusBadge tone={c.escalation?.priority === 'urgent' ? 'forest' : 'accent'}>
            {c.escalation?.priority === 'urgent' ? 'Urgent' : 'Staff alert'}
          </StatusBadge>
        ) : c.status === 'staff_active' ? (
          <StatusBadge tone="info">Staff handling</StatusBadge>
        ) : c.status === 'resolved' ? (
          <StatusBadge tone="neutral">Resolved</StatusBadge>
        ) : (
          <StatusBadge tone="success">AI handled</StatusBadge>
        )}
      </div>
      <p className="text-label-lg text-ink">
        {c.guestName ?? 'Website visitor'}
        {c.isReturning && <span className="ml-1.5 text-label-sm text-terracotta">· Returning</span>}
      </p>
      <p className={cn('line-clamp-2 text-body-sm', alert ? 'text-terracotta-deep' : 'text-slate')}>
        {alert && c.escalation ? c.escalation.reason : c.lastMessagePreview}
      </p>
      <div className="flex items-center justify-between text-label-sm text-sage">
        <span className="inline-flex items-center gap-1">
          {c.channel === 'web' ? <MessagesSquare className="size-3" aria-hidden /> : <Smartphone className="size-3" aria-hidden />}
          {c.channel === 'simulator' ? 'Simulator' : c.channel === 'web' ? 'Website' : 'WhatsApp'} · {formatRelative(c.lastMessageAt)}
        </span>
        {c.unreadForStaff > 0 && <span className="num rounded-full bg-terracotta px-2 py-0.5 text-white">{c.unreadForStaff}</span>}
      </div>
    </button>
  );
}

function SimulatorModal({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('Namaste, can we check in early around 11 AM? Also is parking available?');
  const simulate = useMutation({
    mutationFn: () => deskService.simulate({ phone, name: name || undefined, text }),
    onSuccess: (r) => {
      toast.success(r.escalated ? 'Message escalated to staff.' : r.aiReplied ? 'The AI concierge replied.' : 'Message logged.', 'Simulated WhatsApp message');
      onStarted(r.conversationId);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err), 'Simulation failed'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Simulate an incoming WhatsApp query"
      description="Test the receptionist without Meta credentials. Like real WhatsApp, the phone number identifies the guest and their stay."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => simulate.mutate()} loading={simulate.isPending} disabled={phone.trim().length < 8 || !text.trim()}>
            Send as guest
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Guest WhatsApp number"
          type="tel"
          placeholder="98112 34567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Use a seeded guest's number to test booking context."
        />
        <TextField label="Name (optional, for new numbers)" value={name} onChange={(e) => setName(e.target.value)} />
        <TextAreaField label="Message" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}

export function ReceptionistDashboard() {
  const { can, hotel } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const settings = useHotelSettings();

  const stats = useQuery({ queryKey: ['desk-stats'], queryFn: deskService.stats, refetchInterval: 15_000 });
  const status = TABS.find((t) => t.key === tab)!.status;
  const list = useQuery({ queryKey: ['conversations', tab], queryFn: () => deskService.list({ status, limit: 50 }), refetchInterval: 5000 });

  const items = list.data?.data ?? [];
  const activeId = selected ?? items[0]?.id ?? null;
  const s = stats.data;
  const whatsappLive = settings.data?.integrations.whatsappConfigured;

  const open = (id: string) => {
    if (isDesktop) setSelected(id);
    else navigate(`/app/receptionist/${id}`);
  };

  return (
    <>
      <section className="card mb-6 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
        <div className="flex items-start gap-4">
          <span className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-forest-50 text-forest">
            <Bot className="size-6" aria-hidden />
            <span
              className={cn('absolute top-0 right-0 size-3 rounded-full ring-2 ring-white', s?.aiConfigured ? 'bg-emerald' : 'bg-terracotta')}
              aria-hidden
            />
          </span>
          <div>
            <p className="eyebrow text-terracotta">AI receptionist</p>
            <h1 className="text-headline-md lg:text-headline-lg">AI Concierge &amp; Staff Dispatch Hub</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-slate">
              <span className="inline-flex items-center gap-1">
                <Smartphone className="size-3.5" aria-hidden /> WhatsApp gateway:{' '}
                {whatsappLive ? `live${hotel?.whatsapp ? ` · ${hotel.whatsapp}` : ''}` : 'simulator mode (no Meta credentials)'}
              </span>
              <span aria-hidden>·</span>
              <span>{s ? (s.aiConfigured ? 'Gemini AI active · English, Hindi & Hinglish' : 'AI not configured — all chats go to staff') : '…'}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s && s.escalationQueue.total > 0 && (
            <button
              type="button"
              onClick={() => setTab('escalated')}
              className="inline-flex items-center gap-2 rounded-full bg-terracotta-50 px-4 py-2 text-label-md text-terracotta-deep"
            >
              <span className="size-2 rounded-full bg-terracotta" aria-hidden />
              {s.escalationQueue.total} escalation{s.escalationQueue.total > 1 ? 's' : ''} need{s.escalationQueue.total === 1 ? 's' : ''} review
            </button>
          )}
          <Link to="/app/receptionist/knowledge">
            <Button variant="secondary" size="sm" icon={<BookOpen className="size-4" aria-hidden />} tabIndex={-1}>
              Knowledge base
            </Button>
          </Link>
          {can('conversations.escalations') && (
            <Button size="sm" icon={<Radio className="size-4" aria-hidden />} onClick={() => setSimulating(true)}>
              Simulate incoming query
            </Button>
          )}
        </div>
      </section>

      {stats.isLoading ? (
        <LoadingSkeleton variant="stats" count={4} label="Loading desk metrics" />
      ) : s ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Automated resolution rate"
            value={s.automatedResolutionRate !== null ? `${s.automatedResolutionRate}%` : '—'}
            icon={<CheckCircle2 className="size-5" />}
            description={
              s.conversations ? `${s.resolvedWithoutStaff} of ${s.conversations} chats in 7 days handled without staff` : 'No chats in the last 7 days'
            }
          />
          <StatCard
            label="Avg AI latency"
            value={s.avgAiLatencyMs !== null ? `${(s.avgAiLatencyMs / 1000).toFixed(1)}s` : '—'}
            icon={<Zap className="size-5" />}
            description={s.aiRepliesUnder4sPercent !== null ? `${s.aiRepliesUnder4sPercent}% of replies under 4s` : 'No AI replies yet'}
          />
          <StatCard
            label="Conversations in flight"
            value={s.inFlight.total}
            unit="active"
            icon={<MessagesSquare className="size-5" />}
            description={`${s.inFlight.aiActive} with AI · ${s.inFlight.staffActive} with staff · ${s.openServiceRequests} open request${s.openServiceRequests === 1 ? '' : 's'}`}
          />
          <StatCard
            label="Staff intervention queue"
            value={s.escalationQueue.total}
            unit={s.escalationQueue.total === 1 ? 'alert' : 'alerts'}
            tone={s.escalationQueue.total ? 'alert' : 'default'}
            icon={<AlertCircle className="size-5" />}
            description={
              s.escalationQueue.urgent ? `${s.escalationQueue.urgent} urgent (safety / medical)` : 'Sensitive chats are paused for staff automatically'
            }
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <section aria-labelledby="queue-title" className="flex flex-col gap-3">
          <h2 id="queue-title" className="sr-only">
            Conversations
          </h2>
          <div className="scrollbar-none flex gap-2 overflow-x-auto" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setTab(t.key);
                  setSelected(null);
                }}
                className={cn(
                  'shrink-0 rounded-full border px-4 py-2 text-label-md',
                  tab === t.key ? 'border-forest bg-forest text-white' : 'border-line bg-white text-slate',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {list.isLoading ? (
            <LoadingSkeleton variant="table" count={4} label="Loading conversations" />
          ) : list.error ? (
            <div className="card">
              <EmptyState
                tone="error"
                title="Couldn’t load chats"
                description={errorMessage(list.error)}
                action={<Button onClick={() => void list.refetch()}>Retry</Button>}
              />
            </div>
          ) : !items.length ? (
            <div className="card">
              <EmptyState
                icon={<MessagesSquare className="size-6" />}
                title={tab === 'escalated' ? 'No staff alerts' : 'No conversations here'}
                description="Guest chats from WhatsApp and your website appear here in real time."
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-2.5 lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto lg:pr-1">
              {items.map((c) => (
                <li key={c.id}>
                  <ConversationCard c={c} active={isDesktop && c.id === activeId} onOpen={() => open(c.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Front desk staff takeover console" className="hidden lg:block">
          <h2 className="mb-3 text-headline-sm">Front desk staff takeover console</h2>
          {activeId ? (
            <StaffTakeoverPanel key={activeId} conversationId={activeId} />
          ) : (
            <div className="card">
              <EmptyState title="Select a conversation" />
            </div>
          )}
        </section>
      </div>

      {simulating && (
        <SimulatorModal
          onClose={() => setSimulating(false)}
          onStarted={(id) => {
            void queryClient.invalidateQueries({ queryKey: ['conversations'] });
            void queryClient.invalidateQueries({ queryKey: ['desk-stats'] });
            setTab('all');
            open(id);
          }}
        />
      )}
    </>
  );
}
