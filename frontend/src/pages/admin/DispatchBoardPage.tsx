import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalShell } from '../../layouts/PortalShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  Spinner,
  StatCard,
  useToast,
  type Column,
} from '../../components/ui';
import { adminNav } from './nav';
import { useAuth, useApiError } from '../../contexts/AuthContext';
import { useDispatchBoard, useRunDispatchRound, type DispatchBoardRow } from '../../hooks/useAdmin';
import { LIVE_EVENTS, useLiveEvent } from '../../lib/live';
import { useQueryClient } from '@tanstack/react-query';

/**
 * THE DISPATCH BOARD
 * ─────────────────────────────────────────────────────────────────────────────
 * The engine places jobs on its own, and this is where you watch it do that. Every
 * row is a booking still waiting for a rider: how far the search has reached, who
 * has been asked and how long they have left, and the two escapes for when
 * automation cannot finish the job — run the next round immediately, or assign a
 * rider by hand.
 *
 * Nothing on this screen is estimated. The round, the radius and the offers all
 * come from the rows the engine writes.
 */
export default function DispatchBoardPage() {
  const { hasPermission } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const board = useDispatchBoard();
  const runRound = useRunDispatchRound();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['admin', 'dispatch'] }),
    [queryClient],
  );
  useLiveEvent(LIVE_EVENTS.DELIVERY_NEW, refresh);
  useLiveEvent(LIVE_EVENTS.DELIVERY_UPDATED, refresh);
  useLiveEvent(LIVE_EVENTS.DISPATCH_EXHAUSTED, refresh);

  const canRun = hasPermission('delivery:assign');
  const data = board.data;

  const askAgain = async (row: DispatchBoardRow) => {
    setBusyId(row.id);
    try {
      const result = await runRound.mutateAsync(row.id);
      notify({
        tone: result.offered > 0 ? 'success' : 'warning',
        title: result.offered > 0 ? `Round ${result.round} sent to ${result.offered} rider(s)` : 'No rider found',
        description:
          result.offered > 0
            ? `${row.reference} · ${row.dispatch.radiusLabel} radius · ${data?.summary.offerTimeoutSeconds ?? 20}s to respond`
            : `${row.reference} · nobody eligible within ${row.dispatch.radiusLabel}. Assign a rider by hand.`,
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: 'Could not run a round',
        description: useApiError(error) ?? 'Please try again.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<DispatchBoardRow>[] = [
    {
      key: 'reference',
      header: 'Delivery',
      render: (row) => (
        <div className="min-w-0 whitespace-nowrap">
          <div className="font-semibold text-ink-900">{row.reference}</div>
          <div className="text-xs text-ink-500">
            {row.deliveryType.replace(/_/g, ' ').toLowerCase()}
            {row.zone ? ` · ${row.zone}` : ''}
          </div>
          <div className="text-xs text-ink-500">
            {row.chargeFormatted} · waiting {row.waitingMinutes} min
          </div>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      render: (row) => (
        <div className="max-w-[240px] text-xs text-ink-600">
          <div className="truncate">
            <span className="font-medium text-ink-800">From</span> {row.pickup.address}
          </div>
          <div className="truncate">
            <span className="font-medium text-ink-800">To</span> {row.destination.address}
          </div>
        </div>
      ),
    },
    {
      key: 'round',
      header: 'Search',
      render: (row) => (
        <div className="space-y-1 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <Badge tone={row.dispatch.exhausted ? 'danger' : row.dispatch.offersOut > 0 ? 'info' : 'warning'}>
              <span className="whitespace-nowrap">
                Round {Math.min(row.dispatch.round, row.dispatch.maxRounds)} of {row.dispatch.maxRounds}
              </span>
            </Badge>
            <span className="text-xs text-ink-500">{row.dispatch.radiusLabel}</span>
          </div>
          <div className="text-xs text-ink-500">
            {row.dispatch.offersOut > 0
              ? `${row.dispatch.offersOut} deciding now`
              : row.dispatch.exhausted
                ? 'automatic search exhausted'
                : 'no offer out — next round due'}
            {row.dispatch.askedCount > 0 ? ` · ${row.dispatch.askedCount} asked so far` : ''}
          </div>
          {/* Why the engine stopped, in words. A bare "exhausted" told the desk
              nothing it could act on. */}
          {row.dispatch.blocking && (
            <p className="max-w-xs whitespace-normal text-xs font-medium text-danger-700">
              {row.dispatch.blocking}
            </p>
          )}
          <div className="text-xs text-ink-700">
            {row.dispatch.liveOffers.length === 0 ? (
              <span className="text-ink-400">nobody holds it yet</span>
            ) : (
              row.dispatch.liveOffers.map((offer) => (
                <div key={offer.assignmentId}>
                  <span className="font-medium">{offer.rider}</span>
                  <span className="text-ink-500"> · {offer.secondsLeft}s left</span>
                </div>
              ))
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          <Button
            size="sm"
            variant="secondary"
            className="whitespace-nowrap"
            title="Run the next dispatch round immediately instead of waiting for the current batch"
            disabled={!canRun || busyId === row.id || row.dispatch.offersOut > 0 || row.dispatch.exhausted}
            onClick={() => void askAgain(row)}
          >
            {busyId === row.id ? <Spinner size="sm" /> : 'Run round'}
          </Button>
          <Link
            to={`/admin/deliveries?q=${encodeURIComponent(row.reference)}`}
            className="whitespace-nowrap"
            title="Open this delivery and choose a rider yourself"
          >
            <Button size="sm" variant="ghost" className="whitespace-nowrap">
              Assign
            </Button>
          </Link>
        </div>
      ),
    },
  ];

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="mx-auto max-w-[1400px] space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">Dispatch board</h1>
            <p className="mt-1 text-sm text-ink-500">
              Every booking waiting for a rider, and how hard the engine is looking.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void board.refetch()} disabled={board.isFetching}>
            {board.isFetching ? <Spinner size="sm" /> : 'Refresh'}
          </Button>
        </div>

        {board.isError ? (
          <ErrorState
            title="Could not load the dispatch board"
            message={useApiError(board.error) ?? 'The API did not answer.'}
            onRetry={() => void board.refetch()}
          />
        ) : board.isPending || !data ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Waiting for a rider"
                value={String(data.summary.waiting)}
                hint={`${data.summary.offersOut} offer(s) out right now`}
              />
              <StatCard
                label="Riders online"
                value={String(data.summary.onlineRiders)}
                hint={
                  data.summary.onlineWithoutPing > 0
                    ? `${data.summary.onlineWithoutPing} of them cannot be located — not offerable`
                    : `${data.summary.batchSize} asked per round · ${data.summary.offerTimeoutSeconds}s each`
                }
              />
              <StatCard
                label="Exhausted today"
                value={String(data.summary.exhaustedToday)}
                hint="automatic search gave up — needs a human"
              />
              <StatCard
                label="Rounds per delivery"
                value={String(data.summary.maxRounds)}
                hint="5 km → 12 km → 25 km → whole branch"
              />
            </div>

            {data.summary.exhaustedToday > 0 && (
              <Alert tone="warning" title="Some deliveries could not be placed automatically">
                They are highlighted below. Assign a rider from the delivery screen — the customer is
                waiting either way.
              </Alert>
            )}

            <Card>
              <CardHeader
                title="Waiting for assignment"
                subtitle="Oldest first. The engine re-offers automatically every few seconds; this list is the manual override."
              />
              <CardBody className="!p-0">
                <DataTable<DispatchBoardRow>
                  columns={columns}
                  rows={data.waiting}
                  emptyTitle="Nothing is waiting"
                  emptyDescription="Every booking has a rider. This screen stays quiet until one does not."
                />
              </CardBody>
            </Card>

            {data.justAssigned.length > 0 && (
              <Card>
                <CardHeader title="Recently assigned" subtitle="The last ten jobs the engine or a dispatcher placed." />
                <CardBody>
                  <ul className="divide-y divide-ink-100">
                    {data.justAssigned.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="font-medium text-ink-900">{row.reference}</span>
                        <span className="text-ink-600">
                          {row.rider ? `${row.rider.name} (${row.rider.code})` : 'unassigned'}
                        </span>
                        <Badge tone="neutral">{row.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                        <span className="text-xs text-ink-500">
                          {new Date(row.at).toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos' })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            {data.waiting.length === 0 && data.justAssigned.length === 0 && (
              <EmptyState
                title="The floor is clear"
                description="No booking is waiting and nothing has been assigned in the last day."
              />
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
