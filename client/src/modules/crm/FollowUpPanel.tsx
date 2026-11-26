import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Megaphone, MessageCircle, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../context/ToastContext';
import { errorMessage } from '../../services/api';
import { crmService } from '../../services/crm.service';
import type { Audience, FollowUpDraft } from '../../types/crm';
import { cn, formatPhone, whatsappLink } from '../../utils/format';

const AUDIENCES: { key: Exclude<Audience, 'selected'>; label: string }[] = [
  { key: 'returning', label: 'Guests who have stayed with us' },
  { key: 'ota_only', label: 'OTA guests who haven’t booked direct yet' },
  { key: 'ota_converts', label: 'Guests who moved from OTA to direct' },
  { key: 'all_consented', label: 'Everyone who opted in' },
];

function DraftsDialog({ drafts, excluded, onClose }: { drafts: FollowUpDraft[]; excluded: number; onClose: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<Record<string, 'sent' | 'discarded'>>({});
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'sent' | 'discarded' }) => (v.action === 'sent' ? crmService.markSent(v.id) : crmService.discard(v.id)),
    onSuccess: (_d, v) => setState((s) => ({ ...s, [v.id]: v.action })),
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t update'),
  });
  const done = Object.keys(state).length;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${drafts.length} personal message${drafts.length === 1 ? '' : 's'} ready`}
      description={`Open each one in WhatsApp and send it from your own phone, then mark it sent.${excluded ? ` ${excluded} guest${excluded === 1 ? ' was' : 's were'} skipped — no marketing consent.` : ''}`}
      footer={
        <Button onClick={onClose}>
          Done ({done}/{drafts.length})
        </Button>
      }
    >
      {drafts.length === 0 ? (
        <EmptyState
          title="No one to message"
          description="None of the guests in this group has agreed to receive offers. You can record consent on a guest's profile when they give it."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => (
            <li
              key={d.id}
              className={cn('rounded-[var(--radius-card)] border p-3', state[d.id] ? 'border-line bg-parchment-alt/60 opacity-70' : 'border-line bg-white')}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-label-lg text-ink">
                  {d.guestName ?? 'Guest'} <span className="num font-normal text-slate">· {formatPhone(d.phoneE164)}</span>
                </p>
                {state[d.id] && <StatusBadge tone={state[d.id] === 'sent' ? 'success' : 'neutral'}>{state[d.id] === 'sent' ? 'Sent' : 'Skipped'}</StatusBadge>}
              </div>
              <p className="whitespace-pre-wrap text-body-sm text-slate">{d.text}</p>
              {!state[d.id] && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <a href={whatsappLink(d.phoneE164, d.text)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="whatsapp" icon={<MessageCircle className="size-4" aria-hidden />} tabIndex={-1}>
                      Open in WhatsApp
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Check className="size-4" aria-hidden />}
                    onClick={() => act.mutate({ id: d.id, action: 'sent' })}
                  >
                    Mark sent
                  </Button>
                  <Button size="sm" variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={() => act.mutate({ id: d.id, action: 'discarded' })}>
                    Skip
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * PRD "direct follow-up message drafts": pre-written messages the owner sends personally. Consent is
 * enforced by the server; nothing is broadcast automatically.
 */
export function FollowUpPanel({ className, marketingContacts }: { className?: string; marketingContacts?: number }) {
  const toast = useToast();
  const templates = useQuery({ queryKey: ['crm-templates'], queryFn: crmService.templates });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [audience, setAudience] = useState<Exclude<Audience, 'selected'>>('returning');
  const [result, setResult] = useState<{ drafts: FollowUpDraft[]; excluded: number } | null>(null);
  const prepare = useMutation({
    mutationFn: () => crmService.drafts({ templateId: (templateId ?? templates.data?.find((t) => t.isActive)?.id)!, audience }),
    onSuccess: (r) => setResult({ drafts: r.drafts, excluded: r.excludedNoConsent }),
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t prepare messages'),
  });
  const active = templates.data?.filter((t) => t.isActive) ?? [];
  const selected = templateId ?? active[0]?.id ?? null;

  return (
    <section className={cn('card flex flex-col gap-4 p-4 lg:p-5', className)} aria-labelledby="followup-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="followup-title" className="flex items-center gap-2 text-headline-sm">
            <Megaphone className="size-5 text-terracotta" aria-hidden /> Personal follow-ups
          </h2>
          <p className="text-body-sm text-slate">
            Bring guests back direct. {marketingContacts !== undefined ? `${marketingContacts} guests have opted in.` : ''}
          </p>
        </div>
      </div>
      {templates.isLoading ? (
        <LoadingSkeleton variant="lines" count={3} />
      ) : !active.length ? (
        <p className="text-body-sm text-slate">No message templates yet.</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow mb-1">Choose a message</legend>
          {active.map((t) => (
            <label
              key={t.id}
              className={cn(
                'flex cursor-pointer gap-3 rounded-[var(--radius-card)] border p-3',
                selected === t.id ? 'border-forest bg-forest-50' : 'border-line',
              )}
            >
              <input
                type="radio"
                name="template"
                checked={selected === t.id}
                onChange={() => setTemplateId(t.id)}
                className="mt-1 accent-[var(--color-forest)]"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-label-lg text-ink">
                  {t.name}
                  {t.promoCode && <span className="num text-label-sm text-terracotta">CODE: {t.promoCode}</span>}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-body-sm text-slate">{t.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <SelectField label="Send to" value={audience} onChange={(e) => setAudience(e.target.value as Exclude<Audience, 'selected'>)}>
        {AUDIENCES.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
          </option>
        ))}
      </SelectField>
      <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-body-sm text-emerald">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Only guests who agreed to receive offers are included. Anyone who replied STOP is skipped
        automatically.
      </p>
      <Button icon={<MessageCircle className="size-4" aria-hidden />} loading={prepare.isPending} disabled={!selected} onClick={() => prepare.mutate()}>
        Prepare messages
      </Button>
      {result && <DraftsDialog drafts={result.drafts} excluded={result.excluded} onClose={() => setResult(null)} />}
    </section>
  );
}
