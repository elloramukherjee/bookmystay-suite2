import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, UserPlus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { SelectField, TextField } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ApiError, errorMessage } from '../../services/api';
import { authService } from '../../services/auth.service';
import { usersService } from '../../services/hotel.service';
import type { StaffRole, User } from '../../types/api';
import { cn, formatPhone, formatRelative, initials, ROLE_LABELS } from '../../utils/format';

const ASSIGNABLE: Record<StaffRole, Array<'manager' | 'front_desk'>> = {
  super_admin: ['manager', 'front_desk'],
  owner: ['manager', 'front_desk'],
  manager: [],
  front_desk: [],
};

const ROLE_HELP: Record<'manager' | 'front_desk', string> = {
  manager: 'Reservations, rooms & rates, all guest profiles, escalated chats',
  front_desk: 'Check-in/out, today’s reservations, replying to guest chats',
};

const newStaffSchema = z.object({
  name: z.string().trim().min(2, 'Enter their full name').max(120),
  email: z.string().trim().pipe(z.email('Enter a valid email')),
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[+\d\s-]{10,16}$/.test(v), 'Enter a 10-digit mobile number')
    .optional(),
  role: z.enum(['manager', 'front_desk']),
  password: z
    .string()
    .min(10, 'At least 10 characters')
    .max(128)
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and numbers'),
});
type NewStaff = z.infer<typeof newStaffSchema>;

function AddStaffModal({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: Array<'manager' | 'front_desk'> }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewStaff>({
    resolver: zodResolver(newStaffSchema),
    defaultValues: { role: roles.includes('front_desk') ? 'front_desk' : roles[0], name: '', email: '', phone: '', password: '' },
  });
  const role = watch('role');

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (values: NewStaff) => {
    try {
      await authService.register({ ...values, phone: values.phone || undefined });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${values.name} can now sign in with their email.`, 'Staff account created');
      close();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) return setError('email', { message: 'This email already has an account' });
        const fields = err.fieldErrors;
        for (const [path, message] of Object.entries(fields)) setError(path as keyof NewStaff, { message });
        if (Object.keys(fields).length) return;
      }
      setError('root', { message: errorMessage(err) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a team member"
      description="Share the password with them in person. They can start using the desk straight away."
      dismissible={!isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="add-staff" loading={isSubmitting}>
            Create account
          </Button>
        </>
      }
    >
      <form id="add-staff" className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        {errors.root && (
          <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-body-sm text-danger">
            {errors.root.message}
          </p>
        )}
        <TextField label="Full name" autoComplete="off" required error={errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Email (used to sign in)" type="email" autoComplete="off" required error={errors.email?.message} {...register('email')} />
          <TextField label="Mobile (WhatsApp)" type="tel" inputMode="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
        </div>
        <SelectField label="Role" required error={errors.role?.message} hint={role ? ROLE_HELP[role] : undefined} {...register('role')}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Temporary password"
          type="text"
          autoComplete="new-password"
          required
          hint="At least 10 characters with letters and numbers."
          error={errors.password?.message}
          {...register('password')}
        />
      </form>
    </Modal>
  );
}

/** For a staff member who forgot their password: there is no email/SMS reset, so the owner sets one and shares it in person. */
function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => usersService.resetPassword(user.id, password),
    onSuccess: () => {
      toast.success(`${user.name} has been signed out everywhere. Share the new password with them in person.`, 'Password reset');
      onClose();
    },
  });
  const fieldError = reset.error instanceof ApiError ? reset.error.fieldErrors.newPassword : undefined;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password for ${user.name}`}
      description="They’ll be signed out on every device and can sign in with the new password straight away."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => reset.mutate()} loading={reset.isPending} disabled={password.length < 10}>
            Set new password
          </Button>
        </>
      }
    >
      {reset.error && !fieldError && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-50 px-3 py-2 text-body-sm text-danger">
          {errorMessage(reset.error)}
        </p>
      )}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters, with letters and numbers."
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldError}
      />
    </Modal>
  );
}

