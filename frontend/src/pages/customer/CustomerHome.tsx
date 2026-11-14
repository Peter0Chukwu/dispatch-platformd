import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PortalShell } from '../../layouts/PortalShell';
import { Alert, Badge, Card, CardBody, CardHeader, StatCard, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatNaira, formatNgPhone } from '@dispatch/shared';
import { CUSTOMER_NAV } from './nav';
import { useWallet } from '../../hooks/usePayments';

interface SummaryResponse {
  total: number;
  active: number;
  delivered: number;
  cancelled: number;
  pending: number;
  spentKobo: string;
  savedKobo: string;
}

interface ProfileResponse {
  user: { firstName: string; email: string | null; phone: string | null; emailVerified: boolean; phoneVerified: boolean; createdAt: string };
  customer: { id: string; referralCode: string | null } | null;
  session: { audience: string };
}



export default function CustomerHome() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<ProfileResponse>('/auth/me'),
  });
  // Real aggregates from Postgres — never a placeholder number.
  const { data: wallet } = useWallet();
  const { data: summary } = useQuery({
    queryKey: ['deliveries', 'summary'],
    queryFn: () => api.get<SummaryResponse>('/deliveries/summary'),
  });

  return (
    <PortalShell portal="Customer" nav={CUSTOMER_NAV}>
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
          <StatCard
            label="Deliveries booked"
            value={String(summary?.total ?? 0)}
            hint={summary ? `${summary.delivered} delivered · ${summary.cancelled} cancelled` : 'loading…'}
          />
          <StatCard
            label="Active now"
            value={String(summary?.active ?? 0)}
            hint={summary?.pending ? `${summary.pending} waiting for a rider` : 'nothing in progress'}
          />
          <StatCard
            label="Spent on deliveries"
            value={formatNaira(summary?.spentKobo ?? 0)}
            hint={summary && BigInt(summary.savedKobo) > 0n ? `saved ${formatNaira(summary.savedKobo)} with promos` : 'no promo discounts yet'}
          />
          <StatCard
            label="Wallet balance"
            value={wallet ? formatNaira(wallet.balanceKobo) : '—'}
            hint={wallet ? 'available to spend on deliveries' : 'loading…'}
            isLoading={!wallet}
          />
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
            <CardHeader title="What you can do" subtitle="The three things you will use most" />
            <CardBody className="space-y-3">
              {[
                { title: 'Book a delivery', detail: 'Choose where the rider collects and where it is going — the fare is shown before you confirm.' },
                { title: 'Pay securely', detail: 'Card, transfer or your wallet. The rider is only dispatched once the payment is confirmed.' },
                { title: 'Track live', detail: 'Follow the rider on the map and send the recipient a link so they can follow it too.' },
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

        <Alert tone="info" title="Staying signed in">
          This device stays signed in until you sign out, so you are not asked for a code every time you open the app.
          On a phone you share with someone else, sign out when you have finished.
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
