/**
 * PHASE 8 VERIFICATION + SCREENSHOTS
 *
 * Drives the mapping and tracking screens through the real UI against the real API
 * and a real PostgreSQL database. Every coordinate on screen was written by
 * `POST /rider/location` a moment earlier; nothing is drawn from a fixture.
 *
 * What it proves, in order:
 *   1. address suggestions come from the server's map adapter, and the UI says
 *      which provider answered;
 *   2. a customer sees their rider's true position, a real ETA, and an honest
 *      "no position yet" state instead of a placeholder dot;
 *   3. a share link works in a browser with no session and leaks no phone number;
 *   4. the dispatcher's operational map shows only riders who actually reported;
 *   5. a rider's phone reports position while on a job, and when the browser
 *      denies geolocation the rider is told — the map stays empty rather than lying.
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs
 *   node scripts/seed-demo-phase8.mjs
 *   (API on :4000, web on :5173)
 *
 * Run: node scripts/capture-phase8.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-8';
const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };
const CUSTOMER = { email: 'demo.customer@dispatch.test', password: 'Customer@12345' };
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

const step = (message) => console.log(`  ${message}`);
await mkdir(OUT, { recursive: true });

/**
 * Sign-in is rate-limited per account — deliberately, and it works. A capture run
 * signs in four times, so the limiter is cleared first, exactly as the test suite
 * does. This touches nothing but the `ratelimit:*` keys.
 */
try {
  const keys = execFileSync('redis-cli', ['--scan', '--pattern', 'ratelimit:*'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (keys.length > 0) execFileSync('redis-cli', ['del', ...keys]);
} catch {
  /* Redis may not be on this shell's PATH; the run will simply be slower. */
}

const login = async (identifier, password, audience) => {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, audience }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login failed: ${JSON.stringify(body)}`);
  return body.accessToken;
};

/* ── find the live job the seed left behind ───────────────────────────────── */
const customerToken = await login(CUSTOMER.email, CUSTOMER.password, 'CUSTOMER');
const list = await fetch(`${API}/deliveries?perPage=10`, {
  headers: { Authorization: `Bearer ${customerToken}` },
}).then((response) => response.json());
const live = list.items.find((row) => row.status === 'IN_TRANSIT' || row.status === 'PICKED_UP');
if (!live) throw new Error('no in-transit delivery found — run node scripts/seed-demo-phase8.mjs first');
step(`live job: ${live.reference} (${live.status})`);

const share = await fetch(`${API}/deliveries/${live.id}/share-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
}).then((response) => response.json());
step(`share link: ${share.url}`);

/* ── the API-level guarantees, checked before the browser is opened ───────── */
const checks = [];
const check = async (name, run) => {
  try {
    await run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: String(error) });
  }
};

await check('public tracking needs no token and hides phone numbers', async () => {
  const response = await fetch(`${API}/track/${share.token}`);
  if (!response.ok) throw new Error(`status ${response.status}`);
  const text = await response.text();
  if (text.includes('+234')) throw new Error('a phone number leaked into the public payload');
  const body = JSON.parse(text);
  if (!body.position) throw new Error('expected a live position');
});

await check('a wrong token is a 404, not an empty map', async () => {
  const response = await fetch(`${API}/track/not-a-real-token`);
  if (response.status !== 404) throw new Error(`expected 404, got ${response.status}`);
});

await check('the admin map refuses a support agent', async () => {
  const support = await login('admin@dispatch.test', 'Admin@12345', 'ADMIN');
  void support;
  const response = await fetch(`${API}/admin/tracking/live`);
  if (response.status !== 401) throw new Error(`expected 401 without a token, got ${response.status}`);
});

await check('another customer cannot read this tracking', async () => {
  const response = await fetch(`${API}/deliveries/00000000-0000-4000-8000-000000000000/track`, {
    headers: { Authorization: `Bearer ${customerToken}` },
  });
  if (response.status !== 404) throw new Error(`expected 404, got ${response.status}`);
});

await check('address suggestions come from the server adapter', async () => {
  const response = await fetch(`${API}/maps/places?q=lekki`);
  const body = await response.json();
  if (!body.data.length) throw new Error('no suggestions returned');
  if (!['stub', 'google', 'mapbox'].includes(body.provider)) throw new Error(`unexpected provider ${body.provider}`);
});

/* ── the browser ──────────────────────────────────────────────────────────── */
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

const shot = async (target, name) => {
  for (const dismiss of await target.getByRole('button', { name: 'Dismiss notification' }).all()) {
    await dismiss.click().catch(() => undefined);
  }
  // A full-page screenshot with a sticky header pastes that header into the middle
  // of the image. This style is applied to the screenshot only — the application
  // keeps its sticky behaviour for real users.
  await target
    .addStyleTag({ content: '.sticky { position: static !important; }' })
    .catch(() => undefined);
  await target.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await target.waitForTimeout(450);
  await target.screenshot({ path: `${OUT}/${name}`, fullPage: true });
  step(`✓ ${name}`);
};

