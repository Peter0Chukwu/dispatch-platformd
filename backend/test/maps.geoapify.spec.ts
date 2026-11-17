import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsService } from '../src/pricing/maps.service';
import type { AppConfig } from '../src/config/app.config';

/**
 * The Geoapify adapter, tested against the wire format — no network, no key.
 *
 * Geoapify answers with GeoJSON, where coordinates arrive as
 * `geometry.coordinates: [longitude, latitude]` — longitude first. Getting that
 * backwards would put every Benin City pickup in the Atlantic off Ghana and would
 * still "work", so the order is asserted explicitly here.
 */

const config = {
  mapsProviderKey: 'geoapify',
  geoapifyApiKey: 'test-key',
} as unknown as AppConfig;

/**
 * A suggestion, exactly as Geoapify shapes it — for Sakponba Road, which is
 * deliberately a place the platform does NOT keep in its own table, so these
 * tests exercise the adapter by itself.
 */
const autocompleteBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        place_id: '51f2c3a4d5e6f7',
        name: 'Sakponba Road',
        formatted: 'Sakponba Road, Benin City, 300102, Nigeria',
        address_line1: 'Sakponba Road',
        address_line2: 'Benin City, 300102, Nigeria',
        suburb: 'Oredo',
        city: 'Benin City',
        lat: 6.3403,
        lon: 5.6252,
        country_code: 'ng',
      },
      // Longitude first, deliberately: this is what the API really sends.
      geometry: { type: 'Point', coordinates: [5.6252, 6.3403] },
    },
    {
      type: 'Feature',
      properties: {
        place_id: 'no-position',
        formatted: 'Somewhere without coordinates',
      },
    },
  ],
};

const routeBody = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        mode: 'drive',
        units: 'metric',
        distance: 10631.4,
        time: 604,
      },
      geometry: { type: 'LineString', coordinates: [] },
    },
  ],
};

