import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Bot, Hand, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/Button';
import { ChatWindow } from '../../components/ChatWindow';
import { EmptyState } from '../../components/EmptyState';
import { TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Modal } from '../../components/Modal';
import { usePublicHotel } from '../../hooks/usePublicHotel';
import { ApiError, errorMessage } from '../../services/api';
import { chatSessions, guestChatService } from '../../services/chat.service';
import type { ChatMessageView, GuestChatSession } from '../../types/chat';

const QUICK_PROMPTS = ['What time is check-in?', 'Is parking available?', 'Wi-Fi details', 'Late checkout', 'Things to do nearby', 'Speak to the front desk'];

function VerifyModal({ hotelId, onClose, onVerified }: { hotelId: string; onClose: () => void; onVerified: (s: GuestChatSession) => void }) {
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const verify = useMutation({
    mutationFn: () => guestChatService.verify(hotelId, reference.trim().toUpperCase(), phone),
    onSuccess: (s) => {
      onVerified(s);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Verify your booking"
      description="So we can help with your stay — room requests, your check-in details and more."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => verify.mutate()}
            loading={verify.isPending}
            disabled={!/^BMS-?[A-Z0-9]{6}$/i.test(reference.trim()) || phone.trim().length < 8}
          >
            Verify
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {verify.error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-body-sm text-danger">
            {errorMessage(verify.error)}
          </p>
        )}
        <TextField
          label="Booking reference"
          placeholder="BMS-7K3Q9P"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          autoCapitalize="characters"
        />
        <TextField label="Mobile number used for booking" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
    </Modal>
  );
}

/**
 * Guest web chat with the AI concierge. Starts anonymously; sharing a phone number links the chat to the
 * guest's profile, and verifying a booking unlocks stay-specific help. Staff replies appear via polling.
 */
export function GuestChatPage() {
  const hotel = usePublicHotel();
  const [params] = useSearchParams();
  const bookingId = params.get('booking') ?? undefined;
  const queryClient = useQueryClient();
  const hotelId = hotel.data?.id;
  const [started, setStarted] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<ChatMessageView | null>(null);
  const [verifying, setVerifying] = useState(false);

  const hasSession = Boolean(hotelId && chatSessions.get(hotelId));
  const session = useQuery({
    queryKey: ['chat-session', hotelId],
    queryFn: () => guestChatService.session(hotelId!),
    enabled: Boolean(hotelId) && (hasSession || started),
    refetchInterval: 4000,
    retry: false,
  });

  // An expired/invalid session token: forget it and let the guest start again.
  useEffect(() => {
    if (hotelId && session.error instanceof ApiError && session.error.status === 401) {
      chatSessions.clear(hotelId);
      setStarted(false);
    }
  }, [session.error, hotelId]);

  useEffect(() => {
    if (hotel.data) document.title = `Chat · ${hotel.data.name}`;
  }, [hotel.data]);

  const send = useMutation({
    mutationFn: (text: string) =>
      guestChatService.send({
        hotelId: hotelId!,
        text,
        ...(hasSession ? {} : { name: name || undefined, phone: phone || undefined, consent: phone ? consent : undefined }),
        bookingId,
      }),
    onMutate: (text) =>
      setPending({
        id: 'pending',
        sender: 'guest',
        text,
        staffName: null,
        latencyMs: null,
        toolCalls: [],
        visibleToGuest: true,
        deliveryStatus: null,
        createdAt: new Date().toISOString(),
      }),
    onSettled: () => setPending(null),
    onSuccess: async () => {
      setStarted(true);
      await queryClient.invalidateQueries({ queryKey: ['chat-session', hotelId] });
    },
  });

  if (hotel.isLoading) return <LoadingSkeleton variant="lines" count={6} className="page-container py-10" label="Loading chat" />;
  if (!hotel.data) {
    return (
      <div className="page-container py-16">
        <EmptyState tone="error" title="We couldn’t load this property" description={errorMessage(hotel.error)} />
      </div>
    );
  }
  const h = hotel.data;
  const s = session.data;
  const messages = [...(s?.messages ?? []), ...(pending ? [pending] : [])];
  const inChat = hasSession || started;

  const header = (
    <header className="flex items-center gap-3 bg-forest px-4 py-3 text-white">
      <span className="relative flex size-10 items-center justify-center rounded-full bg-white/15">
        {s?.withStaff ? <Hand className="size-5" aria-hidden /> : <Bot className="size-5" aria-hidden />}
        <span
          className={`absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-forest ${s?.withStaff || s?.aiAvailable !== false ? 'bg-emerald' : 'bg-terracotta'}`}
          aria-hidden
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-serif text-label-lg">{h.name} Concierge</p>
        <p className="truncate text-body-sm text-forest-100">
          {s?.withStaff ? 'A member of our team is with you' : s?.aiAvailable === false ? 'Our team replies here' : 'AI concierge · replies in seconds'}
        </p>
      </div>
      {s?.verifiedBooking ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-label-sm">
          <BadgeCheck className="size-3.5" aria-hidden /> {s.verifiedBooking.reference}
        </span>
      ) : (
        inChat && (
          <button type="button" onClick={() => setVerifying(true)} className="rounded-full bg-white/15 px-3 py-1.5 text-label-sm hover:bg-white/25">
            Verify booking
          </button>
        )
      )}
    </header>
  );

  return (
    <div className="page-container flex flex-col gap-4 py-5">
      <Link to={`/h/${h.slug}`} className="inline-flex items-center gap-1 text-label-md text-forest">
        <ArrowLeft className="size-4" aria-hidden /> {h.name}
      </Link>
      <div className="mx-auto w-full max-w-2xl">
        <ChatWindow
          className="h-[calc(100dvh-220px)] min-h-[480px]"
          header={header}
          messages={messages}
          perspective="guest"
          typing={send.isPending}
          sending={send.isPending}
          onSend={(text) => send.mutateAsync(text).catch(() => undefined)}
          quickPrompts={messages.length < 3 ? QUICK_PROMPTS : undefined}
          composerPlaceholder="Message the concierge…"
          composerDisabled={Boolean(phone) && !consent && !inChat}
          emptyState={
            <div className="mx-auto max-w-md rounded-[var(--radius-card)] bg-white p-5 text-center shadow-soft">
              <p className="font-serif text-headline-sm text-forest">Namaste! How can we help?</p>
              <p className="mt-1 text-body-sm text-slate">
                Ask about check-in, rooms and prices, parking, food, or anything for your stay. A real person takes over whenever needed.
              </p>
              {!inChat && (
                <div className="mt-4 flex flex-col gap-3 text-left">
                  <TextField label="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                  <TextField
                    label="WhatsApp number (optional)"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    hint="Lets the hotel recognise you. It does not reveal any booking details."
                  />
                  {phone && (
                    <label className="flex items-start gap-2 text-body-sm text-slate">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-[var(--color-forest)]"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      I agree to {h.name} saving this chat with my number to help with my enquiries and stay.
                    </label>
                  )}
                </div>
              )}
            </div>
          }
          composerNote={
            send.error ? (
              <span role="alert" className="text-danger">
                {errorMessage(send.error)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5 text-emerald" aria-hidden /> Answers come from the hotel’s own information. Never share card numbers or OTPs in
                chat.
              </span>
            )
          }
        />
      </div>
      {verifying && hotelId && (
        <VerifyModal hotelId={hotelId} onClose={() => setVerifying(false)} onVerified={(v) => queryClient.setQueryData(['chat-session', hotelId], v)} />
      )}
    </div>
  );
}
