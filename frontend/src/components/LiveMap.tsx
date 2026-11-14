import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

/**
 * LIVE MAP
 * ─────────────────────────────────────────────────────────────────────────────
 * This component draws real coordinates and is honest about its basemap.
 *
 *   · With `VITE_GOOGLE_MAPS_API_KEY` set, it loads the Google Maps JavaScript API
 *     and draws street-level tiles with proper markers.
 *   · Without a key it draws a **schematic**: every point is placed at its true
 *     latitude/longitude relative to the others, on a plain grid. Nothing is moved,
 *     interpolated or invented — the caption says exactly that, so nobody mistakes
 *     a schematic for a street map.
 *
 * What this component will NOT do is invent a position. If a rider has not pinged,
 * `points` contains no rider and the map says "no position reported yet".
 */

export type MapPointKind = "rider" | "pickup" | "destination" | "me" | "idle-rider";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  kind: MapPointKind;
  label: string;
  /** Riders only: heading in degrees, 0 = north. */
  heading?: number | null;
  /** Greyed out when the position is old. */
  stale?: boolean;
}

export interface LiveMapProps {
  points: MapPoint[];
  /** Draw a dashed line from this point id to that one (rider → next stop). */
  connect?: { from: string; to: string } | null;
  height?: number;
  className?: string;
  /** Ask the browser for the viewer's own position (customer "how far am I?"). */
  showMyLocation?: boolean;
  /** Shown when there is nothing to draw. */
  emptyHint?: string;
}

const KIND_STYLE: Record<MapPointKind, { fill: string; ring: string; glyph: string }> = {
  pickup: { fill: "var(--accent-600, #4f46e5)", ring: "#c7d2fe", glyph: "P" },
  destination: { fill: "#059669", ring: "#a7f3d0", glyph: "D" },
  rider: { fill: "#ea580c", ring: "#fed7aa", glyph: "R" },
  "idle-rider": { fill: "#64748b", ring: "#e2e8f0", glyph: "R" },
  me: { fill: "#0284c7", ring: "#bae6fd", glyph: "•" },
};

