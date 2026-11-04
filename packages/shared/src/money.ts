/**
 * MONEY RULES — read this before touching any amount.
 *
 * The database stores every amount as an INTEGER number of KOBO (1 NGN = 100 kobo),
 * in PostgreSQL BigInt columns. ₦1,500.00 => 150000.
 *
 * Why: JavaScript numbers are floats. 0.1 + 0.2 !== 0.3. On a platform that handles
 * thousands of deliveries, float drift becomes real money lost or invented. Integers
 * are exact, and integer arithmetic is safe up to 9 quadrillion kobo (₦90 trillion).
 *
 * BigInt crosses the API boundary as a STRING, because JSON numbers lose precision
 * above 2^53. The frontend converts with BigInt() or Number() only for display.
 */

export const KOBO_PER_NAIRA = 100;

const nairaFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const nairaCompactFormatter = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export type Kobo = bigint;

export function toKobo(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`toKobo expects an integer number of kobo, received ${value}`);
    return BigInt(value);
  }
  return BigInt(value);
}

/** ₦1,500.50 => 150050n */
export function nairaToKobo(naira: number | string): bigint {
  const asString = typeof naira === 'number' ? naira.toString() : naira.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(asString)) {
    throw new Error(`Invalid naira amount: ${naira}`);
  }
  const [whole, fraction = ''] = asString.split('.');
  const kobo = (fraction + '00').slice(0, 2);
  return BigInt(whole!) * BigInt(KOBO_PER_NAIRA) + BigInt(kobo);
}

/** 150050n => "₦1,500.50" */
export function formatNaira(kobo: bigint | number | string): string {
  return nairaFormatter.format(Number(toKobo(kobo)) / KOBO_PER_NAIRA);
}

/** 150050n => "₦1.5K" (for dashboard cards / axis labels) */
export function formatNairaCompact(kobo: bigint | number | string): string {
  return nairaCompactFormatter.format(Number(toKobo(kobo)) / KOBO_PER_NAIRA);
}

/** 150050n => "1,500.50" (no symbol — for CSV exports and inputs) */
export function formatNairaPlain(kobo: bigint | number | string): string {
  return (Number(toKobo(kobo)) / KOBO_PER_NAIRA).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function sumKobo(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/**
 * Percentage of a kobo amount, rounded to the nearest `roundToKobo` (default 50 kobo),
 * half-up. Used for commission splits and promo discounts — always deterministic.
 */
export function percentOfKobo(amount: bigint, percent: number, roundToKobo = 50): bigint {
  if (percent < 0 || percent > 100) throw new Error(`percent must be between 0 and 100, received ${percent}`);
  const scaled = (amount * BigInt(Math.round(percent * 100))) / 10_000n;
  return roundKobo(scaled, roundToKobo);
}

export function roundKobo(amount: bigint, roundToKobo = 50): bigint {
  if (roundToKobo <= 0) return amount;
  const unit = BigInt(roundToKobo);
  const remainder = amount % unit;
  if (remainder === 0n) return amount;
  const rounded = amount - remainder + (remainder * 2n >= unit ? unit : 0n);
  return rounded < 0n ? 0n : rounded;
}

export function clampMin(amount: bigint, minimum: bigint): bigint {
  return amount < minimum ? minimum : amount;
}
