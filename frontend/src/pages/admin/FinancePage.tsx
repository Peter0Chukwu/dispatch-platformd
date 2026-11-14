import { useState } from 'react';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  ErrorState,
  Input,
  Modal,
  Spinner,
  StatCard,
  Tabs,
  useToast,
  type Column,
} from '../../components/ui';
import { adminNav } from './nav';
import {
  useAdminPayments,
  useAdminRefunds,
  useAdminWithdrawals,
  useCreateRefund,
  useFinanceSummary,
  usePayWithdrawal,
  useReconciliation,
  useWithdrawalDecision,
  type AdminPayment,
  type Reconciliation,
  type RefundRecord,
  type WithdrawalRecord,
} from '../../hooks/usePayments';
import { useApiError, useAuth } from '../../contexts/AuthContext';

type TabKey = 'overview' | 'reconciliation' | 'payments' | 'withdrawals' | 'refunds';

const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * THE FINANCE DESK
 *
 * Six real questions, answered from the database:
 *   · how much came in, and what did the gateways keep?
 *   · what do riders earn, what has been paid out, what is queued?
 *   · do the books balance, and does every payment have a journal entry?
 *   · which withdrawals need a human decision?
 *   · what has been refunded, and why?
 *
 * Nothing on this page is a placeholder. If a number is zero, it is because the
 * ledger says zero.
 */
export default function FinancePage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const { hasPermission } = useAuth();
  const nav = adminNav(hasPermission);

  const canReadFinance = hasPermission('finance:read');
  const canReadLedger = hasPermission('ledger:read');
  const summary = useFinanceSummary(canReadFinance);
  const reconciliation = useReconciliation(canReadLedger && tab === 'reconciliation');

  const tabs = [
    { value: 'overview' as const, label: 'Overview' },
    ...(canReadLedger ? [{ value: 'reconciliation' as const, label: 'Reconciliation' }] : []),
    { value: 'payments' as const, label: 'Payments' },
    { value: 'withdrawals' as const, label: 'Withdrawals' },
    { value: 'refunds' as const, label: 'Refunds' },
  ];

  return (
    <PortalShell portal="Admin" nav={nav}>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Finance</h1>
          <p className="mt-1 text-sm text-ink-500">
            Money in, money out, and the double-entry books behind both. Every figure is computed from rows.
          </p>
        </div>

        <Tabs tabs={tabs} value={tab} onChange={(next) => setTab(next as TabKey)} />

        {tab === 'overview' && (
          <OverviewTab
            summary={summary}
            onOpenWithdrawals={() => setTab('withdrawals')}
            canReadFinance={canReadFinance}
          />
        )}
        {tab === 'reconciliation' && <ReconciliationTab reconciliation={reconciliation} />}
        {tab === 'payments' && <PaymentsTab canRefund={hasPermission('finance:refund:write')} />}
        {tab === 'withdrawals' && (
          <WithdrawalsTab
            canApprove={hasPermission('withdrawal:approve')}
            canPay={hasPermission('withdrawal:payout')}
          />
        )}
        {tab === 'refunds' && <RefundsTab />}
      </div>
    </PortalShell>
  );
}

/* ─────────────────────────────── overview ─────────────────────────────── */

