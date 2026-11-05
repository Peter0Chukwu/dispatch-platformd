import { Link, useParams } from "react-router-dom";
import { Badge, Card, CardBody, CardHeader, ErrorState, Spinner } from "../components/ui";
import { LiveMap, type MapPoint } from "../components/LiveMap";
import { usePublicTracking } from "../hooks/useTracking";
import { useApiError } from "../contexts/AuthContext";

/**
 * PUBLIC TRACKING PAGE — /track/:token
 *
 * What a recipient sees when the customer shares a link. No sign-in, no
 * navigation, no portal: one page, the parcel, the map, and an honest ETA.
 *
 * It is also deliberately thin. There is no phone number, no address book, no
 * order history — a share link is a window on one delivery, and nothing else.
 * The link expires (`TRACKING_SHARE_LINK_TTL_HOURS`, 72 h) and the customer can
 * revoke it at any moment, at which point this page 404s.
 */
export default function TrackPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, error } = usePublicTracking(token);

  const points: MapPoint[] = [];
  if (data) {
    points.push({ id: "pickup", lat: data.delivery.pickup.lat, lng: data.delivery.pickup.lng, kind: "pickup", label: "Pickup" });
    points.push({
      id: "destination",
      lat: data.delivery.destination.lat,
      lng: data.delivery.destination.lng,
      kind: "destination",
      label: "Drop-off",
    });
    if (data.position) {
      points.push({
        id: "rider",
        lat: data.position.lat,
        lng: data.position.lng,
        kind: "rider",
        label: data.rider?.name ?? "Rider",
        heading: data.position.heading,
        stale: data.stale,
      });
    }
  }

  const expired = Boolean(error) && useApiError(error)?.toLowerCase().includes("expired");

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Dispatch · live tracking</p>
            <h1 className="text-xl font-bold text-ink-900">Where is my parcel?</h1>
          </div>
          <Link to="/" className="text-xs font-medium text-brand-700 hover:underline">
            dispatch.app
          </Link>
        </header>

        {isLoading && (
          <Card>
            <CardBody className="flex items-center gap-2 text-sm text-ink-500">
              <Spinner /> Looking up this tracking link…
            </CardBody>
          </Card>
        )}

        {error && (
          <ErrorState
            title={expired ? "This tracking link has expired" : "This tracking link is not valid"}
            message={
              expired
                ? "Ask the sender for a fresh link — each one is time-limited on purpose."
                : "The link may have been revoked, or it may never have existed. Ask the sender to share it again."
            }
          />
        )}

        {data && (
          <>
            <Card>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs font-semibold text-ink-500">{data.delivery.reference}</p>
                    <h2 className="mt-1 text-lg font-bold text-ink-900">{data.delivery.statusLabel}</h2>
                    {data.rider && (
                      <p className="mt-0.5 text-sm text-ink-600">
                        Rider {data.rider.name} · {data.rider.riderCode}
                      </p>
                    )}
                  </div>
                  <Badge tone={data.live ? (data.stale ? "warning" : "success") : "neutral"}>
                    {data.live ? (data.stale ? "Position delayed" : "Live") : "Tracking ended"}
                  </Badge>
                </div>

                {data.eta && (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-brand-50 px-3 py-2">
                    <p className="text-lg font-bold tabular-nums text-brand-900">~{data.eta.minutes} min</p>
                    <p className="text-sm text-brand-800">
                      {data.eta.distanceRemainingKm?.toFixed(1)} km to the {data.eta.headingTo}
                    </p>
                  </div>
                )}

                {data.stale && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    The rider's phone has not reported for a few minutes. The marker shows the last known position
                    rather than a guess.
                  </p>
                )}

                <LiveMap
                  points={points}
                  connect={data.position ? { from: "rider", to: data.eta?.headingTo === "pickup" ? "pickup" : "destination" } : null}
                  emptyHint={data.live ? "Waiting for the rider's first position." : "Tracking has ended for this delivery."}
                />

                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">From</p>
                    <p className="mt-1 text-ink-900">{data.delivery.pickupAddress}</p>
                  </div>
                  <div className="rounded-xl border border-ink-200 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">To</p>
                    <p className="mt-1 text-ink-900">{data.delivery.destAddress}</p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Progress" subtitle="Recorded by the platform as each step happened" />
              <CardBody>
                <ol className="space-y-2">
                  {data.timeline.map((entry, index) => (
                    <li key={`${entry.status}-${entry.at}`} className="flex gap-3 text-sm">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${index === 0 ? "bg-brand-600" : "bg-ink-300"}`}
                      />
                      <span className="flex-1">
                        <span className={`font-medium ${index === 0 ? "text-ink-900" : "text-ink-600"}`}>{entry.label}</span>
                        <span className="ml-2 text-xs text-ink-500">{new Date(entry.at).toLocaleString("en-NG")}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>

            {data.shareExpiresAt && (
              <p className="text-center text-[11px] text-ink-400">
                This link expires {new Date(data.shareExpiresAt).toLocaleString("en-NG")}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
