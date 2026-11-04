import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input, Alert, Tabs, useToast } from '../../components/ui';
import { useAuth, useApiError, type Audience } from '../../contexts/AuthContext';

const PORTALS: Array<{ value: Audience; label: string; home: string }> = [
  { value: 'CUSTOMER', label: 'Customer', home: '/app' },
  { value: 'RIDER', label: 'Rider', home: '/rider' },
  { value: 'ADMIN', label: 'Admin', home: '/admin' },
];

export default function LoginPage() {
  const [params] = useSearchParams();
  const initial = (params.get('portal')?.toUpperCase() as Audience) ?? 'CUSTOMER';
  const [audience, setAudience] = useState<Audience>(PORTALS.some((p) => p.value === initial) ? initial : 'CUSTOMER');
  const [formError, setFormError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', audience },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await login({ ...values, audience });
      const home = PORTALS.find((p) => p.value === audience)?.home ?? '/';
      notify({ tone: 'success', title: `Welcome back, ${session.user.firstName}` });
      navigate(home, { replace: true });
    } catch (error) {
      const message = useApiError(error) ?? 'Sign in failed';
      setFormError(message);
      if (error && typeof error === 'object' && 'fieldErrors' in error) {
        const fieldErrors = (error as { fieldErrors: Record<string, string> }).fieldErrors;
        for (const [field, message2] of Object.entries(fieldErrors)) {
          setError(field as keyof LoginInput, { message: message2 });
        }
      }
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the portal that matches your account."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-semibold text-brand-700 hover:underline">
            Create a customer account
          </Link>{' '}
          or{' '}
          <Link to="/register-rider" className="font-semibold text-brand-700 hover:underline">
            apply as a rider
          </Link>
          .
        </>
      }
    >
      <Tabs
        value={audience}
        onChange={(value) => setAudience(value as Audience)}
        tabs={PORTALS.map((portal) => ({ value: portal.value, label: portal.label }))}
        className="mb-5"
      />

      {formError && (
        <div className="mb-4">
          <Alert tone="danger" title="Could not sign you in">
            {formError}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label={audience === 'ADMIN' ? 'Work email' : 'Email or phone number'}
          placeholder={audience === 'ADMIN' ? 'you@company.com' : '0803 123 4567'}
          autoComplete="username"
          error={errors.identifier?.message}
          {...register('identifier')}
        />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <input type="hidden" value={audience} {...register('audience')} />

        <div className="flex items-center justify-between">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
          <span className="text-xs text-ink-400">Protected by Argon2id + rotating sessions</span>
        </div>

        <Button type="submit" variant="accent" size="lg" fullWidth isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>

      <p className="mt-6 rounded-xl bg-ink-100 px-3 py-2.5 text-[12px] leading-relaxed text-ink-600">
        <strong className="font-semibold">Administrators:</strong> the super admin created by the seed script is
        <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono">admin@dispatch.test</code>
        with the password printed when you ran <code className="rounded bg-white px-1 py-0.5 font-mono">npm run db:seed</code>.
        Change it immediately after signing in.
      </p>
    </AuthLayout>
  );
}