describe('phase 8 — the Geoapify adapter', () => {
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
    it('asks the autocomplete endpoint, restricted to Nigeria, with the key', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => autocompleteBody });

      const results = await new MapsService(config).autocomplete('sakponba road', 6);

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/autocomplete');
      expect(url.searchParams.get('text')).toBe('sakponba road');
      expect(url.searchParams.get('filter')).toBe('countrycode:ng');
      expect(url.searchParams.get('apiKey')).toBe('test-key');
      expect(url.searchParams.get('limit')).toBe('6');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: '51f2c3a4d5e6f7',
        name: 'Sakponba Road',
        address: 'Sakponba Road, Benin City, 300102, Nigeria',
        landmark: 'Oredo',
        lat: 6.3403,
        lng: 5.6252,
        source: 'GEOAPIFY',
      });
    });

    it('reads longitude before latitude, and drops a feature with no position', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => autocompleteBody });

      const [place] = await new MapsService(config).autocomplete('sakponba road');
      // The two are far apart on the globe: a swap would put this at 5.62N 6.34E,
      // in the Gulf of Guinea, and nothing else in the system would notice.
      expect(place!.lat).toBe(6.3403);
      expect(place!.lng).toBe(5.6252);

      const all = await new MapsService(config).autocomplete('sakponba road');
      expect(all.some((row) => row.id === 'no-position')).toBe(false);
    });

    it('sends the depot city as a bias, longitude first', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => autocompleteBody });

      const configWithBias = { ...config, mapsSearchBias: '5.6222,6.3329' } as unknown as AppConfig;
      await new MapsService(configWithBias).autocomplete('ring road');

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.searchParams.get('bias')).toBe('proximity:5.6222,6.3329');
    });

    it('puts the platform’s own Benin City locations ahead of the provider’s answers', async () => {
      // Geoapify really does answer "ring road" with Ring Road, LAGOS — 300 km and a
      // different state. The platform's own surveyed points must win.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                place_id: 'lagos-ring-road',
                name: 'Ring Road',
                formatted: 'Ring Road, Lagos 100242, LA, Nigeria',
                lat: 6.5,
                lon: 3.37,
              },
              geometry: { coordinates: [3.37, 6.5] },
            },
          ],
        }),
      });

      const results = await new MapsService(config).autocomplete('ring');

      expect(results[0]!.id).toBe('ring-road');
      expect(results[0]!.source).toBe('STUB');
      expect(results.some((place) => place.source === 'GEOAPIFY')).toBe(true);
    });

    it('does not list the same place twice when ours and theirs agree', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                place_id: 'osm-ring-road',
                name: 'Ring Road',
                formatted: 'Ring Road, Oba Ovonramwen Square, Benin City',
                // Within 200 m of the platform's own Ring Road point.
                lat: 6.3335,
                lon: 5.6225,
              },
              geometry: { coordinates: [5.6225, 6.3335] },
            },
          ],
        }),
      });

      const results = await new MapsService(config).autocomplete('ring');
      const ringRoads = results.filter((place) => place.name.toLowerCase().includes('ring road'));
      expect(ringRoads).toHaveLength(1);
      expect(ringRoads[0]!.source).toBe('STUB');
    });

    it('falls back to the platform table when Geoapify answers with an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

      const results = await new MapsService(config).autocomplete('ring road');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((place) => place.source === 'STUB')).toBe(true);
    });
  });

  describe('geocoding', () => {
    it('turns a written address into coordinates with one search call', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => autocompleteBody });

      const result = await new MapsService(config).geocode('Sakponba Road, Benin City');

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.pathname).toBe('/v1/geocode/search');
      expect(result).toMatchObject({ lat: 6.3403, lng: 5.6252, source: 'GEOAPIFY', approximate: false });
    });

    it('names the nearest place when reverse geocoding', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => autocompleteBody });

      const result = await new MapsService(config).reverseGeocode({ lat: 6.3403, lng: 5.6252 });

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.pathname).toBe('/v1/geocode/reverse');
      expect(url.searchParams.get('lat')).toBe('6.3403');
      expect(url.searchParams.get('lon')).toBe('5.6252');
      expect(result).toMatchObject({
        address: 'Sakponba Road, Benin City, 300102, Nigeria',
        source: 'GEOAPIFY',
      });
    });
  });

  describe('route estimates', () => {
    it('posts the two waypoints to the routing API and converts metres and seconds', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => routeBody });

      const estimate = await new MapsService(config).estimateRoute(
        { lat: 6.3329, lng: 5.6222 },
        { lat: 6.396, lng: 5.611 },
      );

      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/routing');
      expect(url.searchParams.get('waypoints')).toBe('6.3329,5.6222|6.396,5.611');
      expect(url.searchParams.get('mode')).toBe('drive');

      expect(estimate.source).toBe('GEOAPIFY');
      expect(estimate.distanceKm).toBeCloseTo(10.63, 2);
      expect(estimate.durationMinutes).toBe(10);
    });

    it('honours an account configured in miles', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ properties: { distance: 1, time: 120, units: 'miles' } }],
        }),
      });

      const estimate = await new MapsService(config).estimateRoute(
        { lat: 6.33, lng: 5.62 },
        { lat: 6.4, lng: 5.61 },
      );
      expect(estimate.distanceKm).toBeCloseTo(1.61, 2);
    });

    it('falls back to the stub estimate rather than blocking a booking', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

      const estimate = await new MapsService(config).estimateRoute(
        { lat: 6.3329, lng: 5.6222 },
        { lat: 6.396, lng: 5.611 },
      );
      expect(estimate.source).toBe('STUB');
      expect(estimate.distanceKm).toBeGreaterThan(0);
    });
  });

  it('uses the stub whenever no key is configured, and never calls out', async () => {
    const noKey = { mapsProviderKey: 'geoapify', geoapifyApiKey: undefined } as unknown as AppConfig;

    const places = await new MapsService(noKey).autocomplete('ring road');
    const estimate = await new MapsService(noKey).estimateRoute({ lat: 6.33, lng: 5.62 }, { lat: 6.4, lng: 5.61 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(places.every((place) => place.source === 'STUB')).toBe(true);
    expect(estimate.source).toBe('STUB');
  });
});
