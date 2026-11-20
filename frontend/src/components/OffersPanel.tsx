import { Badge, Button, Card, CardBody, CardHeader, useToast } from './ui';
import { formatNaira } from '@dispatch/shared';
import {
  useAcceptOfferPrice,
  useDeclineOfferPrice,
  useDeliveryOffers,
  type DeliveryOffer,
} from '../hooks/useDeliveries';
import { useApiError } from '../contexts/AuthContext';

/**
 * THE BILL, AND WHAT RIDERS SAID ABOUT IT
 *
 * A customer's own page while the job is on the board. It shows the two numbers
 * that matter — the bill and what they asked for — and every rider who named a
 * price of their own, with Accept and Decline beside it.
 *
 * Declining is not a dead end: the rider's offer stays open at the asking price, so
 * a customer who turns down ₦2,500 has not lost the rider who might still take
 * ₦2,000. The server enforces that; this screen only reflects it.
 */
export function OffersPanel({ deliveryId }: { deliveryId: string }) {
  const { notify } = useToast();
  const offers = useDeliveryOffers(deliveryId);
  const accept = useAcceptOfferPrice(deliveryId);
  const decline = useDeclineOfferPrice(deliveryId);

  const data = offers.data;
  const pending = (data?.offers ?? []).filter((offer) => offer.counterState === 'PENDING');

  const take = async (offer: DeliveryOffer) => {
    try {
      await accept.mutateAsync(offer.assignmentId);
      notify({
        tone: 'success',
        title: 'Rider booked',
        description: `${offer.riderName} is on the way at ${formatNaira(offer.counterKobo ?? '0')}.`,
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not take that price', description: useApiError(error) ?? 'Please try again.' });
    }
  };

  const refuse = async (offer: DeliveryOffer) => {
    try {
      await decline.mutateAsync(offer.assignmentId);
      notify({
        tone: 'info',
        title: 'Price declined',
        description: `${offer.riderName} can still take the job at your price.`,
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not decline', description: useApiError(error) ?? 'Please try again.' });
    }
  };

  if (!data) return null;

  return (
    <Card>
      <CardHeader
        title="What you asked for"
        subtitle={
          data.isNegotiated
            ? 'You negotiated this price — riders see your number, not the bill'
            : 'You accepted the bill — riders see exactly this'
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Our bill</p>
            <p className={data.isNegotiated ? 'mt-1 text-lg font-semibold text-ink-400 line-through' : 'mt-1 text-lg font-bold text-ink-900'}>
              {formatNaira(data.quotedKobo)}
            </p>
          </div>
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {data.isNegotiated ? 'You are offering riders' : 'Riders are being asked'}
            </p>
            <p className="mt-1 text-lg font-bold text-brand-800">{formatNaira(data.askKobo)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
          <Badge tone={data.ridersAsked > 0 ? 'info' : 'neutral'}>
            {data.ridersAsked > 0
              ? `${data.ridersAsked} rider${data.ridersAsked === 1 ? '' : 's'} looking right now`
              : 'No rider has been alerted yet'}
          </Badge>
          {data.pendingCount > 0 && (
            <Badge tone="warning">
              {data.pendingCount} asking for a different price
            </Badge>
          )}
        </div>

        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Riders asking for more</p>
            {pending.map((offer) => (
              <div
                key={offer.assignmentId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-200 bg-warning-50 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{offer.riderName}</p>
                  <p className="text-xs text-ink-500">{offer.riderCode}</p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-ink-900">{formatNaira(offer.counterKobo ?? '0')}</p>
                  <p className="text-[11px] text-ink-500">instead of {formatNaira(data.askKobo)}</p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <Button
                    size="sm"
                    className="flex-1"
                    isLoading={accept.isPending}
                    onClick={() => void take(offer)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    isLoading={decline.isPending}
                    onClick={() => void refuse(offer)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs leading-relaxed text-ink-500">
          Nothing is charged until a rider has the job. If a rider asks for more, you decide — and declining costs you
          nothing: their offer stays open at your price.
        </p>
      </CardBody>
    </Card>
  );
}
