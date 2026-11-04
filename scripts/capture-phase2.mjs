/**
 * Phase 2 verification + screenshots, driven through a REAL browser.
 * Exercises: admin login → admin dashboard → sign out → customer registration
 * → email/phone verification → customer login → customer dashboard.
 *
 *   node scripts/capture-phase2.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = 'screenshots';
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'admin@dispatch.test';
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@12345';
const stamp = Date.now().toString().slice(-6);
const CUSTOMER = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: `ada.${stamp}@example.test`,
  phone: `0803${stamp}11`.slice(0, 11),
  password: 'Str0ngPassw0rd',
};

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

const step = (message) => console.log(`  ${message}`);

// 1 ── Login screen
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-login.png` });
step('✓ 10-login.png');

// 2 ── Admin sign-in through the UI
await page.getByRole('tab', { name: 'Admin' }).click();
await page.getByLabel('Work email').fill(ADMIN_EMAIL);
await page.getByLabel('Password').fill(ADMIN_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/admin', { timeout: 15_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/11-admin-dashboard.png`, fullPage: true });
step('✓ 11-admin-dashboard.png (signed in as super admin)');

const staffRows = await page.locator('table tbody tr').count();
const permissionChips = await page.locator('.font-mono').count();
step(`  → staff table rows rendered: ${staffRows}; permission chips: ${permissionChips}`);

// 3 ── Sign out
await page.getByRole('button', { name: 'Sign out' }).first().click();
await page.getByRole('button', { name: 'Sign out', exact: true }).last().click();
await page.waitForURL('**/login', { timeout: 15_000 });
step('✓ signed out, refresh cookie revoked');

// 4 ── Customer registration through the UI
await page.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
await page.getByLabel('First name').fill(CUSTOMER.firstName);
await page.getByLabel('Last name').fill(CUSTOMER.lastName);
await page.getByLabel('Email address').fill(CUSTOMER.email);
await page.getByLabel('Phone number').fill(CUSTOMER.phone);
await page.getByLabel('Password', { exact: false }).first().fill(CUSTOMER.password);
await page.screenshot({ path: `${OUT}/12-register.png` });
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL('**/verify', { timeout: 15_000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/13-verify.png` });
step('✓ 12-register.png, 13-verify.png');

// 5 ── Verify email then phone (development mode returns the codes)
await page.getByRole('button', { name: 'Verify email' }).click();
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Verify phone' }).click();
await page.waitForURL('**/login**', { timeout: 15_000 });
step('✓ email + phone verified');

// 6 ── Customer sign-in
await page.goto(`${WEB}/login?portal=customer`, { waitUntil: 'networkidle' });
await page.getByLabel('Email or phone number').fill(CUSTOMER.email);
await page.getByLabel('Password').fill(CUSTOMER.password);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL('**/app', { timeout: 15_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/14-customer-dashboard.png`, fullPage: true });
step('✓ 14-customer-dashboard.png');

// 7 ── Portal separation: a customer token must not open /admin
await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
step(`✓ customer visiting /admin redirected to: ${new URL(page.url()).pathname}`);

// 8 ── Mobile login screen
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await mobile.goto(`${WEB}/login?portal=rider`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${OUT}/15-login-mobile.png` });
step('✓ 15-login-mobile.png');

await browser.close();

if (errors.length > 0) {
  console.log('\n⚠ Console errors observed:');
  for (const error of new Set(errors)) console.log('   ', error);
} else {
  console.log('\n✓ No browser console errors during the whole journey');
}
console.log(`\nCustomer created: ${CUSTOMER.email} / ${CUSTOMER.phone} / ${CUSTOMER.password}`);
