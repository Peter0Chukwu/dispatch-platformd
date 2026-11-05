import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DELIVERY_STATUS_LABELS } from "@dispatch/shared";
import { PortalShell } from "../../layouts/PortalShell";
import { adminNav } from "./nav";
import { useAuth } from "../../contexts/AuthContext";
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
} from "../../components/ui";
import { LiveMap, type MapPoint } from "../../components/LiveMap";
import { useLiveMap, type LiveMapRider } from "../../hooks/useTracking";
import { useLiveStatus } from "../../lib/live";
import { cn } from "../../lib/cn";

/**
 * OPERATIONS MAP
 *
 * The dispatcher's view of the city: every online rider carrying a position, every
 * live job, and a click on any marker to see who is where.
 *
 * Three rules keep it honest:
 *   · a rider with no ping is simply absent — the map will not place them at their
 *     branch, at their last known spot, or anywhere else;
 *   · a ping older than the freshness window is drawn faded and labelled "last
 *     seen", so a quiet phone cannot masquerade as a moving one;
 *   · every count in the header comes from this same payload, so the numbers and
 *     the markers can never disagree.
 */
export default function LiveMapPage() {
  const { hasPermission } = useAuth();
  const { data, isLoading, isError, error, refetch, isFetching } = useLiveMap();
  const isLive = useLiveStatus();
  const [selectedRider, setSelectedRider] = useState<string | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<string | null>(null);

  /**
   * What is drawn by default: every positioned rider, plus the two ends of each
   * job that actually has a rider on it. Without the endpoints a lone marker has
   * no meaning — you cannot tell where the rider is *going*. Unassigned jobs are
   * counted in the header but not drawn: pinning every pending address would bury
   * the movement the dispatcher is looking for.
   */
  const points = useMemo<MapPoint[]>(() => {
    if (!data) return [];
    const rows: MapPoint[] = data.riders.map((rider) => ({
      id: `rider-${rider.riderId}`,
      lat: rider.lat,
      lng: rider.lng,
      kind: rider.activeDelivery ? "rider" : "idle-rider",
      label: rider.riderCode,
      heading: rider.heading,
      stale: rider.stale,
    }));

    for (const delivery of data.deliveries) {
      if (!delivery.rider) continue;
      rows.push(
        { id: `pickup-${delivery.id}`, lat: delivery.pickup.lat, lng: delivery.pickup.lng, kind: "pickup", label: "Pickup" },
        {
          id: `dest-${delivery.id}`,
          lat: delivery.destination.lat,
          lng: delivery.destination.lng,
          kind: "destination",
          label: "Drop-off",
        },
      );
    }
    return rows;
  }, [data]);

  /** The job the dispatcher is looking at, or the only one with a rider on it. */
  const focusedJob = useMemo(() => {
    if (!data) return null;
    if (selectedDelivery) return data.deliveries.find((delivery) => delivery.id === selectedDelivery) ?? null;
    return data.deliveries.find((delivery) => delivery.rider) ?? null;
  }, [data, selectedDelivery]);

  const riderRows = data?.riders ?? [];
  const focusedRider = riderRows.find((rider) => rider.riderId === selectedRider) ?? null;
  const focusedDelivery = data?.deliveries.find((delivery) => delivery.id === selectedDelivery) ?? null;

  const mapPoints = useMemo<MapPoint[]>(() => {
    if (!focusedDelivery) return points;
    return [
      ...points,
      { id: "focus-pickup", lat: focusedDelivery.pickup.lat, lng: focusedDelivery.pickup.lng, kind: "pickup", label: "Pickup" },
      {
        id: "focus-destination",
        lat: focusedDelivery.destination.lat,
        lng: focusedDelivery.destination.lng,
        kind: "destination",
        label: "Drop-off",
      },
    ];
  }, [points, focusedDelivery]);

  return (
    <PortalShell portal="Admin" nav={adminNav(hasPermission)}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900">Operations map</h1>
            <p className="text-sm text-ink-500">
              Live rider positions and open jobs. Updates every 15 s
              {isLive ? " and immediately on each ping." : " (live channel offline, polling)."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && <Spinner size="sm" />}
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Refresh now
            </Button>
          </div>
        </div>

        {isLoading && (
          <Card>
            <CardBody className="flex items-center gap-2 text-sm text-ink-500">
              <Spinner /> Loading positions…
            </CardBody>
          </Card>
        )}
        {isError && (
          <Alert tone="danger" title="Could not load the map">
            {(error as Error)?.message ?? "The tracking endpoint did not answer."}
          </Alert>
        )}

        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Riders online" value={data.summary.onlineRiders} hint="Available for offers" />
              <StatCard label="On a delivery" value={data.summary.ridersOnDelivery} hint="Carrying a parcel" />
              <StatCard label="Active deliveries" value={data.summary.activeDeliveries} hint="Accepted or in transit" />
              <StatCard label="Awaiting a rider" value={data.summary.unassigned} hint="Booked, nobody assigned" />
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Card>
                <CardHeader
                  title="City view"
                  subtitle={`${data.summary.positioned} of ${data.riders.length} online riders have a position · window ${Math.round(
                    data.freshnessWindowSeconds / 60,
                  )} min`}
                  action={<Badge tone={data.mapProvider === "google" ? "success" : "warning"}>{data.mapProvider.toUpperCase()}</Badge>}
                />
                <CardBody>
                  {mapPoints.length === 0 ? (
                    <EmptyState
                      title="No rider positions yet"
                      description="Nobody online has reported a location in the last few minutes. The map stays empty rather than placing riders somewhere they are not."
                    />
                  ) : (
                    <LiveMap
                      points={mapPoints}
                      connect={
                        focusedJob?.rider?.position
                          ? { from: `rider-${focusedJob.rider.id}`, to: `dest-${focusedJob.id}` }
                          : null
                      }
                      height={420}
                      emptyHint="No rider positions yet"
                    />
                  )}
                </CardBody>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader title="Riders" subtitle="Click one to inspect" />
                  <CardBody className="max-h-80 space-y-1.5 overflow-y-auto">
                    {riderRows.length === 0 && <p className="text-sm text-ink-500">No riders online.</p>}
                    {riderRows.map((rider) => (
                      <RiderRow
                        key={rider.riderId}
                        rider={rider}
                        active={selectedRider === rider.riderId}
                        onClick={() => {
                          setSelectedRider(rider.riderId === selectedRider ? null : rider.riderId);
                          setSelectedDelivery(rider.activeDelivery?.id ?? null);
                        }}
                      />
                    ))}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader title="Live jobs" subtitle="Newest first" />
                  <CardBody className="max-h-80 space-y-1.5 overflow-y-auto">
                    {data.deliveries.length === 0 && <p className="text-sm text-ink-500">No live jobs.</p>}
                    {data.deliveries.map((delivery) => (
                      <button
                        key={delivery.id}
                        type="button"
                        onClick={() => setSelectedDelivery(delivery.id === selectedDelivery ? null : delivery.id)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition",
                          selectedDelivery === delivery.id
                            ? "border-brand-400 bg-brand-50"
                            : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-ink-700">{delivery.reference}</span>
                          <span className="text-xs text-ink-500">{delivery.chargeFormatted}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-600">
                          {DELIVERY_STATUS_LABELS[delivery.status as keyof typeof DELIVERY_STATUS_LABELS] ?? delivery.status}
                          {delivery.rider ? ` · ${delivery.rider.riderCode}` : " · unassigned"}
                        </p>
                      </button>
                    ))}
                  </CardBody>
                </Card>

                {focusedRider && (
                  <Card>
                    <CardHeader title={focusedRider.name} subtitle={focusedRider.riderCode} />
                    <CardBody className="space-y-1.5 text-sm">
                      <Row label="Status" value={focusedRider.availability.replace(/_/g, " ").toLowerCase()} />
                      <Row label="Phone" value={focusedRider.phone} />
                      <Row
                        label="Position"
                        value={`${focusedRider.lat.toFixed(4)}, ${focusedRider.lng.toFixed(4)}`}
                      />
                      <Row label="Reported" value={new Date(focusedRider.recordedAt).toLocaleTimeString("en-NG")} />
                      <Row label="Speed" value={focusedRider.speedKph ? `${Math.round(focusedRider.speedKph)} km/h` : "—"} />
                      <Row label="Battery" value={focusedRider.batteryPct != null ? `${focusedRider.batteryPct}%` : "—"} />
                      {focusedRider.stale && (
                        <p className="pt-1 text-xs text-amber-700">
                          This position is older than the freshness window — the rider may be offline.
                        </p>
                      )}
                      {focusedRider.activeDelivery && (
                        <Link
                          to="/admin/dispatch"
                          className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                        >
                          Open {focusedRider.activeDelivery.reference} on the dispatch board →
                        </Link>
                      )}
                    </CardBody>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function RiderRow({ rider, active, onClick }: { rider: LiveMapRider; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border px-3 py-2 text-left transition",
        active ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:border-ink-300 hover:bg-ink-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-900">{rider.name}</span>
        <Badge tone={rider.stale ? "warning" : rider.activeDelivery ? "success" : "neutral"}>
          {rider.stale ? "stale" : rider.activeDelivery ? "on job" : "idle"}
        </Badge>
      </div>
      <p className="mt-0.5 font-mono text-[11px] text-ink-500">
        {rider.riderCode} · {rider.lat.toFixed(4)}, {rider.lng.toFixed(4)} ·{" "}
        {new Date(rider.recordedAt).toLocaleTimeString("en-NG")}
      </p>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-ink-400">{label}</span>
      <span className="text-right text-sm text-ink-800">{value}</span>
    </div>
  );
}
