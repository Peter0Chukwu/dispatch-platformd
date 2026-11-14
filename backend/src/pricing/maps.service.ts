import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { estimateRoute, haversineKm, type Point, type RouteEstimate } from './distance';
import type { GeocodeResult, PlaceResult } from './maps-types';

/**
 * MapsService — the only place that knows how routes are measured.
 *
 * Today `MAPS_PROVIDER=stub` (haversine × road factor). When the Google Maps key
 * is configured, `MAPS_PROVIDER=google` switches this to Google's current
 * services and NOTHING ELSE in the codebase has to change: PricingService only
 * ever calls `estimateRoute()` and receives the same shape back.
 *
 * WHICH GOOGLE SERVICES, AND WHY THESE ONES
 * Google retired the legacy Places, Directions and Distance Matrix endpoints on
 * 5 October 2026: a Google Cloud project created after that date cannot enable
 * them at all. Since every deployment of this platform starts as a new project,
 * this file speaks only to what a new project can actually use —
 *   · Places API (New)     places.googleapis.com  — address suggestions + details
 *   · Routes API           routes.googleapis.com  — driving distance and duration
 *   · Geocoding API        maps.googleapis.com    — written address ↔ coordinates
 *                                           (Geocoding was not retired.)
 * A key that only has the legacy APIs enabled will fail here, and the service
 * falls back to the stub with a warning in the log rather than blocking a
 * booking.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(private readonly config: AppConfig) {}

  get provider(): 'stub' | 'google' | 'mapbox' {
    return this.config.mapsProviderKey;
  }

  /**
   * Distance and duration between two points.
   * Never throws for valid coordinates; a failed Google call falls back to the
   * stub so a booking is never blocked by a third-party outage.
   */
  async estimateRoute(from: Point, to: Point): Promise<RouteEstimate> {
    if (this.provider === 'google') {
      try {
        return await this.googleRoute(from, to);
      } catch (error) {
        this.logger.warn(
          `Routes API failed, falling back to the stub estimate: ${(error as Error).message}`,
        );
      }
    }
    return estimateRoute(from, to);
  }

  // ── Address lookup ───────────────────────────────────────────────────────

  /**
   * Place suggestions for the booking form.
   *
   * With Google configured this is Places Autocomplete. Without a key there is no
   * honest way to invent a geocoder, so the stub answers from the platform's own
   * table of real Benin City locations — every one of them has surveyed-ish coordinates
   * that pricing and dispatch already use. The result says `source: 'STUB'`, and the
   * UI says so too.
   */
  async autocomplete(query: string, limit = 6): Promise<PlaceResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    if (this.provider === 'google') {
      const key = this.config.googleMapsApiKey;
      if (key) {
        try {
          const results = await this.googleAutocomplete(trimmed, key, limit);
          if (results.length > 0) return results;
        } catch (error) {
          this.logger.warn(`Google autocomplete failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }
    return stubSearch(trimmed, limit);
  }

  /** Turn a written address into coordinates. Used when a rider types a landmark. */
  async geocode(address: string): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (trimmed.length < 3) return null;

    if (this.provider === 'google') {
      const key = this.config.googleMapsApiKey;
      if (key) {
        try {
          const url =
            'https://maps.googleapis.com/maps/api/geocode/json' +
            `?address=${encodeURIComponent(trimmed)}&region=ng&components=country:NG` +
            `&key=${encodeURIComponent(key)}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          const body = (await response.json()) as {
            status: string;
            results?: Array<{
              formatted_address: string;
              place_id: string;
              geometry: { location: { lat: number; lng: number } };
            }>;
          };
          const first = body.results?.[0];
          if (body.status === 'OK' && first) {
            return {
              address: first.formatted_address,
              lat: first.geometry.location.lat,
              lng: first.geometry.location.lng,
              source: 'GOOGLE',
              approximate: false,
            };
          }
        } catch (error) {
          this.logger.warn(`Google geocode failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }

    // Stub: the closest matching saved location, clearly marked as approximate.
    const [match] = stubSearch(trimmed, 1);
    if (!match) return null;
    return { address: match.address, lat: match.lat, lng: match.lng, source: 'STUB', approximate: true };
  }

  /** Coordinates → an address the rider can read. */
  async reverseGeocode(point: Point): Promise<GeocodeResult | null> {
    if (this.provider === 'google') {
      const key = this.config.googleMapsApiKey;
      if (key) {
        try {
          const url =
            'https://maps.googleapis.com/maps/api/geocode/json' +
            `?latlng=${point.lat},${point.lng}&region=ng&key=${encodeURIComponent(key)}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
          const body = (await response.json()) as {
            status: string;
            results?: Array<{ formatted_address: string }>;
          };
          if (body.status === 'OK' && body.results?.[0]) {
            return {
              address: body.results[0].formatted_address,
              lat: point.lat,
              lng: point.lng,
              source: 'GOOGLE',
              approximate: false,
            };
          }
        } catch (error) {
          this.logger.warn(`Google reverse geocode failed: ${(error as Error).message}`);
        }
      }
    }

    // Stub: name the nearest known Benin City location, and say how far away it is.
    const nearest = nearestStubLocation(point);
    if (!nearest) return null;
    const km = haversineKm(point, { lat: nearest.lat, lng: nearest.lng });
    return {
      address: `Near ${nearest.name} (±${km.toFixed(1)} km)`,
      lat: point.lat,
      lng: point.lng,
      source: 'STUB',
      approximate: true,
    };
  }

  /**
   * Address suggestions from Places API (New).
   *
   * Autocomplete answers with predictions but no coordinates, so the few the
   * customer will actually see are expanded with a Place Details call. Both
   * requests carry the field mask the new API requires; without a mask Google
   * rejects the call outright.
   */
  private async googleAutocomplete(query: string, key: string, limit: number): Promise<PlaceResult[]> {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify({
        input: query,
        // Benin City is in Nigeria; a suggestion from another country is noise.
        includedRegionCodes: ['ng'],
        languageCode: 'en',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Places autocomplete responded ${response.status}`);

    const body = (await response.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        };
      }>;
    };

    const predictions = (body.suggestions ?? [])
      .map((suggestion) => suggestion.placePrediction)
      .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction?.placeId))
      .slice(0, limit);
    if (predictions.length === 0) return [];

    const detailed = await Promise.all(
      predictions.map((prediction) => this.googlePlaceDetails(prediction.placeId!, prediction, key)),
    );
    return detailed.filter((place): place is PlaceResult => place !== null);
  }

  /** One place, by id, with the coordinates a booking needs. */
  private async googlePlaceDetails(
    placeId: string,
    prediction: {
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    },
    key: string,
  ): Promise<PlaceResult | null> {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': key,
          // Ask for three fields, not the whole place: Google bills by field.
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;

    const place = (await response.json()) as {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    if (place.location?.latitude === undefined || place.location?.longitude === undefined) return null;

    return {
      id: place.id ?? placeId,
      name: prediction.structuredFormat?.mainText?.text ?? place.displayName?.text ?? place.formattedAddress ?? '',
      address: place.formattedAddress ?? prediction.text?.text ?? '',
      landmark: prediction.structuredFormat?.secondaryText?.text ?? null,
      lat: place.location.latitude,
      lng: place.location.longitude,
      source: 'GOOGLE',
    };
  }

  /** Driving distance and duration from the Routes API. */
  private async googleRoute(from: Point, to: Point): Promise<RouteEstimate> {
    const key = this.config.googleMapsApiKey;
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not configured');

    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        // Benin City traffic is real, but traffic-aware routing is billed higher
        // and a fare quote does not need it. Duration is still authoritative.
        routingPreference: 'TRAFFIC_UNAWARE',
        regionCode: 'NG',
        units: 'METRIC',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Routes responded ${response.status}`);

    const body = (await response.json()) as {
      routes?: Array<{ distanceMeters?: number; duration?: string }>;
    };
    const route = body.routes?.[0];
    if (!route?.distanceMeters) throw new Error('Routes returned no route');

    // `duration` arrives as a protobuf duration string, e.g. "842s".
    const seconds = Number.parseInt(String(route.duration ?? '0s').replace('s', ''), 10) || 0;

    return {
      distanceKm: Math.round((route.distanceMeters / 1000) * 100) / 100,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      source: 'GOOGLE',
    };
  }
}

/* ────────────────────────── the stub place table ────────────────────────── */

/**
 * Real Benin City locations with coordinates the platform already prices against.
 * Kept server-side so the API can answer without a maps key, and so a booking made
 * with `MAPS_PROVIDER=STUB` still records a true position rather than a fake one.
 */
const STUB_PLACES: Array<{ id: string; name: string; address: string; landmark: string; lat: number; lng: number }> = [
  { id: 'ring-road', name: 'Ring Road — Oba Ovonramwen Square', address: 'Ring Road, Oba Ovonramwen Square, Benin City', landmark: 'By the palace roundabout', lat: 6.333, lng: 5.622 },
  { id: 'new-benin', name: 'New Benin — Mission Road', address: 'Mission Road, New Benin Market, Benin City', landmark: 'Opposite the market gate', lat: 6.3373, lng: 5.6337 },
  { id: 'akpakpava', name: 'Akpakpava Road', address: 'Akpakpava Road, Benin City', landmark: 'Near the Central Mosque', lat: 6.3395, lng: 5.628 },
  { id: 'gra-adesuwa', name: 'GRA — Adesuwa Road', address: 'Adesuwa Road, GRA, Benin City', landmark: 'By Adesuwa Primary School', lat: 6.3312, lng: 5.6392 },
  { id: 'siluko', name: 'Siluko Road', address: 'Siluko Road, Benin City', landmark: 'Off Sapele Road, by Siluko junction', lat: 6.318, lng: 5.629 },
  { id: 'ugbowo-complex', name: 'Ugbowo — Shopping Complex', address: 'Ugbowo-Lagos Road, Ugbowo, Benin City', landmark: 'Ugbowo Shopping Complex', lat: 6.396, lng: 5.611 },
  { id: 'ubth', name: 'Ugbowo — UBTH', address: 'Ugbowo-Lagos Road, Benin City', landmark: 'University of Benin Teaching Hospital main gate', lat: 6.3906, lng: 5.6122 },
  { id: 'uselu', name: 'Uselu — Market Road', address: 'Uselu Market Road, Benin City', landmark: 'By Uselu market', lat: 6.372, lng: 5.621 },
  { id: 'ikpoba-hill', name: 'Ikpoba Hill', address: 'Benin-Auchi Road, Ikpoba Hill, Benin City', landmark: 'By the Ikpoba River bridge', lat: 6.3565, lng: 5.6691 },
  { id: 'aduwawa', name: 'Aduwawa', address: 'Aduwawa, Benin-Auchi Road, Benin City', landmark: 'Near Aduwawa market', lat: 6.3629, lng: 5.6791 },
  { id: 'airport-road', name: 'Airport Road — Benin Airport', address: 'Airport Road, Benin City', landmark: 'By the airport terminal', lat: 6.3169, lng: 5.5994 },
  { id: 'sapele-road', name: 'Sapele Road — Oregbeni', address: 'Sapele Road, Benin City', landmark: 'By Oregbeni market', lat: 6.2771, lng: 5.6337 },
];

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function stubSearch(query: string, limit: number): PlaceResult[] {
  const needle = normalise(query);
  const terms = needle.split(' ').filter(Boolean);
  if (terms.length === 0) return [];

  return STUB_PLACES.map((place) => {
    const haystack = normalise(`${place.name} ${place.address} ${place.landmark}`);
    const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
    return { place, score };
  })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ place }) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      landmark: place.landmark,
      lat: place.lat,
      lng: place.lng,
      source: 'STUB' as const,
    }));
}

function nearestStubLocation(point: Point) {
  let best: (typeof STUB_PLACES)[number] | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const place of STUB_PLACES) {
    const km = haversineKm(point, { lat: place.lat, lng: place.lng });
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best;
}
