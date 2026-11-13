/**
 * SERVICE ZONES & PRICING
 * ─────────────────────────────────────────────────────────────────────────────
 * Benin City, Edo State. Each zone is a circle around a real area of the city:
 * the centre is that area's own coordinates, the radius is roughly how far a
 * rider will travel within it before the next zone is a better answer.
 *
 * Coordinates were taken from published landmarks (Ring Road, UBTH/Ugbowo,
 * Ikpoba Hill, Aduwawa, Benin Airport) and are accurate to street level — good
 * enough for a haversine distance. They get replaced by exact map pins once
 * MAPS_PROVIDER=GOOGLE is configured; nothing else about a zone changes.
 *
 * ⚠ FEES ARE STILL PLACEHOLDERS. They are the same ballpark as before so that
 *   nothing about pricing moves unexpectedly. When you supply real tariffs you
 *   have two options:
 *     1. Edit this file and re-run `npm run db:seed`, or
 *     2. Change them on the admin Pricing screen — no code change, no deploy.
 *
 * All money is in KOBO. ₦1,500 = 150000. Use the helper: N('1500').
 */

export type ZoneSeed = {
  code: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  baseFeeKobo: bigint;
  perKmFeeKobo: bigint;
  minFeeKobo: bigint;
  supportsSameDay: boolean;
};

const N = (naira: string) => {
  const [whole, frac = ''] = naira.split('.');
  return BigInt(whole!) * 100n + BigInt((frac + '00').slice(0, 2));
};

export const SERVICE_ZONES: ZoneSeed[] = [
  {
    code: 'BEN-CENTRAL',
    name: 'Benin City Centre',
    // Ring Road — Oba Ovonramwen Square, the middle of the city.
    centerLat: 6.3330,
    centerLng: 5.6220,
    radiusKm: 6,
    baseFeeKobo: N('1500'),
    perKmFeeKobo: N('120'),
    minFeeKobo: N('1500'),
    supportsSameDay: true,
  },
  {
    code: 'BEN-UGBOWO',
    name: 'Ugbowo / UNIBEN',
    // Ugbowo-Lagos Road: University of Benin, UBTH, Uselu.
    centerLat: 6.3960,
    centerLng: 5.6110,
    radiusKm: 7,
    baseFeeKobo: N('1600'),
    perKmFeeKobo: N('130'),
    minFeeKobo: N('1600'),
    supportsSameDay: true,
  },
  {
    code: 'BEN-IKPOBA',
    name: 'Ikpoba Hill / Aduwawa',
    // Benin-Auchi Road, east of the Ikpoba River.
    centerLat: 6.3600,
    centerLng: 5.6740,
    radiusKm: 8,
    baseFeeKobo: N('1700'),
    perKmFeeKobo: N('135'),
    minFeeKobo: N('1700'),
    supportsSameDay: true,
  },
  {
    code: 'BEN-SAPELE',
    name: 'Sapele Road / Airport',
    // Benin-Sapele Road and Airport Road, south-west of the centre.
    centerLat: 6.3150,
    centerLng: 5.6000,
    radiusKm: 8,
    baseFeeKobo: N('1600'),
    perKmFeeKobo: N('130'),
    minFeeKobo: N('1600'),
    supportsSameDay: true,
  },
];

/** The default pricing rule applied when a zone has no override. */
export const DEFAULT_PRICING = {
  name: 'Standard pricing (v1)',
  baseFeeKobo: N('1500'),
  perKmFeeKobo: N('130'),
  minFeeKobo: N('1500'),
  freeKmIncluded: 2,
  expressSurchargeKobo: N('700'),
  scheduledSurchargeKobo: N('300'),
  sameDaySurchargeKobo: N('500'),
  waitingFeePerMinKobo: N('50'),
  additionalStopFeeKobo: N('400'),
  defaultCommissionPct: 20,
  roundToKobo: 50,
};
