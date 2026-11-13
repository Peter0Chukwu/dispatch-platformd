#!/usr/bin/env node
/**
 * PHASE 6 DEMO SEED — the dispatch board with something to look at
 *
 * Everything here goes through the public HTTP API, exactly as a dispatcher would,
 * so the board can never show a state the product could not reach by itself. It
 * leaves four deliveries behind, one for each thing the board has to communicate:
 *
 *   1. a job the engine placed and that is now moving           (recently assigned)
 *   2. a job waiting with nobody online                          (round 2, no offers)
 *   3. a job the automatic search has given up on                (exhausted + alert)
 *   4. a job with live offers in a rider's hand                  (countdown running)
 *
 * Run this after scripts/seed-demo-phase4.mjs, with the API up and the dispatch
 * scheduler enabled (it is on unless DISPATCH_SCHEDULER=off).
 *
 * Usage: node scripts/seed-demo-phase6.mjs [--api http://127.0.0.1:4000/api/v1]
 */
const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://127.0.0.1:4000/api/v1';

const RIDER_EMAIL = 'demo.rider@dispatch.test';
const RIDER_PASSWORD = 'Rider@12345';
const CUSTOMER_EMAIL = 'demo.customer@dispatch.test';
const CUSTOMER_PASSWORD = 'Customer@12345';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'admin@dispatch.test';
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'Admin@12345';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PICKUP = {
  address: 'Ring Road, Oba Ovonramwen Square, Benin City',
  landmark: 'By the Oba’s palace roundabout roundabout',
  lat: 6.4281,
  lng: 3.4219,
  contactName: 'Ada Okafor',
  contactPhone: '+2348039876543',
};

const DESTINATIONS = [
  { address: 'Ugbowo-Lagos Road, Benin City', lat: 6.3960, lng: 5.6110 },
  { address: 'Aduwawa, Benin-Auchi Road, Benin City', lat: 6.3629, lng: 5.6791 },
  { address: 'Benin-Auchi Road, Ikpoba Hill, Benin City', lat: 6.3565, lng: 5.6691 },
  { address: 'Adesuwa Road, GRA, Benin City', lat: 6.3312, lng: 5.6392 },
];

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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const login = (identifier, password, audience) =>
  call('/auth/login', { body: { identifier, password, audience } }).then((r) => r.accessToken);

const book = (customerToken, index) =>
  call('/deliveries', {
    token: customerToken,
    body: {
      deliveryType: index === 3 ? 'EXPRESS' : 'STANDARD',
      pickup: PICKUP,
      destination: {
        address: DESTINATIONS[index % DESTINATIONS.length].address,
        lat: DESTINATIONS[index % DESTINATIONS.length].lat,
        lng: DESTINATIONS[index % DESTINATIONS.length].lng,
        contactName: 'Chinedu Eze',
        contactPhone: '+2348069876543',
      },
      packageCategory: index === 3 ? 'ELECTRONICS' : 'DOCUMENTS',
      packageDescription: index === 3 ? 'Sealed laptop box' : 'A4 envelope with signed contracts',
      packageWeightKg: index === 3 ? 2.5 : 0.5,
      isFragile: index === 3,
      recipientName: 'Chinedu Eze',
      recipientPhone: '+2348069876543',
      acceptTerms: true,
      paymentMethod: 'PAYSTACK',
    },
  });

async function main() {
  console.log(`Seeding Phase 6 demo data against ${API}`);

  const customerToken = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, 'CUSTOMER');
  const riderToken = await login(RIDER_EMAIL, RIDER_PASSWORD, 'RIDER');
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN');

  // A half-finished job from an earlier run would block the rider from going online.
  const active = await call('/rider/jobs/active', { method: 'GET', token: riderToken });
  if (active) {
    await call(`/rider/jobs/${active.id}/fail`, {
      token: riderToken,
      body: { reason: 'Demo reset — cleared by scripts/seed-demo-phase6.mjs' },
    });
    console.log(`· released stale job ${active.reference}`);
  }

  const goOnline = async () => {
    await call('/rider/location', {
      token: riderToken,
      body: { lat: 6.3345, lng: 5.6240, accuracyM: 12, speedKph: 0, batteryPct: 84 },
    });
    await call('/rider/availability', { token: riderToken, body: { availability: 'ONLINE' } });
  };
  const goOffline = () => call('/rider/availability', { token: riderToken, body: { availability: 'OFFLINE' } });

  /* ── 1. jobs waiting while nobody is online ──────────────────────────────── */
  await goOffline().catch(() => console.log('· rider was already offline'));
  const waiting = await book(customerToken, 1);
  console.log(`· ${waiting.reference} booked with nobody online — waiting`);

  /* ── 2. a job the automatic search gave up on ────────────────────────────── */
  const lost = await book(customerToken, 2);
  // Every round is an empty round while no rider is online; the engine keeps
  // widening until the schedule is used up and it raises the alert for the desk.
  for (let round = 0; round < 5; round += 1) {
    try {
      await call(`/admin/dispatch/deliveries/${lost.id}/run`, { token: adminToken, body: {} });
    } catch (error) {
      if (!/exhausted/i.test(error.message)) throw error;
      break;
    }
  }
  console.log(`· ${lost.reference} exhausted the automatic search — needs a human`);

  /* ── 3. a job the engine placed, carried, and finished ───────────────────── */
  await goOnline();
  const moving = await book(customerToken, 0);
  const offers = await call('/rider/offers', { method: 'GET', token: riderToken });
  const mine = offers.find((offer) => offer.delivery.id === moving.id);
  if (!mine) throw new Error('The engine did not offer the demo job to the demo rider');
  await call(`/rider/offers/${mine.assignmentId}/accept`, { token: riderToken, body: {} });
  for (const action of ['arrive-pickup', 'pickup', 'start-transit', 'arrive-destination']) {
    await call(`/rider/jobs/${moving.id}/${action}`, { token: riderToken, body: {} });
  }
  // Proof of delivery is a photo plus the recipient's name — the same path a rider
  // takes when the recipient cannot read out the code.
  const proof = await call(`/rider/jobs/${moving.id}/proof-photo`, {
    token: riderToken,
    body: { mimeType: 'image/png', base64: TINY_PNG },
  });
  await call(`/rider/jobs/${moving.id}/complete`, {
    token: riderToken,
    body: { proofPhotoKey: proof.proofPhotoKey, recipientNameEntered: 'Chinedu Eze' },
  });
  console.log(`· ${moving.reference} accepted, delivered and closed with photo proof`);

  /* ── 4. a job with live offers in a rider's hand ─────────────────────────── */
  // Completing released the rider, and the engine immediately offered the jobs that
  // were still waiting to them — which is exactly what the board should show.
  const live = await book(customerToken, 3);
  const board = await call('/admin/dispatch/board', { method: 'GET', token: adminToken });
  const row = board.waiting.find((item) => item.id === live.id);
  console.log(
    `· ${live.reference} is live: round ${row?.dispatch.round ?? '?'} · ${row?.dispatch.offersOut ?? 0} offer(s) out`,
  );

  console.log('\nThe dispatch board is now populated for an admin sign-in:');
  console.log(`  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('\nStates on the board:');
  console.log('  · recently assigned — in transit with a rider');
  console.log('  · waiting — round 2, no rider online');
  console.log('  · exhausted — flagged for manual assignment');
  console.log('  · offers out — countdown running against the demo rider');
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
