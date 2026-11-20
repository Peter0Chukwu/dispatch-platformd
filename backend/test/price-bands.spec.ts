import { checkAsk, checkCounter, highestAsk, lowestAsk } from '../src/dispatch/price-bands';

/**
 * The haggling rules, as numbers.
 *
 * A bill of ₦2,000 = 200_000 kobo is the running example: the customer may offer
 * anything from ₦1,000 to ₦6,000, and a rider may ask up to three times whatever
 * number is on the card they were shown.
 */
const BILL = 200_000n;

describe('what a customer may offer', () => {
  it('accepts the bill itself, and anything above it up to the ceiling', () => {
    expect(checkAsk(BILL, BILL).ok).toBe(true);
    expect(checkAsk(BILL, BILL * 2n).ok).toBe(true);
    expect(checkAsk(BILL, highestAsk(BILL)).ok).toBe(true);
  });

  it('accepts exactly half, which is the floor', () => {
    expect(lowestAsk(BILL)).toBe(100_000n);
    expect(checkAsk(BILL, 100_000n).ok).toBe(true);
  });

  it('refuses a kobo below the floor, and says what the floor is', () => {
    const result = checkAsk(BILL, 99_999n);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('₦1,000');
  });

  it('refuses more than three times the bill — a slipped key, not a tip', () => {
    const result = checkAsk(BILL, BILL * 3n + 1n);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('₦6,000');
  });

  it('rounds the floor down to a whole ₦50, never up', () => {
    // ₦1,234 bill → half is ₦617 → floor is ₦600, not ₦650.
    expect(lowestAsk(123_400n)).toBe(60_000n);
  });
});

describe('what a rider may ask for', () => {
  const ASK = 100_000n; // the customer offered ₦1,000

  it('must be more than the number on the card', () => {
    expect(checkCounter(ASK, ASK).ok).toBe(false);
    expect(checkCounter(ASK, ASK - 1n).ok).toBe(false);
    expect(checkCounter(ASK, ASK + 1n).ok).toBe(true);
  });

  it('is capped at three times the asking price', () => {
    expect(checkCounter(ASK, ASK * 3n).ok).toBe(true);
    const over = checkCounter(ASK, ASK * 3n + 1n);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain('₦3,000');
  });

  it('tells a rider who asked for less to simply take the job', () => {
    const result = checkCounter(ASK, 50_000n);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('accept the job');
  });
});
