import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner, useToast } from "./ui";
import { LiveMap, type MapPoint } from "./LiveMap";
import { useShareLink, useTracking } from "../hooks/useTracking";
import { useEffect } from "react";
import { LIVE_EVENTS, subscribeToDelivery, useLiveEvent } from "../lib/live";
import { useApiError } from "../contexts/AuthContext";

/**
 * LIVE TRACKING, AS THE CUSTOMER SEES IT
 *
 * The card answers three questions in order: where is it, when will it get here,
 * and who else needs to know. Everything it displays came from a rider's phone via
 * `rider_locations`; when no ping has arrived it says so instead of drawing.
 */
export function DeliveryTrackingCard({
  deliveryId,
  status,
}: {
  deliveryId: string;
  status: string;
}) {
  const { data, isLoading } = useTracking(deliveryId);
  const { create, revoke } = useShareLink(deliveryId);
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeToDelivery(deliveryId), [deliveryId]);

  // A ping invalidates rather than patches: the REST answer stays the only truth.
  useLiveEvent(
    LIVE_EVENTS.TRACKING_PING,
    useCallback(
      (payload: unknown) => {
        const ping = payload as { deliveryId?: string };
        if (ping.deliveryId && ping.deliveryId !== deliveryId) return;
        void queryClient.invalidateQueries({ queryKey: ["tracking", deliveryId] });
      },
      [deliveryId, queryClient],
    ),
  );

  const finished = status === "DELIVERED" || status === "CANCELLED";

  const shareLink = async () => {
    try {
      const result = await create.mutateAsync();
      setSharedUrl(result.url);
      notify({
        tone: "success",
        title: "Share link created",
        description: `Anyone with this link can follow the parcel until ${new Date(result.expiresAt).toLocaleString("en-NG")}.`,
      });
    } catch (error) {
      notify({ tone: "error", title: "Could not create the link", description: useApiError(error) ?? "Please try again." });
    }
  };

  const revokeLink = async () => {
    try {
      await revoke.mutateAsync();
      setSharedUrl(null);
      setCopied(false);
      notify({ tone: "success", title: "Link revoked", description: "The old URL stopped working immediately." });
    } catch (error) {
      notify({ tone: "error", title: "Could not revoke the link", description: useApiError(error) ?? "Please try again." });
    }
  };

  const copy = async () => {
    if (!sharedUrl) return;
    try {
      await navigator.clipboard.writeText(sharedUrl);
      setCopied(true);
      notify({ tone: "success", title: "Copied", description: "Paste it into a message to the recipient." });
    } catch {
      notify({ tone: "warning", title: "Copy blocked", description: "Your browser blocked clipboard access — select the link and copy it manually." });
    }
  };

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
        label: data.rider ? data.rider.name.split(" ")[0]! : "Rider",
        heading: data.position.heading,
        stale: data.stale,
      });
    }
  }

  const target = data?.eta?.headingTo === "pickup" ? "pickup" : "destination";

  return (
    <Card>
      <CardHeader
        title="Live tracking"
        subtitle="Positions come from the rider's phone — the map never invents a location"
        action={
          data?.live ? (
            <Badge tone={data.stale ? "warning" : "success"}>{data.stale ? "Position delayed" : "Live"}</Badge>
          ) : (
            <Badge tone="neutral">{finished ? "Tracking ended" : "Waiting"}</Badge>
          )
        }
      />
      <CardBody className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <Spinner /> Loading tracking…
          </div>
        )}

        {data && (
          <>
            {data.eta && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-brand-50 px-3 py-2">
                <p className="text-lg font-bold tabular-nums text-brand-900">~{data.eta.minutes} min</p>
                <p className="text-sm text-brand-800">
                  {data.eta.distanceRemainingKm?.toFixed(1)} km to the {data.eta.headingTo}
                  {data.rider ? ` · rider ${data.rider.riderCode}` : ""}
                </p>
                <p className="ml-auto text-[11px] text-brand-700">
                  {data.eta.source === "GOOGLE" ? "Road route" : "Road-factor estimate (maps key not configured)"}
                </p>
              </div>
            )}

            {finished && (
              <Alert tone={status === "DELIVERED" ? "success" : "warning"} title={status === "DELIVERED" ? "Delivered" : "Cancelled"}>
                {status === "DELIVERED"
                  ? "The parcel was delivered, so the rider's position is no longer shared — tracking stops here."
                  : "This delivery was cancelled; the map is closed."}
              </Alert>
            )}

            {!finished && data.stale && (
              <Alert tone="warning" title="The rider's phone has not reported recently">
                Last ping {Math.round((data.position?.ageSeconds ?? 0) / 60)} min ago. The marker shows that last
                known point — it is not being moved to look current.
              </Alert>
            )}

            {!finished && !data.position && (
              <Alert tone="info" title="No position yet">
                Tracking begins when the rider accepts the job and their phone reports a position.
              </Alert>
            )}

            <LiveMap
              points={points}
              connect={data.position ? { from: "rider", to: target } : null}
              showMyLocation
              emptyHint={finished ? "Tracking has ended for this delivery." : "Waiting for the rider's first position."}
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
              {sharedUrl ? (
                <>
                  <input
                    readOnly
                    value={sharedUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700"
                    aria-label="Share link"
                  />
                  <Button size="sm" onClick={copy}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={revokeLink} isLoading={revoke.isPending}>
                    Revoke
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={shareLink} isLoading={create.isPending}>
                    Create share link
                  </Button>
                  <p className="text-[11px] text-ink-500">
                    A public link that expires. It shows the parcel and the rider's first name — no phone numbers.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
