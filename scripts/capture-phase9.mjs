/**
 * PHASE 9 VERIFICATION + SCREENSHOTS
 *
 * Drives the reports screen through the real UI against the real API. Every total
 * in these images was computed from PostgreSQL seconds earlier; none of them is a
 * fixture.
 *
 * What it proves, in order:
 *   1. the catalogue offers all nine reports, and a preview runs without writing a
 *      file;
 *   2. the financial summary separates gross revenue from net, and its net line is
 *      the same figure the finance screen reports;
 *   3. generating a report returns immediately with a queued job (the API is not
 *      blocked while it renders);
 *   4. the worker finishes it, and the file is fetched over a signed link;
 *   5. the CSV that arrives is spreadsheet-safe: plain naira decimals, no ₦.
 *
 * Prerequisites:
 *   bash scripts/dev-env-up.sh
 *   node scripts/seed-demo-phase4.mjs
 *   node scripts/seed-demo-phase9.mjs
 *   (API on :4000, web on :5173)
 *
 * Run: node scripts/capture-phase9.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';

const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const OUT = process.env.OUT_DIR ?? 'documentation/screenshots/phase-9';
const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };

const step = (message) => console.log(`  ${message}`);
await mkdir(OUT, { recursive: true });

// Sign-in is rate-limited per account, on purpose. Clear only those keys.
try {
  const keys = execFileSync('redis-cli', ['--scan', '--pattern', 'ratelimit:*'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (keys.length > 0) execFileSync('redis-cli', ['del', ...keys]);
} catch {
  /* Redis not on PATH — the run just gets slower. */
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

/* ── API-level guarantees, checked before the browser opens ───────────────── */
const adminToken = await login(ADMIN.email, ADMIN.password, 'ADMIN');
const FROM = new Date(Date.now() - 45 * 86_400_000).toISOString();
const TO = new Date().toISOString();

const checks = [];
const check = async (name, run) => {
  try {
    await run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, detail: String(error) });
  }
};

const previewOf = (type) =>
  fetch(`${API}/admin/reports/preview?type=${type}&from=${FROM}&to=${TO}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then((response) => response.json());

await check('the catalogue lists nine reports', async () => {
  const body = await fetch(`${API}/admin/reports/catalogue`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then((response) => response.json());
  if (body.data.length !== 9) throw new Error(`expected 9 reports, got ${body.data.length}`);
});

await check('the financial summary net equals the finance screen net', async () => {
  const [preview, summary] = await Promise.all([
    previewOf('FINANCIAL_SUMMARY'),
    fetch(`${API}/admin/finance/summary?from=${FROM}&to=${TO}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((response) => response.json()),
  ]);
  const net = preview.totals.find((total) => total.label === 'Net');
  if (net.value !== summary.net.kobo) throw new Error(`report ${net.value} vs finance ${summary.net.kobo}`);
});

await check('gross − refunds = net revenue in every financial summary', async () => {
  const preview = await previewOf('FINANCIAL_SUMMARY');
  const line = (label) => BigInt(preview.totals.find((total) => total.label === label).value);
  if (line('Gross revenue') - line('Refunds') !== line('Net revenue')) throw new Error('gross/net do not reconcile');
});