export function StaffManagementPage() {
  const { user: me, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const canManage = can('staff.manage');
  const assignable = me ? ASSIGNABLE[me.role] : [];

  const list = useQuery({
    queryKey: ['users', { page, q }],
    queryFn: () => usersService.list({ page, limit: 20, q: q || undefined }),
    placeholderData: keepPreviousData,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ role: StaffRole; isActive: boolean }> }) => usersService.update(id, input),
    onSuccess: async ({ user }) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${user.name} updated.`);
    },
    onError: (err) => toast.error(errorMessage(err), 'Couldn’t update'),
  });

  const editable = (u: User) => canManage && u.id !== me?.id && u.role !== 'owner' && u.role !== 'super_admin';

  const roleControl = (u: User) =>
    editable(u) && assignable.length > 1 ? (
      <select
        aria-label={`Role for ${u.name}`}
        value={u.role}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ id: u.id, input: { role: e.target.value as StaffRole } })}
        className="h-9 rounded-full border border-line-strong bg-white px-3 text-label-md text-forest focus:border-forest focus:outline-none"
      >
        {assignable.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    ) : (
      <StatusBadge tone={u.role === 'owner' ? 'forest' : 'info'}>{ROLE_LABELS[u.role]}</StatusBadge>
    );

  const statusBadge = (u: User) => (
    <StatusBadge tone={u.isActive ? 'success' : 'neutral'} dot>
      {u.isActive ? 'Active' : 'Deactivated'}
    </StatusBadge>
  );

  const identity = (u: User) => (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full text-label-md',
          u.isActive ? 'bg-forest-50 text-forest' : 'bg-parchment-alt text-sage',
        )}
      >
        {initials(u.name)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-label-lg text-ink">
          {u.name}
          {u.id === me?.id && <span className="ml-1.5 text-body-sm font-normal text-sage">(you)</span>}
        </p>
        <p className="truncate text-body-sm text-slate">{u.email}</p>
      </div>
    </div>
  );

  const toggleButton = (u: User) =>
    editable(u) ? (
      <div className="flex flex-wrap justify-end gap-1">
        {u.isActive && (
          <Button
            size="sm"
            variant="ghost"
            icon={<KeyRound className="size-4" aria-hidden />}
            onClick={() => setResetting(u)}
            aria-label={`Reset password for ${u.name}`}
          >
            Reset password
          </Button>
        )}
        <Button
          size="sm"
          variant={u.isActive ? 'ghost' : 'secondary'}
          onClick={() => setToggling(u)}
          className={u.isActive ? 'text-danger hover:bg-danger-50' : ''}
        >
          {u.isActive ? 'Deactivate' : 'Reactivate'}
        </Button>
      </div>
    ) : null;

  const columns: Column<User>[] = [
    { key: 'name', header: 'Team member', render: identity },
    { key: 'phone', header: 'Mobile', render: (u) => <span className="num whitespace-nowrap text-slate">{formatPhone(u.phone)}</span> },
    { key: 'role', header: 'Role', render: roleControl },
    { key: 'status', header: 'Status', render: statusBadge },
    { key: 'last', header: 'Last sign-in', render: (u) => <span className="text-slate">{formatRelative(u.lastLoginAt)}</span> },
    { key: 'actions', header: '', align: 'right', render: toggleButton },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Property"
        title="Staff"
        description="Everyone who can sign in to your desk. Deactivating someone signs them out everywhere immediately."
        actions={
          canManage &&
          assignable.length > 0 && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              Add team member
            </Button>
          )
        }
      />

      <div className="mb-4 max-w-sm">
        <TextField
          label="Search staff"
          type="search"
          placeholder="Name or email"
          leading={<Search className="size-4" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <DataTable
        caption="Staff accounts"
        columns={columns}
        rows={list.data?.data}
        rowKey={(u) => u.id}
        loading={list.isFetching}
        meta={list.data?.meta}
        onPageChange={setPage}
        error={
          list.error ? (
            <EmptyState
              tone="error"
              title="Couldn’t load staff"
              description={errorMessage(list.error)}
              action={<Button onClick={() => void list.refetch()}>Retry</Button>}
            />
          ) : undefined
        }
        empty={{
          title: q ? 'No one matches that search' : 'No staff yet',
          description: q ? 'Try a different name or email.' : 'Add your front-desk team so they can check guests in.',
        }}
        renderMobile={(u) => (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{identity(u)}</div>
              <div className="shrink-0">{statusBadge(u)}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {roleControl(u)}
              {toggleButton(u)}
            </div>
          </div>
        )}
      />

      {canManage && assignable.length > 0 && <AddStaffModal open={adding} onClose={() => setAdding(false)} roles={assignable} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}

      <ConfirmDialog
        open={Boolean(toggling)}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Reactivate ${toggling?.name}?`}
        message={
          toggling?.isActive
            ? 'They will be signed out on every device and won’t be able to sign in. Their past actions stay in the audit log.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        tone={toggling?.isActive ? 'danger' : 'default'}
        loading={update.isPending}
        onCancel={() => setToggling(null)}
        onConfirm={() => {
          if (!toggling) return;
          update.mutate({ id: toggling.id, input: { isActive: !toggling.isActive } }, { onSettled: () => setToggling(null) });
        }}
      />
    </>
  );
}
