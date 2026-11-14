import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Spinner,
  StatCard,
  StatusPill,
  ErrorState,
  useToast,
} from '../../components/ui';
import { useAuth, useApiError } from '../../contexts/AuthContext';
import { RIDER_NAV } from './nav';
import { useActiveJob, useOffers, useRiderProfile, useSetAvailability } from '../../hooks/useRider';
import { LocationReporter } from '../../components/LocationReporter';

export default function RiderHome() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [toggling, setToggling] = useState(false);
  const profile = useRiderProfile();
  const setAvailability = useSetAvailability();
  const rider = profile.data;

  const online = rider?.availability === 'ONLINE';
  const onDelivery = rider?.availability === 'ON_DELIVERY';

  // Offers are only meaningful while online, and polling them costs a request.
  const offers = useOffers(online);
  const activeJob = useActiveJob();
  const offerCount = offers.data?.length ?? 0;

  const toggle = async () => {
    setToggling(true);
    try {
      const next = online ? 'OFFLINE' : 'ONLINE';
      await setAvailability.mutateAsync(next);
      notify({
        tone: 'success',
        title: next === 'ONLINE' ? 'You are online' : 'You are offline',
        description:
          next === 'ONLINE'
            ? 'Delivery offers will appear on your Offers screen.'
            : 'You will not receive new offers until you go online again.',
      });
    } catch (error) {
      notify({ tone: 'error', title: 'Could not change availability', description: useApiError(error) ?? 'Please try again.' });
    } finally {
      setToggling(false);
    }
  };

  const approvalTone =
    rider?.approvalStatus === 'APPROVED'
      ? 'success'
      : rider?.approvalStatus === 'REJECTED' || rider?.approvalStatus === 'SUSPENDED'
        ? 'danger'
        : 'warning';

  if (profile.isLoading) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    );
  }

  if (profile.isError || !rider) {
    return (
      <PortalShell portal="Rider" nav={RIDER_NAV}>
        <ErrorState title="We could not load your rider profile" onRetry={() => void profile.refetch()} />
      </PortalShell>
    );
  }

  const earnings = rider.earnings;

  return (
    <PortalShell portal="Rider" nav={RIDER_NAV}>
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Only report a position while the rider is actually available for work. */}
        {(online || onDelivery) && <LocationReporter deliveryId={activeJob.data?.id ?? null} />}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink-900">Hello, {user?.firstName}</h1>
            <p className="mt-1 text-sm text-ink-500">
              {rider.riderCode} · {rider.vehicle?.type.toLowerCase()} · {rider.vehicle?.registrationNumber}
            </p>
          </div>
          <StatusPill
            label={rider.approvalStatus === 'APPROVED' ? 'Approved' : `Application ${rider.approvalStatus.toLowerCase()}`}
            tone={approvalTone}
          />
        </div>

        {/* Availability — the single most important control on this screen. */}
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={
                  onDelivery
                    ? 'flex h-3 w-3 shrink-0 rounded-full bg-warning-500 ring-4 ring-warning-100'
                    : online
                      ? 'flex h-3 w-3 shrink-0 rounded-full bg-accent-500 ring-4 ring-accent-100'
                      : 'flex h-3 w-3 shrink-0 rounded-full bg-ink-300 ring-4 ring-ink-100'
                }
                aria-hidden
              />
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {onDelivery ? 'On a delivery' : online ? 'Online — receiving offers' : 'Offline'}
                </p>
                <p className="text-xs text-ink-500">
                  {onDelivery
                    ? 'Finish or fail the job to become available again.'
                    : online
                      ? 'Offers are checked every few seconds.'
                      : 'Go online to start receiving deliveries.'}
                </p>
              </div>
            </div>

            {onDelivery ? (
              <Link to="/rider/active">
                <Button variant="secondary">Open active job</Button>
              </Link>
            ) : (
              <Button
                onClick={() => void toggle()}
                isLoading={toggling}
                variant={online ? 'secondary' : 'primary'}
                disabled={!online && !rider.canGoOnline}
              >
                {online ? 'Go offline' : 'Go online'}
              </Button>
            )}
          </CardBody>
        </Card>

        {!rider.canGoOnline && rider.approvalStatus === 'APPROVED' && rider.missingDocuments.length > 0 && (
          <Alert tone="warning" title="Documents still needed before you can go online">
            <p>
              Missing: <strong>{rider.missingDocuments.map((doc) => doc.replace(/_/g, ' ').toLowerCase()).join(', ')}</strong>.
            </p>
            <p className="mt-2">
              <Link to="/rider/documents" className="font-semibold underline">
                Upload your documents
              </Link>
            </p>
          </Alert>
        )}

        {rider.approvalStatus !== 'APPROVED' && (
          <Alert tone={rider.approvalStatus === 'PENDING' ? 'info' : 'danger'} title="Your application is being reviewed">
            A Rider Manager reviews your identity and vehicle documents before you can take jobs. You can upload or
            replace them at any time.
          </Alert>
        )}

        {activeJob.data && (
          <Card>
            <CardHeader title="Current job" subtitle={activeJob.data.reference} />
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <StatusPill label={activeJob.data.statusLabel} tone="info" />
                <span className="text-sm font-semibold text-accent-700">{activeJob.data.pay.netFormatted}</span>
              </div>
              <div className="text-sm text-ink-700">
                <p>
                  <span className="font-medium text-ink-500">Pick up:</span> {activeJob.data.pickup.address}
                </p>
                <p className="mt-1">
                  <span className="font-medium text-ink-500">Deliver to:</span> {activeJob.data.destination.address}
                </p>
              </div>
              <Link to="/rider/active">
                <Button className="w-full sm:w-auto">Continue job</Button>
              </Link>
            </CardBody>
          </Card>
        )}

        {online && offerCount > 0 && (
          <Alert tone="success" title={`${offerCount} new ${offerCount === 1 ? 'offer' : 'offers'} waiting`}>
            Offers expire quickly — open them now.{' '}
            <Link to="/rider/offers" className="font-semibold underline">
              View offers
            </Link>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Available to withdraw" value={earnings.formatted.withdrawable} hint="cleared earnings" />
          <StatCard label="Pending clearance" value={earnings.formatted.pending} hint="released after 24 hours" />
          <StatCard label="Completed deliveries" value={String(rider.completedCount)} />
          <StatCard
            label="Rating"
            value={rider.rating.count ? `${rider.rating.average.toFixed(1)} ★` : '—'}
            hint={rider.rating.count ? `${rider.rating.count} reviews` : 'no reviews yet'}
          />
        </div>

        <Card>
          <CardHeader
            title="Documents"
            subtitle={`${rider.documents.filter((doc) => doc.status === 'APPROVED').length} of ${rider.requiredDocuments.length} approved`}
            action={
              <Link to="/rider/documents">
                <Button variant="ghost" size="sm">
                  Manage
                </Button>
              </Link>
            }
          />
          <CardBody>
            {rider.documents.length === 0 ? (
              <EmptyState
                title="No documents uploaded"
                description="Upload your ID, driver's licence and vehicle papers to be approved."
                action={{ label: 'Upload documents', onClick: () => undefined }}
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {rider.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="text-ink-800">{doc.type.replace(/_/g, ' ').toLowerCase()}</span>
                    <Badge
                      tone={doc.status === 'APPROVED' ? 'success' : doc.status === 'REJECTED' ? 'danger' : 'warning'}
                    >
                      {doc.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </PortalShell>
  );
}
