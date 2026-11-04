import { useQuery } from '@tanstack/react-query';
import { PortalShell } from '../../layouts/PortalShell';
import { Alert, Badge, Card, CardBody, CardHeader, StatCard, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatNgPhone } from '@dispatch/shared';

interface ProfileResponse {
  user: { firstName: string; phone: string | null; emailVerified: boolean; phoneVerified: boolean };
  rider: {
    id: string;
    riderCode: string;
    approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    availability: string;
    ratingAvg: number;
    ratingCount: number;
    completedCount: number;
    vehicles: Array<{ id: string; type: string; registrationNumber: string; isVerified: boolean }>;
  } | null;
}

const NAV = [
  { to: '/rider', label: 'Overview' },
  { to: '/rider/offers', label: 'Offers', soon: true },
  { to: '/rider/active', label: 'Active job', soon: true },
  { to: '/rider/earnings', label: 'Earnings', soon: true },
];

export default function RiderHome() {
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api.get<ProfileResponse>('/auth/me') });
  const rider = data?.rider;

  const approvalTone =
    rider?.approvalStatus === 'APPROVED'
      ? 'success'
      : rider?.approvalStatus === 'REJECTED' || rider?.approvalStatus === 'SUSPENDED'
        ? 'danger'
        : 'warning';

  return (
    <PortalShell portal="Rider" nav={NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Hello, {user?.firstName}</h1>
          <p className="mt-1 text-sm text-ink-500">Rider portal · mobile-first</p>
        </div>

        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink-900">{rider?.riderCode ?? 'Rider application'}</p>
                <p className="text-xs text-ink-500">
                  {user?.phone ? formatNgPhone(user.phone) : '—'} ·{' '}
                  {rider?.vehicles?.[0]?.type.toLowerCase()} · {rider?.vehicles?.[0]?.registrationNumber}
                </p>
              </div>
              <StatusPill
                label={rider?.approvalStatus === 'APPROVED' ? 'Approved' : `Application ${rider?.approvalStatus?.toLowerCase()}`}
                tone={approvalTone}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge tone={user?.emailVerified ? 'success' : 'warning'}>
                Email {user?.emailVerified ? 'verified' : 'pending'}
              </Badge>
              <Badge tone={user?.phoneVerified ? 'success' : 'warning'}>
                Phone {user?.phoneVerified ? 'verified' : 'pending'}
              </Badge>
              <Badge tone={rider?.vehicles?.[0]?.isVerified ? 'success' : 'warning'}>
                Vehicle {rider?.vehicles?.[0]?.isVerified ? 'verified' : 'awaiting verification'}
              </Badge>
            </div>
          </CardBody>
        </Card>

        <Alert tone="info" title="You cannot go online yet">
          Rider accounts stay <strong>offline</strong> until an administrator approves your application. In Phase 4 you
          will upload your ID, driver's licence and vehicle papers here, and a Rider Manager will review them. The
          status above is read from the database, not simulated.
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Today's earnings" value="₦0.00" hint="starts after your first delivery" />
          <StatCard label="Completed deliveries" value={String(rider?.completedCount ?? 0)} />
          <StatCard
            label="Rating"
            value={rider?.ratingCount ? `${rider.ratingAvg.toFixed(1)} ★` : '—'}
            hint={rider?.ratingCount ? `${rider.ratingCount} reviews` : 'no reviews yet'}
          />
          <StatCard label="Availability" value={rider?.availability ?? 'OFFLINE'} hint="set in Phase 4" />
        </div>

        <Card>
          <CardHeader title="Build order for your portal" subtitle="Phase 4" />
          <CardBody>
            <ol className="space-y-2.5 text-sm text-ink-700">
              {[
                'Upload identity and vehicle documents (private storage, admin-only access)',
                'Go online and receive delivery offers with a countdown timer',
                'Progress a job: arrive at pickup → collect → in transit → arrive → deliver',
                'Prove delivery with the recipient OTP or a photo, then see net earnings after commission',
                'Request a withdrawal to your bank account',
              ].map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </PortalShell>
  );
}
