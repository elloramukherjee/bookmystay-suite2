import { zodResolver } from '@hookform/resolvers/zod';
import { Bot, CreditCard, MessageCircle, MessageSquare, Save } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { TextAreaField, TextField } from '../../components/FormField';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useHotelSettings, useUpdateHotel } from '../../hooks/useHotelSettings';
import { MessagingStatusPanel } from '../../modules/messaging/MessagingStatusPanel';
import { ApiError, errorMessage } from '../../services/api';
import type { HotelSettings } from '../../types/api';
import { formatINR } from '../../utils/format';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const pct = (max: number) => z.number({ error: 'Enter a number' }).min(0).max(max, `Max ${max}%`);

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(160),
  story: z.string().trim().max(2000),
  checkInTime: time,
  checkOutTime: time,
  phone: z.string().trim().max(20),
  whatsapp: z.string().trim().max(20),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  line1: z.string().trim().max(160),
  locality: z.string().trim().max(120),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.union([z.literal(''), z.string().regex(/^\d{6}$/, '6-digit PIN code')]),
  gstin: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN'),
  ]),
  directDiscountPercent: pct(50),
  otaCommissionRate: pct(40),
  holdMinutes: z.number({ error: 'Enter minutes' }).int().min(5).max(120),
  freeCancellationHours: z.number({ error: 'Enter hours' }).int().min(0).max(720),
});
type FormValues = z.infer<typeof schema>;

