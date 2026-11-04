/**
 * Phase 3 verification + screenshots: the customer books a delivery through the
 * real UI, sees the server-computed price, then cancels it.
 *
 *   node scripts/capture-phase3.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const OUT = 'screenshots';
const stamp = Date.now().toString().slice(-6);
const CUSTOMER = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: `booker.${stamp}@example.test`,
  phone: `0803${stamp}55`.slice(0, 11),
  password: 'Str0ngPassw0rd',
};

// ── 1. Create and verify the customer through the public API ────────────────
const post = (path, body) =>
  fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const registered = await post('/auth/register/customer', {
  firstName: CUSTOMER.firstName,
  lastName: CUSTOMER.lastName,
  email: CUSTOMER.email,
  phone: CUSTOMER.phone,
  password: CUSTOMER.password,
  acceptTerms: true,
});
if (registered.status !== 201) throw new Error(`register failed: ${JSON.stringify(registered.body)}`);
await post('/auth/verify-email', { token: registered.body.verification.devToken });
await post('/auth/otp/verify', { phone: CUSTOMER.phone, code: registered.body.verification.devCode });
console.log(`  ✓ customer ${CUSTOMER.email} registered and verified`);

// ── 2. Drive the UI ─────────────────────────────────────────────────────────
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const log = (message) => console.log(`  ${message}`);

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.getByLabel('Email or phone number').fill(CUSTOMER.email);
await page.getByLabel('Password').fill(CUSTOMER.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/app', { timeout: 15_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/30-dashboard-empty.png`, fullPage: true });
log('✓ 30-dashboard-empty.png (real zeros from /deliveries/summary)');

// Booking wizard — step 1: pickup
await page.getByRole('link', { name: 'Book a rider' }).first().click();
await page.waitForURL('**/app/book');
await page.getByLabel('Search saved locations').fill('Lekki');
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Lekki — Phase 1/ }).click();
await page.getByLabel('Contact name').fill('Ada Okafor');
await page.getByLabel('Contact phone').fill(CUSTOMER.phone);
await page.screenshot({ path: `${OUT}/31-book-step1-pickup.png` });
log('✓ 31-book-step1-pickup.png');
await page.getByRole('button', { name: 'Continue' }).click();

// step 2: drop-off
await page.getByLabel('Search saved locations').fill('Yaba');
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Yaba — Commercial Avenue/ }).click();
await page.getByLabel('Contact name').fill('Chinedu Eze');
await page.getByLabel('Contact phone').fill('08069876543');
await page.waitForTimeout(1200); // let the quote arrive
await page.getByRole('button', { name: 'Continue' }).click();

// step 3: package
await page.getByLabel('What is inside?').fill('One envelope with signed contracts');
await page.getByLabel('Weight (kg)').fill('0.5');
await page.getByRole('button', { name: /Express/ }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/32-book-step3-package.png`, fullPage: true });
log('✓ 32-book-step3-package.png');
await page.getByRole('button', { name: 'Continue' }).click();

// step 4: review
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/33-book-review.png`, fullPage: true });
const priceText = await page.locator('text=/Total/').first().locator('..').innerText().catch(() => '');
log(`✓ 33-book-review.png  (price panel: ${priceText.replace(/\n/g, ' ').slice(0, 60)})`);

await page.getByRole('checkbox').check();
const confirm = page.getByRole('button', { name: /Confirm booking/ });
const confirmLabel = await confirm.innerText();
await confirm.click();
await page.waitForURL(/\/app\/deliveries\/[0-9a-f-]{36}/, { timeout: 15_000 });
const deliveryUrl = page.url();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/34-delivery-detail.png`, fullPage: true });
log(`✓ 34-delivery-detail.png (${confirmLabel.trim()})`);

// list
await page.goto(`${WEB}/app/deliveries`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/35-deliveries-list.png`, fullPage: true });
log('✓ 35-deliveries-list.png');

// dashboard with real numbers
await page.goto(`${WEB}/app`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/36-dashboard-filled.png`, fullPage: true });
const stats = await page.locator('.text-2xl, .text-3xl').allInnerTexts().catch(() => []);
log(`✓ 36-dashboard-filled.png (stats: ${stats.slice(0, 4).join(' | ')})`);

// cancel flow
await page.goto(deliveryUrl, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Cancel delivery' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Why are you cancelling?').fill('The recipient moved the meeting to tomorrow');
await page.screenshot({ path: `${OUT}/37-cancel-dialog.png` });
log('✓ 37-cancel-dialog.png');
await page.getByRole('button', { name: 'Cancel delivery' }).last().click();
await page.waitForTimeout(1200);
await page.waitForLoadState('networkidle');
await page.screenshot({ path: `${OUT}/38-delivery-cancelled.png`, fullPage: true });
const heading = await page.locator('h1').first().innerText();
log(`✓ 38-delivery-cancelled.png (status now: ${heading})`);

await browser.close();

if (errors.length > 0) {
  console.log('\n⚠ Console errors:');
  for (const error of new Set(errors)) console.log('   ', error);
} else {
  console.log('\n✓ No browser console errors during the whole journey');
}
console.log(`\nCustomer: ${CUSTOMER.email} / ${CUSTOMER.password}`);
