/**
 * Distance maths — pure functions, no I/O, fully unit-testable.
 *
 * The pricing engine never trusts a distance sent by the browser: the client
 * sends two coordinates, the server measures. Everything below is deterministic.
 */

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points, in kilometres (haversine).
 * Accurate to ~0.5% — plenty for pricing, and it costs microseconds.
 */
export function haversineKm(from: Point, to: Point): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Straight-line distance understates real driving distance, especially in Lagos
 * where you cannot cross the lagoon without a bridge. Until the Google Directions
 * API is wired up (Phase 4+), the stub multiplies by a road factor.
 *
 * This is deliberately a named constant with a comment, not a magic number
 * hidden in the pricing code: when real route data arrives, only this function
 * changes and every historical price keeps its frozen snapshot.
 */
export const ROAD_DETOUR_FACTOR = 1.35;

/** Average urban speed used to estimate duration while Maps is stubbed. */
export const AVERAGE_SPEED_KMH = 22;

export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
  /** 'STUB' means haversine × road factor, not a real route. Shown in the UI. */
  source: 'STUB' | 'GOOGLE';
}

export function estimateRoute(from: Point, to: Point): RouteEstimate {
  const straight = haversineKm(from, to);
  const distanceKm = roundTo(straight * ROAD_DETOUR_FACTOR, 2);
  const durationMinutes = Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 60));
  return { distanceKm, durationMinutes, source: 'STUB' };
}

/** Total distance of a multi-stop trip: pickup → stops… → destination. */
export function totalRouteKm(start: Point, stops: readonly Point[], end: Point): number {
  let total = 0;
  let previous = start;
  for (const stop of stops) {
    total += haversineKm(previous, stop) * ROAD_DETOUR_FACTOR;
    previous = stop;
  }
  total += haversineKm(previous, end) * ROAD_DETOUR_FACTOR;
  return roundTo(total, 2);
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
