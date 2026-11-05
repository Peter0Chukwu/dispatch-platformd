/**
 * PHASE 6 VERIFICATION + SCREENSHOTS
 *
 * Drives the dispatch engine through the real UI against the real API and the real
 * database. Nothing is stubbed: every round, offer and countdown on screen came out
 * of Postgres a moment earlier, and the "Live" badge is a real socket connection.
 *
 * Flow:
 *   admin sign-in → dispatch board (engine states) → run a round from the board →
 *   delivery history of what the engine did → rider offers with the live push
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs     # customer, rider and documents
 *   node scripts/seed-demo-phase6.mjs     # the four board states
 *   (API on :4000, web on :5173, DISPATCH_SCHEDULER not disabled)
 *
 * Run: node scripts/capture-phase6.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-6';
const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

const step = (message) => console.log(`  ${message}`);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error}`));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  // The browser logs a bare 401 for the pre-sign-in session probe; the response
  // listener below already inspects every API reply, so this line is noise.
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

/* ── 1. the dispatch board, straight after sign-in ────────────────────────── */
await signIn(ADMIN, 'admin');
await page.waitForURL('**/admin', { timeout: 20_000 });
await page.getByRole('link', { name: 'Dispatch board' }).click();
await page.waitForURL('**/admin/dispatch', { timeout: 20_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
await shot('01-dispatch-board.png');

const liveBadge = await page.getByText(/^(Live|Reconnecting)$/).first().innerText();
step(`   socket status in the header: ${liveBadge}`);
const waitingRows = await page.locator('tbody tr').count();
step(`   deliveries on the board: ${waitingRows}`);

/* ── 2. the rider's side of the same moment ──────────────────────────────── */
const riderContext = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const riderPage = await riderContext.newPage();
riderPage.on('pageerror', (error) => problems.push(`rider pageerror: ${error}`));

await riderPage.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await riderPage.getByRole('tab', { name: /rider/i }).click();
await riderPage.getByLabel(/email|phone/i).fill(RIDER.email);
await riderPage.getByLabel(/password/i).fill(RIDER.password);
await riderPage.getByRole('button', { name: /^sign in$/i }).click();
await riderPage.waitForURL('**/rider', { timeout: 20_000 });
await riderPage.goto(`${WEB}/rider/offers`, { waitUntil: 'networkidle' });
await riderPage.waitForTimeout(1200);
await riderPage.screenshot({ path: `${OUT}/02-rider-offers.png`, fullPage: true });
step('✓ 02-rider-offers.png');
step(`   offers in the rider's hand: ${await riderPage.getByRole('button', { name: /^pass$/i }).count()}`);

/* ── 3. the rider declines everything ────────────────────────────────────── */
// A real rejection through the real endpoint: the engine must stop asking this
// rider and move on, which is what pushes the jobs into the exhausted state.
for (const pass of await riderPage.getByRole('button', { name: /^pass$/i }).all()) {
  await pass.click().catch(() => undefined);
  await riderPage.waitForTimeout(700);
}
await riderPage.waitForTimeout(1200);
await riderPage.screenshot({ path: `${OUT}/03-rider-no-offers.png`, fullPage: true });
step('✓ 03-rider-no-offers.png');
await riderContext.close();

/* ── 4. the board once the engine has run out of riders ──────────────────── */
await page.getByRole('link', { name: 'Dispatch board' }).click();
await page.waitForURL('**/admin/dispatch', { timeout: 20_000 });
await page.waitForTimeout(2500); // let the heartbeat record the next empty rounds
await shot('04-exhausted.png');
const exhausted = await page.getByText(/automatic search gave up/i).locator('..').innerText().catch(() => '');
step(`   exhausted counter: ${exhausted.replace(/\s+/g, ' ').slice(0, 80)}`);

/* ── 5. the fallback: assigning a rider by hand ──────────────────────────── */
// Choosing a rider is the override the board exists to hand off to. The drawer is
// where the whole record lives: offers, responses and the manual assignment form.
await page.goto(`${WEB}/admin/deliveries`, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const openFirst = page.getByRole('button', { name: /^open$/i }).first();
if (await openFirst.count()) {
  await openFirst.click();
  await page.waitForTimeout(1200);
  const assignRider = page.getByRole('button', { name: /assign a rider|reassign rider/i }).first();
  if (await assignRider.count()) {
    await assignRider.click();
    await page.waitForTimeout(800);
  }
  await shot('05-manual-assign.png');
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(600);
} else {
  step('   (no deliveries to open)');
}

/* ── 6. what the engine did, in the delivery record ──────────────────────── */
// The delivered job: its drawer shows the full status timeline and the assignment
// trail (offered → accepted → delivered), which is the audit the product promises.
const deliveredRow = page.locator('tbody tr', { hasText: /DELIVERED/i }).first();
const openButton = (await deliveredRow.count())
  ? deliveredRow.getByRole('button', { name: /^open$/i })
  : page.getByRole('button', { name: /^open$/i }).first();
await openButton.click();
await page.waitForTimeout(1500);
await shot('06-delivery-history.png');
await page.keyboard.press('Escape').catch(() => undefined);

await browser.close();

if (problems.length > 0) {
  console.error('\nProblems seen while driving the UI:');
  for (const problem of [...new Set(problems)]) console.error(`  · ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nNo console errors, no failed API calls.');
}
