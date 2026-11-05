#!/usr/bin/env node
/**
 * PHASE 9 DEMO SEED — history, then the reports that describe it
 *
 * A report is only convincing if there is enough history to report on. So this
 * script does two things in order:
 *
 *   1. **Builds a week-by-week trail through the product.** Eight bookings: six
 *      walked to delivered by the rider, one cancelled by the customer, one failed
 *      by the rider with a reason. Every one of them is created by the API, paid
 *      through the payment simulator, and moved along the real rider state machine
 *      — nothing is inserted as a finished delivery.
 *
 *   2. **Spreads them over the last five weeks.** A same-day-only dataset makes a
 *      30-day report look broken, so the demo clock shifts `createdAt`/`deliveredAt`
 *      (and the matching payment and earning rows) by a fixed offset per delivery.
 *      Only dates move; amounts, statuses and ledger postings are untouched.
 *
 * Then it asks the API for four real reports, downloads them with a signed link,
 * and checks the totals against `GET /admin/finance/summary` and raw SQL. Files
 * land in `documentation/samples/`.
 *
 * Usage: node scripts/seed-demo-phase9.mjs [--api http://127.0.0.1:4000/api/v1]
 * Requires: API up, PAYMENTS_MODE=DEVELOPMENT, demo users seeded.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://127.0.0.1:4000/api/v1';

const RIDER_EMAIL = 'demo.rider@dispatch.test';
const RIDER_PASSWORD = 'Rider@12345';
const CUSTOMER_EMAIL = 'demo.customer@dispatch.test';
const CUSTOMER_PASSWORD = 'Customer@12345';
const ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'admin@dispatch.test';
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD ?? 'Admin@12345';

const PICKUPS = [
  { address: '12 Adeola Odeku Street, Victoria Island, Lagos', lat: 6.4281, lng: 3.4219, landmark: 'Opposite Eko Hotel' },
  { address: '4 Commercial Avenue, Yaba, Lagos', lat: 6.5095, lng: 3.3711, landmark: 'By Tejuosho market' },
  { address: '1 Marina Road, Lagos Island, Lagos', lat: 6.4531, lng: 3.3958, landmark: 'Near Union Bank head office' },
];

const DESTINATIONS = [
  { address: '5 Bode Thomas Street, Surulere, Lagos', lat: 6.4969, lng: 3.3481 },
  { address: '33 Awolowo Road, Ikoyi, Lagos', lat: 6.4501, lng: 3.4356 },
  { address: '18 Admiralty Way, Lekki Phase 1, Lagos', lat: 6.4419, lng: 3.4723 },
  { address: '7 Adebayo Doherty Street, Lekki Phase 1, Lagos', lat: 6.4471, lng: 3.4802 },
  { address: '22 Awolowo Way, Ikeja, Lagos', lat: 6.6018, lng: 3.3515 },
  { address: '8 Bode Thomas Street, Surulere, Lagos', lat: 6.4972, lng: 3.3498 },
];

/** Day offsets, in days before today, one per planned job. */
const DAY_BACK = [0, 1, 3, 6, 9, 14, 21, 28, 34];

