import { describe, expect, it } from 'vitest';
import {
  formatNaira,
  formatNairaPlain,
  nairaToKobo,
  percentOfKobo,
  roundKobo,
  sumKobo,
} from '@dispatch/shared';

/**
 * Money correctness is the highest-stakes logic on the platform.
 * These tests exist so a future refactor cannot quietly lose a kobo.
 */
describe('money (kobo integer arithmetic)', () => {
  it('converts Naira text to exact kobo', () => {
    expect(nairaToKobo('1500')).toBe(150000n);
    expect(nairaToKobo('1500.5')).toBe(150050n);
    expect(nairaToKobo('0.99')).toBe(99n);
    expect(nairaToKobo('0.05')).toBe(5n);
    expect(nairaToKobo(250)).toBe(25000n);
  });

  it('rejects malformed amounts instead of guessing', () => {
    expect(() => nairaToKobo('1,500')).toThrow();
    expect(() => nairaToKobo('1500.999')).toThrow();
    expect(() => nairaToKobo('-20')).toThrow();
    expect(() => nairaToKobo('abc')).toThrow();
  });

  it('avoids the classic float bug', () => {
    // 0.1 + 0.2 !== 0.3 in float maths; in kobo it is exact.
    expect(nairaToKobo('0.1') + nairaToKobo('0.2')).toBe(nairaToKobo('0.3'));
    expect(sumKobo([nairaToKobo('0.1'), nairaToKobo('0.2')])).toBe(30n);
  });

  it('formats Naira for display', () => {
    expect(formatNaira(150000n)).toContain('1,500.00');
    expect(formatNaira('150050')).toContain('1,500.50');
    expect(formatNairaPlain(150050n)).toBe('1,500.50');
  });

  it('computes commission deterministically and rounds to the kobo step', () => {
    expect(percentOfKobo(150000n, 20)).toBe(30000n);   // ₦1,500 × 20% = ₦300
    expect(percentOfKobo(1000n, 20)).toBe(200n);       // ₦10 × 20% = ₦2
    expect(percentOfKobo(12345n, 20, 1)).toBe(2469n);  // unrounded 2469
    expect(percentOfKobo(0n, 20)).toBe(0n);
  });

  it('disallows negative and out-of-range percentages', () => {
    expect(() => percentOfKobo(1000n, -1)).toThrow();
    expect(() => percentOfKobo(1000n, 101)).toThrow();
  });

  it('rounds to configurable steps', () => {
    expect(roundKobo(1234n, 50)).toBe(1250n);
    expect(roundKobo(1220n, 50)).toBe(1200n);
    expect(roundKobo(1225n, 50)).toBe(1250n); // half rounds up
    expect(roundKobo(1234n, 0)).toBe(1234n);
  });

  it('never returns money from the sum of an empty list as undefined', () => {
    expect(sumKobo([])).toBe(0n);
  });
});
