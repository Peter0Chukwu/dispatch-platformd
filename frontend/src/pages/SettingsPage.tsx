import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { changePasswordSchema } from '@dispatch/shared';
import { PortalShell } from '../layouts/PortalShell';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Spinner,
  useToast,
} from '../components/ui';
import { useAuth, useApiError } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { CUSTOMER_NAV } from './customer/nav';
import { RIDER_NAV } from './rider/nav';
import { adminNav } from './admin/nav';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface SessionRow {
  familyId: string;
  createdAt: string;
  lastUsedAt?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  current: boolean;
}

/**
 * PROFILE & SETTINGS — one screen, all three portals.
 *
 * Everything here belongs to the signed-in person about themselves: their picture,
 * how their name is spelled in the product, and the devices their account is open
 * on. Anything that changes what they are allowed to *do* lives in the admin
 * screens, behind a permission — a settings page that could promote its own user
 * would be a privilege escalation with a friendly face.
 */
export default function SettingsPage({ portal }: { portal: 'Customer' | 'Rider' | 'Admin' }) {
  const { user, hasPermission, updateUser } = useAuth();
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const nav = portal === 'Admin' ? adminNav(hasPermission) : portal === 'Rider' ? RIDER_NAV : CUSTOMER_NAV;

  /* ── name ─────────────────────────────────────────────────────────────── */
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
  }, [user?.firstName, user?.lastName]);

  const saveName = async () => {
    setSavingName(true);
    setNameError(null);
    try {
      const result = await api.patch<{ firstName: string; lastName: string }>('/auth/me', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      updateUser({ firstName: result.firstName, lastName: result.lastName });
      notify({ tone: 'success', title: 'Name updated' });
    } catch (error) {
      setNameError(useApiError(error) ?? 'Could not save your name');
    } finally {
      setSavingName(false);
    }
  };

  /* ── picture ──────────────────────────────────────────────────────────── */
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setAvatarError(null);

    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError('Choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('That image is larger than 5 MB. Choose a smaller one.');
      return;
    }

    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that file'));
        reader.readAsDataURL(file);
      });

      const result = await api.post<{ avatarUrl: string }>('/auth/me/avatar', {
        mimeType: file.type,
        base64,
      });
      // The URL contains a fresh random key, so the browser re-fetches it instead
      // of showing the old picture from its cache.
      updateUser({ avatarUrl: result.avatarUrl });
      notify({ tone: 'success', title: 'Picture updated' });
    } catch (error) {
      setAvatarError(useApiError(error) ?? 'Could not upload that picture');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    setAvatarError(null);
    try {
      await api.delete('/auth/me/avatar');
      updateUser({ avatarUrl: null });
      notify({ tone: 'success', title: 'Picture removed', description: 'Your initials will be shown instead.' });
    } catch (error) {
      setAvatarError(useApiError(error) ?? 'Could not remove that picture');
    } finally {
      setUploading(false);
    }
  };

  /* ── password ─────────────────────────────────────────────────────────── */
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordState, setPasswordState] = useState<'idle' | 'saving'>('idle');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const changePassword = async () => {
    setPasswordError(null);

    if (passwords.next !== passwords.confirm) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    const parsed = changePasswordSchema.safeParse({
      currentPassword: passwords.current,
      newPassword: passwords.next,
    });
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0]?.message ?? 'Check the new password');
      return;
    }

    setPasswordState('saving');
    try {
      await api.patch('/auth/password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      setPasswords({ current: '', next: '', confirm: '' });
      notify({
        tone: 'success',
        title: 'Password changed',
        description: 'Every other device has been signed out.',
      });
      void loadSessions();
    } catch (error) {
      setPasswordError(useApiError(error) ?? 'Could not change your password');
    } finally {
      setPasswordState('idle');
    }
  };

  /* ── sessions ─────────────────────────────────────────────────────────── */
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadSessions = async () => {
    try {
      const rows = await api.get<SessionRow[]>('/auth/sessions');
      setSessions(rows);
    } catch {
      setSessions([]);
    }
  };

  useEffect(() => {
    void loadSessions();
    // Deliberately once: the list only changes when this page changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOutOthers = async () => {
    setRevoking(true);
    try {
      const result = await api.delete<{ revokedSessions: number }>('/auth/sessions/others');
      notify({
        tone: 'success',
        title: result.revokedSessions === 0 ? 'No other devices were signed in' : 'Other devices signed out',
        description:
          result.revokedSessions > 0 ? `${result.revokedSessions} session(s) ended.` : undefined,
      });
      void loadSessions();
    } catch (error) {
      notify({ tone: 'error', title: 'Could not sign those devices out', description: useApiError(error) ?? undefined });
    } finally {
      setRevoking(false);
    }
  };

  const displayName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

  return (
    <PortalShell portal={portal} nav={nav}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Profile &amp; settings</h1>
          <p className="mt-1 text-sm text-ink-500">
            Your picture, your name, and the devices your account is open on.
          </p>
        </div>

        {/* Picture */}
        <Card>
          <CardHeader title="Display picture" subtitle="Shown in the top bar, on your profile and to colleagues." />
          <CardBody className="space-y-4">
            {avatarError && <Alert tone="danger" title={avatarError} />}
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={displayName} src={user?.avatarUrl} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    isLoading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {user?.avatarUrl ? 'Change picture' : 'Upload picture'}
                  </Button>
                  {user?.avatarUrl && (
                    <Button variant="ghost" size="sm" disabled={uploading} onClick={() => void removeAvatar()}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="mt-2 text-xs text-ink-500">
                  JPG, PNG or WebP · up to 5 MB. Without a picture we show your initials.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void onPickFile(event.target.files?.[0])}
              />
            </div>
          </CardBody>
        </Card>

        {/* Name */}
        <Card>
          <CardHeader title="Your details" subtitle="How your name appears across the platform." />
          <CardBody className="space-y-4">
            {nameError && <Alert tone="danger" title={nameError} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="firstName">
                <Input id="firstName" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </Field>
              <Field label="Last name" htmlFor="lastName">
                <Input id="lastName" value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </Field>
            </div>
            <Button
              size="sm"
              isLoading={savingName}
              disabled={!firstName.trim() || !lastName.trim() || firstName.trim().length < 2 || lastName.trim().length < 2}
              onClick={() => void saveName()}
            >
              Save changes
            </Button>
          </CardBody>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader title="Contact" subtitle="Email and phone are your sign-in identifiers." />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-ink-500">Email</span>
              <span className="flex items-center gap-2 font-medium text-ink-900">
                {user?.email ?? '—'}
                {user?.emailVerified ? (
                  <Badge tone="brand">Verified</Badge>
                ) : (
                  <Badge tone="warning">Unverified</Badge>
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-ink-500">Phone</span>
              <span className="flex items-center gap-2 font-medium text-ink-900">
                {user?.phone ?? '—'}
                {user?.phoneVerified ? (
                  <Badge tone="brand">Verified</Badge>
                ) : (
                  <Link to="/verify" className="text-xs font-semibold text-brand-700 underline">
                    Verify now
                  </Link>
                )}
              </span>
            </div>
            <p className="text-xs text-ink-500">
              Contact an administrator to change either — they are tied to your account history.
            </p>
          </CardBody>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader title="Password" subtitle="Changing it signs out every other device." />
          <CardBody className="space-y-4">
            {passwordError && <Alert tone="danger" title={passwordError} />}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Current password" htmlFor="currentPassword">
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.current}
                  onChange={(event) => setPasswords((p) => ({ ...p, current: event.target.value }))}
                />
              </Field>
              <Field label="New password" htmlFor="newPassword">
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.next}
                  onChange={(event) => setPasswords((p) => ({ ...p, next: event.target.value }))}
                />
              </Field>
              <Field label="Confirm new password" htmlFor="confirmPassword">
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.confirm}
                  onChange={(event) => setPasswords((p) => ({ ...p, confirm: event.target.value }))}
                />
              </Field>
            </div>
            <Button
              size="sm"
              isLoading={passwordState === 'saving'}
              disabled={!passwords.current || !passwords.next || !passwords.confirm}
              onClick={() => void changePassword()}
            >
              Change password
            </Button>
          </CardBody>
        </Card>

        {/* Sessions */}
        <Card>
          <CardHeader title="Where you are signed in" subtitle="Every device holding a live session for this account." />
          <CardBody className="space-y-4">
            {sessions === null ? (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <Spinner size="sm" /> Loading sessions…
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-ink-500">No active sessions found.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {sessions.map((session) => (
                  <li key={session.familyId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink-900">
                        {shortDevice(session.userAgent) ?? 'Unknown device'}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {session.ip ?? 'Unknown IP'} · started {formatWhen(session.createdAt)}
                      </span>
                    </span>
                    {session.current && <Badge tone="brand">This device</Badge>}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="secondary" size="sm" isLoading={revoking} onClick={() => void signOutOthers()}>
              Sign out other devices
            </Button>
          </CardBody>
        </Card>
      </div>
    </PortalShell>
  );
}

/** "Mozilla/5.0 (iPhone; CPU iPhone OS 17…" → "iPhone · Safari"-ish, best effort. */
function shortDevice(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /Firefox\//.test(userAgent)
            ? 'Firefox'
            : 'Browser';
  const device = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Mac OS X/.test(userAgent)
            ? 'Mac'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : 'device';
  return `${browser} on ${device}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
}