async function call(path, { method = 'POST', token, body, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) {
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
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

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function main() {
  console.log(`Seeding Phase 9 demo history against ${API}`);

  const customerToken = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, 'CUSTOMER');
  const riderToken = await login(RIDER_EMAIL, RIDER_PASSWORD, 'RIDER');
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN');

  const book = (index, type = 'STANDARD') => {
    const pickup = PICKUPS[index % PICKUPS.length];
    const destination = DESTINATIONS[index % DESTINATIONS.length];
    return call('/deliveries', {
      token: customerToken,
      body: {
        deliveryType: type,
        pickup: { ...pickup, contactName: 'Ada Okafor', contactPhone: '+2348039876543' },
        destination: { ...destination, contactName: 'Chinedu Eze', contactPhone: '+2348069876543' },
        packageCategory: 'DOCUMENTS',
        packageDescription: 'A4 envelope with signed contracts',
        packageWeightKg: 0.5,
        recipientName: 'Chinedu Eze',
        recipientPhone: '+2348069876543',
        acceptTerms: true,
        paymentMethod: 'PAYSTACK',
      },
    });
  };

  const pay = async (deliveryId) => {
    const payment = await call(`/payments/deliveries/${deliveryId}/initialize`, {
      token: customerToken,
      body: { provider: 'PAYSTACK' },
    });
    const settled = await call(`/payments/${payment.reference}/simulate`, { token: customerToken });
    return settled.payment;
  };

  // The rider must be online and reporting a position before the dispatch engine
  // will offer anything — this is the same gate a real rider passes.
  await call('/rider/location', {
    token: riderToken,
    body: { lat: 6.4301, lng: 3.4197, accuracyM: 12, speedKph: 0, batteryPct: 84 },
  });
  await call('/rider/availability', { token: riderToken, body: { availability: 'ONLINE' } });

  const acceptOffer = async (deliveryId) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const offers = await call('/rider/offers', { method: 'GET', token: riderToken });
      const list = Array.isArray(offers) ? offers : (offers.data ?? []);
      const offer = list.find((row) => row.delivery?.id === deliveryId);
      if (offer) {
        await call(`/rider/offers/${offer.assignmentId}/accept`, { token: riderToken, body: {} });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no offer arrived for ${deliveryId} — is the rider online and inside the zone?`);
  };

  const deliver = async (deliveryId) => {
    const pos = { lat: 6.4281, lng: 3.4219 };
    await call(`/rider/jobs/${deliveryId}/arrive-pickup`, { token: riderToken, body: pos });
    await call(`/rider/jobs/${deliveryId}/pickup`, { token: riderToken, body: pos });
    await call(`/rider/jobs/${deliveryId}/start-transit`, { token: riderToken, body: pos });
    await call(`/rider/jobs/${deliveryId}/arrive-destination`, { token: riderToken, body: pos });
    const proof = await call(`/rider/jobs/${deliveryId}/proof-photo`, {
      token: riderToken,
      body: { mimeType: 'image/png', base64: TINY_PNG },
    });
    return call(`/rider/jobs/${deliveryId}/complete`, {
      token: riderToken,
      body: { proofPhotoKey: proof.proofPhotoKey, recipientNameEntered: 'Chinedu Eze' },
    });
  };

  /* ── 1. six delivered jobs ─────────────────────────────────────────────────── */
  const created = [];
  for (let index = 0; index < 6; index += 1) {
    const booking = await book(index, index === 2 ? 'EXPRESS' : 'STANDARD');
    await pay(booking.id);
    await acceptOffer(booking.id);
    const done = await deliver(booking.id);
    created.push({ id: booking.id, reference: booking.reference, outcome: 'DELIVERED' });
    console.log(`· ${booking.reference} delivered ${done.chargeFormatted ?? done.delivery?.chargeFormatted ?? ''}`);
  }

  /* ── 2. one cancelled and one failed, so those reports have rows ───────────── */
  const cancelled = await book(7);
  const cancelledJob = await call(`/deliveries/${cancelled.id}/cancel`, {
    token: customerToken,
    body: { reason: 'Recipient rescheduled — will rebook next week' },
  });
  created.push({ id: cancelled.id, reference: cancelled.reference, outcome: cancelledJob.status });

  const failed = await book(8);
  await pay(failed.id);
  await acceptOffer(failed.id);
  await call(`/rider/jobs/${failed.id}/fail`, {
    token: riderToken,
    body: { reason: 'Recipient unavailable at the delivery address' },
  });
  created.push({ id: failed.id, reference: failed.reference, outcome: 'FAILED' });
  console.log(`· ${cancelled.reference} cancelled · ${failed.reference} failed`);

  /* ── 3. spread the trail across five weeks ─────────────────────────────────── */
  // Dates only. Amounts, statuses and the ledger are exactly what the API posted.
  const shiftScript = `
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      const jobs = ${JSON.stringify(created)};
      const days = ${JSON.stringify(DAY_BACK.slice(0, created.length))};
      let moved = 0;
      for (let index = 0; index < jobs.length; index += 1) {
        const offsetMs = days[index] * 24 * 60 * 60 * 1000 + index * 37 * 60 * 1000;
        const back = (date) => (date ? new Date(date.getTime() - offsetMs) : null);
        const delivery = await prisma.delivery.findUnique({ where: { id: jobs[index].id } });
        if (!delivery) continue;
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: {
            createdAt: back(delivery.createdAt),
            acceptedAt: back(delivery.acceptedAt),
            pickedUpAt: back(delivery.pickedUpAt),
            deliveredAt: back(delivery.deliveredAt),
            cancelledAt: back(delivery.cancelledAt),
          },
        });
        const payments = await prisma.payment.findMany({ where: { deliveryId: delivery.id } });
        for (const payment of payments) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { createdAt: back(payment.createdAt), paidAt: back(payment.paidAt), verifiedAt: back(payment.verifiedAt) },
          });
        }
        // Journal entries move with their delivery, so a period report and the ledger
        // agree about *when* revenue happened — not just how much of it there was.
        for (const entry of await prisma.journalEntry.findMany({ where: { deliveryId: delivery.id } })) {
          await prisma.journalEntry.update({
            where: { id: entry.id },
            data: { postedAt: back(entry.postedAt), createdAt: back(entry.createdAt) },
          });
        }
        const earning = await prisma.riderEarning.findUnique({ where: { deliveryId: delivery.id } });
        if (earning) {
          await prisma.riderEarning.update({
            where: { id: earning.id },
            data: { createdAt: back(earning.createdAt), availableAt: back(earning.availableAt) },
          });
        }
        moved += 1;
      }
      console.log('demo clock: ' + moved + ' delivery trail(s) spread over five weeks');
      await prisma.\$disconnect();
    })().catch((error) => { console.error(error.message); process.exit(1); });
  `;
  execFileSync('node', ['-e', shiftScript], { cwd: resolve(process.cwd(), 'backend'), stdio: 'inherit' });

  /* ── 4. ask for four real reports and collect them ─────────────────────────── */
  const days = 45;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const to = new Date().toISOString();

  const wanted = [
    { type: 'DAILY_DELIVERIES', format: 'CSV' },
    { type: 'FINANCIAL_SUMMARY', format: 'PDF' },
    { type: 'ZONE_PERFORMANCE', format: 'CSV' },
    { type: 'RIDER_PERFORMANCE', format: 'CSV' },
  ];

  const sampleDir = resolve(process.cwd(), 'documentation/samples');
  mkdirSync(sampleDir, { recursive: true });

  for (const want of wanted) {
    const job = await call('/admin/reports', { token: adminToken, body: { ...want, from, to } });
    let ready = job;
    for (let attempt = 0; attempt < 40 && ready.status !== 'READY'; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      ready = await call(`/admin/reports/${job.id}`, { method: 'GET', token: adminToken });
    }
    if (ready.status !== 'READY') throw new Error(`${want.type} never became READY (${ready.status}: ${ready.error})`);

    const link = await call(`/admin/reports/${job.id}/download-link`, { token: adminToken, body: {} });
    const file = await call(link.url.replace('/api/v1', ''), { method: 'GET', raw: true });
    const name = `${want.type.toLowerCase().replace(/_/g, '-')}.${want.format.toLowerCase()}`;
    writeFileSync(resolve(sampleDir, name), file.buffer);
    console.log(`· ${want.type} ${want.format} · ${(file.buffer.length / 1024).toFixed(1)} kB → documentation/samples/${name}`);
  }

  /* ── 5. the numbers must agree ─────────────────────────────────────────────── */
  const preview = await call(`/admin/reports/preview?type=FINANCIAL_SUMMARY&from=${from}&to=${to}`, {
    method: 'GET',
    token: adminToken,
  });
  const summary = await call(`/admin/finance/summary?from=${from}&to=${to}`, { method: 'GET', token: adminToken });
  const reportNet = preview.totals.find((total) => total.label === 'Net');
  const collected = preview.totals.find((total) => total.label === 'Collected');
  const gross = preview.totals.find((total) => total.label === 'Gross revenue');
  const netRevenue = preview.totals.find((total) => total.label === 'Net revenue');

  const checks = [
    {
      name: 'report net = finance screen net',
      ok: reportNet.value === summary.net.kobo,
      detail: `${Number(reportNet.value) / 100} vs ${Number(summary.net.kobo) / 100}`,
    },
    {
      name: 'report collected = finance screen collected',
      ok: collected.value === summary.collected.amountKobo,
      detail: `${Number(collected.value) / 100} vs ${Number(summary.collected.amountKobo) / 100}`,
    },
    {
      name: 'gross − refunds = net revenue',
      ok: BigInt(gross.value) - BigInt(preview.totals.find((total) => total.label === 'Refunds').value) === BigInt(netRevenue.value),
      detail: `${Number(gross.value) / 100} − refunds = ${Number(netRevenue.value) / 100}`,
    },
    {
      name: 'collected = report collected on the finance screen',
      ok: collected.value === summary.collected.amountKobo,
      detail: `₦${(Number(collected.value) / 100).toLocaleString('en-NG')}`,
    },
  ];

  console.log('\nReconciliation');
  for (const check of checks) console.log(`  ${check.ok ? '✓' : '✗'} ${check.name} — ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;

  console.log(`\nGenerated files are in documentation/samples/. Reports are in the admin UI at /admin/reports.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
