import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsService } from '../src/pricing/maps.service';
import type { AppConfig } from '../src/config/app.config';

/**
 * The Google adapter, tested against the wire format — no network, no key.
 *
 * These assertions exist because the endpoints changed: Google retired the
 * legacy Places and Directions APIs on 5 October 2026, so a project created
 * today can only use Places API (New) and the Routes API. A call to the old
 * URLs would not fail loudly — it would return a suggestion-less response and
 * the app would quietly fall back to the stub table, which looks like "Google
 * is not working" and is miserable to diagnose from a screenshot.
 */

const config = {
  mapsProviderKey: 'google',
  googleMapsApiKey: 'test-key',
} as unknown as AppConfig;

const autocompleteResponse = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'place-ring-road',
        text: { text: 'Ring Road, Benin City, Nigeria' },
        structuredFormat: {
          mainText: { text: 'Ring Road' },
          secondaryText: { text: 'Benin City, Nigeria' },
        },
      },
    },
  ],
};

const detailsResponse = {
  id: 'place-ring-road',
  displayName: { text: 'Ring Road' },
  formattedAddress: 'Ring Road, Oba Ovonramwen Square, Benin City 300102, Edo, Nigeria',
  location: { latitude: 6.3329, longitude: 5.6222 },
};

const routesResponse = { routes: [{ distanceMeters: 7123, duration: '842s' }] };

describe('phase 8 — the Google adapter speaks the current APIs', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('address suggestions', () => {
    it('posts to Places API (New) with the key in a header, not the query string', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => autocompleteResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => detailsResponse });

      const service = new MapsService(config);
      const results = await service.autocomplete('ring road', 6);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
      expect(url).not.toContain('key=');

      const sent = JSON.parse(init.body as string) as { input: string; includedRegionCodes: string[] };
      expect(sent.input).toBe('ring road');
      // Never offer a suggestion outside Nigeria.
      expect(sent.includedRegionCodes).toEqual(['ng']);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'place-ring-road',
        name: 'Ring Road',
        address: 'Ring Road, Oba Ovonramwen Square, Benin City 300102, Edo, Nigeria',
        landmark: 'Benin City, Nigeria',
        lat: 6.3329,
        lng: 5.6222,
        source: 'GOOGLE',
      });
    });

    it('asks for place details with a field mask, because the new API requires one', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => autocompleteResponse })
        .mockResolvedValueOnce({ ok: true, json: async () => detailsResponse });

      await new MapsService(config).autocomplete('ring road');

      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toBe('https://places.googleapis.com/v1/places/place-ring-road');
      expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
        'id,displayName,formattedAddress,location',
      );
    });

    it('falls back to the platform table when Google answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

      // "ring" matches the seeded Ring Road entry, so the stub can answer.
      const results = await new MapsService(config).autocomplete('ring road');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((place) => place.source === 'STUB')).toBe(true);
    });
  });

  describe('route estimates', () => {
    it('posts to the Routes API and reads the protobuf duration string', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => routesResponse });

      const estimate = await new MapsService(config).estimateRoute(
        { lat: 6.3329, lng: 5.6222 },
        { lat: 6.396, lng: 5.611 },
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe(
        'routes.distanceMeters,routes.duration',
      );

      const sent = JSON.parse(init.body as string) as {
        origin: { location: { latLng: { latitude: number; longitude: number } } };
        travelMode: string;
        regionCode: string;
      };
      expect(sent.origin.location.latLng).toEqual({ latitude: 6.3329, longitude: 5.6222 });
      expect(sent.travelMode).toBe('DRIVE');
      expect(sent.regionCode).toBe('NG');

      expect(estimate.source).toBe('GOOGLE');
      expect(estimate.distanceKm).toBeCloseTo(7.12, 2);
      // 842 seconds is 14.03 minutes.
      expect(estimate.durationMinutes).toBe(14);
    });

    it('falls back to the stub estimate rather than blocking a booking', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

      const estimate = await new MapsService(config).estimateRoute(
        { lat: 6.3329, lng: 5.6222 },
        { lat: 6.396, lng: 5.611 },
      );
      expect(estimate.source).not.toBe('GOOGLE');
      expect(estimate.distanceKm).toBeGreaterThan(0);
    });
  });
});
