import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
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
import { useMyWithdrawals, useRequestWithdrawal } from '../../hooks/usePayments';
import { Button, Input, Modal, Select, useToast } from '../../components/ui';
import { useApiError } from '../../contexts/AuthContext';

/** Nigerian banks offered by the payout form; the code is what Paystack needs. */
const BANKS = [
  { code: '058', name: 'GTBank' },
  { code: '011', name: 'First Bank' },
  { code: '044', name: 'Access Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '033', name: 'UBA' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '221', name: 'Stanbic IBTC' },
  { code: '035', name: 'Wema Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
];

const koboToNaira = (kobo: string) => (Number(kobo) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

export default function EarningsPage() {
  const profile = useRiderProfile();
  const earnings = useEarnings();
  const history = useJobHistory(1);
  const withdrawals = useMyWithdrawals(1);
  const requestWithdrawal = useRequestWithdrawal();
  const { notify } = useToast();

  const [open, setOpen] = useState(false);
  const [amountNaira, setAmountNaira] = useState('');
  const [bankCode, setBankCode] = useState(BANKS[0].code);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  // One key per attempt: a double-tap on "Request" cannot create two withdrawals.
  const [idempotencyKey, setIdempotencyKey] = useState(() => `wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

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

        <Card>
          <CardHeader
            title="Withdraw your earnings"
            subtitle="Requests are reviewed by the finance team, then paid to your bank"
            action={
              <Button
                onClick={() => {
                  setAmountNaira((Number(data.withdrawableKobo) / 100).toFixed(2));
                  setIdempotencyKey(`wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                  setOpen(true);
                }}
                disabled={BigInt(data.withdrawableKobo) <= 0n}
              >
                Request withdrawal
              </Button>
            }
          />
          <CardBody>
            {(withdrawals.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title="No withdrawals yet"
                description="Once an earning clears its hold you can request a payout to your bank account."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {withdrawals.data?.data.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">
                        {row.amountFormatted} → {row.bankName} {row.accountNumberMasked}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {new Date(row.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                        {row.decisionNote ? ` · ${row.decisionNote}` : ''}
                        {row.providerTransferRef ? ` · ref ${row.providerTransferRef}` : ''}
                      </p>
                    </div>
                    <Badge
                      tone={
                        row.status === 'PAID'
                          ? 'success'
                          : row.status === 'REJECTED' || row.status === 'FAILED'
                            ? 'danger'
                            : row.status === 'APPROVED' || row.status === 'PROCESSING'
                              ? 'info'
                              : 'warning'
                      }
                    >
                      {row.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

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

        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Request a withdrawal"
          description="The finance team reviews every request before the money leaves."
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                isLoading={requestWithdrawal.isPending}
                onClick={() => {
                  const bank = BANKS.find((option) => option.code === bankCode) ?? BANKS[0];
                  const kobo = BigInt(Math.round(Number(amountNaira.replace(/[^0-9.]/g, '')) * 100));
                  void requestWithdrawal
                    .mutateAsync({
                      amountKobo: kobo.toString(),
                      bankName: bank.name,
                      bankCode: bank.code,
                      accountNumber,
                      accountName,
                      idempotencyKey,
                    })
                    .then(() => {
                      notify({ tone: 'success', title: 'Withdrawal requested', description: 'Finance has been notified.' });
                      setOpen(false);
                      setAccountNumber('');
                      setAccountName('');
                    })
                    .catch((error: unknown) => {
                      notify({
                        tone: 'error',
                        title: 'Could not request the withdrawal',
                        description: useApiError(error) ?? 'Please check the details and try again.',
                      });
                    });
                }}
              >
                Request
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Amount (₦)"
              leftAddon="₦"
              inputMode="decimal"
              value={amountNaira}
              onChange={(event) => setAmountNaira(event.target.value)}
              hint={`You can withdraw up to ${data.formatted.withdrawable} right now`}
            />
            <Select
              label="Bank"
              value={bankCode}
              onChange={(event) => setBankCode(event.target.value)}
              options={BANKS.map((bank) => ({ value: bank.code, label: bank.name }))}
            />
            <Input
              label="Account number"
              inputMode="numeric"
              maxLength={10}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ''))}
              hint="10 digits, the account must be in your own name"
            />
            <Input
              label="Account name"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              hint="Exactly as it appears on your bank statement"
            />
          </div>
        </Modal>

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
