#!/usr/bin/env node
/**
 * PHASE 7 DEMO SEED — a finance desk with real money behind it
 *
 * Every naira here is created by exercising the product: a wallet top-up, a card
 * payment, a wallet payment, two completed deliveries, a withdrawal request, a
 * refund. Nothing is inserted straight into a table, so what the finance screen
 * shows is exactly what a real day would produce.
 *
 * What it leaves behind:
 *   1. the customer has a wallet with a real balance and a statement
 *   2. two deliveries are paid — one by card (with a gateway fee), one by wallet
 *   3. the demo rider has earnings, some still on hold and some cleared
 *   4. one withdrawal is waiting for a finance decision
 *   5. one payment has been refunded, with the reason on record
 *
 * Usage: node scripts/seed-demo-phase7.mjs [--api http://127.0.0.1:4000/api/v1]
 * Requires: API up, PAYMENTS_MODE=DEVELOPMENT (the simulator settles the charges).
 */
import { execFileSync } from 'node:child_process';
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
  { address: 'Adesuwa Road, GRA, Benin City', lat: 6.3312, lng: 5.6392 },
  { address: 'Aduwawa, Benin-Auchi Road, Benin City', lat: 6.3629, lng: 5.6791 },
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

const book = (customerToken, index, type = 'STANDARD') =>
  call('/deliveries', {
    token: customerToken,
    body: {
      deliveryType: type,
      pickup: PICKUP,
      destination: {
        address: DESTINATIONS[index % DESTINATIONS.length].address,
        lat: DESTINATIONS[index % DESTINATIONS.length].lat,
        lng: DESTINATIONS[index % DESTINATIONS.length].lng,
        contactName: 'Chinedu Eze',
        contactPhone: '+2348069876543',
      },
      packageCategory: 'DOCUMENTS',
      packageDescription: 'A4 envelope with signed contracts',
      packageWeightKg: 0.5,
      recipientName: 'Chinedu Eze',
      recipientPhone: '+2348069876543',
      acceptTerms: true,
      paymentMethod: 'PAYSTACK',
    },
  });

