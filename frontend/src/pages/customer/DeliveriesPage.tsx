import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DELIVERY_STATUS_LABELS, DELIVERY_STATUS_TONE, formatNaira } from '@dispatch/shared';
import { PortalShell } from '../../layouts/PortalShell';
import { Badge, Button, Card, CardBody, EmptyState, StatusPill } from '../../components/ui';
import { CUSTOMER_NAV } from './nav';
import { useDeliveries } from '../../hooks/useDeliveries';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Awaiting rider' },
  { value: 'IN_TRANSIT', label: 'On the way' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export default function DeliveriesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const { data, isLoading, isError, refetch } = useDeliveries(page, status || undefined);

  return (
    <PortalShell portal="Customer" nav={CUSTOMER_NAV}>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">My deliveries</h1>
            <p className="mt-1 text-sm text-ink-500">
              {data ? `${data.total} booking${data.total === 1 ? '' : 's'} on your account` : 'Loading your bookings…'}
            </p>
          </div>
          <Link to="/app/book">
            <Button>Book a delivery</Button>
          </Link>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => {
                setStatus(filter.value);
                setPage(1);
              }}
              className={
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ' +
                (status === filter.value
                  ? 'border-brand-500 bg-brand-50 text-brand-800'
                  : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300')
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-ink-500">Loading…</p>}

        {isError && (
          <Card>
            <CardBody>
              <EmptyState
                title="We could not load your deliveries"
                description="Check your connection and try again."
                action={{ label: 'Retry', onClick: () => void refetch() }}
              />
            </CardBody>
          </Card>
        )}

        {data && data.items.length === 0 && (
          <Card>
            <CardBody>
              <EmptyState
                title={status ? 'Nothing in this filter' : 'No deliveries yet'}
                description={
                  status
                    ? 'Try another filter, or book a new delivery.'
                    : 'Your bookings will appear here the moment you create one.'
                }
                action={{ label: 'Book your first delivery', onClick: () => navigate('/app/book') }}
              />
            </CardBody>
          </Card>
        )}

        {data && data.items.length > 0 && (
          <ul className="space-y-3">
            {data.items.map((delivery) => (
              <li key={delivery.id}>
                <Link
                  to={`/app/deliveries/${delivery.id}`}
                  className="block rounded-2xl border border-ink-200 bg-white p-4 transition-colors hover:border-ink-300 hover:bg-ink-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-ink-500">{delivery.reference}</span>
                        <StatusPill
                          label={DELIVERY_STATUS_LABELS[delivery.status as keyof typeof DELIVERY_STATUS_LABELS] ?? delivery.status}
                          tone={DELIVERY_STATUS_TONE[delivery.status as keyof typeof DELIVERY_STATUS_TONE] ?? 'neutral'}
                        />
                      </div>
                      <p className="mt-1.5 truncate text-sm font-medium text-ink-900">{delivery.destination.address}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">from {delivery.pickup.address}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold tabular-nums text-ink-900">{formatNaira(delivery.chargeKobo)}</p>
                      <p className="text-xs text-ink-400">
                        {new Date(delivery.createdAt).toLocaleDateString('en-NG', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <Badge tone="neutral">{delivery.deliveryType.replace('_', ' ').toLowerCase()}</Badge>
                    {delivery.distanceKm !== null && <span>{delivery.distanceKm} km</span>}
                    <span>·</span>
                    <span>{delivery.recipient.name}</span>
                    {BigInt(delivery.discountKobo) > 0n && (
                      <Badge tone="success">−{formatNaira(delivery.discountKobo)}</Badge>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs text-ink-500">
              Page {data.page} of {data.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
