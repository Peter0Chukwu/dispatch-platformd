import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Input,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Spinner,
  StatusPill,
  useToast,
} from '../../components/ui';
import { OfferCountdown } from '../../components/OfferCountdown';
import { LIVE_EVENTS, useLiveEvent } from '../../lib/live';
import { RIDER_NAV } from './nav';
import { useApiError } from '../../contexts/AuthContext';
import {
  useAcceptOffer,
  useCounterOffer,
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
  const counter = useCounterOffer();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which card has its "ask for more" box open, and what has been typed in it.
  const [askingId, setAskingId] = useState<string | null>(null);
  const [askAmount, setAskAmount] = useState('');

  /**
   * Live offers. The push only carries enough to announce the job; the list itself
   * comes from the API, so the screen can never show an offer the server would refuse.
   */
  const onOffer = useCallback(
    (payload: unknown) => {
      const offer = payload as { reference?: string; distanceToPickupKm?: number; netFormatted?: string };
      void offers.refetch();
      notify({
        tone: 'info',
        title: 'New job nearby',
        description: [offer.reference, offer.distanceToPickupKm !== undefined ? `${offer.distanceToPickupKm.toFixed(1)} km to pickup` : null, offer.netFormatted ? `${offer.netFormatted} net` : null]
          .filter(Boolean)
          .join(' · '),
      });
    },
    [notify, offers],
  );

  useLiveEvent(LIVE_EVENTS.OFFER_NEW, onOffer);
  // An offer pulled back (taken by someone else, or expired) must leave the list.
  useLiveEvent(LIVE_EVENTS.OFFER_REVOKED, useCallback(() => void offers.refetch(), [offers]));

  const take = async (offer: Offer) => {
    setBusyId(offer.assignmentId);
    try {
      await accept.mutateAsync(offer.assignmentId);
      notify({ tone: 'success', title: 'Job accepted', description: 'Head to the pickup address — the customer is waiting in chat.' });
      // Straight into the thread: the two of them can talk before either moves.
      navigate(`/rider/deliveries/${offer.delivery.id}/chat`);
    } catch (error) {
      // Losing the race is expected behaviour, not a bug: another rider took it first.
      notify({ tone: 'error', title: 'Offer no longer available', description: useApiError(error) ?? 'It was taken by another rider or has expired.' });
      await offers.refetch();
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Name a price. Naira in the box, kobo on the wire — the API never takes a
   * decimal amount and the customer never sees one.
   */
  const askForMore = async (offer: Offer) => {
    const naira = Number(askAmount.replace(/,/g, ''));
    if (!Number.isFinite(naira) || naira <= 0) {
      notify({ tone: 'error', title: 'Enter a price', description: 'Type the amount you want for this job.' });
      return;
    }
    setBusyId(offer.assignmentId);
    try {
      const result = await counter.mutateAsync({
        assignmentId: offer.assignmentId,
        amountKobo: String(Math.round(naira * 100)),
      });
      setAskingId(null);
      setAskAmount('');
      notify({
        tone: 'success',
        title: `Asked for ${result.counterFormatted}`,
        description: result.message,
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: 'That price was not sent',
        description: useApiError(error) ?? 'Please try again.',
      });
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

                <div className="space-y-3 rounded-xl bg-ink-50 p-3">
                  {offer.money.isNegotiated ? (
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-ink-500">Our bill</span>
                        <span className="text-ink-400 line-through">{offer.money.quotedFormatted}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                          Customer is offering
                        </span>
                        <span className="text-lg font-bold text-brand-800">{offer.money.askFormatted}</span>
                      </div>
                      <p className="text-[11px] text-ink-500">
                        They negotiated the bill down. Take it, or ask for a price of your own.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                        Customer is paying
                      </span>
                      <span className="text-lg font-bold text-brand-800">{offer.money.askFormatted}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-2.5">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">You earn</p>
                      <p className="text-lg font-bold text-accent-700">{offer.pay.netFormatted}</p>
                    </div>
                    <p className="text-right text-xs text-ink-500">Commission {offer.pay.commissionPct}%</p>
                  </div>

                  {offer.money.counterState === 'PENDING' && offer.money.counterKobo && (
                    <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs font-medium text-warning-800">
                      You asked for ₦{(Number(offer.money.counterKobo) / 100).toLocaleString('en-NG')} — waiting for the
                      customer. You can still take the job at {offer.money.askFormatted} meanwhile.
                    </p>
                  )}
                  {offer.money.counterState === 'DECLINED' && (
                    <p className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
                      Your price was turned down. The job is still here at {offer.money.askFormatted}.
                    </p>
                  )}
                </div>

                {offer.distanceToPickupKm !== null && (
                  <p className="text-xs text-ink-500">
                    You are about {offer.distanceToPickupKm.toFixed(1)} km from the pickup point.
                  </p>
                )}

                {askingId === offer.assignmentId ? (
                  <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
                    <label className="text-xs font-semibold text-ink-700" htmlFor={`ask-${offer.assignmentId}`}>
                      What should the customer pay?
                    </label>
                    <Input
                      id={`ask-${offer.assignmentId}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="50"
                      placeholder={`More than ${offer.money.askFormatted.replace('₦', '')}`}
                      value={askAmount}
                      onChange={(event) => setAskAmount(event.target.value)}
                    />
                    <p className="text-[11px] text-ink-500">
                      Your asking price. The customer decides — nothing is charged until they say yes.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        isLoading={counter.isPending}
                        onClick={() => void askForMore(offer)}
                      >
                        Send my price
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAskingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      className="flex-1"
                      onClick={() => void take(offer)}
                      isLoading={busyId === offer.assignmentId && accept.isPending}
                      disabled={busyId !== null && busyId !== offer.assignmentId}
                    >
                      Accept {offer.money.askFormatted}
                    </Button>
                    <Button
                      variant="secondary"
                      className="sm:w-36"
                      onClick={() => {
                        setAskingId(offer.assignmentId);
                        setAskAmount('');
                      }}
                      disabled={busyId !== null}
                    >
                      Ask for more
                    </Button>
                    <Button
                      variant="ghost"
                      className="sm:w-24"
                      onClick={() => void pass(offer)}
                      disabled={busyId !== null}
                    >
                      Pass
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>

        <Alert tone="info" title="Only one rider gets the job">
          Only one rider can take a job. If someone accepts first, the offer closes for everyone else — so a parcel is
          never promised twice.
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