async function main() {
  console.log(`Seeding Phase 7 demo money against ${API}`);

  const customerToken = await login(CUSTOMER_EMAIL, CUSTOMER_PASSWORD, 'CUSTOMER');
  const riderToken = await login(RIDER_EMAIL, RIDER_PASSWORD, 'RIDER');
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD, 'ADMIN');

  const pay = async (deliveryId, provider = 'PAYSTACK') => {
    const payment = await call(`/payments/deliveries/${deliveryId}/initialize`, {
      token: customerToken,
      body: { provider },
    });
    const settled = await call(`/payments/${payment.reference}/simulate`, { token: customerToken });
    console.log(`· ${payment.reference} settled · ${payment.amountFormatted}`);
    return settled.payment;
  };

  /* ── 1. the wallet ────────────────────────────────────────────────────────── */
  const topUp = await call('/payments/wallet/topups', {
    token: customerToken,
    body: { amountKobo: '3000000', provider: 'PAYSTACK' }, // ₦30,000
  });
  const toppedUp = await call(`/payments/${topUp.reference}/simulate`, { token: customerToken });
  console.log(`· wallet topped up to ${toppedUp.walletBalanceKobo === '3000000' ? '₦30,000' : toppedUp.walletBalanceKobo}`);

  /* ── 2. a delivery paid by card, with a gateway fee on the books ──────────── */
  const byCard = await book(customerToken, 0);
  const cardPayment = await pay(byCard.id, 'PAYSTACK');

  /* ── 3. a delivery paid from the wallet ──────────────────────────────────── */
  const byWallet = await book(customerToken, 1, 'EXPRESS');
  const walletPayment = await call(`/payments/deliveries/${byWallet.id}/pay-with-wallet`, {
    token: customerToken,
  });
  console.log(`· ${byWallet.reference} paid from wallet · balance ${walletPayment.walletBalanceFormatted}`);

  /* ── 4. two completed jobs so the rider has earnings ─────────────────────── */
  const goOnline = async () => {
    await call('/rider/location', {
      token: riderToken,
      body: { lat: 6.3345, lng: 5.6240, accuracyM: 12, speedKph: 0, batteryPct: 84 },
    });
    await call('/rider/availability', { token: riderToken, body: { availability: 'ONLINE' } });
  };

  const TINY_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** Accept the offer for a delivery, walk it to delivered, and let earnings land. */
  const earnOn = async (deliveryId) => {
    const offers = await call('/rider/offers', { method: 'GET', token: riderToken });
    const list = Array.isArray(offers) ? offers : (offers.data ?? []);
    const offer = list.find((row) => row.delivery?.id === deliveryId);
    if (!offer) throw new Error(`no live offer for ${deliveryId} — is the rider online?`);
    await call(`/rider/offers/${offer.assignmentId}/accept`, { token: riderToken, body: {} });

    const pos = { lat: 6.3329, lng: 5.6221 };
    await call(`/rider/jobs/${deliveryId}/arrive-pickup`, { token: riderToken, body: pos });
    // Pickup asks for a photo, but uploads are only accepted once the parcel is
    // moving — so the pickup step is taken with the declared photo key omitted and
    // the same upload is reused for proof of delivery below.
    await call(`/rider/jobs/${deliveryId}/pickup`, { token: riderToken, body: pos }).catch(async (error) => {
      if (!/photo/i.test(error.message)) throw error;
      throw new Error(`pickup photo required: ${error.message}`);
    });

    await call(`/rider/jobs/${deliveryId}/start-transit`, { token: riderToken, body: pos });
    await call(`/rider/jobs/${deliveryId}/arrive-destination`, { token: riderToken, body: pos });

    const deliveryProof = await call(`/rider/jobs/${deliveryId}/proof-photo`, {
      token: riderToken,
      body: { mimeType: 'image/png', base64: TINY_PNG },
    });

    // Proof of delivery: the seed does not know the recipient OTP, so it uses the
    // photo + recipient-name route — a real, supported completion path.
    const done = await call(`/rider/jobs/${deliveryId}/complete`, {
      token: riderToken,
      body: { proofPhotoKey: deliveryProof.proofPhotoKey, recipientNameEntered: 'Chinedu Eze' },
    });
    console.log(`· ${done.reference} delivered · rider earns ${done.earning.netFormatted}`);
  };

  await goOnline();
  await earnOn(byWallet.id);

  /* ── 5. a second job for a second earning ────────────────────────────────── */
  const third = await book(customerToken, 2);
  await pay(third.id);
  await earnOn(third.id);

  /* ── 6. move the demo clock forward so an earning clears its hold ─────────── */
  // A real earning clears 24 h after delivery. A screenshot cannot wait a day, so
  // the demo data rewinds `availableAt` — the hold itself is untouched in the code.
  const backendDir = resolve(process.cwd(), 'backend');
  execFileSync(
    'node',
    [
      '-e',
      `const { PrismaClient } = require('@prisma/client');
       const prisma = new PrismaClient();
       (async () => {
         const rider = await prisma.rider.findFirst({ where: { user: { email: '${RIDER_EMAIL}' } } });
         const result = await prisma.riderEarning.updateMany({
           where: { riderId: rider.id, status: 'PENDING' },
           data: { availableAt: new Date(Date.now() - 60 * 60 * 1000) },
         });
         console.log('demo clock: ' + result.count + ' earning(s) past their hold');
         await prisma.$disconnect();
       })().catch((error) => { console.error(error.message); process.exit(1); });`,
    ],
    { cwd: backendDir, stdio: 'inherit' },
  );

  const earnings = await call('/rider/earnings', { method: 'GET', token: riderToken });
  console.log(`· rider holds ${earnings.pendingKobo} kobo pending, ${earnings.availableKobo} kobo cleared`);

  /* ── 6b. a withdrawal request waiting for a finance decision ─────────────── */
  const withdrawable = BigInt(earnings.withdrawableKobo);
  if (withdrawable > 0n) {
    const withdrawal = await call('/rider/withdrawals', {
      token: riderToken,
      body: {
        amountKobo: withdrawable.toString(),
        bankName: 'GTBank',
        bankCode: '058',
        accountNumber: '0123456789',
        accountName: 'Rita Adeyemi',
        idempotencyKey: `demo-withdrawal-${Date.now()}`,
      },
    });
    console.log(`· withdrawal ${withdrawal.amountFormatted} requested (${withdrawal.status}) → ${withdrawal.accountNumberMasked}`);
  } else {
    console.log('· nothing withdrawable yet — the hold has not cleared');
  }

  /* ── 7. a refund with a real reason on record ────────────────────────────── */
  const refundable = cardPayment;
  const refund = await call(`/admin/finance/payments/${refundable.id}/refunds`, {
    token: adminToken,
    body: { amountKobo: refundable.amountKobo, reason: 'Recipient refused the parcel — returned to sender' },
  });
  console.log(`· refund ${refund.amountFormatted} recorded (${refund.status})`);

  /* ── 8. summary for a human ─────────────────────────────────────────────── */
  const summary = await call('/admin/finance/summary', { method: 'GET', token: adminToken });
  const reconciliation = await call('/admin/finance/reconciliation', { method: 'GET', token: adminToken });
  console.log(
    `\nFinance desk: collected ${summary.collected.amountFormatted} · rider net ${summary.riders.netFormatted} · net ${summary.net.formatted}`,
  );
  console.log(`Books balanced: ${reconciliation.trialBalanceBalanced}`);
  for (const check of reconciliation.checks) {
    console.log(`  ${check.ok ? '✓' : '✗'} ${check.name} — ${check.detail}`);
  }
  console.log(`\nWallet balance: ${(await call('/wallet', { method: 'GET', token: customerToken })).balanceFormatted}`);
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exit(1);
});
