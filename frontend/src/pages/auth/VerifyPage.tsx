import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

/**
 * One screen covering both verification steps:
 *   1. email link (token arrives in the URL, or was returned in development mode)
 *   2. phone OTP (6 digits)
 *
 * In development the API returns `devToken`/`devCode` so the whole flow is
 * testable without an SMS provider — they are shown here and clearly labelled.
 */
export default function VerifyPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as {
    email?: string;
    phone?: string;
    verification?: { devToken?: string; devCode?: string };
    rider?: boolean;
  };

  const [emailToken, setEmailToken] = useState(params.get('token') ?? state.verification?.devToken ?? '');
  const [code, setCode] = useState(state.verification?.devCode ?? '');
  const [phone, setPhone] = useState(state.phone ?? '');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(null);
  const [busy, setBusy] = useState<'email' | 'phone' | 'resend' | null>(null);
  const autoRan = useRef(false);

  const verifyEmail = async (token: string) => {
    setBusy('email');
    try {
      await api.post('/auth/verify-email', { token }, { skipAuthRefresh: true });
      setStatus({ tone: 'success', message: 'Email verified. Now confirm your phone number below.' });
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof ApiError ? error.userMessage : 'Verification failed' });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const tokenFromLink = params.get('token');
    if (tokenFromLink && !autoRan.current) {
      autoRan.current = true;
      void verifyEmail(tokenFromLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPhone = async () => {
    setBusy('phone');
    try {
      await api.post('/auth/otp/verify', { phone, code }, { skipAuthRefresh: true });
      setStatus({ tone: 'success', message: 'Phone verified. You can sign in now.' });
      setTimeout(() => navigate(state.rider ? '/login?portal=rider' : '/login?portal=customer'), 1200);
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof ApiError ? error.userMessage : 'Verification failed' });
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy('resend');
    try {
      const response = await api.post<{ devCode?: string; message: string }>(
        '/auth/otp/request',
        { phone },
        { skipAuthRefresh: true },
      );
      if (response.devCode) setCode(response.devCode);
      setStatus({ tone: 'info', message: response.message });
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof ApiError ? error.userMessage : 'Could not resend' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout
      title="Verify your account"
      subtitle={state.email ? `We sent a link to ${state.email} and a code to your phone.` : 'Confirm your email and phone number.'}
      footer={
        <>
          Already verified?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        {status && <Alert tone={status.tone}>{status.message}</Alert>}

        <section className="card-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">1. Email address</h2>
          <p className="mt-0.5 text-xs text-ink-500">Paste the verification token from the email link.</p>
          <div className="mt-3 space-y-3">
            <Input
              label="Verification token"
              value={emailToken}
              onChange={(event) => setEmailToken(event.target.value)}
              placeholder="Paste the token from your email"
            />
            <Button variant="secondary" onClick={() => void verifyEmail(emailToken)} isLoading={busy === 'email'} disabled={!emailToken}>
              Verify email
            </Button>
          </div>
        </section>

        <section className="card-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">2. Phone number</h2>
          <p className="mt-0.5 text-xs text-ink-500">Enter the 6-digit code we sent by SMS.</p>
          <div className="mt-3 space-y-3">
            <Input label="Phone number" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0803 123 4567" />
            <Input
              label="6-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              className="tracking-[0.4em]"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => void submitPhone()} isLoading={busy === 'phone'} disabled={code.length !== 6}>
                Verify phone
              </Button>
              <Button variant="secondary" onClick={() => void resend()} isLoading={busy === 'resend'} disabled={!phone}>
                Resend code
              </Button>
            </div>
          </div>
        </section>

        {state.verification?.devCode && (
          <Alert tone="warning" title="Development mode">
            No SMS was sent. The API returned the code directly because <code>SMS_MODE=CONSOLE</code>: it is in the
            API console log and pre-filled above. With a live SMS provider this never reaches the browser.
          </Alert>
        )}
      </div>
    </AuthLayout>
  );
}
