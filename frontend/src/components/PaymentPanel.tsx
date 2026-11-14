import { useCallback, useState } from 'react';
import { formatNaira } from '@dispatch/shared';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Select, useToast } from './ui';
import {
  useInitializeDeliveryPayment,
  usePayDeliveryWithWallet,
  usePaymentConfig,
  useSimulatePayment,
  useWallet,
  type PayProvider,
} from '../hooks/usePayments';
import { useApiError } from '../contexts/AuthContext';

/**
 * PAYING FOR A DELIVERY
 *
 * Two real paths and no third: from the wallet (instant, ledger-posted) or through
 * a gateway (the provider confirms, then we settle). In DEVELOPMENT the gateway is
 * simulated, and the panel says so plainly instead of pretending a card was charged.
 */
export function PaymentPanel({
  deliveryId,
  amountKobo,
  paymentStatus,
}: {
  deliveryId: string;
  amountKobo: string;
  paymentStatus: string;
}) {
  const config = usePaymentConfig();
  const wallet = useWallet();
  const initialize = useInitializeDeliveryPayment();
  const payWithWallet = usePayDeliveryWithWallet();
  const simulate = useSimulatePayment();
  const { notify } = useToast();

  const [provider, setProvider] = useState<PayProvider>('PAYSTACK');
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);

  const walletKobo = BigInt(wallet.data?.balanceKobo ?? '0');
  const simulated = config.data?.simulated ?? true;

  const payFromWallet = useCallback(async () => {
    try {
      const result = await payWithWallet.mutateAsync(deliveryId);
      notify({
        tone: 'success',
        title: 'Paid from your wallet',
        description: `Balance now ${result.walletBalanceFormatted}. Your rider has been notified.`,
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Payment failed', description: useApiError(error) ?? 'Please try again.' });
    }
  }, [deliveryId, notify, payWithWallet]);

  const startGateway = useCallback(async () => {
    try {
      const payment = await initialize.mutateAsync({ deliveryId, provider });
      if (payment.authorizationUrl) {
        setAuthorizationUrl(payment.authorizationUrl);
        window.location.href = payment.authorizationUrl;
        return;
      }
      setPendingReference(payment.reference);
      notify({
        tone: 'info',
        title: 'Payment started',
        description: simulated ? 'Simulated gateway — confirm it below to settle.' : 'Finish on the gateway page.',
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not start the payment', description: useApiError(error) ?? 'Try again.' });
    }
  }, [deliveryId, initialize, notify, provider, simulated]);

  const confirmSimulated = useCallback(async () => {
    if (!pendingReference) return;
    try {
      const result = await simulate.mutateAsync(pendingReference);
      notify({
        tone: 'success',
        title: result.alreadySettled ? 'Already paid' : 'Payment confirmed',
        description: 'Your delivery is paid and the rider can be dispatched.',
      });
      setPendingReference(null);
    } catch (error) {
      notify({ tone: 'error', title: 'Could not confirm', description: useApiError(error) ?? 'Try again.' });
    }
  }, [notify, pendingReference, simulate]);

  if (paymentStatus === 'PAID') {
    return (
      <Card>
        <CardBody className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">Paid</p>
            <p className="text-xs text-ink-500">{formatNaira(amountKobo)} received — nothing left to do.</p>
          </div>
          <Badge tone="success">settled</Badge>
        </CardBody>
      </Card>
    );
  }

  if (paymentStatus === 'REFUNDED' || paymentStatus === 'PARTIALLY_REFUNDED') {
    return (
      <Alert tone="info" title="Refund in progress">
        {formatNaira(amountKobo)} was refunded for this delivery. Refunds return to the wallet or original payment method.
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader title="Pay for this delivery" subtitle={`${formatNaira(amountKobo)} is due`} />
      <CardBody className="space-y-4">
        <div className="rounded-xl border border-ink-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink-900">Pay from wallet</p>
              <p className="text-xs text-ink-500">Balance {wallet.data?.balanceFormatted ?? formatNaira('0')}</p>
            </div>
            <Button
              variant={walletKobo >= BigInt(amountKobo) ? 'primary' : 'secondary'}
              onClick={() => void payFromWallet()}
              isLoading={payWithWallet.isPending}
              disabled={walletKobo < BigInt(amountKobo)}
            >
              {walletKobo >= BigInt(amountKobo) ? 'Pay now' : 'Not enough balance'}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 p-3">
          <p className="text-sm font-semibold text-ink-900">Pay with card or transfer</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[160px] flex-1">
              <Select
                label="Provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value as PayProvider)}
                options={(config.data?.providers ?? [{ key: 'PAYSTACK', label: 'Paystack' }]).map((option) => ({
                  value: option.key,
                  label: option.label,
                }))}
              />
            </div>
            <Button onClick={() => void startGateway()} isLoading={initialize.isPending}>
              Continue to payment
            </Button>
          </div>
        </div>

        {pendingReference && (
          <div className="rounded-xl border border-warning-300 bg-warning-50 p-3">
            <p className="text-sm font-semibold text-ink-900">
              {simulated ? 'Simulated payment awaiting confirmation' : 'Waiting for the gateway'}
            </p>
            <p className="mt-0.5 font-mono text-xs text-ink-600">{pendingReference}</p>
            {simulated ? (
              <Button className="mt-2" onClick={() => void confirmSimulated()} isLoading={simulate.isPending}>
                Confirm payment
              </Button>
            ) : (
              <Button className="mt-2" variant="secondary" onClick={() => void confirmSimulated()}>
                I have paid — check now
              </Button>
            )}
          </div>
        )}

        {authorizationUrl && (
          <a href={authorizationUrl} className="text-sm font-semibold text-brand-700 underline">
            Reopen the payment page
          </a>
        )}

        {simulated && (
          <Alert tone="warning" title="Test payments">
            Payments are in test mode, so no real money leaves any account. Everything else — the receipt, the wallet
            entry and the rider's earnings — behaves exactly as it will when live payments are switched on.
          </Alert>
        )}
      </CardBody>
    </Card>
  );
}
