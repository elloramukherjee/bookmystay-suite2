import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Circle, Mail, MessageCircle, MessageSquare, TriangleAlert } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { StatusBadge } from '../../components/StatusBadge';
import { errorMessage } from '../../services/api';
import { messagingService, type MessagingStatus } from '../../services/messaging.service';
import { formatInstant } from '../../utils/dates';
import { formatRelative } from '../../utils/format';
import { ManualFollowUpList } from './ManualFollowUps';

const CHANNEL = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle },
  sms: { label: 'SMS fallback', icon: MessageSquare },
  email: { label: 'Email fallback', icon: Mail },
} as const;

const TEMPLATE_LABEL: Record<string, string> = {
  booking_confirmed: 'Booking confirmation',
  booking_cancelled: 'Cancellation notice',
  checkin_welcome: 'Check-in welcome',
  chat_reply: 'Chat reply',
  staff_escalation_alert: 'Staff alert',
  payment_link_pending: 'Payment link notice',
  payment_received_room_unavailable: 'Late payment notice',
};

/** What's left before real WhatsApp messages flow. Each step maps to a credential or a Meta setting. */
function GoLiveChecklist({ s }: { s: MessagingStatus }) {
  const steps = [
    { done: false, text: 'Meta Business account verified and a WhatsApp Business number added (not used in the WhatsApp app)' },
    { done: false, text: 'Permanent access token, phone number ID and app secret added to the server .env' },
    { done: false, text: `Webhook URL set in Meta: https://<your-domain>${s.webhookPath} with your verify token, subscribed to "messages"` },
    {
      done: s.templates.every((t) => t.metaTemplate),
      text: `Message templates approved and mapped in WHATSAPP_TEMPLATES (${s.templates.filter((t) => t.metaTemplate).length}/${s.templates.length}) for confirmations sent more than 24 hours after a guest’s last message`,
    },
  ];
  return (
    <div className="rounded-[var(--radius-card)] bg-parchment-alt/60 p-4">
      <p className="text-label-lg text-ink">To go live on WhatsApp</p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {steps.map((st) => (
          <li key={st.text} className="flex items-start gap-2 text-body-sm text-slate">
            {st.done ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald" aria-hidden />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden />
            )}
            {st.text}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-body-sm text-slate">
        Until then everything works in simulator mode: messages are recorded as “simulated” and nothing reaches guests. Try conversations from the Concierge
        Desk simulator.
      </p>
    </div>
  );
}

/** Messaging health for owners: which provider each channel uses and what happened in the last 7 days. */
export function MessagingStatusPanel() {
  const status = useQuery({ queryKey: ['messaging-status'], queryFn: messagingService.status, refetchInterval: 60_000 });
  const s = status.data;

  return (
    <section className="card mt-4 grid gap-6 p-5 lg:grid-cols-[260px_1fr] lg:p-6" aria-labelledby="messaging-title">
      <div>
        <h2 id="messaging-title" className="text-headline-sm">
          Guest messaging
        </h2>
        <p className="mt-1 text-body-sm text-slate">
          Confirmations, chat replies and alerts go out on WhatsApp first, then SMS, then email if a channel fails.
        </p>
      </div>
      {status.isLoading ? (
        <LoadingSkeleton variant="lines" count={4} />
      ) : status.error || !s ? (
        <EmptyState tone="error" title="Couldn’t load messaging status" description={errorMessage(status.error)} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={s.mode === 'live' ? 'success' : 'warning'} dot>
              {s.mode === 'live' ? 'WhatsApp live' : 'Simulator mode'}
            </StatusBadge>
            {s.mode === 'live' && (
              <span className="text-body-sm text-slate">
                Number ID <span className="num">{s.phoneNumberId}</span> · API {s.apiVersion}
                {s.linkedToProperty === false && <span className="text-danger"> · not linked to this property</span>}
              </span>
            )}
            <span className="text-body-sm text-slate">
              Last guest message: {s.lastInboundAt ? formatRelative(s.lastInboundAt) : 'none yet'}
              {s.mode === 'live' && ` · last sent: ${s.lastOutboundAt ? formatRelative(s.lastOutboundAt) : 'none yet'}`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-body-sm">
              <caption className="sr-only">Messages in the last 7 days by channel</caption>
              <thead className="text-label-sm uppercase text-sage">
                <tr>
                  <th className="py-2 font-medium">Channel (7 days)</th>
                  <th className="py-2 text-right font-medium">Delivered to provider</th>
                  <th className="py-2 text-right font-medium">Simulated</th>
                  <th className="py-2 text-right font-medium">Waiting</th>
                  <th className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.channels.map((c) => {
                  const Icon = CHANNEL[c.channel].icon;
                  return (
                    <tr key={c.channel}>
                      <td className="py-2">
                        <span className="flex items-center gap-2 text-ink">
                          <Icon className="size-4 text-forest" aria-hidden /> {CHANNEL[c.channel].label}
                        </span>
                        <span className="text-label-sm text-slate">{c.provider}</span>
                      </td>
                      <td className="num py-2 text-right">{c.sent}</td>
                      <td className="num py-2 text-right">{c.simulated}</td>
                      <td className="num py-2 text-right">{c.pending}</td>
                      <td className={`num py-2 text-right ${c.failed ? 'text-danger' : ''}`}>{c.failed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {s.channels.some((c) => c.channel !== 'whatsapp' && !c.live) && (
            <p className="rounded-lg bg-parchment-alt/60 px-3 py-2 text-body-sm text-slate">
              No SMS or email service is set up. If WhatsApp can’t deliver an important message (confirmation, cancellation, welcome), it isn’t faked: the
              booking is flagged and the guest appears below as someone to call.
            </p>
          )}

          {s.mode === 'live' && s.templates.some((t) => !t.metaTemplate) && (
            <p className="rounded-lg bg-warning-50 px-3 py-2 text-body-sm text-ink">
              {s.templates.filter((t) => !t.metaTemplate).length} message type{s.templates.filter((t) => !t.metaTemplate).length === 1 ? ' has' : 's have'} no
              approved WhatsApp template yet (
              {s.templates
                .filter((t) => !t.metaTemplate)
                .map((t) => t.template.replace(/_/g, ' '))
                .join(', ')}
              ). They only reach guests who messaged you in the last 24 hours.
            </p>
          )}

          {s.manualFollowUps.length > 0 && (
            <div>
              <p className="mb-1 text-label-md text-ink">Guests to call ({s.manualFollowUps.length})</p>
              <ManualFollowUpList items={s.manualFollowUps} />
            </div>
          )}

          {s.recentFailures.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-label-md text-danger">
                <TriangleAlert className="size-4" aria-hidden /> Recent failures
              </p>
              <ul className="flex flex-col gap-1.5">
                {s.recentFailures.map((f, i) => (
                  <li key={`${f.at}-${i}`} className="rounded-lg bg-danger-50 px-3 py-2 text-body-sm">
                    <span className="text-ink">
                      {TEMPLATE_LABEL[f.template] ?? f.template} via {CHANNEL[f.channel as keyof typeof CHANNEL]?.label ?? f.channel}
                    </span>
                    {f.fellBackTo && <span className="text-slate"> → retried by {CHANNEL[f.fellBackTo as keyof typeof CHANNEL]?.label ?? f.fellBackTo}</span>}
                    {f.staffFollowUp && <span className="text-slate"> → staff asked to call the guest</span>}
                    <span className="block text-label-sm text-slate">
                      {formatInstant(f.at)} · {f.error ?? 'Unknown error'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.mode === 'simulator' && <GoLiveChecklist s={s} />}
        </div>
      )}
    </section>
  );
}
