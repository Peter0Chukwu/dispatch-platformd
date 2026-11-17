import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsService } from '../src/pricing/maps.service';
import { SavedLocationsService, type SavedLocationRecord } from '../src/pricing/saved-locations.service';
import type { AppConfig } from '../src/config/app.config';

/**
 * Saved places — the list operations maintain at Admin → Saved places.
 *
 * The point of moving these out of the source code is that a new neighbourhood
 * becomes a row, not a deploy. These tests hold that promise: a place added to the
 * database has to appear in the booking form on the very next keystroke, and one
 * that is hidden has to stop appearing — without a restart.
 */

const row = (over: Partial<SavedLocationRecord> = {}): SavedLocationRecord => ({
  id: 'db-ekhwan',
  name: 'Ekhwan Road',
  address: 'Ekhwan Road, Benin City',
  landmark: 'By the filling station',
  lat: 6.3455,
  lng: 5.6301,
  isActive: true,
  sortOrder: 100,
  ...over,
});

/** The smallest Prisma surface SavedLocationsService actually uses. */
function fakePrisma(rows: SavedLocationRecord[]) {
  return {
    savedLocation: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Partial<SavedLocationRecord> }) => row({ id: 'created', ...data })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SavedLocationRecord> }) =>
        row({ id: where.id, ...data }),
      ),
    },
  };
}

describe('phase 8 — saved places, maintained without a deploy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('the cache', () => {
    it('reads the table once for repeated suggestions', async () => {
      const prisma = fakePrisma([row()]);
      const service = new SavedLocationsService(prisma as never);

      await service.active();
      await service.active();
      await service.active();

      expect(prisma.savedLocation.findMany).toHaveBeenCalledTimes(1);
    });

    it('forgets the cached list the moment an admin writes', async () => {
      const prisma = fakePrisma([row()]);
      const service = new SavedLocationsService(prisma as never);

      await service.active();
      await service.create({ name: 'Ekhwan Road', address: 'Ekhwan Road, Benin City', lat: 6.3455, lng: 5.6301 }, 'staff-1');
      await service.active();

      expect(prisma.savedLocation.findMany).toHaveBeenCalledTimes(2);
    });

    it('returns null — not an exception — when the table is missing', async () => {
      const prisma = {
        savedLocation: {
          findMany: vi.fn(async () => {
            throw new Error('relation "saved_locations" does not exist');
          }),
        },
      };
      const service = new SavedLocationsService(prisma as never);

      await expect(service.active()).resolves.toBeNull();
    });
  });

  describe('the booking form sees what operations entered', () => {
    const config = { mapsProviderKey: 'stub', geoapifyApiKey: undefined } as unknown as AppConfig;

    it('offers a place that only exists in the database', async () => {
      const service = new SavedLocationsService(fakePrisma([row()]) as never);
      const maps = new MapsService(config, service);

      const results = await maps.autocomplete('ekhwan');

      expect(results[0]).toMatchObject({ id: 'db-ekhwan', name: 'Ekhwan Road', source: 'STUB' });
    });

    it('stops offering a place that was hidden', async () => {
      // `active()` filters on isActive in SQL; the fake returns whatever the query
      // would, so an empty result stands in for "this row is now hidden".
      const service = new SavedLocationsService(fakePrisma([]) as never);
      const maps = new MapsService(config, service);

      const results = await maps.autocomplete('ekhwan');

      expect(results).toHaveLength(0);
    });

    it('falls back to the built-in table when the database says nothing', async () => {
      // No SavedLocationsService at all is what a unit test — or a deployment that
      // has not run the migration — looks like.
      const maps = new MapsService(config);

      const results = await maps.autocomplete('ring road');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe('ring-road');
    });

    it('lets a database place win over a provider answer for the same words', async () => {
      const service = new SavedLocationsService(
        fakePrisma([row({ id: 'db-sapele', name: 'Sapele Road — New Layout', lat: 6.3, lng: 5.62 })]) as never,
      );
      const maps = new MapsService({ ...config, mapsProviderKey: 'geoapify', geoapifyApiKey: 'k' } as unknown as AppConfig, service);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              // The town of Sapele, 300 km away, which is what the provider prefers.
              properties: { place_id: 'town', name: 'Sapele', formatted: 'Sapele, DE, Nigeria', lat: 5.89, lon: 5.68 },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const results = await maps.autocomplete('sapele');

      expect(results[0]!.id).toBe('db-sapele');
      expect(results[0]!.source).toBe('STUB');

      vi.unstubAllGlobals();
    });
  });
});
