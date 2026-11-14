import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CHAT_OPEN_STATUSES, DELIVERY_STATUS_LABELS, formatNaira, formatNgPhone } from '@dispatch/shared';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Modal,
  Textarea,
  useToast,
} from '../../components/ui';
import { PriceBreakdown } from '../../components/PriceBreakdown';
import { PaymentPanel } from '../../components/PaymentPanel';
import { DeliveryTrackingCard } from '../../components/DeliveryTrackingCard';
import { ContactCard } from '../../components/ContactCard';
import { CUSTOMER_NAV } from './nav';
import { useCancelDelivery, useDelivery } from '../../hooks/useDeliveries';
import { useApiError } from '../../contexts/AuthContext';
import { cn } from '../../lib/cn';
import { LIVE_EVENTS, useLiveEvent } from '../../lib/live';

export default function DeliveryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useToast();
  const { data: delivery, isLoading, isError } = useDelivery(id);
  const cancelDelivery = useCancelDelivery(id ?? '');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();

  // A rider accepting, arriving or delivering updates this page while it is open.
  useLiveEvent(
    LIVE_EVENTS.DELIVERY_UPDATED,
    useCallback(
      (payload: unknown) => {
        const update = payload as { deliveryId?: string };
        if (update.deliveryId && id && update.deliveryId !== id) return;
        void queryClient.invalidateQueries({ queryKey: ['delivery', id] });
        void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      },
      [id, queryClient],
    ),
  );

  const cancellable = delivery && ['PENDING', 'ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP'].includes(delivery.status);

  const doCancel = async () => {
    try {
      await cancelDelivery.mutateAsync(reason);
      notify({ tone: 'success', title: 'Delivery cancelled', description: 'No charge is owed for a cancelled booking.' });
      setConfirmOpen(false);
      setReason('');
    } catch (error) {
      notify({ tone: 'error', title: 'Could not cancel', description: useApiError(error) ?? 'Please try again.' });
    }
  };

  return (
    <PortalShell portal="Customer" nav={CUSTOMER_NAV}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-center justify-between">
          <Link to="/app/deliveries" className="text-sm font-medium text-brand-700 hover:underline">
            ← All deliveries
          </Link>
          {cancellable && (
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Cancel delivery
            </Button>
          )}
        </div>

        {isLoading && <p className="text-sm text-ink-500">Loading delivery…</p>}
        {isError && (
          <Alert tone="danger" title="Delivery not found">
            It may belong to another account. <Link to="/app/deliveries" className="underline">Back to your deliveries</Link>.
          </Alert>
        )}

        {delivery && (
          <>
            <Card>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-ink-500">{delivery.reference}</p>
                    <h1 className="mt-1 text-xl font-bold text-ink-900">
                      {DELIVERY_STATUS_LABELS[delivery.status as keyof typeof DELIVERY_STATUS_LABELS] ?? delivery.status}
                    </h1>
                    <p className="mt-1 text-sm text-ink-500">
                      Booked {new Date(delivery.createdAt).toLocaleString('en-NG')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums text-ink-900">{formatNaira(delivery.chargeKobo)}</p>
                    <Badge tone={delivery.paymentStatus === 'PAID' ? 'success' : 'warning'}>
                      {delivery.paymentStatus === 'PAID' ? 'Paid' : 'Payment pending'}
                    </Badge>
                  </div>
                </div>

                {delivery.status === 'CANCELLED' && (
                  <Alert tone="warning" title="This delivery was cancelled">
                    {delivery.cancellationReason ?? 'No reason recorded.'}
                  </Alert>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Pickup</p>
                    <p className="mt-1 text-sm font-medium text-ink-900">{delivery.pickup.address}</p>
                    {delivery.pickup.landmark && <p className="text-xs text-ink-500">{delivery.pickup.landmark}</p>}
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Drop-off</p>
                    <p className="mt-1 text-sm font-medium text-ink-900">{delivery.destination.address}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {delivery.recipient.name} · {formatNgPhone(delivery.recipient.phone)}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <PaymentPanel
              deliveryId={delivery.id}
              amountKobo={delivery.chargeKobo}
              paymentStatus={delivery.paymentStatus}
            />

            <DeliveryTrackingCard deliveryId={delivery.id} status={delivery.status} />

            <ContactCard
              deliveryId={delivery.id}
              perspective="CUSTOMER"
              counterpartName={delivery.riderFirstName ?? undefined}
              enabled={(CHAT_OPEN_STATUSES as readonly string[]).includes(delivery.status)}
            />

            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader title="Price you were charged" subtitle="Frozen at booking — later rule changes cannot alter it" />
                <CardBody>
                  <PriceBreakdown
                    lines={delivery.priceSnapshot.lines ?? []}
                    totalKobo={delivery.chargeKobo}
                    compact
                    meta={{
                      distanceKm: delivery.priceSnapshot.distanceKm,
                      zoneName: delivery.priceSnapshot.zoneName,
                    }}
                  />
                  <p className="mt-2 text-xs text-ink-400">
                    Priced by {delivery.priceSnapshot.ruleName ?? 'the active rule'} v{delivery.priceSnapshot.ruleVersion ?? 1}
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Package" subtitle="What the rider is carrying" />
                <CardBody className="space-y-3 text-sm">
                  <p className="font-medium text-ink-900">{delivery.package.description}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">{delivery.package.category}</Badge>
                    <Badge tone="neutral">{delivery.deliveryType.replace('_', ' ').toLowerCase()}</Badge>
                    {delivery.package.isFragile && <Badge tone="warning">fragile</Badge>}
                    {delivery.package.weightKg && <Badge tone="neutral">{delivery.package.weightKg} kg</Badge>}
                  </div>
                  {delivery.package.specialInstructions && (
                    <p className="rounded-lg bg-ink-50 p-2.5 text-xs text-ink-600">
                      {delivery.package.specialInstructions}
                    </p>
                  )}
                  {delivery.scheduledFor && (
                    <p className="text-xs text-ink-500">
                      Scheduled for {new Date(delivery.scheduledFor).toLocaleString('en-NG')}
                    </p>
                  )}
                </CardBody>
              </Card>
            </div>

            {delivery.timeline && delivery.timeline.length > 0 && (
              <Card>
                <CardHeader title="Progress" subtitle="Who handled your parcel, and when" />
                <CardBody>
                  <ol className="space-y-3">
                    {delivery.timeline.map((entry, index) => (
                      <li key={`${entry.status}-${entry.at}`} className="flex gap-3">
                        <span
                          className={cn(
                            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                            index === delivery.timeline!.length - 1 ? 'bg-brand-500' : 'bg-ink-300',
                          )}
                        />
                        <div>
                          <p className="text-sm font-medium text-ink-900">
                            {DELIVERY_STATUS_LABELS[entry.status as keyof typeof DELIVERY_STATUS_LABELS] ?? entry.status}
                          </p>
                          <p className="text-xs text-ink-500">{new Date(entry.at).toLocaleString('en-NG')}</p>
                          {entry.reason && <p className="text-xs text-ink-500">“{entry.reason}”</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {delivery.status === 'PENDING' && (
                    <p className="mt-4 rounded-lg bg-info-50 p-2.5 text-xs text-info-800">
                      Waiting for a rider — the dispatch engine is offering this job to the closest riders. The live map below fills in as soon as a rider accepts.
                    </p>
                  )}
                </CardBody>
              </Card>
            )}
          </>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Cancel this delivery?"
        description="You can cancel until a rider picks the package up. This cannot be undone."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => void doCancel()}
              isLoading={cancelDelivery.isPending}
              disabled={reason.trim().length < 5}
            >
              Cancel delivery
            </Button>
          </div>
        }
      >
        <Field
          label="Why are you cancelling?"
          required
          hint="Shared with support so we can improve"
          htmlFor="cancel-reason"
        >
          <Textarea
            id="cancel-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </Modal>
    </PortalShell>
  );
}
