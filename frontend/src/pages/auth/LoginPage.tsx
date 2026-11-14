import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Button, Input, Alert, Tabs, useToast } from '../../components/ui';
import { useAuth, useApiError, type Audience } from '../../contexts/AuthContext';

/**
 * Sign-in, in two flavours.
 *
 * PUBLIC — customers and riders. Two tabs, and nothing else: the staff login is
 * not advertised anywhere on the public site.
 *
 * STAFF — reached at /staff, a URL that is not linked from any public page and
 * is only ever handed out by invitation. Team members sign in with their work
 * email; there is no self-service staff account and no way to become one.
 */

const PUBLIC_PORTALS: Array<{ value: Audience; label: string; home: string }> = [
  { value: 'CUSTOMER', label: 'Customer', home: '/app' },
  { value: 'RIDER', label: 'Rider', home: '/rider' },
];

const STAFF_PORTAL = { value: 'ADMIN' as Audience, home: '/admin' };

function SignIn({ staff }: { staff: boolean }) {
  const [params] = useSearchParams();
  const requested = params.get('portal')?.toUpperCase() as Audience | undefined;
  const portals = staff ? [STAFF_PORTAL] : PUBLIC_PORTALS;
  const initial = portals.some((portal) => portal.value === requested) ? requested! : portals[0]!.value;

  const [audience, setAudience] = useState<Audience>(initial);
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
      const home = portals.find((portal) => portal.value === audience)?.home ?? '/';
      notify({ tone: 'success', title: `Welcome back, ${session.user.firstName}` });
      navigate(home, { replace: true });
    } catch (error) {
      const message = useApiError(error) ?? 'Sign in failed';
      setFormError(message);
      if (error && typeof error === 'object' && 'fieldErrors' in error) {
        const fieldErrors = (error as { fieldErrors: Record<string, string> }).fieldErrors;
        for (const [field, detail] of Object.entries(fieldErrors)) {
          setError(field as keyof LoginInput, { message: detail });
        }
      }
    }
  });

  return (
    <AuthLayout
      title={staff ? 'Staff sign in' : 'Sign in'}
      subtitle={
        staff
          ? 'For the operations, finance and support team. Staff accounts are created by invitation.'
          : 'Welcome back. Use the same details you signed up with.'
      }
      footer={
        staff ? (
          <>
            Invited to join the team but do not have a password yet?{' '}
            <Link to="/" className="font-semibold text-brand-700 hover:underline">
              Open the invitation link
            </Link>{' '}
            you were sent.
          </>
        ) : (
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
        )
      }
    >
      {!staff && (
        <Tabs
          value={audience}
          onChange={(value) => setAudience(value as Audience)}
          tabs={PUBLIC_PORTALS.map((portal) => ({ value: portal.value, label: portal.label }))}
          className="mb-5"
        />
      )}

      {formError && (
        <div className="mb-4">
          <Alert tone="danger" title="Could not sign you in">
            {formError}
          </Alert>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Input
          label={staff ? 'Work email' : 'Email or phone number'}
          placeholder={staff ? 'you@traderswelfare.ng' : '0803 123 4567'}
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

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" variant="accent" size="lg" fullWidth isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>

      {!staff && (
        <p className="mt-6 text-center text-xs leading-relaxed text-ink-400">
          Trouble signing in? Ask us through the chat in your account, or reset your password above.
        </p>
      )}
    </AuthLayout>
  );
}

/** The public sign-in screen: customers and riders only. */
export default function LoginPage() {
  const [params] = useSearchParams();
  // Old bookmarks and guarded redirects may still ask for the admin portal.
  if (params.get('portal')?.toLowerCase() === 'admin') return <Navigate to="/staff" replace />;
  return <SignIn staff={false} />;
}

/** Staff sign-in, served at /staff. Never linked from the public site. */
export function StaffSignInPage() {
  return <SignIn staff />;
}