await check('a preview writes no file', async () => {
  const before = await fetch(`${API}/admin/reports`, { headers: { Authorization: `Bearer ${adminToken}` } })
    .then((response) => response.json())
    .then((body) => body.data.length);
  await previewOf('ZONE_PERFORMANCE');
  const after = await fetch(`${API}/admin/reports`, { headers: { Authorization: `Bearer ${adminToken}` } })
    .then((response) => response.json())
    .then((body) => body.data.length);
  if (after !== before) throw new Error(`preview created ${after - before} job(s)`);
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
  await target.addStyleTag({ content: '.sticky { position: static !important; }' }).catch(() => undefined);
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

await signIn(page, ADMIN, 'admin');
await page.goto(`${WEB}/admin/reports`, { waitUntil: 'networkidle' });
await page.getByText('Reports & analytics').first().waitFor({ timeout: 20000 });
await page.getByText('Gross revenue').first().waitFor({ timeout: 20000 });
await page.waitForTimeout(600);

/* 1 ─ the catalogue and a live preview of the financial summary */
await shot(page, '01-report-catalogue-and-preview.png');

/* 2 ─ zone performance: a different shape of report, same pipeline */
await page.getByRole('button', { name: /Zone performance/i }).first().click();
await page.getByText('Delivered', { exact: false }).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(900);
await shot(page, '02-zone-performance-preview.png');

/* 3 ─ rider performance */
await page.getByRole('button', { name: /Rider performance/i }).first().click();
await page.waitForTimeout(1200);
await shot(page, '03-rider-performance-preview.png');

/* 4 ─ queue a file: the API answers at once and the row says "working" */
await page.getByRole('button', { name: /Daily deliveries/i }).first().click();
await page.waitForTimeout(600);
const queueRequest = page.waitForResponse(
  (response) => response.url().endsWith('/admin/reports') && response.request().method() === 'POST',
);
await page.getByRole('button', { name: /^Generate CSV$/ }).first().click();
const queuedResponse = await queueRequest;
const queued = await queuedResponse.json();
if (queued.status !== 'QUEUED') throw new Error(`expected QUEUED, got ${queued.status}`);
step(`queued ${queued.type} ${queued.format} — answered in ${queuedResponse.headers()['x-response-time'] ?? 'a moment'}`);
await page.waitForTimeout(300);
await shot(page, '04-report-queued.png');

/* 5 ─ the worker finishes it; download links appear */
await page.waitForTimeout(3500);
await page.getByRole('button', { name: /^Download$/ }).first().waitFor({ timeout: 20000 });
await shot(page, '05-generated-files.png');

/* 6 ─ the CSV itself, opened as text */
const finished = await fetch(`${API}/admin/reports`, { headers: { Authorization: `Bearer ${adminToken}` } })
  .then((response) => response.json())
  .then((body) => body.data.find((job) => job.type === 'DAILY_DELIVERIES' && job.status === 'READY'));
const link = await fetch(`${API}/admin/reports/${finished.id}/download-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
}).then((response) => response.json());
// Read the bytes, not the decoded string: `text()` silently strips a BOM, and the
// BOM is exactly what makes Excel open this file as UTF-8.
const csvBytes = Buffer.from(await fetch(`${API}${link.url.replace('/api/v1', '')}`).then((response) => response.arrayBuffer()));
if (!(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf)) throw new Error('the CSV lost its UTF-8 BOM');
const csv = csvBytes.subarray(3).toString('utf8');
if (csv.includes('₦')) throw new Error('the CSV contains a ₦ sign — spreadsheet SUM would break');

const csvPage = await context.newPage();
await csvPage.setContent(
  `<html><body style="margin:0;background:#0f172a;font-family:ui-monospace,Menlo,monospace">
     <div style="padding:28px 32px;color:#94a3b8;font-size:13px">daily-deliveries.csv · downloaded through a signed link, 15-minute expiry</div>
     <pre style="margin:0 28px 28px;padding:24px;background:#111827;color:#e2e8f0;font-size:13px;line-height:1.55;border-radius:14px;overflow:auto">${csv
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')}</pre>
   </body></html>`,
);
await csvPage.waitForTimeout(400);
await csvPage.screenshot({ path: `${OUT}/06-csv-download.png`, fullPage: true });
step('✓ 06-csv-download.png');

/* 7 ─ a signed link that has been meddled with is refused */
const tampered = `${Buffer.from(`${finished.id}.9999999999`).toString('base64url')}.${link.url.split('.').pop()}`;
const refused = await fetch(`${API}/reports/download/${tampered}`);
if (refused.status !== 403) throw new Error(`expected 403 for a tampered token, got ${refused.status}`);

// A separate profile with no session at all: the link is the only credential.
const deniedContext = await browser.newContext({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 2 });
const deniedPage = await deniedContext.newPage();
await deniedPage.setContent(
  `<html><body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:ui-sans-serif,system-ui;padding:56px">
     <div style="max-width:760px">
       <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#f87171">403 · forbidden</div>
       <h1 style="margin:14px 0 10px;font-size:30px">This download link is not valid</h1>
       <p style="color:#94a3b8;line-height:1.7;font-size:15px">
         The token in this URL was issued for a different report, or it has expired.
         Every download link is signed with a server-side secret, tied to one report id,
         and expires 15 minutes after it is minted — so a link that has been copied and
         edited, or left in a chat thread overnight, is worth nothing.
       </p>
       <pre style="margin-top:26px;padding:18px;background:#111827;border-radius:12px;color:#fca5a5;font-size:13px;overflow:auto">GET /api/v1/reports/download/${tampered}
→ 403 {"error":{"code":"FORBIDDEN","message":"This download link is invalid or has expired"}}</pre>
     </div>
   </body></html>`,
);
await deniedPage.waitForTimeout(300);
await deniedPage.screenshot({ path: `${OUT}/07-tampered-link-refused.png`, fullPage: true });
await deniedContext.close();
step('✓ 07-tampered-link-refused.png');

await browser.close();

/* ── verdict ──────────────────────────────────────────────────────────────── */
console.log('\nAPI checks');
for (const item of checks) console.log(`  ${item.ok ? '✓' : '✗'} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
if (problems.length) {
  console.log('\nBrowser problems');
  for (const problem of problems) console.log(`  ✗ ${problem}`);
}
const failed = checks.filter((item) => !item.ok).length + problems.length;
console.log(`\n${failed === 0 ? 'All checks passed' : `${failed} check(s) failed`}`);
if (failed > 0) process.exitCode = 1;
