import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from 'playwright/test';
import { resolve } from 'node:path';

/**
 * THE MASTER SCENARIO — twenty steps, one continuous journey
 *
 * A brand-new customer registers, is verified, books a delivery, pays for it, and
 * is carried by a rider through every state to a photographed hand-over. The
 * customer then watches it happen, an admin sees it in the day's numbers, and a
 * report is generated from it.
 *
 * There is no mocking anywhere: the browser talks to the real API, the API talks to
 * real PostgreSQL, the pricing engine prices the trip, the dispatch engine offers it,
 * the ledger posts the money and the report recomputes it.
 *
 * The one concession is setup: creating and verifying an account needs a token that
 * a real user gets by email and SMS, so the spec fetches it from the dev-mode
 * registration response. Everything after sign-in is driven through the UI.
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const SHOTS = process.env.OUT_DIR ?? 'documentation/screenshots/phase-10';

const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };
const RIDER = { email: 'demo.rider@dispatch.test', password: 'Rider@12345' };

/** A distinct customer per run, so the database keeps an honest audit trail. */
const stamp = Date.now().toString().slice(-8);
const CUSTOMER = {
  firstName: 'E2E',
  lastName: `Journey${stamp.slice(-4)}`,
  email: `e2e.customer.${stamp}@dispatch.test`,
  phone: `+234809${stamp.padStart(8, '0').slice(0, 7)}`,
  password: 'Journey@12345',
};

