import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ message: string; devToken?: string }>(
        '/auth/password/forgot',
        { identifier },
        { skipAuthRefresh: true },
      );
      setSent(true);
      if (response.devToken) setDevToken(response.devToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email address or phone number on your account."
      footer={
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success" title="Check your inbox">
            If an account matches those details, we have sent a reset link valid for one hour.
          </Alert>
          {devToken && (
            <Alert tone="warning" title="Development mode">
              Email delivery is simulated. Use this token to continue:{' '}
              <code className="break-all rounded bg-white px-1">{devToken}</code>
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/reset-password?token=${devToken}`)}>
                  Open reset screen
                </Button>
              </div>
            </Alert>
          )}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Input
            label="Email or phone number"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@example.com or 0803 123 4567"
          />
          <Button type="submit" variant="accent" size="lg" fullWidth isLoading={busy} disabled={identifier.trim().length < 3}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