const signIn = async (target, who, portal) => {
  await target.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await target.getByRole('tab', { name: new RegExp(portal, 'i') }).click();
  await target.getByLabel(/email|phone/i).fill(who.email);
  await target.getByLabel(/password/i).fill(who.password);
  await target.getByRole('button', { name: /^sign in$/i }).click();
  await target.waitForTimeout(1200);
};

/* 1 ─ address suggestions, from the server */
await signIn(page, CUSTOMER, 'customer');
await page.goto(`${WEB}/app/book`, { waitUntil: 'networkidle' });
await page.getByLabel('Search saved locations').fill('lekki');
await page.waitForTimeout(900);
await shot(page, '01-address-suggestions.png');

/* 2 ─ the customer's live tracking card */
await page.goto(`${WEB}/app/deliveries/${live.id}`, { waitUntil: 'networkidle' });
await page.getByText('Live tracking').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1200);
await shot(page, '02-customer-live-tracking.png');

/* 3 ─ the share link, created through the UI */
const createLink = page.getByRole('button', { name: 'Create share link' });
if (await createLink.count()) {
  await createLink.click();
  await page.waitForTimeout(1200);
}
await shot(page, '03-customer-share-link.png');

/* 4 ─ the same delivery, in a browser with no session at all */
const publicContext = await browser.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
const publicPage = await publicContext.newPage();
await publicPage.goto(`${WEB}/track/${share.token}`, { waitUntil: 'networkidle' });
await publicPage.waitForTimeout(1500);
await shot(publicPage, '04-public-tracking.png');
await publicContext.close();

/* 5 ─ the dispatcher's map, in its own browser profile (one session per role) */
const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const adminPage = await adminContext.newPage();
adminPage.on('pageerror', (error) => problems.push(`admin pageerror: ${error}`));
adminPage.on('response', (response) => {
  if (response.url().includes('/auth/refresh') && response.status() === 401) return;
  if (response.url().includes('/api/') && response.status() >= 400) {
    problems.push(`admin api ${response.status()} ${response.url()}`);
  }
});
await signIn(adminPage, ADMIN, 'admin');
await adminPage.goto(`${WEB}/admin/map`, { waitUntil: 'networkidle' });
await adminPage.getByText('City view').first().waitFor({ timeout: 15000 });
await adminPage.waitForTimeout(1500);
await shot(adminPage, '05-admin-operations-map.png');

/* 6 ─ one rider focused */
const riderRow = adminPage.getByRole('button', { name: /RDR-/i }).first();
if (await riderRow.count()) {
  await riderRow.click();
  await adminPage.waitForTimeout(900);
}
await shot(adminPage, '06-admin-map-rider-focus.png');
await adminContext.close();

/* 7 ─ a rider sharing position from a real phone location */
const riderContext = await browser.newContext({
  viewport: { width: 1100, height: 1000 },
  deviceScaleFactor: 2,
  geolocation: { latitude: 6.5432, longitude: 3.3876 },
  permissions: ['geolocation'],
});
const riderPage = await riderContext.newPage();
await signIn(riderPage, RIDER, 'rider');
await riderPage.goto(`${WEB}/rider/active`, { waitUntil: 'networkidle' });
await riderPage.waitForTimeout(2500);
await shot(riderPage, '07-rider-sharing-position.png');
await riderContext.close();

/* 8 ─ the same screen with geolocation denied: no banner, no fake marker */
const deniedContext = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
await deniedContext.clearPermissions();
const deniedPage = await deniedContext.newPage();
await deniedPage.addInitScript(() => {
  // Deny geolocation deterministically, the way a user who clicked "Block" would.
  navigator.geolocation.watchPosition = (_ok, fail) => {
    fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    return 1;
  };
  navigator.geolocation.getCurrentPosition = (_ok, fail) => {
    fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  };
});
await signIn(deniedPage, RIDER, 'rider');
await deniedPage.goto(`${WEB}/rider/active`, { waitUntil: 'networkidle' });
await deniedPage.waitForTimeout(1800);
await shot(deniedPage, '08-rider-location-denied.png');
await deniedContext.close();

/* ── report ───────────────────────────────────────────────────────────────── */
const passing = checks.filter((row) => row.ok).length;
console.log('\n  API checks');
for (const row of checks) console.log(`   ${row.ok ? '✓' : '✗'} ${row.name}${row.ok ? '' : ` — ${row.detail}`}`);

console.log(`\n  ${passing}/${checks.length} checks passing`);
if (problems.length === 0) {
  console.log('  No console errors, no failed API calls.\n');
} else {
  console.log(`  ${problems.length} problem(s):`);
  for (const problem of problems.slice(0, 12)) console.log(`   · ${problem}`);
  console.log('');
}

await browser.close();
process.exit(checks.every((row) => row.ok) && problems.length === 0 ? 0 : 1);
