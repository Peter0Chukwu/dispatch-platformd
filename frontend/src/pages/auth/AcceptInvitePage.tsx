import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { acceptStaffInviteSchema, type AcceptStaffInviteInput } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Badge, Button, Input, Spinner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

type InviteState =
  | { kind: 'loading' }
  | { kind: 'valid'; email: string; roleKeys: string[]; expiresAt: string }
  | { kind: 'invalid'; reason: 'USED' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN' | 'OFFLINE' };

const INVALID_COPY: Record<'USED' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN' | 'OFFLINE', { title: string; body: string }> = {
  USED: {
    title: 'This link has already been used',
    body: 'An invitation works once, and this one has already created an account. Sign in with the email it was sent to — or ask the super admin for a new link.',
  },
  EXPIRED: {
    title: 'This link has expired',
    body: 'Invitations are deliberately short-lived. Ask the super admin to send a fresh one.',
  },
  REVOKED: {
    title: 'This invitation was withdrawn',
    body: 'The super admin cancelled this link before it was used. Ask them to send another.',
  },
  UNKNOWN: {
    title: 'This link is not valid',
    body: 'Check that you copied the whole address, including everything after the last slash.',
  },
  OFFLINE: {
    title: 'We could not check this link',
    body: 'The server did not answer. Check your connection and reload this page.',
  },
};

/**
 * ACCEPTING AN ADMIN INVITATION.
 *
 * This is the only public page that creates a staff account, and it does so with a
 * token rather than a password someone else chose. The invited email is fixed by
 * the invitation and shown here for confirmation — the person accepting cannot
 * redirect the account to a different address.
 */
export default function AcceptInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InviteState>({ kind: 'loading' });
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [created, setCreated] = useState<{ staffCode?: string | null; email: string } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AcceptStaffInviteInput>({
    resolver: zodResolver(acceptStaffInviteSchema),
    defaultValues: { firstName: '', lastName: '', phone: '', password: '', acceptTerms: true },
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.get<
          | { valid: true; email: string; roleKeys: string[]; expiresAt: string }
          | { valid: false; reason: 'USED' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN' }
        >(`/auth/invites/${encodeURIComponent(token)}`, { skipAuthRefresh: true, retryOnUnauthorized: false });

        if (cancelled) return;
        setInvite(
          result.valid
            ? { kind: 'valid', email: result.email, roleKeys: result.roleKeys, expiresAt: result.expiresAt }
            : { kind: 'invalid', reason: result.reason },
        );
      } catch {
        if (!cancelled) setInvite({ kind: 'invalid', reason: 'OFFLINE' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (values.password !== confirmPassword) {
      setError('password', { message: 'The two passwords do not match' });
      return;
    }
    try {
      const result = await api.post<{ email: string; staffCode?: string | null }>(
        `/auth/invites/${encodeURIComponent(token)}/accept`,
        values,
        { skipAuthRefresh: true, retryOnUnauthorized: false },
      );
      setCreated({ email: result.email, staffCode: result.staffCode });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.userMessage);
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (['firstName', 'lastName', 'phone', 'password'].includes(field)) {
            setError(field as keyof AcceptStaffInviteInput, { message });
          }
        }
      } else {
        setFormError('Could not create your account. Please try again.');
      }
    }
  });

  // ── account created ────────────────────────────────────────────────────────
  if (created) {
    return (
      <AuthLayout
        title="You are in"
        subtitle="Your administrator account is ready."
        footer={
          <Link to="/login?portal=admin" className="font-semibold text-brand-700 hover:underline">
            Go to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <Alert tone="success" title="Account created">
            Sign in as <strong>{created.email}</strong>
            {created.staffCode ? ` (staff ${created.staffCode})` : ''} using the password you just chose.
          </Alert>
          <Button fullWidth size="lg" onClick={() => navigate('/login?portal=admin')}>
            Sign in to the admin portal
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // ── checking / invalid ─────────────────────────────────────────────────────
  if (invite.kind === 'loading') {
    return (
      <AuthLayout title="Checking your invitation" subtitle="One moment.">
        <div className="flex items-center gap-3 text-sm text-ink-600">
          <Spinner size="sm" /> Verifying this link…
        </div>
      </AuthLayout>
    );
  }

  if (invite.kind === 'invalid') {
    const copy = INVALID_COPY[invite.reason];
    return (
      <AuthLayout
        title={copy.title}
        subtitle="This invitation cannot be used."
        footer={
          <Link to="/login?portal=admin" className="font-semibold text-brand-700 hover:underline">
            Sign in instead
          </Link>
        }
      >
        <Alert tone="warning" title={copy.title}>
          {copy.body}
        </Alert>
      </AuthLayout>
    );
  }

  // ── the form ───────────────────────────────────────────────────────────────
  return (
    <AuthLayout
      title="Set up your admin account"
      subtitle="You were invited to work on this platform. Choose your own password — nobody else sees it."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login?portal=admin" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {formError && (
        <div className="mb-4">
          <Alert tone="danger" title="Could not create your account">
            {formError}
          </Alert>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-ink-200 bg-white p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Invitation for</p>
        <p className="mt-1 text-sm font-semibold text-ink-900">{invite.email}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {invite.roleKeys.map((role) => (
            <Badge key={role} tone="neutral">
              {role.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-500">
          Expires {new Date(invite.expiresAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" placeholder="Ada" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" placeholder="Okafor" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input
          label="Phone number"
          placeholder="0803 123 4567"
          autoComplete="tel"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with upper and lower case and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <Button type="submit" fullWidth size="lg" isLoading={isSubmitting}>
          Create my account
        </Button>
      </form>
    </AuthLayout>
  );
}
