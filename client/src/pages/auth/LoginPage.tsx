import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '../../components/Button';
import { TextField } from '../../components/FormField';
import { Logo } from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { ApiError, errorMessage } from '../../services/api';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email').pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Enter your password').max(128),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate(from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait a few minutes.' : errorMessage(err));
    }
  };

  return (
    <div className="grid min-h-screen bg-parchment lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-forest p-12 text-white lg:flex">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-forest-soft/40" aria-hidden />
        <div className="absolute -bottom-32 -left-16 size-80 rounded-full bg-terracotta/20" aria-hidden />
        <p className="relative text-label-sm uppercase tracking-widest text-forest-200">BookMyStay Suite</p>
        <div className="relative">
          <h1 className="text-display-lg text-white">Run your property from your phone.</h1>
          <p className="mt-4 max-w-md text-body-lg text-forest-100">
            Direct bookings, an AI receptionist that knows when to call you, and a guest register that survives staff turnover.
          </p>
        </div>
        <ul className="relative flex flex-col gap-2 text-body-sm text-forest-100">
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-forest-200" aria-hidden /> Sessions are encrypted and expire automatically
          </li>
        </ul>
      </section>

      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <Logo to="/" />
          </div>
          <div className="card-elevated p-6 sm:p-8">
            <h2 className="text-headline-md">Staff sign in</h2>
            <p className="mt-1 text-body-md text-slate">Owners, managers and front-desk team.</p>

            <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
              {formError && (
                <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-4 py-3 text-body-sm text-danger">
                  {formError}
                </div>
              )}
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                inputMode="email"
                leading={<Mail className="size-4" />}
                error={errors.email?.message}
                {...register('email')}
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                leading={<KeyRound className="size-4" />}
                error={errors.password?.message}
                {...register('password')}
              />
              <Button type="submit" size="lg" fullWidth loading={isSubmitting} className="mt-2">
                Sign in
              </Button>
            </form>
          </div>
          <p className="mt-6 text-center text-body-sm text-slate">Can’t sign in? Contact your property owner.</p>
        </div>
      </section>
    </div>
  );
}
