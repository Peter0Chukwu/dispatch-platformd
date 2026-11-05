#!/usr/bin/env node
/**
 * PHASE 8 DEMO SEED — a rider mid-delivery, with a real position trail
 *
 * Nothing here is inserted as "display data": the script books a real delivery
 * through the customer API, has the demo rider accept it, then reports positions
 * through the same endpoint the rider's phone uses. The pings therefore land in
 * `rider_locations` exactly as a live phone's would, and every screen afterwards
 * reads them back through the tracking API.
 *
 * What it leaves behind:
 *   1. one delivery IN_TRANSIT from Victoria Island to Ikeja, paid
 *   2. a position trail of ~12 pings along the route (rider heading to the drop-off)
 *   3. a share link the capture script can open without signing in
 *
 * Usage: node scripts/seed-demo-phase8.mjs [--api http://127.0.0.1:4000/api/v1]
 * Requires: API up, seed-demo-phase4 run first (demo customer + rider exist).
 */
const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://127.0.0.1:4000/api/v1';

const CUSTOMER = { email: 'demo.customer@dispatch.test', password: 'Customer@12345' };
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

const PICKUP = {
  address: '12 Adeola Odeku Street, Victoria Island, Lagos',
  landmark: 'Opposite Eko Hotel roundabout',
  lat: 6.4281,
  lng: 3.4219,
  contactName: 'Ada Okafor',
  contactPhone: '+2348039876543',
};
const DEST = {
  address: '7 Allen Avenue, Ikeja, Lagos',
  landmark: 'Beside the Zenith Bank branch',
  lat: 6.6018,
  lng: 3.3515,
  contactName: 'Chinedu Eze',
  contactPhone: '+2348069876543',
};

const step = (message) => console.log(`  ${message}`);

const call = async (path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

const login = async (identifier, password, audience) =>
  (await call('/auth/login', { method: 'POST', body: { identifier, password, audience } })).accessToken;

const riderTokenEarly = await login(RIDER.email, RIDER.password, 'RIDER');
const existing = await call('/rider/jobs/active', { token: riderTokenEarly }).catch(() => null);

/* ── 1. a job to drive ────────────────────────────────────────────────────────
 * Re-runnable on purpose: if the rider is already carrying a job from a previous
 * run, this script keeps that job and refreshes its positions rather than piling
 * up half-finished deliveries. (An in-transit job genuinely cannot be cancelled —
 * the API refuses — so reusing it is also the only honest option.)
 */
const customerToken = await login(CUSTOMER.email, CUSTOMER.password, 'CUSTOMER');

let delivery;
if (existing?.id) {
  delivery = {
    id: existing.id,
    reference: existing.reference,
    chargeFormatted: existing.pay?.grossFormatted ?? '',
  };
  step(`reusing the job already in progress: ${delivery.reference}`);
} else {
  const created = await call('/deliveries', {
    method: 'POST',
    token: customerToken,
    body: {
      deliveryType: 'STANDARD',
      pickup: PICKUP,
      destination: DEST,
      packageCategory: 'ELECTRONICS',
      packageDescription: 'Laptop in a padded bag',
      packageWeightKg: 2.4,
      isFragile: true,
      specialInstructions: 'Call on arrival — the gate is usually locked.',
      recipientName: DEST.contactName,
      recipientPhone: DEST.contactPhone,
      acceptTerms: true,
      paymentMethod: 'PAYSTACK',
    },
  });
  delivery = created;
  step(`booked ${created.reference} (${created.chargeFormatted})`);

  // ── 2. pay for it, so the job is a real one ──────────────────────────────
  const payment = await call(`/payments/deliveries/${delivery.id}/initialize`, {
    method: 'POST',
    token: customerToken,
    body: { provider: 'PAYSTACK' },
  });
  await call(`/payments/${payment.reference}/simulate`, { method: 'POST', token: customerToken });
  step(`paid ${payment.reference} (simulated gateway)`);

  // ── 3. the rider takes the job, through the real offer endpoint ──────────
  await call('/rider/availability', { method: 'POST', token: riderTokenEarly, body: { availability: 'ONLINE' } });

  let offers = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    offers = await call('/rider/offers', { token: riderTokenEarly });
    if (offers.some((offer) => offer.delivery.id === delivery.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const offer = offers.find((row) => row.delivery.id === delivery.id);
  if (!offer) throw new Error('the demo rider was never offered this delivery — is the dispatch engine running?');
  await call(`/rider/offers/${offer.assignmentId}/accept`, { method: 'POST', token: riderTokenEarly });
  step(`rider accepted (${offer.distanceToPickupKm?.toFixed?.(1) ?? '—'} km to pickup)`);

  // ── 4. collect the parcel, then drive ────────────────────────────────────
  // The state machine is strict on purpose: arrive at the pickup, collect, start
  // transit. A seed that skipped a step would be lying about what a rider can do.
  await call(`/rider/jobs/${delivery.id}/arrive-pickup`, { method: 'POST', token: riderTokenEarly });
  await call(`/rider/jobs/${delivery.id}/pickup`, { method: 'POST', token: riderTokenEarly });
  step('parcel collected (PICKED_UP)');
  await call(`/rider/jobs/${delivery.id}/start-transit`, { method: 'POST', token: riderTokenEarly });
  step('in transit');
}

const riderToken = riderTokenEarly;

/**
 * A position trail, reported the way a phone reports it: one ping at a time, each
 * a genuine coordinate, walking from the pickup toward the drop-off. The final
 * ping is the one the map will draw, so the trail is not decoration — it is the
 * history the customer's ETA is measured from.
 */
const POINTS = 12;
for (let index = 1; index <= POINTS; index += 1) {
  // Stop around 70% of the way: a rider who has already arrived makes for a dull
  // map, and the ETA would be zero.
  const ratio = 0.06 + (index / POINTS) * 0.64;
  const lat = PICKUP.lat + (DEST.lat - PICKUP.lat) * ratio;
  const lng = PICKUP.lng + (DEST.lng - PICKUP.lng) * ratio;
  await call('/rider/location', {
    method: 'POST',
    token: riderToken,
    body: {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracyM: 8 + (index % 4),
      speedKph: 22 + (index % 7),
      heading: 315,
      batteryPct: 82 - index,
      deliveryId: delivery.id,
    },
  });
}
step(`${POINTS} position pings recorded`);

/* ── 5. a share link the capture script can open without signing in ───────── */
const share = await call(`/deliveries/${delivery.id}/share-link`, { method: 'POST', token: customerToken });
step(`share link live until ${new Date(share.expiresAt).toLocaleString('en-NG')}`);

const tracking = await call(`/deliveries/${delivery.id}/track`, { token: customerToken });
step(
  `tracking: ${tracking.delivery.statusLabel} · ETA ${tracking.eta?.minutes ?? '—'} min · ` +
    `${tracking.eta?.distanceRemainingKm ?? '—'} km to the ${tracking.eta?.headingTo ?? '—'}`,
);

console.log(
  JSON.stringify(
    {
      deliveryId: delivery.id,
      reference: delivery.reference,
      shareToken: share.token,
      shareUrl: share.url,
      etaMinutes: tracking.eta?.minutes ?? null,
    },
    null,
    2,
  ),
);
