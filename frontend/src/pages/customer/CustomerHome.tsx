import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PortalShell } from '../../layouts/PortalShell';
import { Alert, Badge, Card, CardBody, CardHeader, StatCard, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatNgPhone } from '@dispatch/shared';

interface ProfileResponse {
  user: { firstName: string; email: string | null; phone: string | null; emailVerified: boolean; phoneVerified: boolean; createdAt: string };
  customer: { id: string; referralCode: string | null } | null;
  session: { audience: string };
}

const NAV = [
  { to: '/app', label: 'Overview' },
  { to: '/app/book', label: 'Book a rider', soon: true },
  { to: '/app/deliveries', label: 'Deliveries', soon: true },
  { to: '/app/wallet', label: 'Wallet', soon: true },
];

export default function CustomerHome() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<ProfileResponse>('/auth/me'),
  });

  return (
    <PortalShell portal="Customer" nav={NAV}>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            Hello, {user?.firstName} 👋
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            You are signed in to the customer portal. Your account data below comes from{' '}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">GET /api/v1/auth/me</code>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Deliveries booked" value="0" hint="booking arrives in Phase 3" />
          <StatCard label="Active deliveries" value="0" hint="live tracking in Phase 8" />
          <StatCard label="Wallet balance" value="₦0.00" hint="top-up in Phase 7" />
          <StatCard label="Ratings given" value="0" hint="after completed deliveries" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Account" subtitle="Verified details on your profile" />
            <CardBody className="space-y-3 text-sm">
              <Row label="Email" value={data?.user.email ?? '—'} verified={data?.user.emailVerified} />
              <Row
                label="Phone"
                value={data?.user.phone ? formatNgPhone(data.user.phone) : '—'}
                verified={data?.user.phoneVerified}
              />
              <Row label="Customer ID" value={data?.customer?.id?.slice(0, 8).toUpperCase() ?? '—'} />
              <Row label="Referral code" value={data?.customer?.referralCode ?? 'not issued'} />
              <Row label="Member since" value={data ? new Date(data.user.createdAt).toLocaleDateString('en-NG') : '—'} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What happens next" subtitle="Phase 3 adds the booking flow" />
            <CardBody className="space-y-3">
              {[
                { title: 'Book a delivery', detail: 'Pickup and destination on a map, server-calculated price shown before you pay.' },
                { title: 'Pay securely', detail: 'Paystack, Flutterwave or your wallet — verified server-side, never trusted from the browser.' },
                { title: 'Track live', detail: 'See your rider on the map and share a secure tracking link with the recipient.' },
              ].map((item) => (
                <div key={item.title} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
                  <div>
                    <p className="text-sm font-semibold text-ink-800">{item.title}</p>
                    <p className="text-xs leading-relaxed text-ink-500">{item.detail}</p>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <Alert tone="info" title="Your session is real, and short-lived">
          Access tokens expire after 15 minutes and are refreshed silently in the background. The refresh token is
          stored in an <code>HttpOnly</code> cookie that JavaScript cannot read, so a script injected into this page
          could not steal it.
        </Alert>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
          <Badge tone="success">Email {data?.user.emailVerified ? 'verified' : 'pending'}</Badge>
          <Badge tone={data?.user.phoneVerified ? 'success' : 'warning'}>
            Phone {data?.user.phoneVerified ? 'verified' : 'pending'}
          </Badge>
          <Link to="/verify" className="font-medium text-brand-700 hover:underline">
            Manage verification →
          </Link>
        </div>
      </div>
    </PortalShell>
  );
}

function Row({ label, value, verified }: { label: string; value: string; verified?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2 last:border-0 last:pb-0">
      <span className="text-ink-500">{label}</span>
      <span className="flex items-center gap-2 font-medium text-ink-900">
        {value}
        {verified !== undefined && (
          <StatusPill label={verified ? 'Verified' : 'Pending'} tone={verified ? 'success' : 'warning'} />
        )}
      </span>
    </div>
  );
}
