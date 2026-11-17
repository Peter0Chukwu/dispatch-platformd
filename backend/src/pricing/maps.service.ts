import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfig, type MapsProviderKey } from '../config/app.config';
import { SavedLocationsService, type SavedLocationRecord } from './saved-locations.service';
import { estimateRoute, haversineKm, type Point, type RouteEstimate } from './distance';
import type { GeocodeResult, PlaceResult } from './maps-types';

/**
 * MapsService — the only place that knows how routes are measured.
 *
 * `MAPS_PROVIDER` picks the provider; NOTHING ELSE in the codebase has to change,
 * because PricingService only ever calls `estimateRoute()` and receives the same
 * shape back:
 *
 *   stub (default)  haversine × road factor, no key, no account
 *   geoapify        OpenStreetMap data, one key for suggestions + routes + tiles
 *   google          Places API (New) + Routes API + Geocoding
 *   mapbox          not implemented — the enum value is reserved
 *
 * WHY GEOAPIFY IS THE DEFAULT CHOICE FOR A NEW DEPLOYMENT
 * Its free plan needs no card, allows commercial use with attribution, and one
 * key covers every call this file makes. Google's equivalent needs a billing
 * account before it answers a single request.
 *
 * A note on coverage, measured rather than assumed: OpenStreetMap (what Geoapify
 * serves) has Benin City's roads — a Ring Road → Ugbowo drive measures 10.6 km
 * and returns in about 10 minutes — but many Benin City streets have no name in
 * the data, and informal landmarks are absent from every provider. That is why
 * the booking form leads with the platform's own saved locations and treats a
 * typed address as the fallback.
 *
 * WHICH GOOGLE SERVICES, IF YOU CHOOSE GOOGLE
 * Google retired the legacy Places, Directions and Distance Matrix endpoints on
 * 5 October 2026: a Cloud project created after that date cannot enable them.
 * This file therefore speaks only to what a new project can use —
 *   · Places API (New)     places.googleapis.com  — address suggestions + details
 *   · Routes API           routes.googleapis.com  — driving distance and duration
 *   · Geocoding API        maps.googleapis.com    — written address ↔ coordinates
 * A key that only has the legacy APIs enabled fails here, and the service falls
 * back to the stub with a warning rather than blocking a booking.
 *
 * The stub is always the floor. Any provider error — bad key, quota, outage —
 * logs one warning and prices the booking from the stub table, because a
 * customer must never be unable to book a parcel because a map vendor is down.
 */
