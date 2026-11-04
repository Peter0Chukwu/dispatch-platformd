/**
 * COMPANY CONFIGURATION — edit this file, then re-run `npm run db:seed`.
 * Everything here is real configuration, not mock data.
 */
export const COMPANY = {
  name: 'Dispatch Platform',
  legalName: 'Dispatch Logistics Ltd',
  supportPhone: '+2348000000000',
  supportEmail: 'support@example.com',
  currency: 'NGN',
  timezone: 'Africa/Lagos',
};

/**
 * The first operating branch. Multi-branch expansion later = add more entries
 * here (or create them from the admin UI once that screen exists in Phase 5).
 */
export const BRANCHES = [
  {
    code: 'LAG-01',
    name: 'Lagos HQ',
    city: 'Lagos',
    state: 'Lagos',
    country: 'NG',
    phone: COMPANY.supportPhone,
    email: COMPANY.supportEmail,
    lat: 6.5244,
    lng: 3.3792,
  },
] as const;

/** Super administrator created on first seed. Password is printed ONCE and must be changed. */
export const SUPER_ADMIN = {
  email: process.env.SUPER_ADMIN_EMAIL ?? 'admin@dispatch.test',
  phone: process.env.SUPER_ADMIN_PHONE ?? '+2348000000001',
  firstName: 'Super',
  lastName: 'Admin',
  password: process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@12345',
};
