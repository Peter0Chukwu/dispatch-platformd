/**
 * PHASE 4 VERIFICATION + SCREENSHOTS
 *
 * Drives the rider portal through the real UI against the real API:
 *
 *   sign in → overview (online) → offers with the 20-second countdown →
 *   accept → walk the job to the destination → prove delivery with a photo →
 *   earnings → documents
 *
 * Nothing is stubbed: the offer must exist in Postgres, the accept must win the
 * Redis lock, and the earnings shown at the end come from the rider's ledger.
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs
 *   (backend on :4000, web on :5173)
 *
 * Run: node scripts/capture-phase4.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-4';
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

/** A 1x1 PNG is a legal upload but a 64x64 one makes a nicer screenshot. */
const PROOF_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAhUlEQVR42u3RMQ0AMAgEwF9CJ2yCJmyCJmyCJgyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJgyCJmyCJmyCJgyCJgzCCweoBAAG7wF1EAAAAASUVORK5CYII=',
  'base64',
);

const step = (message) => console.log(`  ${message}`);

await mkdir(OUT, { recursive: true });
const proofPath = `${OUT}/.proof-handover.png`;
await writeFile(proofPath, PROOF_PNG);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

const shot = async (name) => {
  // Clear the "Job accepted" / "Photo attached" toasts so they do not cover the header.
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
    await dismiss.click().catch(() => undefined);
  }
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: true });
  step(`✓ ${name}`);
};

// ── 1. Sign in as a rider ───────────────────────────────────────────────────
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Rider' }).click();
await page.getByLabel('Email or phone number').fill(RIDER.email);
await page.getByLabel('Password').fill(RIDER.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/rider', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await shot('40-rider-overview-online.png');

// ── 2. Offers, with the countdown ticking ──────────────────────────────────
await page.getByRole('link', { name: 'Offers' }).first().click();
await page.waitForURL('**/rider/offers');
await page.waitForSelector('text=Accept job', { timeout: 20_000 });
await shot('41-rider-offers-countdown.png');

const countdown = await page.getByRole('timer').first().innerText();
step(`   countdown read from the live offer: ${countdown.trim()}s`);

// ── 3. Accept the first job ────────────────────────────────────────────────
await page.getByRole('button', { name: 'Accept job' }).first().click();
await page.waitForURL('**/rider/active**', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await shot('42-rider-active-job.png');

// ── 4. Walk the workflow ───────────────────────────────────────────────────
const steps = [
  ['I have arrived at the pickup', 'arrived at pickup'],
  ['Package collected', 'package collected'],
  ['Start the trip', 'in transit'],
  ['I have arrived at the destination', 'at the destination'],
];
for (const [label, what] of steps) {
  await page.getByRole('button', { name: label }).click();
  await page.waitForTimeout(900);
  step(`✓ ${what}`);
}
await shot('43-rider-workflow-progress.png');

// ── 5. Prove delivery with a photo ─────────────────────────────────────────
await page.getByRole('button', { name: 'Complete delivery' }).click();
await page.getByRole('button', { name: 'Photo proof' }).click();
await page.locator('input[type="file"]').setInputFiles(proofPath);
await page.waitForSelector('text=Attached:', { timeout: 20_000 });
await page.getByPlaceholder('e.g. Chidi Okafor').fill('Chinedu Eze');
await shot('44-rider-proof-of-delivery.png');
await page.getByRole('button', { name: 'Confirm delivered' }).click();
await page.waitForURL('**/rider/earnings', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await shot('45-rider-earnings.png');

// ── 6. Documents ───────────────────────────────────────────────────────────
await page.getByRole('link', { name: 'Documents' }).first().click();
await page.waitForURL('**/rider/documents');
await page.waitForLoadState('networkidle');
await shot('46-rider-documents.png');

// ── 7. The same offers screen on a phone ───────────────────────────────────
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const phone = await mobile.newPage();
await phone.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await phone.getByRole('tab', { name: 'Rider' }).click();
await phone.getByLabel('Email or phone number').fill(RIDER.email);
await phone.getByLabel('Password').fill(RIDER.password);
await phone.getByRole('button', { name: 'Sign in' }).click();
await phone.waitForURL('**/rider', { timeout: 20_000 });
await phone.waitForLoadState('networkidle');
await phone.waitForTimeout(600);
for (const dismiss of await phone.getByRole('button', { name: 'Dismiss notification' }).all()) {
  await dismiss.click().catch(() => undefined);
}
await phone.waitForTimeout(300);
await phone.screenshot({ path: `${OUT}/47-rider-overview-mobile.png`, fullPage: true });
step('✓ 47-rider-overview-mobile.png (390×844)');

await mobile.close();
await browser.close();

if (problems.length > 0) {
  console.log('\nBrowser reported:');
  for (const problem of [...new Set(problems)]) console.log(`  ! ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nNo console errors or page exceptions.');
}