function toForm(h: HotelSettings): FormValues {
  return {
    name: h.name,
    tagline: h.tagline,
    story: h.story,
    checkInTime: h.checkInTime,
    checkOutTime: h.checkOutTime,
    phone: h.contact.phone ?? '',
    whatsapp: h.contact.whatsapp ?? '',
    email: h.contact.email ?? '',
    line1: h.address.line1,
    locality: h.address.locality,
    city: h.address.city,
    state: h.address.state,
    pincode: h.address.pincode,
    gstin: h.gstin ?? '',
    directDiscountPercent: h.settings.directDiscountPercent,
    otaCommissionRate: h.settings.otaCommissionRate,
    holdMinutes: h.settings.holdMinutes,
    freeCancellationHours: h.settings.freeCancellationHours,
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="card grid gap-6 p-5 lg:grid-cols-[260px_1fr] lg:p-6">
      <div>
        <h2 className="text-headline-sm">{title}</h2>
        {description && <p className="mt-1 text-body-sm text-slate">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function IntegrationRow({
  icon,
  label,
  status,
  tone,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  tone: 'success' | 'warning' | 'neutral';
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-forest">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-label-lg text-ink">{label}</p>
        <p className="text-body-sm text-slate">{detail}</p>
      </div>
      <StatusBadge tone={tone}>{status}</StatusBadge>
    </li>
  );
}

export function HotelSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const settings = useHotelSettings();
  const update = useUpdateHotel();
  const readOnly = !can('hotel.update');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (settings.data) reset(toForm(settings.data));
  }, [settings.data, reset]);

  if (settings.isLoading) return <LoadingSkeleton variant="lines" count={8} label="Loading settings" />;
  if (settings.error || !settings.data) {
    return (
      <div className="card">
        <EmptyState
          tone="error"
          title="Couldn’t load settings"
          description={errorMessage(settings.error)}
          action={<Button onClick={() => void settings.refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  const h = settings.data;
  const onSubmit = async (v: FormValues) => {
    try {
      await update.mutateAsync({
        name: v.name,
        tagline: v.tagline,
        story: v.story,
        checkInTime: v.checkInTime,
        checkOutTime: v.checkOutTime,
        contact: { phone: v.phone || null, whatsapp: v.whatsapp || null, email: v.email || null },
        address: { line1: v.line1, locality: v.locality, city: v.city, state: v.state, ...(v.pincode ? { pincode: v.pincode } : {}) },
        gstin: v.gstin || null,
        settings: {
          directDiscountPercent: v.directDiscountPercent,
          otaCommissionRate: v.otaCommissionRate,
          holdMinutes: v.holdMinutes,
          freeCancellationHours: v.freeCancellationHours,
        },
      });
      toast.success('Your changes are live on the booking site.', 'Settings saved');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        for (const [path, message] of Object.entries(err.fieldErrors)) {
          const field = path.split('.').pop() as keyof FormValues;
          setError(field, { message });
        }
      }
      toast.error(errorMessage(err), 'Couldn’t save');
    }
  };

  const num = { valueAsNumber: true } as const;
  const i = h.integrations;

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PageHeader
        eyebrow="Property"
        title="Hotel settings"
        description={readOnly ? 'You can view these settings. Only the owner can change them.' : 'Changes apply to your public booking page immediately.'}
        actions={
          !readOnly && (
            <Button type="submit" icon={<Save className="size-4" />} loading={isSubmitting} disabled={!isDirty}>
              Save changes
            </Button>
          )
        }
      />
      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <Section title="Property profile" description="Shown to guests on your direct booking page.">
          <TextField label="Hotel name" error={errors.name?.message} {...register('name')} />
          <TextField label="Headline" hint="One line that makes a guest want to book direct." error={errors.tagline?.message} {...register('tagline')} />
          <TextAreaField label="Your story" rows={4} error={errors.story?.message} {...register('story')} />
        </Section>

        <Section title="Arrival & departure" description="The AI receptionist answers check-in questions from these values only.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Check-in from" type="time" error={errors.checkInTime?.message} {...register('checkInTime')} />
            <TextField label="Check-out by" type="time" error={errors.checkOutTime?.message} {...register('checkOutTime')} />
          </div>
        </Section>

        <Section title="Contact & address">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="WhatsApp number"
              type="tel"
              hint="Guests reach you here; also your header hotline."
              error={errors.whatsapp?.message}
              {...register('whatsapp')}
            />
            <TextField label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
          </div>
          <TextField label="Email" type="email" error={errors.email?.message} {...register('email')} />
          <TextField label="Street address" error={errors.line1?.message} {...register('line1')} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Locality" error={errors.locality?.message} {...register('locality')} />
            <TextField label="PIN code" inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
            <TextField label="City" error={errors.city?.message} {...register('city')} />
            <TextField label="State" error={errors.state?.message} {...register('state')} />
          </div>
          <TextField label="GSTIN" hint="Printed on guest invoices. Not shown on the public page." error={errors.gstin?.message} {...register('gstin')} />
        </Section>

        <Section title="Direct booking rules" description="Prices are always calculated on the server from these values.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Direct booking discount (%)"
              type="number"
              step="0.5"
              error={errors.directDiscountPercent?.message}
              {...register('directDiscountPercent', num)}
            />
            <TextField
              label="Typical OTA commission (%)"
              type="number"
              step="0.5"
              hint="Used to estimate commission saved. Not shown to guests."
              error={errors.otaCommissionRate?.message}
              {...register('otaCommissionRate', num)}
            />
            <TextField label="Hold unpaid bookings for (minutes)" type="number" error={errors.holdMinutes?.message} {...register('holdMinutes', num)} />
            <TextField
              label="Free cancellation until (hours before check-in)"
              type="number"
              error={errors.freeCancellationHours?.message}
              {...register('freeCancellationHours', num)}
            />
          </div>
          <div className="rounded-lg bg-parchment-alt p-4">
            <p className="text-label-md text-slate">GST slabs (per night tariff)</p>
            <ul className="mt-2 flex flex-col gap-1 text-body-sm">
              {h.settings.taxSlabs.map((s, idx) => {
                const prev = idx > 0 ? h.settings.taxSlabs[idx - 1]?.upToPaise : null;
                const range =
                  s.upToPaise === null
                    ? `Above ${formatINR(prev ?? 0)}`
                    : prev
                      ? `${formatINR(prev + 100)} – ${formatINR(s.upToPaise)}`
                      : `Up to ${formatINR(s.upToPaise)}`;
                return (
                  <li key={idx} className="flex justify-between">
                    <span className="text-slate">{range}</span>
                    <span className="num font-semibold text-forest">{s.ratePercent}%</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-body-sm text-sage">Confirm these slabs with your CA. Contact support to change them.</p>
          </div>
        </Section>
      </fieldset>

      <section className="card mt-4 grid gap-6 p-5 lg:grid-cols-[260px_1fr] lg:p-6">
        <div>
          <h2 className="text-headline-sm">Integrations</h2>
          <p className="mt-1 text-body-sm text-slate">Credentials are stored on the server only. They are never shown here.</p>
        </div>
        <ul className="divide-y divide-line">
          <IntegrationRow
            icon={<Bot className="size-5" />}
            label="Gemini AI receptionist"
            status={i.geminiConfigured ? 'Connected' : 'Not configured'}
            tone={i.geminiConfigured ? 'success' : 'neutral'}
            detail={i.geminiConfigured ? 'Answers are grounded in your FAQs and policies.' : 'Without a key, chats go straight to staff.'}
          />
          <IntegrationRow
            icon={<MessageCircle className="size-5" />}
            label="WhatsApp Cloud API"
            status={i.whatsappConfigured ? 'Live' : 'Simulator'}
            tone={i.whatsappConfigured ? 'success' : 'warning'}
            detail={
              i.whatsappConfigured
                ? 'Guests can message your business number.'
                : 'Messages are tested in the built-in simulator until Meta credentials are added.'
            }
          />
          <IntegrationRow
            icon={<CreditCard className="size-5" />}
            label="Payment gateway"
            status={i.paymentMode === 'development-mock' ? 'Dev mock' : i.paymentMode === 'pay_at_hotel' ? 'Pay at hotel only' : i.paymentMode}
            tone={i.paymentMode === 'development-mock' ? 'warning' : 'success'}
            detail={
              i.paymentMode === 'development-mock'
                ? 'Test mode: no real money moves. Production requires a real gateway.'
                : i.paymentMode === 'pay_at_hotel'
                  ? 'No online payments: website bookings are confirmed at once and guests pay at the property. Collect before check-out.'
                  : 'UPI-first checkout is live.'
            }
          />
          <IntegrationRow
            icon={<MessageSquare className="size-5" />}
            label="SMS fallback"
            status={i.smsMode === 'development-console' ? 'Dev console' : i.smsMode}
            tone={i.smsMode === 'development-console' ? 'warning' : 'success'}
            detail="Used when WhatsApp delivery fails. Production needs DLT-registered templates."
          />
        </ul>
      </section>
      <MessagingStatusPanel />
    </form>
  );
}