export function LiveMap({
  points,
  connect,
  height = 260,
  className,
  showMyLocation = false,
  emptyHint = "No position reported yet.",
}: LiveMapProps) {
  const [myPosition, setMyPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const mapKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const containerRef = useRef<HTMLDivElement | null>(null);

  /**
   * The viewer's own position is strictly opt-in.
   *
   * Ask for it unprompted and every visitor sees a permission dialog they did not
   * want, and a scary warning if they decline. So the map draws what the server
   * knows, and "Show my location" is a deliberate click. Declining is still
   * handled honestly — the notice says the rider's marker is unaffected.
   */
  const locateMe = () => {
    if (!navigator.geolocation) {
      setGeoError("This browser has no location support, so your own position cannot be shown.");
      return;
    }
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => setMyPosition({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => {
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "You declined location access, so your own position is not shown. The rider's marker comes from their phone and is unaffected."
            : "Could not read your location right now. The rider's position is unaffected.",
        );
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const allPoints = useMemo(
    () => (myPosition ? [...points, { id: "me", lat: myPosition.lat, lng: myPosition.lng, kind: "me" as const, label: "You" }] : points),
    [points, myPosition],
  );

  // Load the Google Maps JS API only when a key exists and the container is on screen.
  useEffect(() => {
    if (!mapKey || allPoints.length === 0) return;
    const globalWindow = window as unknown as { google?: { maps?: unknown } };
    if (globalWindow.google?.maps) {
      setGoogleReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-google-maps]");
    if (existing) {
      existing.addEventListener("load", () => setGoogleReady(true));
      return;
    }
    const script = document.createElement("script");
    script.dataset.googleMaps = "true";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapKey)}&v=weekly`;
    script.addEventListener("load", () => setGoogleReady(true));
    script.addEventListener("error", () => setGoogleReady(false));
    document.head.appendChild(script);
  }, [mapKey, allPoints.length]);

  if (allPoints.length === 0) {
    return (
      <div
        className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center", className)}
        style={{ height }}
      >
        <p className="text-sm font-medium text-slate-600">{emptyHint}</p>
        <p className="mt-1 max-w-sm px-6 text-xs text-slate-500">
          The rider’s live position will appear here once the trip starts.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white", className)}>
      {mapKey && googleReady ? (
        <GoogleMapCanvas points={allPoints} connect={connect ?? null} height={height} containerRef={containerRef} />
      ) : (
        <SchematicMap points={allPoints} connect={connect ?? null} height={height} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2">
        <p className="text-[11px] leading-snug text-slate-500">
          {mapKey && googleReady
            ? "Street map · positions reported by the rider app."
            : "Schematic view — positions are exact, the basemap is not. Set GOOGLE_MAPS_API_KEY (and VITE_GOOGLE_MAPS_API_KEY) for street-level maps."}
        </p>
        <Legend />
      </div>
      {showMyLocation && (
        <div className="border-t border-slate-100 px-3 py-1.5">
          <button type="button" onClick={locateMe} className="text-[11px] font-medium text-brand-700 hover:underline">
            {myPosition ? "Refresh my position" : "Show my location"}
          </button>
        </div>
      )}
      {geoError && (
        <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">{geoError}</p>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-slate-600">
      <span className="flex items-center gap-1">
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_STYLE.pickup.fill }} /> Pickup
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_STYLE.destination.fill }} /> Drop-off
      </span>
      <span className="flex items-center gap-1">
        <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_STYLE.rider.fill }} /> Rider
      </span>
    </div>
  );
}

/* ─────────────────────────── schematic renderer ─────────────────────────── */

function SchematicMap({
  points,
  connect,
  height,
}: {
  points: MapPoint[];
  connect: LiveMapProps["connect"];
  height: number;
}) {
  const width = 640;
  const padding = 44;

  // Fit every real coordinate into the view. Longitude is scaled by cos(latitude)
  // so east-west distances are not stretched — the same correction haversine makes.
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const midLat = (minLat + maxLat) / 2 || 6.45;
  const lngScale = Math.cos((midLat * Math.PI) / 180);

  const spanLat = Math.max(maxLat - minLat, 0.004);
  const spanLng = Math.max((maxLng - minLng) * lngScale, 0.004);
  const drawWidth = width - padding * 2;
  const drawHeight = height - padding * 2;
  const scale = Math.min(drawWidth / spanLng, drawHeight / spanLat);

  const project = (lat: number, lng: number) => ({
    x: padding + ((lng - minLng) * lngScale - spanLng / 2) * scale + drawWidth / 2 - (drawWidth - spanLng * scale) / 2,
    y: padding + ((maxLat - lat) - spanLat / 2) * scale + drawHeight / 2 - (drawHeight - spanLat * scale) / 2,
  });

  const projected = new Map(points.map((point) => [point.id, project(point.lat, point.lng)]));
  const from = connect ? projected.get(connect.from) : null;
  const to = connect ? projected.get(connect.to) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Delivery positions">
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#f8fafc" />
      <rect width={width} height={height} fill="url(#grid)" />

      {from && to && (
        <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#f97316" strokeWidth="2" strokeDasharray="6 4" opacity="0.7" />
      )}

      {points.map((point) => {
        const { x, y } = projected.get(point.id)!;
        const style = KIND_STYLE[point.kind];
        const stale = point.stale === true;
        return (
          <g key={point.id} opacity={stale ? 0.45 : 1}>
            {point.kind === "rider" && point.heading != null && (
              <path
                d="M 0 -13 L 5 -5 L -5 -5 Z"
                fill={style.fill}
                transform={`translate(${x} ${y}) rotate(${point.heading})`}
              />
            )}
            <circle cx={x} cy={y} r={11} fill="white" stroke={style.ring} strokeWidth="3" />
            <circle cx={x} cy={y} r={6.5} fill={style.fill} />
            <text x={x} y={y + 4} textAnchor="middle" fontSize="8" fontWeight="700" fill="white">
              {style.glyph}
            </text>
            <text x={x} y={y - 17} textAnchor="middle" fontSize="10" fill="#334155">
              {point.label}
            </text>
            {stale && (
              <text x={x} y={y + 25} textAnchor="middle" fontSize="9" fill="#b45309">
                last seen
              </text>
            )}
          </g>
        );
      })}

      <text x={12} y={height - 10} fontSize="9" fill="#94a3b8">
        {minLat.toFixed(4)}–{maxLat.toFixed(4)}°N · {minLng.toFixed(4)}–{maxLng.toFixed(4)}°E
      </text>
    </svg>
  );
}

/* ─────────────────────────── google renderer ─────────────────────────── */

function GoogleMapCanvas({
  points,
  connect,
  height,
  containerRef,
}: {
  points: MapPoint[];
  connect: LiveMapProps["connect"];
  height: number;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const mapRef = useRef<{ fitBounds?: (bounds: unknown) => void } | null>(null);

  useEffect(() => {
    const google = (window as unknown as {
      google?: {
        maps: {
          Map: new (el: HTMLElement, options: Record<string, unknown>) => unknown;
          LatLngBounds: new () => { extend: (p: { lat: number; lng: number }) => void };
          LatLng: new (lat: number, lng: number) => unknown;
          Marker: new (options: Record<string, unknown>) => unknown;
          Polyline: new (options: Record<string, unknown>) => unknown;
        };
      };
    }).google;
    if (!google || !containerRef.current) return;

    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend({ lat: point.lat, lng: point.lng });

    const map = new google.maps.Map(containerRef.current, {
      center: { lat: points[0]!.lat, lng: points[0]!.lng },
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "cooperative",
    }) as { fitBounds?: (value: unknown) => void };
    mapRef.current = map;
    map.fitBounds?.(bounds);

    for (const point of points) {
      const style = KIND_STYLE[point.kind];
      new google.maps.Marker({
        map,
        position: { lat: point.lat, lng: point.lng },
        title: point.label,
        opacity: point.stale ? 0.45 : 1,
        icon: {
          path: 0, // google.maps.SymbolPath.CIRCLE is 0
          fillColor: style.fill,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: 8,
        },
      });
    }

    if (connect) {
      const from = points.find((point) => point.id === connect.from);
      const to = points.find((point) => point.id === connect.to);
      if (from && to) {
        new google.maps.Polyline({
          map,
          path: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
          strokeColor: "#f97316",
          strokeOpacity: 0.8,
          strokeWeight: 3,
        });
      }
    }
  }, [points, connect, containerRef]);

  return <div ref={containerRef} style={{ height }} className="w-full bg-slate-100" />;
}
