import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Spinner,
  StatusPill,
  useToast,
} from '../../components/ui';
import { OfferCountdown } from '../../components/OfferCountdown';
import { RIDER_NAV } from './nav';
import { useApiError } from '../../contexts/AuthContext';
import {
  useAcceptOffer,
  useOffers,
  useRejectOffer,
  useRiderProfile,
  type Offer,
} from '../../hooks/useRider';

export default function OffersPage() {
  const navigate = useNavigate();
  const { notify } = useToast();
  const profile = useRiderProfile();
  const online = profile.data?.availability === 'ONLINE';
  const offers = useOffers(online);
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const [busyId, setBusyId] = useState<string | null>(null);

  const take = async (offer: Offer) => {
    setBusyId(offer.assignmentId);
    try {
      await accept.mutateAsync(offer.assignmentId);
      notify({ tone: 'success', title: 'Job accepted', description: 'Head to the pickup address.' });
      navigate(`/rider/active?job=${offer.delivery.id}`);
    } catch (error) {
      // Losing the race is expected behaviour, not a bug: another rider took it first.
      notify({ tone: 'error', title: 'Offer no longer available', description: useApiError(error) ?? 'It was taken by another rider or has expired.' });
      await offers.refetch();
    } finally {
      setBusyId(null);
    }
  };

  const pass = async (offer: Offer) => {
    setBusyId(offer.assignmentId);
    try {
      await reject.mutateAsync({ assignmentId: offer.assignmentId, reason: 'Passed by rider' });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not pass', description: useApiError(error) ?? 'Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  if (profile.isLoading) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    );
  }

  if (!online) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardBody>
              <EmptyState
                title={profile.data?.availability === 'ON_DELIVERY' ? 'You are on a delivery' : 'You are offline'}
                description={
                  profile.data?.availability === 'ON_DELIVERY'
                    ? 'Finish your current job before new offers arrive.'
                    : 'Go online from your Overview screen to receive delivery offers.'
                }
                action={{ label: 'Back to overview', onClick: () => navigate('/rider') }}
              />
            </CardBody>
          </Card>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell portal="Rider" nav={RIDER_NAV}>
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Delivery offers</h1>
            <p className="mt-1 text-sm text-ink-500">
              Offers expire in {offers.data?.[0]?.offerTimeoutSeconds ?? 20} seconds. Accepting is first-come,
              first-served — another rider may take it at the same moment.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void offers.refetch()} isLoading={offers.isFetching}>
            Refresh
          </Button>
        </div>

        {offers.isError && <ErrorState title="Could not load offers" onRetry={() => void offers.refetch()} />}

        {offers.data?.length === 0 && (
          <Card>
            <CardBody>
              <EmptyState
                title="No offers right now"
                description="You are online. Stay on this screen — new offers are checked every few seconds and appear here automatically."
              />
            </CardBody>
          </Card>
        )}

        <div className="space-y-4">
          {offers.data?.map((offer) => (
            <Card key={offer.assignmentId}>
              <CardBody className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-ink-900">{offer.delivery.reference}</p>
                      <Badge tone="neutral">{offer.delivery.deliveryType.replace(/_/g, ' ').toLowerCase()}</Badge>
                      {offer.delivery.package.isFragile && <Badge tone="warning">fragile</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {offer.delivery.zone ? `${offer.delivery.zone} · ` : ''}
                      {offer.delivery.distanceKm?.toFixed(1) ?? '—'} km route
                      {offer.delivery.durationMinutes ? ` · ~${offer.delivery.durationMinutes} min` : ''}
                    </p>
                  </div>
                  <OfferCountdown
                    expiresAt={offer.expiresAt}
                    totalSeconds={offer.offerTimeoutSeconds}
                    onExpire={() => void offers.refetch()}
                  />
                </div>

                <div className="space-y-2.5 text-sm">
                  <div className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent-500" aria-hidden />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Pick up</p>
                      <p className="text-ink-800">{offer.delivery.pickup.address}</p>
                      {offer.delivery.pickup.landmark && (
                        <p className="text-xs text-ink-500">{offer.delivery.pickup.landmark}</p>
                      )}
                    </div>
                  </div>
                  <div className="ml-1 h-3 w-px bg-ink-200" aria-hidden />
                  <div className="flex gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-900" aria-hidden />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Deliver to</p>
                      <p className="text-ink-800">{offer.delivery.destination.address}</p>
                      <p className="text-xs text-ink-500">Recipient: {offer.delivery.recipientName}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 p-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">You earn</p>
                    <p className="text-lg font-bold text-accent-700">{offer.pay.netFormatted}</p>
                  </div>
                  <div className="text-right text-xs text-ink-500">
                    <p>Customer pays {offer.pay.chargeKobo ? `₦${(Number(offer.pay.chargeKobo) / 100).toFixed(2)}` : '—'}</p>
                    <p>Commission {offer.pay.commissionPct}%</p>
                  </div>
                </div>

                {offer.distanceToPickupKm !== null && (
                  <p className="text-xs text-ink-500">
                    You are about {offer.distanceToPickupKm.toFixed(1)} km from the pickup point.
                  </p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="flex-1"
                    onClick={() => void take(offer)}
                    isLoading={busyId === offer.assignmentId && accept.isPending}
                    disabled={busyId !== null && busyId !== offer.assignmentId}
                  >
                    Accept job
                  </Button>
                  <Button
                    variant="secondary"
                    className="sm:w-32"
                    onClick={() => void pass(offer)}
                    disabled={busyId !== null}
                  >
                    Pass
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <Alert tone="info" title="Only one rider gets the job">
          Every offer is locked on the server when it is accepted. If two riders tap at the same time, one gets the job
          and the other sees “no longer available” — never a double assignment.
          <span className="mt-2 block">
            <Link to="/rider/active" className="font-semibold underline">
              Open my active job
            </Link>
          </span>
        </Alert>

        {offers.data && offers.data.length > 0 && (
          <p className="text-center text-xs text-ink-400">
            <StatusPill label="Live" tone="success" /> offers refresh automatically
          </p>
        )}
      </div>
    </PortalShell>
  );
}