function OverviewTab({
  summary,
  onOpenWithdrawals,
  canReadFinance,
}: {
  summary: ReturnType<typeof useFinanceSummary>;
  onOpenWithdrawals: () => void;
  canReadFinance: boolean;
}) {
  if (!canReadFinance) {
    return <Alert tone="warning" title="Finance access required">Your role does not include `finance:read`.</Alert>;
  }
  if (summary.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (summary.isError || !summary.data) {
    return <ErrorState title="Could not load the finance summary" onRetry={() => void summary.refetch()} />;
  }

  const data = summary.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Collected"
          value={data.collected.amountFormatted}
          hint={`${data.collected.payments} successful payment${data.collected.payments === 1 ? '' : 's'}`}
        />
        <StatCard label="Rider cost" value={data.riders.netFormatted} hint={`commission kept ${formatKobo(data.riders.commissionKobo)}`} />
        <StatCard label="Gateway fees" value={data.collected.gatewayFeesFormatted} hint="what Paystack and Flutterwave kept" />
        <StatCard label="Net" value={data.net.formatted} hint={`margin ${data.net.margin.toFixed(2)}% of revenue`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Where the money went" subtitle="Revenue minus refunds, rider cost and gateway fees" />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Delivery revenue" value={formatKobo(data.revenue.deliveryKobo)} />
            <Row label="Surcharge revenue" value={formatKobo(data.revenue.surchargeKobo)} />
            <Row label="Refunds issued" value={`− ${data.refunds.amountFormatted}`} />
            <Row label="Rider net earnings" value={`− ${data.riders.netFormatted}`} />
            <Row label="Gateway fees" value={`− ${data.collected.gatewayFeesFormatted}`} />
            <div className="border-t border-ink-200 pt-2.5">
              <Row label="Net position" value={data.net.formatted} strong />
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Rider payouts"
              subtitle={`${data.riders.pendingWithdrawals} withdrawal${data.riders.pendingWithdrawals === 1 ? '' : 's'} waiting`}
              action={
                <Button variant="secondary" onClick={onOpenWithdrawals}>
                  Open queue
                </Button>
              }
            />
            <CardBody className="space-y-2.5 text-sm">
              <Row label="Accrued to riders (gross)" value={formatKobo(data.riders.grossKobo)} />
              <Row label="Commission kept" value={formatKobo(data.riders.commissionKobo)} />
              <Row label="Paid out" value={data.riders.paidOutFormatted} />
              <Row label="Queued for approval" value={data.riders.pendingValueFormatted} strong />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer wallets" subtitle="Money customers have with us, owed back on demand" />
            <CardBody className="space-y-2.5 text-sm">
              <Row label="Total wallet liability" value={data.walletLiability.balanceFormatted} strong />
              {data.byProvider.length === 0 ? (
                <p className="text-xs text-ink-500">No gateway payments yet.</p>
              ) : (
                data.byProvider.map((row) => (
                  <Row key={row.provider} label={`${row.provider} (${row.count})`} value={row.amountFormatted} />
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-semibold text-ink-900' : 'text-ink-600'}>{label}</span>
      <span className={strong ? 'font-bold tabular-nums text-ink-900' : 'tabular-nums text-ink-800'}>{value}</span>
    </div>
  );
}

const formatKobo = (kobo: string) =>
  (Number(kobo) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

/* ───────────────────────────── reconciliation ──────────────────────────── */

function ReconciliationTab({ reconciliation }: { reconciliation: ReturnType<typeof useReconciliation> }) {
  if (reconciliation.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  if (reconciliation.isError || !reconciliation.data) {
    return <ErrorState title="Could not run the reconciliation" onRetry={() => void reconciliation.refetch()} />;
  }

  const data: Reconciliation = reconciliation.data;
  const failures = data.checks.filter((check) => !check.ok);

  return (
    <div className="space-y-5">
      <Alert
        tone={failures.length === 0 ? 'success' : 'danger'}
        title={failures.length === 0 ? 'The books reconcile' : `${failures.length} check${failures.length === 1 ? '' : 's'} need attention`}
      >
        {failures.length === 0
          ? `Debits and credits agree at ${formatKobo(data.totals.debitsKobo)}, every payment is posted and every balance matches.`
          : 'Investigate the failing checks below before closing the day.'}
      </Alert>

      <div className="grid gap-3 md:grid-cols-2">
        {data.checks.map((check) => (
          <Card key={check.name}>
            <CardBody className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">{check.name}</p>
                <Badge tone={check.ok ? 'success' : 'danger'}>{check.ok ? 'pass' : 'fail'}</Badge>
              </div>
              <p className="text-xs text-ink-500">{check.detail}</p>
              {check.offenders && check.offenders.length > 0 && (
                <p className="font-mono text-[11px] text-danger-700">{check.offenders.join(', ')}</p>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Trial balance" subtitle="Every account with movement, straight from the journal" />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50/70 text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 py-2.5 text-left font-semibold">Account</th>
                <th className="px-4 py-2.5 text-right font-semibold">Debits</th>
                <th className="px-4 py-2.5 text-right font-semibold">Credits</th>
                <th className="px-4 py-2.5 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => (
                <tr key={account.code} className="border-b border-ink-100 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-ink-400">{account.code}</span>
                    <span className="ml-2 text-ink-800">{account.name}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{formatKobo(account.debitKobo)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">{formatKobo(account.creditKobo)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink-900">{formatKobo(account.balanceKobo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 text-xs font-semibold text-ink-700">
                <td className="px-4 py-2.5">Totals</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatKobo(data.totals.debitsKobo)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatKobo(data.totals.creditsKobo)}</td>
                <td className="px-4 py-2.5 text-right">{data.trialBalanceBalanced ? 'balanced' : 'out of balance'}</td>
              </tr>
            </tfoot>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── payments ──────────────────────────────── */

function PaymentsTab({ canRefund }: { canRefund: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const payments = useAdminPayments(page, status);
  const createRefund = useCreateRefund();
  const { notify } = useToast();
  const [refundFor, setRefundFor] = useState<AdminPayment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const columns: Column<AdminPayment>[] = [
    {
      key: 'reference',
      header: 'Payment',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-ink-900">{row.reference}</p>
          <p className="text-xs text-ink-500">{row.delivery?.reference ?? 'Wallet top-up'}</p>
        </div>
      ),
    },
    { key: 'customer', header: 'Customer', render: (row) => <span className="text-ink-700">{row.customer}</span>, hideOnMobile: true },
    { key: 'provider', header: 'Provider', render: (row) => <Badge tone="neutral">{row.provider.toLowerCase()}</Badge>, hideOnMobile: true },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => <span className="font-semibold tabular-nums text-ink-900">{row.amountFormatted}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge
          tone={row.status === 'SUCCESS' ? 'success' : row.status === 'PENDING' ? 'warning' : row.status === 'FAILED' ? 'danger' : 'neutral'}
        >
          {row.status.toLowerCase()}
        </Badge>
      ),
    },
    { key: 'when', header: 'When', render: (row) => <span className="text-xs text-ink-500">{dateTime(row.paidAt ?? row.createdAt)}</span>, hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canRefund && row.status === 'SUCCESS' ? (
          <Button
            variant="secondary"
            onClick={() => {
              setRefundFor(row);
              setRefundAmount((Number(row.amountKobo) / 100).toFixed(2));
              setRefundReason('');
            }}
          >
            Refund
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[
          { value: undefined as string | undefined, label: 'All' },
          { value: 'SUCCESS', label: 'Successful' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'FAILED', label: 'Failed' },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              setStatus(option.value);
              setPage(1);
            }}
            className={
              status === option.value
                ? 'rounded-full bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-brand-400'
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={payments.data?.data}
        isLoading={payments.isLoading}
        emptyTitle="No payments yet"
        emptyDescription="Successful, pending and failed charges all appear here."
        page={page}
        pageSize={payments.data?.meta.pageSize}
        total={payments.data?.meta.total}
        onPageChange={setPage}
      />

      <Modal
        open={!!refundFor}
        onClose={() => setRefundFor(null)}
        title="Issue a refund"
        description={refundFor ? `Payment ${refundFor.reference} · ${refundFor.amountFormatted}` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRefundFor(null)}>
              Cancel
            </Button>
            <Button
              isLoading={createRefund.isPending}
              onClick={() => {
                if (!refundFor) return;
                const kobo = BigInt(Math.round(Number(refundAmount.replace(/[^0-9.]/g, '')) * 100));
                void createRefund
                  .mutateAsync({ paymentId: refundFor.id, amountKobo: kobo.toString(), reason: refundReason })
                  .then(() => {
                    notify({ tone: 'success', title: 'Refund issued', description: 'The books and the customer were updated.' });
                    setRefundFor(null);
                  })
                  .catch((error: unknown) =>
                    notify({ tone: 'error', title: 'Refund failed', description: useApiError(error) ?? 'Try again.' }),
                  );
              }}
            >
              Refund
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label="Amount (₦)" leftAddon="₦" inputMode="decimal" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} />
          <Input
            label="Reason"
            value={refundReason}
            onChange={(event) => setRefundReason(event.target.value)}
            hint="Shown in the refund log and on the ledger entry"
          />
          <p className="rounded-xl bg-ink-100 px-3 py-2 text-xs text-ink-600">
            A wallet payment goes straight back to the customer's wallet. A card payment is reversed with the provider,
            and the reversal is recorded against that payment.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ────────────────────────────── withdrawals ────────────────────────────── */

function WithdrawalsTab({ canApprove, canPay }: { canApprove: boolean; canPay: boolean }) {
  const [status, setStatus] = useState<string | undefined>('REQUESTED');
  const [page, setPage] = useState(1);
  const list = useAdminWithdrawals(status, page);
  const decision = useWithdrawalDecision();
  const payout = usePayWithdrawal();
  const { notify } = useToast();
  const [rejecting, setRejecting] = useState<WithdrawalRecord | null>(null);
  const [note, setNote] = useState('');

  const columns: Column<WithdrawalRecord>[] = [
    {
      key: 'rider',
      header: 'Rider',
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-ink-900">{row.rider?.name ?? '—'}</p>
          <p className="font-mono text-[11px] text-ink-500">{row.rider?.riderCode ?? row.riderId.slice(0, 8)}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="font-semibold tabular-nums">{row.amountFormatted}</span> },
    {
      key: 'bank',
      header: 'Bank account',
      render: (row) => (
        <div>
          <p className="text-sm text-ink-800">{row.bankName}</p>
          <p className="font-mono text-[11px] text-ink-500">
            {row.accountNumberMasked} · {row.accountName}
          </p>
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
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
      ),
    },
    { key: 'when', header: 'Requested', render: (row) => <span className="text-xs text-ink-500">{dateTime(row.createdAt)}</span>, hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          {row.status === 'REQUESTED' && canApprove && (
            <>
              <Button
                isLoading={decision.isPending}
                onClick={() =>
                  void decision
                    .mutateAsync({ id: row.id, action: 'approve' })
                    .then(() => notify({ tone: 'success', title: 'Approved', description: 'The obligation moved to withdrawals payable.' }))
                    .catch((error: unknown) => notify({ tone: 'error', title: 'Could not approve', description: useApiError(error) ?? '' }))
                }
              >
                Approve
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(row)}>
                Reject
              </Button>
            </>
          )}
          {row.status === 'APPROVED' && canPay && (
            <Button
              isLoading={payout.isPending}
              onClick={() =>
                void payout
                  .mutateAsync(row.id)
                  .then(() => notify({ tone: 'success', title: 'Payout sent', description: 'The rider has been notified.' }))
                  .catch((error: unknown) => notify({ tone: 'error', title: 'Payout failed', description: useApiError(error) ?? '' }))
              }
            >
              Pay rider
            </Button>
          )}
          {row.failureReason && <span className="text-[11px] text-danger-700">{row.failureReason}</span>}
        </div>
      ),
    },
  ];

  const summary = list.data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting approval" value={String(summary?.requested ?? 0)} hint="needs a finance decision" isLoading={list.isLoading} />
        <StatCard label="Approved, unpaid" value={String((summary?.approved ?? 0) + (summary?.processing ?? 0))} hint="ready to pay" isLoading={list.isLoading} />
        <StatCard label="Queued value" value={formatKobo(summary?.pendingValueKobo ?? '0')} hint="in transit" isLoading={list.isLoading} />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { value: 'REQUESTED', label: 'Requested' },
          { value: 'APPROVED', label: 'Approved' },
          { value: 'PAID', label: 'Paid' },
          { value: 'REJECTED', label: 'Rejected' },
          { value: undefined as string | undefined, label: 'All' },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              setStatus(option.value);
              setPage(1);
            }}
            className={
              status === option.value
                ? 'rounded-full bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-brand-400'
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={list.data?.data}
        isLoading={list.isLoading}
        emptyTitle="Nothing in this queue"
        emptyDescription="Withdrawal requests from riders land here for review."
        page={page}
        pageSize={list.data?.meta.pageSize}
        total={list.data?.meta.total}
        onPageChange={setPage}
      />

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject this withdrawal"
        description={rejecting ? `${rejecting.amountFormatted} to ${rejecting.rider?.name ?? 'rider'}` : ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              isLoading={decision.isPending}
              onClick={() => {
                if (!rejecting) return;
                void decision
                  .mutateAsync({ id: rejecting.id, action: 'reject', note })
                  .then(() => {
                    notify({ tone: 'success', title: 'Rejected', description: 'The rider can request again.' });
                    setRejecting(null);
                    setNote('');
                  })
                  .catch((error: unknown) =>
                    notify({ tone: 'error', title: 'Could not reject', description: useApiError(error) ?? '' }),
                  );
              }}
            >
              Reject withdrawal
            </Button>
          </div>
        }
      >
        <Input
          label="Reason"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="The rider sees this, so keep it factual"
        />
      </Modal>
    </div>
  );
}

/* ──────────────────────────────── refunds ──────────────────────────────── */

function RefundsTab() {
  const [page, setPage] = useState(1);
  const refunds = useAdminRefunds(page);

  const columns: Column<RefundRecord>[] = [
    {
      key: 'reference',
      header: 'Refund',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-semibold text-ink-900">{row.paymentReference}</p>
          <p className="text-xs text-ink-500">{row.payment?.delivery?.reference ?? 'Wallet top-up'}</p>
        </div>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', render: (row) => <span className="font-semibold tabular-nums">{row.amountFormatted}</span> },
    { key: 'reason', header: 'Reason', render: (row) => <span className="text-ink-700">{row.reason}</span> },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'COMPLETED' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'}>{row.status.toLowerCase()}</Badge> },
    { key: 'when', header: 'When', render: (row) => <span className="text-xs text-ink-500">{dateTime(row.completedAt ?? row.createdAt)}</span>, hideOnMobile: true },
  ];

  return (
    <DataTable
      columns={columns}
      rows={refunds.data?.data}
      isLoading={refunds.isLoading}
      emptyTitle="No refunds issued"
      emptyDescription="Refunds appear here with the reason and the journal entry behind them."
      page={page}
      pageSize={refunds.data?.meta.pageSize}
      total={refunds.data?.meta.total}
      onPageChange={setPage}
    />
  );
}
