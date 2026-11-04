import { describe, expect, it } from 'vitest';
import { roundKobo, percentOfKobo, clampMin } from '@dispatch/shared';
import {
  AVERAGE_SPEED_KMH,
  ROAD_DETOUR_FACTOR,
  estimateRoute,
  haversineKm,
  roundTo,
  totalRouteKm,
} from '../src/pricing/distance';

/**
 * Pure pricing maths. No database, no HTTP — these run in milliseconds and are
 * the first line of defence for "the customer was charged the wrong amount".
 */
describe('phase 3 — distance and money maths', () => {
  const lagosIsland = { lat: 6.455, lng: 3.396 };
  const mainland = { lat: 6.5244, lng: 3.3792 };

  describe('haversineKm', () => {
    it('is zero for identical points', () => {
      expect(haversineKm(lagosIsland, lagosIsland)).toBe(0);
    });

    it('measures one degree of latitude as ~111.19 km', () => {
      // A known property of the Earth, independent of our implementation:
      // one degree of latitude is ~111.19 km anywhere on the globe.
      const km = haversineKm({ lat: 6, lng: 3 }, { lat: 7, lng: 3 });
      expect(km).toBeGreaterThan(110.9);
      expect(km).toBeLessThan(111.5);
    });

    it('measures Lagos Island to Yaba at roughly 8–9 km', () => {
      const km = haversineKm(lagosIsland, mainland);
      expect(km).toBeGreaterThan(7.5);
      expect(km).toBeLessThan(9.5);
    });

    it('is symmetric — direction does not change the price', () => {
      expect(haversineKm(lagosIsland, mainland)).toBeCloseTo(haversineKm(mainland, lagosIsland), 10);
    });
  });

  describe('estimateRoute', () => {
    it('applies the road detour factor on top of the straight line', () => {
      const straight = haversineKm(lagosIsland, mainland);
      const route = estimateRoute(lagosIsland, mainland);
      expect(route.distanceKm).toBeCloseTo(roundTo(straight * ROAD_DETOUR_FACTOR, 2), 2);
      expect(route.source).toBe('STUB');
    });

    it('never reports a zero-minute trip', () => {
      const route = estimateRoute(lagosIsland, lagosIsland);
      expect(route.distanceKm).toBe(0);
      expect(route.durationMinutes).toBe(1);
    });

    it('derives duration from the average urban speed', () => {
      const route = estimateRoute({ lat: 6, lng: 3 }, { lat: 6.5, lng: 3 });
      const expectedMinutes = Math.round((route.distanceKm / AVERAGE_SPEED_KMH) * 60);
      expect(route.durationMinutes).toBe(Math.max(1, expectedMinutes));
    });
  });

  describe('totalRouteKm with additional stops', () => {
    it('adds each leg instead of measuring start to end', () => {
      const direct = estimateRoute(lagosIsland, mainland).distanceKm;
      const detour = totalRouteKm(lagosIsland, [{ lat: 6.6, lng: 3.5 }], mainland);
      expect(detour).toBeGreaterThan(direct);
    });

    it('equals the direct route when there are no stops', () => {
      const direct = estimateRoute(lagosIsland, mainland).distanceKm;
      expect(totalRouteKm(lagosIsland, [], mainland)).toBeCloseTo(direct, 2);
    });
  });

  describe('money helpers used by the engine', () => {
    it('rounds to the nearest 50 kobo, half up', () => {
      expect(roundKobo(150_024n, 50)).toBe(150_000n);
      expect(roundKobo(150_025n, 50)).toBe(150_050n);
      expect(roundKobo(150_050n, 50)).toBe(150_050n);
    });

    it('never rounds a negative amount below zero', () => {
      expect(roundKobo(-10n, 50)).toBe(0n);
    });

    it('computes percentages in integer kobo without floating point drift', () => {
      // 10% of ₦1,234.56 = ₦123.456 → rounded to ₦123.50
      expect(percentOfKobo(123_456n, 10, 50)).toBe(12_350n);
      expect(percentOfKobo(0n, 10, 50)).toBe(0n);
      expect(percentOfKobo(100_000n, 100, 50)).toBe(100_000n);
    });

    it('rejects a percentage outside 0–100 rather than silently pricing it', () => {
      expect(() => percentOfKobo(10_000n, 140, 50)).toThrow();
      expect(() => percentOfKobo(10_000n, -5, 50)).toThrow();
    });

    it('enforces a minimum fee floor', () => {
      expect(clampMin(80_000n, 150_000n)).toBe(150_000n);
      expect(clampMin(200_000n, 150_000n)).toBe(200_000n);
    });
  });
});
