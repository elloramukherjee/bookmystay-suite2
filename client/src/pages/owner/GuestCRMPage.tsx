import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Search, UserPlus, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { TextField } from '../../components/FormField';
import { GuestCard, TierBadge } from '../../components/GuestCard';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { FollowUpPanel } from '../../modules/crm/FollowUpPanel';
import { QuickCheckInStation } from '../../modules/crm/QuickCheckInStation';
import { ApiError, errorMessage } from '../../services/api';
import { guestService, type GuestFilter } from '../../services/crm.service';
import type { GuestLedgerItem } from '../../types/crm';
import { cn, formatINR, formatPhone, whatsappLink } from '../../utils/format';

const TABS: { key: GuestFilter; label: string; manager?: boolean }[] = [
  { key: 'all', label: 'All guests' },
  { key: 'in_house', label: 'In-house' },
  { key: 'returning', label: 'Returning' },
  { key: 'ota_converts', label: 'OTA → direct', manager: true },
  { key: 'ota', label: 'Came via OTA', manager: true },
  { key: 'marketing', label: 'Opted in', manager: true },
];

function AddGuestDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const create = useMutation({
    mutationFn: () => guestService.create({ phone, name: name || undefined, email: email || undefined, marketingConsent: consent }),
    onSuccess: async (g) => {
      await queryClient.invalidateQueries({ queryKey: ['guests'] });
      toast.success('Guest added to your register.');
      navigate(`/app/guests/${g.id}`);
    },
  });
  const duplicate = create.error instanceof ApiError && create.error.status === 409;
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a guest"
      description="For walk-ins and phone enquiries. The mobile number is their identity across bookings and chats."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={phone.trim().length < 8}>
            Add guest
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {create.error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-body-sm text-danger">
            {duplicate ? 'This guest is already in your register — search their number instead.' : errorMessage(create.error)}
          </p>
        )}
        <TextField label="Mobile (WhatsApp)" type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="flex items-start gap-2 text-body-sm text-slate">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-forest)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          The guest agreed to receive offers from us on WhatsApp
        </label>
      </div>
    </Modal>
  );
}

/** Stitch "Guest Intelligence Ledger" + quick check-in + follow-ups. */
export function GuestCRMPage() {
  const { can } = useAuth();
  const all = can('guests.read_all');
  const finance = can('finance.read');
  const [tab, setTab] = useState<GuestFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['guests', tab, q, page],
    queryFn: () => guestService.list({ filter: tab, q: q || undefined, page, limit: 20 }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<GuestLedgerItem>[] = [
    {
      key: 'guest',
      header: 'Guest & contact',
      render: (g) => (
        <Link to={`/app/guests/${g.id}`} className="block">
          <p className="text-label-lg text-ink hover:text-forest">{g.name ?? 'Unnamed guest'}</p>
          <p className="num text-body-sm text-slate">
            {formatPhone(g.phoneE164)}
            {g.city ? ` · ${g.city}` : ''}
          </p>
        </Link>
      ),
    },
    {
      key: 'tier',
      header: 'Relationship',
      render: (g) => (
        <div className="flex flex-col items-start gap-1">
          <TierBadge tier={g.tier} />
          <span className="text-body-sm text-slate">First came: {g.origin}</span>
          {g.inHouse && <StatusBadge tone="success">In-house{g.inHouse.roomNumber ? ` · ${g.inHouse.roomNumber}` : ''}</StatusBadge>}
        </div>
      ),
    },
    {
      key: 'path',
      header: finance ? 'Stay path & commission saved' : 'Stay path',
      render: (g) => (
        <div>
          <p className="text-body-sm text-ink">{g.stayPath || '—'}</p>
          {finance && g.stats.commissionSavedPaise > 0 && <p className="num text-label-md text-terracotta">Saved {formatINR(g.stats.commissionSavedPaise)}</p>}
        </div>
      ),
    },
    { key: 'pref', header: 'Key preference', render: (g) => <p className="line-clamp-2 max-w-xs text-body-sm text-slate">{g.keyPreference ?? '—'}</p> },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (g) => (
        <a
          href={whatsappLink(g.phoneE164)}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'inline-flex size-10 items-center justify-center rounded-full',
            g.marketingConsent ? 'bg-forest text-white' : 'bg-forest-50 text-forest',
          )}
          aria-label={`WhatsApp ${g.name ?? 'guest'}`}
        >
          <MessageCircle className="size-4" />
        </a>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Guest CRM"
        title="Guests"
        description={
          all
            ? 'Everyone who has booked, stayed or chatted with you — recognised by their mobile number.'
            : 'Guests staying around now (last 7 days to the next 30) and anyone in an active chat.'
        }
        actions={
          can('guests.write') && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              Add guest
            </Button>
          )
        }
      />
      <div className="grid gap-6 2xl:grid-cols-[1fr_400px]">
        <section aria-labelledby="ledger-title">
          <h2 id="ledger-title" className="sr-only">
            Guest ledger
          </h2>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="tablist" aria-label="Filter guests">
              {TABS.filter((t) => !t.manager || all).map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
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
            <div className="lg:w-80">
              <TextField
                label="Search"
                type="search"
                placeholder="Name, phone or booking ref"
                leading={<Search className="size-4" />}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <DataTable
            caption="Guests"
            columns={columns}
            rows={list.data?.data}
            rowKey={(g) => g.id}
            loading={list.isFetching}
            meta={list.data?.meta}
            onPageChange={setPage}
            error={
              list.error ? (
                <EmptyState
                  tone="error"
                  title="Couldn’t load guests"
                  description={errorMessage(list.error)}
                  action={<Button onClick={() => void list.refetch()}>Retry</Button>}
                />
              ) : undefined
            }
            empty={{
              title: q ? 'No guest matches' : 'No guests here yet',
              description: q ? 'Try their mobile number — any format works.' : 'Guest profiles are created automatically from bookings and chats.',
            }}
            renderMobile={(g) => <GuestCard guest={g} showMoney={finance} />}
          />
          {list.data && (
            <p className="mt-2 flex items-center gap-1 text-body-sm text-slate">
              <Users className="size-3.5" aria-hidden /> {list.data.meta.total} guest profile{list.data.meta.total === 1 ? '' : 's'}
            </p>
          )}
        </section>
        <div className="flex flex-col gap-6">
          {can('stays.manage') && <QuickCheckInStation />}
          {can('campaigns.manage') && <FollowUpPanel />}
        </div>
      </div>
      {adding && <AddGuestDialog onClose={() => setAdding(false)} />}
    </>
  );
}
