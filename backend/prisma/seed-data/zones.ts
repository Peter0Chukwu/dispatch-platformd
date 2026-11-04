/**
 * SERVICE ZONES & PRICING
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ PLACEHOLDER VALUES. The project owner is supplying the real zone list,
 *   base fee and per-kilometre rate. Until then these are realistic Lagos
 *   defaults so the system is runnable and testable end-to-end.
 *
 * When the real numbers arrive you have two options:
 *   1. Edit this file and re-run `npm run db:seed`, or
 *   2. Change them in the admin Pricing screen (Phase 5) — no code change.
 *
 * All money is in KOBO. ₦1,500 = 150000. Use the helper: nairaToKobo('1500').
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
    code: 'LAG-ISLAND',
    name: 'Lagos Island',
    centerLat: 6.4550,
    centerLng: 3.3960,
    radiusKm: 9,
    baseFeeKobo: N('1500'),
    perKmFeeKobo: N('120'),
    minFeeKobo: N('1500'),
    supportsSameDay: true,
  },
  {
    code: 'LAG-MAINLAND',
    name: 'Lagos Mainland',
    centerLat: 6.5244,
    centerLng: 3.3792,
    radiusKm: 12,
    baseFeeKobo: N('1600'),
    perKmFeeKobo: N('130'),
    minFeeKobo: N('1600'),
    supportsSameDay: true,
  },
  {
    code: 'LEKKI-AJAH',
    name: 'Lekki / Ajah',
    centerLat: 6.4410,
    centerLng: 3.5590,
    radiusKm: 15,
    baseFeeKobo: N('1800'),
    perKmFeeKobo: N('145'),
    minFeeKobo: N('1800'),
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
