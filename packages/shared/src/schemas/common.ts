import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

/**
 * DATE INPUTS FROM A URL
 *
 * `?from=2026-11-05&to=2026-11-05` is how a human asks for "that day". JavaScript
 * parses both as midnight, which would make the range empty — a filter that silently
 * returns nothing is worse than one that errors. So a bare `to` date means the *end*
 * of that day, and a bare `from` date means its start. Full timestamps pass through
 * untouched.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const rangeFromSchema = z.preprocess(
  (value) => (typeof value === 'string' && DATE_ONLY.test(value.trim()) ? `${value.trim()}T00:00:00.000Z` : value),
  z.coerce.date().optional(),
);

export const rangeToSchema = z.preprocess(
  (value) => (typeof value === 'string' && DATE_ONLY.test(value.trim()) ? `${value.trim()}T23:59:59.999Z` : value),
  z.coerce.date().optional(),
);

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    preset: z
      .enum(['today', 'yesterday', 'last7', 'last30', 'this_month', 'last_month', 'custom'])
      .optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '`from` must be before `to`',
    path: ['from'],
  });
export type DateRangeQuery = z.infer<typeof dateRangeSchema>;

export const nairaAmountSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((v, ctx) => {
    try {
      if (typeof v === 'bigint') return v;
      const s = typeof v === 'number' ? v.toString() : v.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('invalid');
      const [whole, frac = ''] = s.split('.');
      return BigInt(whole!) * 100n + BigInt((frac + '00').slice(0, 2));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid Naira amount (max 2 decimals)' });
      return z.NEVER;
    }
  });

export const latitudeSchema = z.coerce.number().min(-90).max(90);
export const longitudeSchema = z.coerce.number().min(-180).max(180);

export const geoPointSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});
export type GeoPoint = z.infer<typeof geoPointSchema>;
