import { describe, expect, it } from 'vitest';
import { canTransition, DELIVERY_TRANSITIONS, isTerminal, nextStatuses } from '@dispatch/shared';

describe('delivery state machine', () => {
  it('walks the happy path', () => {
    const path = [
      'PENDING', 'ASSIGNED', 'ACCEPTED', 'ARRIVED_AT_PICKUP',
      'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i]!;
      const to = path[i + 1]!;
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('refuses to skip steps (the classic cheat)', () => {
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransition('ACCEPTED', 'DELIVERED')).toBe(false);
    expect(canTransition('PICKED_UP', 'DELIVERED')).toBe(false);
    expect(canTransition('IN_TRANSIT', 'DELIVERED')).toBe(false);
  });

  it('treats delivered/cancelled/rejected/returned as terminal', () => {
    for (const status of ['DELIVERED', 'CANCELLED', 'REJECTED', 'RETURNED'] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(nextStatuses(status)).toHaveLength(0);
    }
  });

  it('allows recovery from FAILED but not resurrection of a delivered order', () => {
    expect(canTransition('FAILED', 'RETURNED')).toBe(true);
    expect(canTransition('FAILED', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('lets a declined offer fall back to the queue', () => {
    expect(canTransition('ASSIGNED', 'PENDING')).toBe(true);
  });

  it('has a definition for every status', () => {
    expect(Object.keys(DELIVERY_TRANSITIONS)).toHaveLength(12);
  });
});
