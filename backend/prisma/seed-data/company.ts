/**
 * COMPANY CONFIGURATION — edit this file, then re-run `npm run db:seed`.
 * Everything here is real configuration, not mock data.
 */
export const COMPANY = {
  name: 'Traders Welfare Logistics',
  /**
   * The registered entity name on invoices and receipts. Confirm this against
   * your CAC certificate before the first real invoice is issued — the name a
   * customer sees on a receipt should be the name on the certificate.
   */
  legalName: 'Traders Welfare Logistics',
  /** Shown to customers and riders. Replace with the number that actually rings. */
  supportPhone: '+2348000000000',
  supportEmail: 'support@example.com',
  currency: 'NGN',
  /**
   * IANA time zone, not a city. All of Nigeria — Benin City included — is West
   * Africa Time, so this stays correct wherever the business operates from.
   */
  timezone: 'Africa/Lagos',
};

/**
 * The first operating branch. Multi-branch expansion later = add more entries
 * here (or create them from the admin UI once that screen exists in Phase 5).
 *
 * Benin City, Edo State. Coordinates are Ring Road, the centre of the city —
 * the point every service zone below is laid out around.
 */
export const BRANCHES = [
  {
    code: 'BEN-01',
    name: 'Benin City HQ',
    city: 'Benin City',
    state: 'Edo',
    country: 'NG',
    phone: COMPANY.supportPhone,
    email: COMPANY.supportEmail,
    lat: 6.3329,
    lng: 5.6222,
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
