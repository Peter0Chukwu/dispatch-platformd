import { Link } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Spinner,
  StatCard,
} from '../../components/ui';
import { RIDER_NAV } from './nav';
import { useEarnings, useJobHistory, useRiderProfile } from '../../hooks/useRider';

const koboToNaira = (kobo: string) => (Number(kobo) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

export default function EarningsPage() {
  const profile = useRiderProfile();
  const earnings = useEarnings();
  const history = useJobHistory(1);

  const data = earnings.data ?? profile.data?.earnings;

  if (earnings.isLoading && profile.isLoading) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    );
  }

  if (earnings.isError || !data) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <ErrorState title="We could not load your earnings" onRetry={() => void earnings.refetch()} />
      </PortalShell>
    );
  }

  const completed = (history.data?.items ?? []).filter((job) => job.status === 'DELIVERED');

  return (
    <PortalShell portal="Rider" nav={RIDER_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Earnings</h1>
          <p className="mt-1 text-sm text-ink-500">
            {data.deliveriesPaid} {data.deliveriesPaid === 1 ? 'delivery' : 'deliveries'} paid · commission is deducted
            from each trip before it reaches your balance.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Withdrawable now" value={data.formatted.withdrawable} hint="cleared earnings minus withdrawals" />
          <StatCard label="Awaiting clearance" value={data.formatted.pending} hint="released 24 hours after delivery" />
          <StatCard label="Paid out" value={data.formatted.paid} hint="already settled" />
          <StatCard label="Gross earned" value={koboToNaira(data.grossKobo)} hint={`commission ${koboToNaira(data.commissionKobo)}`} />
        </div>

        <Card>
          <CardHeader title="Balance breakdown" subtitle="Straight from your earnings ledger" />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Cleared earnings" value={koboToNaira(data.availableKobo)} />
            <Row label="Adjustments" value={koboToNaira(data.adjustmentsKobo)} />
            <Row label="Withdrawn or requested" value={`− ${koboToNaira(data.withdrawnKobo)}`} />
            <div className="border-t border-ink-200 pt-2.5">
              <Row label="Withdrawable" value={data.formatted.withdrawable} strong />
            </div>
          </CardBody>
        </Card>

        <Alert tone="info" title="Withdrawals arrive with the finance phase">
          Your ledger is real and keeps running. The withdrawal request screen, Paystack transfer and payout
          reconciliation ship in Phase 7, so the button below is deliberately not here yet.
        </Alert>

        <Card>
          <CardHeader title="Recent deliveries" subtitle="Net pay per completed trip" />
          <CardBody>
            {history.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : completed.length === 0 ? (
              <EmptyState
                title="Nothing paid yet"
                description="Completed deliveries appear here with the amount you earned after commission."
                action={{ label: 'Find a job', onClick: () => undefined }}
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {completed.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{job.reference}</p>
                      <p className="truncate text-xs text-ink-500">
                        {job.deliveredAt ? new Date(job.deliveredAt).toLocaleDateString('en-NG', { dateStyle: 'medium' }) : '—'} ·{' '}
                        {job.destination.address}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-accent-700">{job.pay.netFormatted}</p>
                      <Badge tone={job.earning?.status === 'PAID' ? 'success' : job.earning?.status === 'AVAILABLE' ? 'info' : 'warning'}>
                        {(job.earning?.status ?? 'pending').toLowerCase()}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <div className="pb-4 text-center text-sm text-ink-500">
          <Link to="/rider" className="font-semibold text-brand-700 underline">
            Back to overview
          </Link>
          {' · the commission rate is frozen per job at the moment you accept'}
        </div>
      </div>
    </PortalShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-semibold text-ink-900' : 'text-ink-600'}>{label}</span>
      <span className={strong ? 'font-bold text-ink-900 tabular-nums' : 'tabular-nums text-ink-800'}>{value}</span>
    </div>
  );
}