@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);

  constructor(
    private readonly config: AppConfig,
    /**
     * Optional so the adapter can still be constructed on its own in a unit test,
     * and so a database that has not been migrated yet degrades to the built-in
     * table instead of taking the booking form down with it.
     */
    @Optional() private readonly savedLocations?: SavedLocationsService,
  ) {}

  /**
   * The places the platform knows, wherever they live.
   *
   * The database is the source of truth once the migration has run; the built-in
   * table is the floor. Both answer with the same shape, so nothing downstream
   * can tell which one replied.
   */
  private async places(): Promise<SavedLocationRecord[]> {
    const fromDb = (await this.savedLocations?.active()) ?? null;
    if (fromDb && fromDb.length > 0) return fromDb;
    return STUB_PLACES.map((place) => ({ ...place, isActive: true, sortOrder: 100 }));
  }

  get provider(): MapsProviderKey {
    return this.config.mapsProviderKey;
  }

  /**
   * Distance and duration between two points.
   * Never throws for valid coordinates; a failed Google call falls back to the
   * stub so a booking is never blocked by a third-party outage.
   */
  async estimateRoute(from: Point, to: Point): Promise<RouteEstimate> {
    if (this.provider === 'geoapify' && this.config.geoapifyApiKey) {
      try {
        return await this.geoapifyRoute(from, to, this.config.geoapifyApiKey);
      } catch (error) {
        this.logger.warn(
          `Geoapify routing failed, falling back to the stub estimate: ${(error as Error).message}`,
        );
      }
    }
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

    // Read once per request: the same rows feed both the merge and the fallback.
    const places = await this.places();

    if (this.provider === 'geoapify') {
      const key = this.config.geoapifyApiKey;
      if (key) {
        try {
          const remote = await this.geoapifyPlaces('autocomplete', trimmed, key, limit);
          if (remote.length > 0) return this.mergeLocalFirst(trimmed, remote, limit, places);
        } catch (error) {
          this.logger.warn(`Geoapify suggestions failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }
    if (this.provider === 'google') {
      const key = this.config.googleMapsApiKey;
      if (key) {
        try {
          const remote = await this.googleAutocomplete(trimmed, key, limit);
          if (remote.length > 0) return this.mergeLocalFirst(trimmed, remote, limit, places);
        } catch (error) {
          this.logger.warn(`Google autocomplete failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }
    return stubSearch(trimmed, limit, places);
  }

  /**
   * The platform's own Benin City locations, ahead of the provider's answers.
   *
   * A geocoder orders by its own idea of relevance, and in Benin City that idea is
   * often wrong: typing "ring" returns Ring Road, LAGOS (300 km away, a different
   * state, a different business), because OpenStreetMap has many Ring Roads in
   * Nigeria and the biggest one wins. Typing "sapele" returns the town of Sapele in
   * Delta State before Benin-Sapele Road, where the riders actually drive.
   *
   * So: our twelve surveyed locations that match the text come first, and the
   * provider fills the rest. They are real coordinates the platform already prices
   * against, not a decoration — and a provider result that lands within 200 m of one
   * of them is the same place said twice, so it is dropped.
   *
   * The local match is deliberately strict: every word the customer typed has to
   * appear in the location's NAME. Matching against the address too would make
   * "road" pull in half the table and bury a precise provider hit.
   */
  private mergeLocalFirst(
    query: string,
    remote: PlaceResult[],
    limit: number,
    places: SavedLocationRecord[],
  ): PlaceResult[] {
    const local = matchLocalByName(query, 3, places);
    if (local.length === 0) return remote.slice(0, limit);

    const seen = new Set(local.map((place) => `${place.name.toLowerCase()}|${place.lat.toFixed(2)}|${place.lng.toFixed(2)}`));
    const extras = remote.filter((place) => {
      // Same spot as one of ours, whatever it calls itself.
      if (local.some((own) => haversineKm({ lat: own.lat, lng: own.lng }, { lat: place.lat, lng: place.lng }) < 0.2)) {
        return false;
      }
      const key = `${place.name.toLowerCase()}|${place.lat.toFixed(2)}|${place.lng.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return [...local, ...extras].slice(0, limit);
  }

  /** Turn a written address into coordinates. Used when a rider types a landmark. */
  async geocode(address: string): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (trimmed.length < 3) return null;

    if (this.provider === 'geoapify') {
      const key = this.config.geoapifyApiKey;
      if (key) {
        try {
          const [match] = await this.geoapifyPlaces('search', trimmed, key, 1);
          if (match) {
            return { address: match.address, lat: match.lat, lng: match.lng, source: 'GEOAPIFY', approximate: false };
          }
        } catch (error) {
          this.logger.warn(`Geoapify geocode failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }
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
    const [match] = stubSearch(trimmed, 1, await this.places());
    if (!match) return null;
    return { address: match.address, lat: match.lat, lng: match.lng, source: 'STUB', approximate: true };
  }

  /** Coordinates → an address the rider can read. */
  async reverseGeocode(point: Point): Promise<GeocodeResult | null> {
    if (this.provider === 'geoapify') {
      const key = this.config.geoapifyApiKey;
      if (key) {
        try {
          const address = await this.geoapifyReverse(point, key);
          if (address) return { address, lat: point.lat, lng: point.lng, source: 'GEOAPIFY', approximate: false };
        } catch (error) {
          this.logger.warn(`Geoapify reverse geocode failed, falling back to local places: ${(error as Error).message}`);
        }
      }
    }
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
    const nearest = nearestStubLocation(point, await this.places());
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

  /* ─────────────────────────────── Geoapify ───────────────────────────────
   * OpenStreetMap data. One key covers suggestions, geocoding, reverse geocoding
   * and routing, and the free plan needs no card.
   *
   * Every call is a GET with `apiKey` in the query string — Geoapify's documented
   * scheme — so, unlike Google, there is no field mask and no header auth to get
   * wrong. Autocomplete and search answer with already-geocoded rows, which means
   * choosing a suggestion costs ONE request here instead of Google's one-plus-one.
   */

  /**
   * Address suggestions ('autocomplete') or a single best match ('search').
   * Both endpoints share a response shape: a GeoJSON FeatureCollection.
   */
  private async geoapifyPlaces(
    kind: 'autocomplete' | 'search',
    query: string,
    key: string,
    limit: number,
  ): Promise<PlaceResult[]> {
    const params = new URLSearchParams({
      text: query,
      // Nigeria only: a suggestion in Ghana or Cameroon is noise for a Benin City
      // courier, and it also keeps the result list short and cheap.
      filter: 'countrycode:ng',
      lang: 'en',
      limit: String(limit),
      apiKey: key,
    });
    // Prefer places near the depot city. `bias` is longitude-first, like the rest of
    // Geoapify's geo parameters.
    const bias = this.config.mapsSearchBias;
    if (bias) params.set('bias', `proximity:${bias}`);
    const response = await fetch(`https://api.geoapify.com/v1/geocode/${kind}?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Geoapify ${kind} responded ${response.status}`);

    const body = (await response.json()) as GeoapifyFeatureCollection;
    return (body.features ?? [])
      .map(toPlaceResult)
      .filter((place): place is PlaceResult => place !== null)
      .slice(0, limit);
  }

  /** Coordinates → the most readable address Geoapify can offer. */
  private async geoapifyReverse(point: Point, key: string): Promise<string | null> {
    const params = new URLSearchParams({
      lat: String(point.lat),
      lon: String(point.lng),
      lang: 'en',
      limit: '1',
      apiKey: key,
    });
    const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Geoapify reverse responded ${response.status}`);

    const body = (await response.json()) as GeoapifyFeatureCollection;
    const first = body.features?.[0]?.properties;
    return first?.formatted ?? first?.address_line1 ?? null;
  }

  /**
   * Driving distance and duration.
   *
   * Geoapify answers with `distance` and `time` on the route feature, in metres
   * and seconds. It can return `units: 'miles'` if an account is configured that
   * way, so the conversion is explicit rather than assumed.
   */
  private async geoapifyRoute(from: Point, to: Point, key: string): Promise<RouteEstimate> {
    const params = new URLSearchParams({
      waypoints: `${from.lat},${from.lng}|${to.lat},${to.lng}`,
      mode: 'drive',
      apiKey: key,
    });
    const response = await fetch(`https://api.geoapify.com/v1/routing?${params}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Geoapify routing responded ${response.status}`);

    const body = (await response.json()) as {
      features?: Array<{ properties?: { distance?: number; time?: number; units?: string } }>;
    };
    const route = body.features?.[0]?.properties;
    if (!route?.distance) throw new Error('Geoapify returned no route');

    const metres = route.units === 'miles' ? route.distance * 1609.344 : route.distance;
    const seconds = route.time ?? 0;

    return {
      distanceKm: Math.round((metres / 1000) * 100) / 100,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      source: 'GEOAPIFY',
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

/* ──────────────────────── Geoapify's response shape ─────────────────────── */

/**
 * Geoapify answers with GeoJSON, not a bespoke object. Only the fields used here
 * are declared — anything else in the payload is ignored, so a new field on
 * their side cannot break a booking.
 */
interface GeoapifyFeatureCollection {
  features?: Array<{
    properties?: {
      place_id?: string;
      name?: string;
      formatted?: string;
      address_line1?: string;
      address_line2?: string;
      city?: string;
      suburb?: string;
      district?: string;
      street?: string;
      lat?: number;
      lon?: number;
    };
    geometry?: { coordinates?: [number, number] };
  }>;
}

/** One GeoJSON feature → the platform's PlaceResult, or null if it has no position. */
function toPlaceResult(feature: NonNullable<GeoapifyFeatureCollection['features']>[number]): PlaceResult | null {
  const props = feature.properties ?? {};
  // Longitude first: GeoJSON, and the single easiest thing to get wrong here.
  const lng = props.lon ?? feature.geometry?.coordinates?.[0];
  const lat = props.lat ?? feature.geometry?.coordinates?.[1];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const name = props.name ?? props.address_line1 ?? props.street ?? props.formatted ?? 'Unknown place';
  const address = props.formatted ?? [props.address_line1, props.address_line2].filter(Boolean).join(', ') ?? name;

  return {
    id: props.place_id ?? `${lat},${lng}`,
    name,
    address: address || name,
    // The neighbourhood is genuinely useful in Benin City, where "off Sapele Road"
    // locates a parcel better than a house number nobody uses.
    landmark: props.suburb ?? props.district ?? props.city ?? null,
    lat,
    lng,
    source: 'GEOAPIFY',
  };
}

/* ────────────────────────── the stub place table ────────────────────────── */

/**
 * Real Benin City locations with coordinates the platform already prices against.
 * Kept server-side so the API can answer without a maps key, and so a booking made
 * with `MAPS_PROVIDER=STUB` still records a true position rather than a fake one.
 */
const STUB_PLACES: SavedLocationRecord[] = [
  { id: 'ring-road', name: 'Ring Road — Oba Ovonramwen Square', address: 'Ring Road, Oba Ovonramwen Square, Benin City', landmark: 'By the palace roundabout', lat: 6.333, lng: 5.622, isActive: true, sortOrder: 100 },
  { id: 'new-benin', name: 'New Benin — Mission Road', address: 'Mission Road, New Benin Market, Benin City', landmark: 'Opposite the market gate', lat: 6.3373, lng: 5.6337, isActive: true, sortOrder: 100 },
  { id: 'akpakpava', name: 'Akpakpava Road', address: 'Akpakpava Road, Benin City', landmark: 'Near the Central Mosque', lat: 6.3395, lng: 5.628, isActive: true, sortOrder: 100 },
  { id: 'gra-adesuwa', name: 'GRA — Adesuwa Road', address: 'Adesuwa Road, GRA, Benin City', landmark: 'By Adesuwa Primary School', lat: 6.3312, lng: 5.6392, isActive: true, sortOrder: 100 },
  { id: 'siluko', name: 'Siluko Road', address: 'Siluko Road, Benin City', landmark: 'Off Sapele Road, by Siluko junction', lat: 6.318, lng: 5.629, isActive: true, sortOrder: 100 },
  { id: 'ugbowo-complex', name: 'Ugbowo — Shopping Complex', address: 'Ugbowo-Lagos Road, Ugbowo, Benin City', landmark: 'Ugbowo Shopping Complex', lat: 6.396, lng: 5.611, isActive: true, sortOrder: 100 },
  { id: 'ubth', name: 'Ugbowo — UBTH', address: 'Ugbowo-Lagos Road, Benin City', landmark: 'University of Benin Teaching Hospital main gate', lat: 6.3906, lng: 5.6122, isActive: true, sortOrder: 100 },
  { id: 'uselu', name: 'Uselu — Market Road', address: 'Uselu Market Road, Benin City', landmark: 'By Uselu market', lat: 6.372, lng: 5.621, isActive: true, sortOrder: 100 },
  { id: 'ikpoba-hill', name: 'Ikpoba Hill', address: 'Benin-Auchi Road, Ikpoba Hill, Benin City', landmark: 'By the Ikpoba River bridge', lat: 6.3565, lng: 5.6691, isActive: true, sortOrder: 100 },
  { id: 'aduwawa', name: 'Aduwawa', address: 'Aduwawa, Benin-Auchi Road, Benin City', landmark: 'Near Aduwawa market', lat: 6.3629, lng: 5.6791, isActive: true, sortOrder: 100 },
  { id: 'airport-road', name: 'Airport Road — Benin Airport', address: 'Airport Road, Benin City', landmark: 'By the airport terminal', lat: 6.3169, lng: 5.5994, isActive: true, sortOrder: 100 },
  { id: 'sapele-road', name: 'Sapele Road — Oregbeni', address: 'Sapele Road, Benin City', landmark: 'By Oregbeni market', lat: 6.2771, lng: 5.6337, isActive: true, sortOrder: 100 },
];

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function stubSearch(query: string, limit: number, places: SavedLocationRecord[] = STUB_PLACES): PlaceResult[] {
  const needle = normalise(query);
  const terms = needle.split(' ').filter(Boolean);
  if (terms.length === 0) return [];

  return places.map((place) => {
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

/** Local places whose NAME contains every word of the query (3+ letters). */
function matchLocalByName(
  query: string,
  limit = 3,
  places: SavedLocationRecord[] = STUB_PLACES,
): PlaceResult[] {
  const terms = normalise(query)
    .split(' ')
    .filter((term) => term.length >= 3);
  if (terms.length === 0) return [];

  return places.filter((place) => {
    const name = normalise(place.name);
    return terms.every((term) => name.includes(term));
  })
    .slice(0, limit)
    .map((place) => ({
      id: place.id,
      name: place.name,
      address: place.address,
      landmark: place.landmark,
      lat: place.lat,
      lng: place.lng,
      source: 'STUB' as const,
    }));
}

function nearestStubLocation(point: Point, places: SavedLocationRecord[] = STUB_PLACES) {
  let best: SavedLocationRecord | null = null;
  let bestKm = Number.POSITIVE_INFINITY;
  for (const place of places) {
    const km = haversineKm(point, { lat: place.lat, lng: place.lng });
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }
  return best;
}