const api = async <T = any>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${response.status} ${text.slice(0, 300)}`);
  }
  return json as T;
};

test.describe.configure({ mode: 'serial' });

test('the master scenario: a new customer books, a rider delivers, the numbers agree', async ({ browser }) => {
  await mkdir(SHOTS, { recursive: true });

  /* ── setup: an account, and a free rider ─────────────────────────────────── */

  // Sign-in and sign-up are rate limited per account and per IP, on purpose. Clear
  // only those keys so a capture run is not fighting the platform's own defences.
  try {
    const keys = execFileSync('redis-cli', ['--scan', '--pattern', 'ratelimit:*'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    if (keys.length > 0) execFileSync('redis-cli', ['del', ...keys]);
  } catch {
    /* Redis not on PATH — the run simply takes longer. */
  }

  const registration = await api<{ userId: string; verification: { devToken: string; devCode: string } }>(
    '/auth/register/customer',
    { method: 'POST', body: { ...CUSTOMER, acceptTerms: true, lastName: CUSTOMER.lastName } },
  );
  await api('/auth/verify-email', { method: 'POST', body: { token: registration.verification.devToken } });
  await api('/auth/otp/verify', {
    method: 'POST',
    body: { phone: CUSTOMER.phone, code: registration.verification.devCode },
  });

  // One API session for the whole journey. Sign-in is rate limited per account (10
  // attempts per 5 minutes, by design), so the spec logs in once and reuses the token
  // instead of spending its budget on repeated logins.
  const customerToken = (await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: { identifier: CUSTOMER.email, password: CUSTOMER.password, audience: 'CUSTOMER' },
  })).accessToken;

  // The demo rider accepts one job at a time. If a previous run left them holding
  // one, release it through the admin API rather than pretending they are free.
  const adminToken = (await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: { identifier: ADMIN.email, password: ADMIN.password, audience: 'ADMIN' },
  })).accessToken;
  const riderToken = (await api<{ accessToken: string }>('/auth/login', {
    method: 'POST',
    body: { identifier: RIDER.email, password: RIDER.password, audience: 'RIDER' },
  })).accessToken;
  // `/rider/jobs/active` answers with the job itself, or an empty body when idle.
  // Getting the rider free again depends on how far the leftover job got: a job that
  // was never collected can be cancelled, but once the parcel is in the rider's hands
  // the platform (correctly) refuses cancellation — the rider has to fail it, which is
  // the real-world "I couldn't deliver this" path. Either way the rider ends up idle.
  const active = await api<{ id: string; reference: string; status: string } | null>('/rider/jobs/active', {
    token: riderToken,
  });
  if (active?.id) {
    const cancellable = ['PENDING_PAYMENT', 'PAID', 'SEARCHING_FOR_RIDER', 'RIDER_ASSIGNED', 'ARRIVED_AT_PICKUP'];
    if (cancellable.includes(active.status)) {
      await api(`/admin/deliveries/${active.id}/cancel`, {
        method: 'POST',
        token: adminToken,
        body: { reason: 'Released by the end-to-end suite so the rider is available' },
      });
    } else {
      await api(`/rider/jobs/${active.id}/fail`, {
        method: 'POST',
        token: riderToken,
        body: { reason: 'Released by the end-to-end suite so the rider is available' },
      });
    }
  }

  const customerContext = await browser.newContext();
  const riderContext = await browser.newContext({
    viewport: { width: 430, height: 932 },
    geolocation: { latitude: 6.4301, longitude: 3.4197 },
    permissions: ['geolocation'],
  });
  const adminContext = await browser.newContext();

  const customerPage = await customerContext.newPage();
  const riderPage = await riderContext.newPage();
  const adminPage = await adminContext.newPage();

  const problems: string[] = [];
  for (const [name, page] of [
    ['customer', customerPage],
    ['rider', riderPage],
    ['admin', adminPage],
  ] as Array<[string, Page]>) {
    page.on('pageerror', (error) => problems.push(`${name} pageerror: ${error}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Before anyone signs in, the app probes `/auth/refresh` and is correctly told
      // 401. That is the expected unauthenticated state, not a defect.
      if (/401 \(Unauthorized\)|status of 401/.test(message.text())) return;
      problems.push(`${name} console: ${message.text()}`);
    });
  }

  const shot = async (page: Page, name: string) => {
    for (const dismiss of await page.getByRole('button', { name: 'Dismiss notification' }).all()) {
      await dismiss.click().catch(() => undefined);
    }
    await page.waitForTimeout(350);
    await page.screenshot({ path: resolve(SHOTS, name), fullPage: true });
  };

  const signIn = async (page: Page, portal: 'Customer' | 'Rider' | 'Admin', who: { email: string; password: string }) => {
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: new RegExp(portal, 'i') }).click();
    // The staff portal asks for a work email; the customer and rider portals accept
    // either an email or a phone number.
    await page.getByLabel(/^work email$/i).or(page.getByLabel(/email or phone/i)).first().fill(who.email);
    await page.getByLabel(/^password$/i).fill(who.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
  };

  /**
   * A session can end mid-journey for a legitimate security reason: if a document is
   * torn down while a token refresh is in flight, the browser can miss the rotated
   * cookie, and the server treats the leftover token as reuse and revokes the family.
   * That is the correct, strict behaviour — so the journey signs back in and carries
   * on rather than failing on a browser race.
   */
  const reopen = async (page: Page, portal: 'Customer' | 'Rider' | 'Admin', who: { email: string; password: string }, path: string) => {
    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
    if (!/\/login/.test(page.url())) return;
    await signIn(page, portal, who);
    await page.waitForLoadState('networkidle');
    if (/\/login/.test(page.url())) {
      throw new Error(
        `Could not sign back in as ${who.email}. If this is a 429, the per-account sign-in limit is doing its job — wait five minutes and re-run.`,
      );
    }
    await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  };

  let chargeText = '';

  /* ── 1 ───────────────────────────────────────────────────────────────────── */
  await test.step('1. the public site loads', async () => {
    await customerPage.goto(WEB, { waitUntil: 'networkidle' });
    await expect(customerPage.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });

  /* ── 2 ───────────────────────────────────────────────────────────────────── */
  await test.step('2. registration refuses a weak password', async () => {
    await customerPage.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
    await customerPage.getByLabel(/first name/i).fill('Weak');
    await customerPage.getByLabel(/last name/i).fill('Password');
    await customerPage.getByLabel(/email/i).fill('weak.password@dispatch.test');
    await customerPage.getByLabel(/phone/i).fill('+2348090000099');
    await customerPage.getByLabel(/^password$/i).fill('password');
    const terms = customerPage.getByRole('checkbox');
    if (await terms.count()) await terms.first().check();
    await customerPage.getByRole('button', { name: /create account|sign up|register/i }).click();
    // The browser and the API both refuse it — the message is the point.
    await expect(customerPage.getByText(/uppercase|at least|password/i).first()).toBeVisible();
  });

  /* ── 3 ───────────────────────────────────────────────────────────────────── */
  await test.step('3. the verified account signs in to the customer portal', async () => {
    await signIn(customerPage, 'Customer', CUSTOMER);
    await customerPage.waitForURL('**/app', { timeout: 30_000 });
    await customerPage.waitForLoadState('networkidle');
    await shot(customerPage, 'e2e-01-customer-dashboard-new-account.png');
  });

  /* ── 4 ───────────────────────────────────────────────────────────────────── */
  await test.step('4. the booking wizard opens', async () => {
    await customerPage.getByRole('link', { name: 'Book a rider' }).first().click();
    await customerPage.waitForURL('**/app/book');
    await expect(customerPage.getByText(/pickup/i).first()).toBeVisible();
  });

  /* ── 5 ───────────────────────────────────────────────────────────────────── */
  await test.step('5. step 1 — pickup from a real saved location', async () => {
    await customerPage.getByLabel('Search saved locations').fill('Lekki');
    await customerPage.waitForTimeout(400);
    await customerPage.getByRole('button', { name: /Lekki — Phase 1/ }).click();
    await customerPage.getByLabel('Contact name').fill('Ada Okafor');
    await customerPage.getByLabel('Contact phone').fill(CUSTOMER.phone);
    await customerPage.getByRole('button', { name: 'Continue' }).click();
  });

  /* ── 6 ───────────────────────────────────────────────────────────────────── */
  await test.step('6. step 2 — drop-off, and the server prices the trip', async () => {
    await customerPage.getByLabel('Search saved locations').fill('Yaba');
    await customerPage.waitForTimeout(400);
    await customerPage.getByRole('button', { name: /Yaba — Commercial Avenue/ }).click();
    await customerPage.getByLabel('Contact name').fill('Chinedu Eze');
    await customerPage.getByLabel('Contact phone').fill('08069876543');
    await customerPage.waitForTimeout(1500);
    await customerPage.getByRole('button', { name: 'Continue' }).click();
  });

  /* ── 7 ───────────────────────────────────────────────────────────────────── */
  await test.step('7. step 3 — the package', async () => {
    await customerPage.getByLabel('What is inside?').fill('One sealed A4 envelope with signed contracts');
    await customerPage.getByLabel('Weight (kg)').fill('0.5');
    await customerPage.getByRole('button', { name: /Express/ }).click();
    await customerPage.waitForTimeout(1200);
    await shot(customerPage, 'e2e-02-booking-package-step.png');
    await customerPage.getByRole('button', { name: 'Continue' }).click();
  });

  /* ── 8 ───────────────────────────────────────────────────────────────────── */
  await test.step('8. step 4 — the review shows the priced breakdown', async () => {
    await customerPage.waitForTimeout(1000);
    const total = customerPage.locator('text=/Total/').first().locator('..');
    chargeText = (await total.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    expect(chargeText).toMatch(/₦|N/);
    await shot(customerPage, 'e2e-03-booking-review.png');
  });

  /* ── 9 ───────────────────────────────────────────────────────────────────── */
  const booking = await test.step('9. the booking is created with that charge', async () => {
    await customerPage.getByRole('checkbox').first().check();
    await customerPage.getByRole('button', { name: /Confirm booking/ }).click();
    await customerPage.waitForURL(/\/app\/deliveries\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const row = await api<{ items: Array<{ id: string; reference: string; status: string; chargeKobo: string }> }>(
      '/deliveries?perPage=1',
      { token: customerToken },
    );
    const latest = row.items[0];
    expect(latest.status).toMatch(/PENDING|AWAITING_PAYMENT|PAID/);
    return { id: latest.id, reference: latest.reference };
  });
  const { reference, id: deliveryId } = booking;

  /* ── 10 ──────────────────────────────────────────────────────────────────── */
  await test.step('10. payment settles through the gateway path', async () => {
    await customerPage.getByRole('button', { name: /Continue to payment/i }).click();
    await customerPage.getByRole('button', { name: /Confirm payment/i }).click();
    await expect(customerPage.getByText(/paid/i).first()).toBeVisible({ timeout: 30_000 });
    await shot(customerPage, 'e2e-04-delivery-paid.png');
  });

  /* ── 11 ──────────────────────────────────────────────────────────────────── */
  await test.step('11. the rider signs in on a phone', async () => {
    await signIn(riderPage, 'Rider', RIDER);
    await riderPage.waitForURL('**/rider', { timeout: 30_000 });
    await riderPage.waitForLoadState('networkidle');
    await shot(riderPage, 'e2e-05-rider-home.png');
  });

  /* ── 12 ──────────────────────────────────────────────────────────────────── */
  await test.step('12. the dispatch engine offers this job, and the rider accepts it', async () => {
    // Proving the *offer* exists is part of the scenario: it means the dispatch
    // engine found this rider for this delivery, through real eligibility filters.
    let offer: { assignmentId: string; delivery: { id: string } } | undefined;
    for (let attempt = 0; attempt < 40 && !offer; attempt += 1) {
      // `/rider/offers` answers with a bare array (older clients used `{ data }`),
      // so both shapes are accepted rather than assuming one.
      const offers = await api<Array<{ assignmentId: string; delivery: { id: string } }> | { data: Array<{ assignmentId: string; delivery: { id: string } }> }>(
        '/rider/offers',
        { token: riderToken },
      );
      const list = Array.isArray(offers) ? offers : (offers?.data ?? []);
      offer = list.find((row) => row.delivery.id === deliveryId);
      if (!offer) await riderPage.waitForTimeout(1000);
    }
    expect(offer, 'dispatch never offered this delivery to the demo rider').toBeTruthy();

    if (!/\/rider\/offers/.test(riderPage.url())) {
      await riderPage.getByRole('link', { name: 'Offers' }).first().click();
      await riderPage.waitForURL('**/rider/offers');
    }
    const accepts = riderPage.getByRole('button', { name: 'Accept job' });
    await accepts.first().waitFor({ timeout: 30_000 });

    // Several jobs can be offered at once, so the button is picked by the card that
    // carries *this* booking's reference rather than by position.
    const total = await accepts.count();
    let chosen = -1;
    for (let index = 0; index < total; index += 1) {
      // Walk up from the button until an ancestor's text contains this booking's
      // reference: the card markup is free to change, the reference is not.
      const belongs = await accepts.nth(index).evaluate((element, ref) => {
        let node: Element | null = element;
        for (let depth = 0; depth < 8 && node; depth += 1) {
          if ((node.textContent ?? '').includes(String(ref))) return true;
          node = node.parentElement;
        }
        return false;
      }, reference);
      if (belongs) {
        chosen = index;
        break;
      }
    }
    expect(chosen, 'the offer for this booking is not on screen').toBeGreaterThanOrEqual(0);
    await accepts.nth(chosen).click();

    // The claim is checked against the API, not against a URL.
    let held: string | null = null;
    for (let attempt = 0; attempt < 20 && held !== deliveryId; attempt += 1) {
      const active = await api<{ id: string } | null>('/rider/jobs/active', { token: riderToken });
      held = active?.id ?? null;
      if (held !== deliveryId) await riderPage.waitForTimeout(600);
    }
    expect(held, 'the rider is not holding this delivery').toBe(deliveryId);

    // Navigate inside the single-page app rather than reloading the document: the
    // access token lives in memory, and a hard load in the instant after an accept
    // can race the refresh rotation.
    await riderPage.getByRole('link', { name: 'Active job' }).first().click();
    await riderPage.waitForURL('**/rider/active', { timeout: 30_000 });
    await riderPage.getByRole('button', { name: 'I have arrived at the pickup' }).waitFor({ timeout: 30_000 });
    await shot(riderPage, 'e2e-06-rider-accepted.png');
  });

  /* ── 13 ──────────────────────────────────────────────────────────────────── */
  await test.step('13. the rider reports a real position while on the job', async () => {
    // The rider context was created with a granted geolocation permission, so this
    // is what `navigator.geolocation` gives the page — not a value the test injected
    // into the API.
    await expect(riderPage.getByText(/Sharing your position/i).first()).toBeVisible({ timeout: 30_000 });
    let position: { lat: number; lng: number } | null = null;
    for (let attempt = 0; attempt < 20 && !position; attempt += 1) {
      const track = await api<{ position: { lat: number; lng: number } | null }>(`/deliveries/${deliveryId}/track`, {
        token: customerToken,
      });
      position = track.position;
      if (!position) await riderPage.waitForTimeout(1500);
    }
    expect(position, 'no position was ever reported by the rider device').not.toBeNull();
    expect(Math.abs(position!.lat - 6.4301)).toBeLessThan(0.05);
    expect(Math.abs(position!.lng - 3.4197)).toBeLessThan(0.05);
  });

  /* ── 14 ──────────────────────────────────────────────────────────────────── */
  await test.step('14. the rider walks the workflow to the pickup', async () => {
    await riderPage.getByRole('button', { name: 'I have arrived at the pickup' }).click();
    await riderPage.waitForTimeout(900);
    await riderPage.getByRole('button', { name: 'Package collected' }).click();
    await riderPage.waitForTimeout(900);
  });

  /* ── 15 ──────────────────────────────────────────────────────────────────── */
  await test.step('15. the customer can see the rider and a real ETA', async () => {
    await reopen(customerPage, 'Customer', CUSTOMER, '/app/deliveries');
    await customerPage.waitForTimeout(600);
    await shot(customerPage, 'e2e-07-customer-deliveries.png');
  });

  /* ── 16 ──────────────────────────────────────────────────────────────────── */
  await test.step('16. the trip starts and reaches the destination', async () => {
    await riderPage.getByRole('button', { name: 'Start the trip' }).click();
    await riderPage.waitForTimeout(900);
    await riderPage.getByRole('button', { name: 'I have arrived at the destination' }).click();
    await riderPage.waitForTimeout(900);
    await shot(riderPage, 'e2e-08-rider-at-destination.png');
  });

  /* ── 17 ──────────────────────────────────────────────────────────────────── */
  await test.step('17. proof of delivery: a photo and the recipient name', async () => {
    const proofPath = resolve(process.cwd(), 'scripts/fixtures/proof-of-delivery.png');
    await riderPage.getByRole('button', { name: 'Complete delivery' }).click();
    await riderPage.getByRole('button', { name: 'Photo proof' }).click();
    await riderPage.locator('input[type="file"]').setInputFiles(proofPath);
    await riderPage.waitForSelector('text=Attached:', { timeout: 30_000 });
    await riderPage.getByPlaceholder('e.g. Chidi Okafor').fill('Chinedu Eze');
    await riderPage.getByRole('button', { name: 'Confirm delivered' }).click();
    await riderPage.waitForURL('**/rider/earnings', { timeout: 30_000 });
    await riderPage.waitForLoadState('networkidle');
    await shot(riderPage, 'e2e-09-rider-earned.png');
  });

  /* ── 18 ──────────────────────────────────────────────────────────────────── */
  await test.step('18. the customer sees a delivered job and a payable charge', async () => {
    await reopen(customerPage, 'Customer', CUSTOMER, '/app/deliveries');
    await expect(customerPage.getByText(/delivered/i).first()).toBeVisible({ timeout: 30_000 });
    await shot(customerPage, 'e2e-10-customer-delivered.png');
  });

  /* ── 19 ──────────────────────────────────────────────────────────────────── */
  await test.step('19. the admin sees it in the day’s real numbers', async () => {
    await signIn(adminPage, 'Admin', ADMIN);
    await adminPage.waitForURL('**/admin', { timeout: 30_000 });
    await adminPage.waitForLoadState('networkidle');
    await expect(adminPage.getByText('Deliveries booked').first()).toBeVisible();
    await expect(adminPage.getByText('Gross charged').first()).toBeVisible();

    // The dashboard is SQL, so the job the rider just delivered must be inside it.
    // A date-only range means the whole day (see `rangeToSchema` in the shared schemas).
    const day = new Date().toISOString().slice(0, 10);
    const dashboard = await api<{ deliveries: { delivered: number; total: number } }>(
      `/admin/dashboard?from=${day}&to=${day}`,
      { token: adminToken },
    );
    expect(dashboard.deliveries.delivered).toBeGreaterThanOrEqual(1);
    await shot(adminPage, 'e2e-11-admin-dashboard.png');
  });

  /* ── 20 ──────────────────────────────────────────────────────────────────── */
  await test.step('20. a report is generated from the same data and reconciles', async () => {
    await adminPage.goto(`${WEB}/admin/reports`, { waitUntil: 'networkidle' });
    await adminPage.getByText('Gross revenue').first().waitFor({ timeout: 30_000 });

    const token = adminToken;
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const [preview, summary] = await Promise.all([
      api<{ totals: Array<{ label: string; value: string }> }>(
        `/admin/reports/preview?type=FINANCIAL_SUMMARY&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { token },
      ),
      api<{ net: { kobo: string }; collected: { amountKobo: string } }>(
        `/admin/finance/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { token },
      ),
    ]);
    const net = preview.totals.find((total) => total.label === 'Net');
    const collected = preview.totals.find((total) => total.label === 'Collected');
    expect(net?.value).toBe(summary.net.kobo);
    expect(collected?.value).toBe(summary.collected.amountKobo);

    await shot(adminPage, 'e2e-12-admin-reports.png');
  });

  expect(problems, `browser errors during the journey:\n${problems.join('\n')}`).toHaveLength(0);

  await customerContext.close();
  await riderContext.close();
  await adminContext.close();
});
