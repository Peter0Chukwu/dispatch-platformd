#!/usr/bin/env node
/**
 * PHASE 4 DEMO SEED
 *
 * Creates one complete, realistic rider day through the public HTTP API — no
 * direct database writes, so nothing here can produce a state the product could
 * not reach on its own:
 *
 *   1. a customer registers, verifies, and books a delivery
 *   2. a rider registers, verifies, and uploads three documents
 *   3. staff review each document and approve the rider
 *   4. the rider goes online and receives an offer for the delivery
 *
 * Credentials it creates (development only):
 *   rider    demo.rider@dispatch.test    / Rider@12345
 *   customer demo.customer@dispatch.test / Customer@12345
 *
 * Usage:  node scripts/seed-demo-phase4.mjs [--api http://127.0.0.1:4000/api/v1]
 */
const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://127.0.0.1:4000/api/v1';

const RIDER_EMAIL = 'demo.rider@dispatch.test';
const RIDER_PHONE = '08031234567';
const RIDER_PASSWORD = 'Rider@12345';
const CUSTOMER_EMAIL = 'demo.customer@dispatch.test';
const CUSTOMER_PHONE = '08039876543';
const CUSTOMER_PASSWORD = 'Customer@12345';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'admin@dispatch.test';
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'Admin@12345';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function call(path, { method = 'POST', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

const login = (identifier, password, audience) =>
  call('/auth/login', { body: { identifier, password, audience } }).then((r) => r.accessToken);

async function main() {
  console.log(`Seeding Phase 4 demo data against ${API}`);

  // ── 1. customer ────────────────────────────────────────────────────────────
  let customerToken;
  try {
    customerToken = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, 'CUSTOMER');
    console.log('· customer already exists');
  } catch {
    const reg = await call('/auth/register/customer', {
      body: {
        firstName: 'Ada',
        lastName: 'Okafor',
        email: CUSTOMER_EMAIL,
        phone: CUSTOMER_PHONE,
        password: CUSTOMER_PASSWORD,
        acceptTerms: true,
      },
    });
    await call('/auth/verify-email', { body: { token: reg.verification.devToken } });
    await call('/auth/otp/verify', { body: { phone: CUSTOMER_PHONE, code: reg.verification.devCode } });
    customerToken = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, 'CUSTOMER');
    console.log('· customer created and verified');
  }

  // ── 3. rider registers and uploads documents ───────────────────────────────
  let riderToken;
  let newlyRegistered = true;
  try {
    riderToken = await login(RIDER_EMAIL, RIDER_PASSWORD, 'RIDER');
    console.log('· rider already exists');
    newlyRegistered = false;
  } catch {
    const reg = await call('/auth/register/rider', {
      body: {
        firstName: 'Rita',
        lastName: 'Adeyemi',
        email: RIDER_EMAIL,
        phone: RIDER_PHONE,
        password: RIDER_PASSWORD,
        addressLine: '24 Ogba Road, Ikeja',
        city: 'Lagos',
        state: 'Lagos',
        vehicleType: 'MOTORCYCLE',
        vehicleRegistrationNumber: 'LSD-482-QR',
        emergencyContactName: 'Tunde Adeyemi',
        emergencyContactPhone: '08032345678',
        acceptTerms: true,
      },
    });
    await call('/auth/verify-email', { body: { token: reg.verification.devToken } });
    // Rider registration sends no SMS itself: the rider asks for a code on their phone.
    const otp = await call('/auth/otp/request', { body: { phone: RIDER_PHONE } });
    await call('/auth/otp/verify', { body: { phone: RIDER_PHONE, code: otp.devCode } });
    riderToken = await login(RIDER_EMAIL, RIDER_PASSWORD, 'RIDER');
    console.log('· rider registered and verified');
  }

  // Finish any verification the rider never completed (a crashed run leaves this behind).
  const me = await call('/auth/me', { method: 'GET', token: riderToken });
  if (!me.user.phoneVerified) {
    const otp = await call('/auth/otp/request', { body: { phone: RIDER_PHONE } });
    await call('/auth/otp/verify', { body: { phone: RIDER_PHONE, code: otp.devCode } });
    console.log('· phone number verified');
  }

  // Upload whatever is missing — a re-run must be able to repair a half-finished seed.
  const existing = await call('/rider/documents', { method: 'GET', token: riderToken });
  const uploaded = new Set(existing.documents.map((doc) => doc.type));
  const missing = ['NIN', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION'].filter((type) => !uploaded.has(type));
  for (const docType of missing) {
    await call('/rider/documents', {
      token: riderToken,
      body: { docType, mimeType: 'image/png', base64: TINY_PNG },
    });
  }
  console.log(
    missing.length > 0 ? `· uploaded ${missing.length} document(s)` : '· all three documents already on file',
  );
  if (newlyRegistered) console.log('  (new rider — first review)');

  // ── 4. staff review and approve (the real admin endpoints) ─────────────────
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN');
  const queue = await call(`/admin/riders?q=${encodeURIComponent(RIDER_EMAIL)}`, {
    method: 'GET',
    token: adminToken,
  });
  const application = queue.data[0];
  if (!application) throw new Error('Rider application not found in the review queue');

  const detail = await call(`/admin/riders/${application.id}`, { method: 'GET', token: adminToken });
  for (const doc of detail.documents.filter((d) => d.status !== 'APPROVED')) {
    await call(`/admin/riders/${application.id}/documents/${doc.id}/review`, {
      token: adminToken,
      body: { decision: 'APPROVE' },
    });
  }
  console.log('· staff approved every document');

  if (detail.approvalStatus !== 'APPROVED') {
    await call(`/admin/riders/${application.id}/approval`, {
      token: adminToken,
      body: { decision: 'APPROVE' },
    });
    console.log('· staff approved the rider');
  }

  // ── 4. clear any job left over from a previous run ─────────────────────────
  const active = await call('/rider/jobs/active', { method: 'GET', token: riderToken });
  if (active) {
    // A real operation, not a database edit: the job goes back to dispatch and the
    // rider becomes available again.
    await call(`/rider/jobs/${active.id}/fail`, {
      token: riderToken,
      body: { reason: 'Demo reset — cleared by scripts/seed-demo-phase4.mjs' },
    });
    console.log(`· released stale job ${active.reference}`);
  }

  // ── 5. go online, then place a booking so an offer is guaranteed ───────────
  await call('/rider/location', {
    token: riderToken,
    body: { lat: 6.4301, lng: 3.4197, accuracyM: 12, speedKph: 0, batteryPct: 84 },
  });
  await call('/rider/availability', { token: riderToken, body: { availability: 'ONLINE' } });
  console.log('· rider online');

  // Booked last on purpose: a booking made while nobody is online has no one to
  // offer it to, and the demo wants something on the Offers screen immediately.


  // ── 5. a delivery to be offered ────────────────────────────────────────────
  const booking = await call('/deliveries', {
    token: customerToken,
    body: {
      deliveryType: 'STANDARD',
      pickup: {
        address: '12 Adeola Odeku Street, Victoria Island, Lagos',
        landmark: 'Opposite Eko Hotel roundabout',
        lat: 6.4281,
        lng: 3.4219,
        contactName: 'Ada Okafor',
        contactPhone: '+2348039876543',
      },
      destination: {
        address: '5 Bode Thomas Street, Surulere, Lagos',
        landmark: 'Beside the First Bank branch',
        lat: 6.4969,
        lng: 3.3481,
        contactName: 'Chinedu Eze',
        contactPhone: '+2348069876543',
      },
      packageCategory: 'DOCUMENTS',
      packageDescription: 'A4 envelope with signed contracts',
      packageWeightKg: 0.5,
      isFragile: false,
      recipientName: 'Chinedu Eze',
      recipientPhone: '+2348069876543',
      acceptTerms: true,
      paymentMethod: 'PAYSTACK',
    },
  });
  console.log(`· delivery booked: ${booking.reference ?? booking.id}`);

  const offers = await call('/rider/offers', { method: 'GET', token: riderToken });
  console.log(`· ${offers.length} open offer(s) waiting`);

  console.log('\nSign in at /login as a rider:');
  console.log(`  ${RIDER_EMAIL} / ${RIDER_PASSWORD}`);
  console.log('Customer:');
  console.log(`  ${CUSTOMER_EMAIL} / ${CUSTOMER_PASSWORD}`);
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
