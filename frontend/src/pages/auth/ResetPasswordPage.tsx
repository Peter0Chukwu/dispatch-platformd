import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordSchema } from '@dispatch/shared';
import { AuthLayout } from '../../layouts/AuthLayout';
import { Alert, Button, Input } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Choose a stronger password');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password/reset', { token, password }, { skipAuthRefresh: true });
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Setting a new password signs you out everywhere else."
      footer={
        <Link to="/login" className="font-semibold text-brand-700 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <Alert tone="success" title="Password updated">
          You can now sign in with your new password. Redirecting…
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error && <Alert tone="danger">{error}</Alert>}
          <Input label="Reset token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste your reset token" />
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="At least 8 characters, with upper and lower case and a number"
          />
          <Input label="Confirm new password" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          <Button type="submit" variant="accent" size="lg" fullWidth isLoading={busy} disabled={!token}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
