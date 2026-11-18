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
    verification?: {
      devToken?: string;
      devCode?: string;
      emailDelivered?: boolean;
      smsDelivered?: boolean;
    };
    rider?: boolean;
  };

  /**
   * Whether the codes actually left the building.
   *
   * When the API could not reach the SMS or email provider it says so, and this
   * screen says so too — "we sent you a code" is the most useless sentence in
   * software when nothing was sent. `undefined` means we were not told (an older
   * response, or arriving from an emailed link), which is not the same as "failed".
   */
  const emailFailed = state.verification?.emailDelivered === false;
  const smsFailed = state.verification?.smsDelivered === false;

  const [emailToken, setEmailToken] = useState(params.get('token') ?? state.verification?.devToken ?? '');
  const [code, setCode] = useState(state.verification?.devCode ?? '');
  const [phone, setPhone] = useState(state.phone ?? '');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger' | 'info'; message: string } | null>(null);
  const [busy, setBusy] = useState<'email' | 'phone' | 'resend' | 'resendEmail' | null>(null);
  const autoRan = useRef(false);

  /**
   * Accepts the long code on its own *or* a whole pasted link.
   *
   * People paste the entire URL from the email into the box — reasonable, since
   * that is what they were sent — and the old version sent it to the API verbatim,
   * which answered "this verification link is not valid". Both shapes now work.
   */
  const tokenFrom = (input: string): string => {
    const text = input.trim();
    const match = /[?&]token=([^&#\s]+)/.exec(text);
    return (match?.[1] ?? text).trim();
  };

  const verifyEmail = async (raw: string) => {
    const token = tokenFrom(raw);
    if (!token) {
      setStatus({ tone: 'danger', message: 'Paste the link from the email, or the long code inside it.' });
      return;
    }
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
      const response = await api.post<{ devCode?: string; message: string; delivered?: boolean }>(
        '/auth/otp/request',
        { phone },
        { skipAuthRefresh: true },
      );
      if (response.devCode) setCode(response.devCode);
      if (response.delivered === false) {
        setStatus({
          tone: 'danger',
          message:
            'We could not send the code to that number just now. Check the number and try again in a minute.',
        });
        return;
      }
      setStatus({ tone: 'info', message: 'A new code is on its way to your phone.' });
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof ApiError ? error.userMessage : 'Could not resend' });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Ask for another verification email.
   *
   * This is the signed-out route on purpose: a brand-new customer has no session
   * yet, so if the first email went to spam there was previously no way forward at
   * all. The reply is worded the same whether or not the address exists.
   */
  const resendEmail = async () => {
    if (!state.email) return;
    setBusy('resendEmail');
    try {
      const response = await api.post<{ message: string }>(
        '/auth/resend-verification-email',
        { email: state.email },
        { skipAuthRefresh: true },
      );
      setStatus({ tone: 'info', message: response.message });
    } catch (error) {
      setStatus({
        tone: 'danger',
        message: error instanceof ApiError ? error.userMessage : 'Could not send the email',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout
      title="Verify your account"
      subtitle={
        emailFailed || smsFailed
          ? 'Confirm your email and phone number. One of the messages below did not go out — you can send it again.'
          : state.email
            ? `We sent a link to ${state.email} and a code to your phone.`
            : 'Confirm your email and phone number.'
      }
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

        {(emailFailed || smsFailed) && (
          <Alert tone="warning" title="Some messages did not go out">
            {emailFailed && smsFailed
              ? 'We could not send the email or the SMS just now.'
              : emailFailed
                ? 'We could not send the email just now.'
                : 'We could not send the SMS just now.'}{' '}
            Your account exists and nothing is lost — use the resend buttons below, or contact support
            if it keeps happening.
          </Alert>
        )}

        <section className="card-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">1. Email address</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            We emailed you a link — opening it confirms your address automatically. If the link will not open,
            paste the whole link here (or just the long code after <code>token=</code>) and press the button.
          </p>
          <div className="mt-3 space-y-3">
            <Input
              label="Link or code from the email"
              value={emailToken}
              onChange={(event) => setEmailToken(event.target.value)}
              placeholder="Paste the whole link, or the code after token="
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void verifyEmail(emailToken)}
                isLoading={busy === 'email'}
                disabled={!emailToken}
              >
                Verify email
              </Button>
              <Button
                variant="ghost"
                onClick={() => void resendEmail()}
                isLoading={busy === 'resendEmail'}
                disabled={!state.email}
              >
                Send the link again
              </Button>
            </div>
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
          <Alert tone="warning" title="Text messages are not switched on yet">
            So you can still finish setting up, your code is shown above instead of being sent to your phone. Once our
            SMS provider is live, it will arrive as a text and will not appear on screen.
          </Alert>
        )}
      </div>
    </AuthLayout>
  );
}
