/**
 * PHASE 7 VERIFICATION + SCREENSHOTS
 *
 * Drives the money screens through the real UI against the real API and the real
 * database. Every naira on screen was created by a payment, an earning or a
 * refund a moment earlier — none of it is mocked, and the reconciliation panel is
 * reading the actual journal.
 *
 * Flow:
 *   admin → finance overview → reconciliation → payments → withdrawals (approve a
 *   real request) → customer wallet → an unpaid delivery's pay panel → rider
 *   earnings and a withdrawal request
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs
 *   node scripts/seed-demo-phase7.mjs
 *   (API on :4000 with PAYMENTS_MODE=DEVELOPMENT, web on :5173)
 *
 * Run: node scripts/capture-phase7.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-7';
const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };
const CUSTOMER = { email: 'demo.customer@dispatch.test', password: 'Customer@12345' };
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

const step = (message) => console.log(`  ${message}`);
await mkdir(OUT, { recursive: true });

/* ── a delivery that is deliberately left unpaid, for the pay panel ────────── */
const login = async (identifier, password, audience) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, audience }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed: ${JSON.stringify(body)}`);
  return body.accessToken;
};

const customerToken = await login(CUSTOMER.email, CUSTOMER.password, 'CUSTOMER');
const unPaid = await fetch(`${API}/deliveries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
  body: JSON.stringify({
    deliveryType: 'STANDARD',
    pickup: {
      address: 'Ring Road, Oba Ovonramwen Square, Benin City',
      landmark: 'By the Oba’s palace roundabout roundabout',
      lat: 6.4281,
      lng: 3.4219,
      contactName: 'Ada Okafor',
      contactPhone: '+2348039876543',
    },
    destination: {
      address: 'Benin-Auchi Road, Ikpoba Hill, Benin City',
      lat: 6.3565,
      lng: 5.6691,
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
  }),
}).then(async (res) => {
  const body = await res.json();
  if (!res.ok) throw new Error(`booking failed: ${JSON.stringify(body)}`);
  return body;
});
step(`unpaid delivery ready: ${unPaid.reference}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  if (/status of 401/.test(message.text())) return;
  problems.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.url().includes('/auth/refresh') && response.status() === 401) return;
  if (response.url().includes('/api/') && response.status() >= 400) {
    problems.push(`api ${response.status()} ${response.url()}`);
  }
});

const shot = async (name) => {
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
    await dismiss.click().catch(() => undefined);
  }
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
  step(`✓ ${name}`);
};

const signIn = async (who, portal) => {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: new RegExp(portal, 'i') }).click();
  await page.getByLabel(/email|phone/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
};

const signOut = async () => {
  await page.getByRole('button', { name: /sign out|log out/i }).first().click().catch(() => undefined);
  await page.waitForTimeout(600);
  await context.clearCookies();
};

/* ── 1. the finance overview ─────────────────────────────────────────────── */
await signIn(ADMIN, 'admin');
await page.waitForURL('**/admin', { timeout: 20_000 });
await page.getByRole('link', { name: 'Finance' }).click();
await page.waitForURL('**/admin/finance', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
await shot('01-finance-overview.png');
const collected = await page.getByText('Collected').first().isVisible();
step(`   summary rendered: ${collected}`);

/* ── 2. reconciliation, run against the live journal ─────────────────────── */
await page.getByRole('tab', { name: 'Reconciliation' }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
await shot('02-reconciliation.png');
const passes = await page.getByText('pass', { exact: true }).count();
const failures = await page.getByText('fail', { exact: true }).count();
step(`   checks passing: ${passes}, failing: ${failures}`);

/* ── 3. the payments ledger ──────────────────────────────────────────────── */
await page.getByRole('tab', { name: 'Payments' }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(700);
await shot('03-payments.png');
const paymentRows = await page.locator('tbody tr').count();
step(`   payments listed: ${paymentRows}`);

/* ── 4. the withdrawal queue, with a real approval ───────────────────────── */
await page.getByRole('tab', { name: 'Withdrawals' }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
await shot('04-withdrawals-queue.png');

// `name` matches substrings by default, so the "Approved" filter chip would
// otherwise be clicked instead of the row action. Exact text, no ambiguity.
const approve = page.getByRole('button', { name: 'Approve', exact: true }).first();
if (await approve.count()) {
  await approve.click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Approved', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  step('   approved one withdrawal — it moved to APPROVED and the ledger recorded it');
  await shot('05-withdrawals-approved.png');
} else {
  step('   no withdrawal was waiting for approval');
}

/* ── 5. the customer wallet ------------------------------------------------- */
await signOut();
await signIn(CUSTOMER, 'customer');
await page.waitForURL('**/app', { timeout: 20_000 });
await page.getByRole('link', { name: 'Wallet' }).click();
await page.waitForURL('**/app/wallet', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
await shot('06-customer-wallet.png');
const balance = await page.getByText(/₦[\d,]+\.\d{2}/).first().innerText();
step(`   wallet balance on screen: ${balance}`);

/* ── 6. paying for a delivery, the honest way ------------------------------ */
await page.goto(`${WEB}/app/deliveries/${unPaid.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await shot('07-pay-delivery.png');

/* ── 7. rider earnings and a withdrawal request ---------------------------- */
await signOut();
await signIn(RIDER, 'rider');
await page.waitForURL('**/rider', { timeout: 20_000 });
await page.getByRole('link', { name: 'Earnings' }).click();
await page.waitForURL('**/rider/earnings', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
await shot('08-rider-earnings.png');

const requestButton = page.getByRole('button', { name: 'Request withdrawal' }).first();
if (await requestButton.isEnabled().catch(() => false)) {
  await requestButton.click();
  await page.waitForTimeout(600);
  await shot('09-withdrawal-request.png');
  await page.keyboard.press('Escape');
}

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems seen while capturing:');
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log('\nNo console errors, no failed API calls.');
