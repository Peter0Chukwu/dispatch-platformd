import { useCallback, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Modal, Select, Spinner, StatCard, useToast } from '../../components/ui';
import { PortalShell } from '../../layouts/PortalShell';
import { CUSTOMER_NAV } from './nav';
import { useApiError } from '../../contexts/AuthContext';
import {
  useMyPayments,
  usePaymentConfig,
  useSimulatePayment,
  useTopUpWallet,
  useWallet,
  useWalletTransactions,
  type PayProvider,
} from '../../hooks/usePayments';

const PRESETS_KOBO = [200_000n, 500_000n, 1_000_000n, 2_000_000n];

const naira = (kobo: string) =>
  Number(kobo) / 100 === 0
    ? '₦0'
    : (Number(kobo) / 100).toLocaleString('en-NG', { style: 'currency', currency: 'NGN' });

export default function WalletPage() {
  const wallet = useWallet();
  const transactions = useWalletTransactions(1);
  const payments = useMyPayments(1);
  const config = usePaymentConfig();
  const topUp = useTopUpWallet();
  const simulate = useSimulatePayment();
  const { notify } = useToast();

  const [open, setOpen] = useState(false);
  const [amountNaira, setAmountNaira] = useState('5000');
  const [provider, setProvider] = useState<PayProvider>('PAYSTACK');
  const [pendingReference, setPendingReference] = useState<string | null>(null);

  const simulated = config.data?.simulated ?? true;

  const startTopUp = useCallback(
    async (kobo: bigint) => {
      try {
        const payment = await topUp.mutateAsync({ amountKobo: kobo.toString(), provider });
        if (payment.authorizationUrl) {
          window.location.href = payment.authorizationUrl;
          return;
        }
        setPendingReference(payment.reference);
        notify({
          tone: 'success',
          title: 'Top-up started',
          description: simulated
            ? 'Simulated gateway — confirm it below to credit your wallet.'
            : 'Finish the payment on the gateway page.',
        });
      } catch (error) {
        notify({ tone: 'error', title: 'Could not start the top-up', description: useApiError(error) ?? 'Try again.' });
      }
    },
    [notify, provider, simulated, topUp],
  );

  const confirmSimulated = useCallback(
    async (reference: string) => {
      try {
        await simulate.mutateAsync(reference);
        notify({ tone: 'success', title: 'Wallet credited', description: 'The money is in your wallet and on the ledger.' });
        setPendingReference(null);
        setOpen(false);
      } catch (error) {
        notify({ tone: 'error', title: 'Could not confirm', description: useApiError(error) ?? 'Try again.' });
      }
    },
    [notify, simulate],
  );

  const submit = async () => {
    const kobo = BigInt(Math.round(Number(amountNaira.replace(/[^0-9.]/g, '')) * 100));
    if (kobo < 10_000n) {
      notify({ tone: 'error', title: 'Too small', description: 'The minimum top-up is ₦100.' });
      return;
    }
    await startTopUp(kobo);
  };

  return (
    <PortalShell portal="Customer" nav={CUSTOMER_NAV}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Wallet</h1>
            <p className="mt-1 text-sm text-ink-500">
              Money you add here pays for deliveries instantly. Every movement is on the books.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>Add money</Button>
        </div>

        {wallet.isError && <ErrorState message="We could not load your wallet." onRetry={() => void wallet.refetch()} />}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Balance"
            value={wallet.isLoading ? '—' : (wallet.data?.balanceFormatted ?? naira('0'))}
            hint="available to spend"
            isLoading={wallet.isLoading}
          />
          <StatCard
            label="Top-ups settled"
            value={
              wallet.isLoading
                ? '—'
                : String(
                    (transactions.data?.data ?? []).filter((row) => row.category === 'TOPUP' && row.direction === 'CREDIT').length,
                  )
            }
            hint="confirmed by the gateway"
            isLoading={transactions.isLoading}
          />
          <StatCard
            label="Payments made"
            value={wallet.isLoading ? '—' : String(payments.data?.meta.total ?? 0)}
            hint="deliveries and top-ups"
            isLoading={payments.isLoading}
          />
        </div>

        {pendingReference && (
          <Card className="border-warning-300 bg-warning-50">
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">Top-up awaiting confirmation</p>
                <p className="mt-0.5 font-mono text-xs text-ink-600">{pendingReference}</p>
              </div>
              <Button onClick={() => void confirmSimulated(pendingReference)} isLoading={simulate.isPending}>
                {simulated ? 'Confirm simulated payment' : 'Check payment'}
              </Button>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Statement" subtitle="Newest first — credits and debits as they were posted" />
          <CardBody>
            {transactions.isLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : (transactions.data?.data.length ?? 0) === 0 ? (
              <EmptyState
                title="No wallet activity yet"
                description="Add money, or pay for a delivery from your wallet, and it will show up here."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {transactions.data?.data.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{row.description ?? row.category}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {new Date(row.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                        {row.category.replace(/_/g, ' ').toLowerCase()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={
                          row.direction === 'CREDIT'
                            ? 'text-sm font-semibold text-accent-700 tabular-nums'
                            : 'text-sm font-semibold text-ink-900 tabular-nums'
                        }
                      >
                        {row.direction === 'CREDIT' ? '+' : '−'} {row.amountFormatted}
                      </p>
                      <p className="text-xs text-ink-500">balance {row.balanceAfterFormatted}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment history" subtitle="Every charge attempt, successful or not" />
          <CardBody>
            {(payments.data?.data.length ?? 0) === 0 ? (
              <EmptyState title="No payments yet" description="Pay for a delivery and the receipt appears here." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {payments.data?.data.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {row.purpose === 'WALLET_TOPUP' ? 'Wallet top-up' : 'Delivery payment'} ·{' '}
                        <span className="font-mono text-xs text-ink-500">{row.reference}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {row.provider} · {new Date(row.createdAt ?? Date.now()).toLocaleString('en-NG', { dateStyle: 'medium' })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-ink-900">{row.amountFormatted}</span>
                      <Badge
                        tone={
                          row.status === 'SUCCESS' ? 'success' : row.status === 'PENDING' ? 'warning' : row.status === 'FAILED' ? 'danger' : 'neutral'
                        }
                      >
                        {row.status.toLowerCase()}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add money to your wallet"
        description="Choose an amount and how you want to pay. Your wallet is credited only when the payment is confirmed."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} isLoading={topUp.isPending}>
              Continue
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS_KOBO.map((preset) => (
              <button
                key={preset.toString()}
                type="button"
                onClick={() => setAmountNaira(String(Number(preset) / 100))}
                className="rounded-full border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:border-brand-400 hover:text-brand-700"
              >
                {naira(preset.toString())}
              </button>
            ))}
          </div>
          <Input
            label="Amount (₦)"
            inputMode="decimal"
            leftAddon="₦"
            value={amountNaira}
            onChange={(event) => setAmountNaira(event.target.value)}
            hint="Minimum ₦100, maximum ₦500,000 per top-up"
          />
          <Select
            label="Pay with"
            value={provider}
            onChange={(event) => setProvider(event.target.value as PayProvider)}
            options={(config.data?.providers ?? [{ key: 'PAYSTACK', label: 'Paystack' }]).map((option) => ({
              value: option.key,
              label: option.label,
            }))}
          />
          {simulated && (
            <p className="rounded-xl bg-ink-100 px-3 py-2 text-xs text-ink-600">
              This environment runs the payment simulator: no card is charged. You will be asked to confirm the top-up after
              it is created.
            </p>
          )}
        </div>
      </Modal>
    </PortalShell>
  );
}
