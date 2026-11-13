import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { estimateRoute, haversineKm, type Point, type RouteEstimate } from './distance';
import type { GeocodeResult, PlaceResult } from './maps-types';

/**
 * MapsService — the only place that knows how routes are measured.
 *
 * Today `MAPS_PROVIDER=stub` (haversine × road factor). When the Google Maps key
 * is configured, `MAPS_PROVIDER=google` switches this to the Directions API and
 * NOTHING ELSE in the codebase has to change: PricingService only ever calls
 * `estimateRoute()` and receives the same shape back.
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
          `Google Directions failed, falling back to stub estimate: ${(error as Error).message}`,
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

  private async googleAutocomplete(query: string, key: string, limit: number): Promise<PlaceResult[]> {
    const url =
      'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
      `?input=${encodeURIComponent(query)}&components=country:NG&region=ng` +
      `&key=${encodeURIComponent(key)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as {
      status: string;
      predictions?: Array<{
        place_id: string;
        description: string;
        structured_formatting?: { main_text: string; secondary_text?: string };
      }>;
    };
    if (body.status !== 'OK' || !body.predictions?.length) return [];

    // Autocomplete returns predictions without coordinates; fetch details for the
    // few the customer will actually see.
    const detailed: Array<PlaceResult | null> = await Promise.all(
      body.predictions.slice(0, limit).map(async (prediction) => {
        const detailUrl =
          'https://maps.googleapis.com/maps/api/place/details/json' +
          `?place_id=${encodeURIComponent(prediction.place_id)}&fields=formatted_address,geometry,name` +
          `&key=${encodeURIComponent(key)}`;
        const detailResponse = await fetch(detailUrl, { signal: AbortSignal.timeout(5000) });
        const detail = (await detailResponse.json()) as {
          result?: { formatted_address: string; name: string; geometry: { location: { lat: number; lng: number } } };
        };
        if (!detail.result) return null;
        const place: PlaceResult = {
          id: prediction.place_id,
          name: prediction.structured_formatting?.main_text ?? detail.result.name,
          address: detail.result.formatted_address,
          landmark: prediction.structured_formatting?.secondary_text ?? null,
          lat: detail.result.geometry.location.lat,
          lng: detail.result.geometry.location.lng,
          source: 'GOOGLE',
        };
        return place;
      }),
    );
    return detailed.filter((row): row is PlaceResult => row !== null);
  }

  private async googleRoute(from: Point, to: Point): Promise<RouteEstimate> {
    const key = this.config.googleMapsApiKey;
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not configured');

    const url =
      'https://maps.googleapis.com/maps/api/directions/json' +
      `?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}` +
      `&mode=driving&region=ng&key=${encodeURIComponent(key)}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Directions responded ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      routes?: { legs: { distance: { value: number }; duration: { value: number } }[] }[];
    };
    if (body.status !== 'OK' || !body.routes?.length) {
      throw new Error(`Directions status ${body.status}`);
    }

    const legs = body.routes[0]!.legs;
    const metres = legs.reduce((sum, leg) => sum + leg.distance.value, 0);
    const seconds = legs.reduce((sum, leg) => sum + leg.duration.value, 0);

    return {
      distanceKm: Math.round((metres / 1000) * 100) / 100,
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
