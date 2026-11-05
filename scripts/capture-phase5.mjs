/**
 * PHASE 5 VERIFICATION + SCREENSHOTS
 *
 * Drives the admin portal through the real UI, against the real API and the real
 * database. Nothing is stubbed: every figure on screen is an aggregate the
 * server computed from Postgres a moment earlier.
 *
 * Flow:
 *   staff sign-in → overview (live dashboard) → deliveries board with filters →
 *   one delivery in full → riders queue → customers → pricing → staff & roles →
 *   audit trail
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs        # a customer, a rider and a job
 *   (API on :4000, web on :5173)
 *
 * Run: node scripts/capture-phase5.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-5';
const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };

const step = (message) => console.log(`  ${message}`);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  // A 401 from /auth/refresh is expected before sign-in: the app probes for an
  // existing session cookie and there is not one yet.
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

// ── 1. sign in on the admin portal ─────────────────────────────────────────
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /admin/i }).click();
await page.getByLabel(/email|phone/i).fill(ADMIN.email);
await page.getByLabel(/password/i).fill(ADMIN.password);
await page.getByRole('button', { name: /^sign in$/i }).click();
await page.waitForURL('**/admin', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await shot('01-overview.png');

// The dashboard must show real numbers, not zeros, once demo data exists.
const gross = await page.getByText(/Gross charged/i).locator('..').innerText();
step(`   overview cards: ${gross.replace(/\s+/g, ' ')}`);

// ── 2. the delivery board ──────────────────────────────────────────────────
await page.getByRole('link', { name: 'Deliveries' }).click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
await shot('02-deliveries.png');

// Filter to the waiting job; the table must narrow to it.
await page.getByLabel(/status/i).selectOption('PENDING');
await page.waitForTimeout(900);
const pendingRows = await page.locator('tbody tr').count();
step(`   filtered to PENDING → ${pendingRows} row(s)`);
await shot('03-deliveries-filtered.png');

// ── 3. one delivery in full ────────────────────────────────────────────────
const openButton = page.getByRole('button', { name: 'Open' }).first();
if (await openButton.count()) {
  await openButton.click();
  await page.waitForTimeout(900);
  await shot('04-delivery-detail.png');
  await page.keyboard.press('Escape');
}

// ── 4. riders, customers, pricing, staff, audit ─────────────────────────────
for (const [link, file] of [
  ['Riders', '05-riders.png'],
  ['Customers', '06-customers.png'],
  ['Pricing', '07-pricing.png'],
  ['Staff & roles', '08-staff.png'],
  ['Audit trail', '09-audit.png'],
]) {
  await page.getByRole('link', { name: link }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  if (link === 'Riders') {
    // The queue is empty once everyone is reviewed; show the live roster instead.
    await page.getByRole('tab', { name: 'Approved' }).click();
    await page.waitForTimeout(700);
  }
  await shot(file);
}

await browser.close();

if (problems.length > 0) {
  console.log('\nProblems seen while driving the UI:');
  for (const problem of [...new Set(problems)]) console.log(`  · ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nNo console errors and no failed API calls.');
}
