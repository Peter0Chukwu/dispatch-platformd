#!/usr/bin/env node
/**
 * LOAD SMOKE (Phase 10)
 *
 * Not a benchmark and not a load test — a *smoke* test. It answers one question:
 * under a burst a small dispatch office could genuinely produce, does the API stay
 * fast and correct, and does a heavy report hold up everybody else?
 *
 * What it measures:
 *   1. **Read burst** — concurrent dashboard/dispatch-board reads as staff.
 *   2. **Pricing burst** — concurrent quotes, the most compute-heavy public route.
 *   3. **The report question** — a report is queued and, while the worker renders it,
 *      a cheap endpoint is polled. If the report blocked the event loop, that cheap
 *      endpoint would stall. It is the same claim the Phase 9 test suite makes, tested
 *      against a real running server rather than an in-process Nest instance.
 *   4. **Error budget** — any 5xx fails the run; a 429 is *not* a failure (the rate
 *      limiter doing its job is a pass), but it is reported so the numbers are honest.
 *
 * Usage: node scripts/load-smoke.mjs [--api http://127.0.0.1:4000/api/v1] [--concurrency 40]
 */
const API = process.argv.includes('--api')
  ? process.argv[process.argv.indexOf('--api') + 1]
  : 'http://127.0.0.1:4000/api/v1';
const CONCURRENCY = process.argv.includes('--concurrency')
  ? Number(process.argv[process.argv.indexOf('--concurrency') + 1])
  : 40;

const ADMIN = { email: 'admin@dispatch.test', password: 'Admin@12345' };
const CUSTOMER = { email: 'demo.customer@dispatch.test', password: 'Customer@12345' };

const PICKUP = { address: 'Ring Road, Oba Ovonramwen Square, Benin City', lat: 6.3329, lng: 5.6221 };
const DEST = { address: 'Ugbowo-Lagos Road, Benin City', lat: 6.3960, lng: 5.6110 };

async function call(path, { method = 'GET', token, body } = {}) {
  const started = performance.now();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, ms: performance.now() - started, body: text ? JSON.parse(text) : null };
}

const login = (identifier, password, audience) =>
  call('/auth/login', { method: 'POST', body: { identifier, password, audience } }).then((r) => {
    if (r.status !== 201 && r.status !== 200) throw new Error(`login ${identifier} failed: ${r.status}`);
    return r.body.accessToken;
  });

const percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

/** Fire `count` requests, `concurrency` at a time, and summarise. */
async function burst(label, count, makeRequest) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, count) }, async () => {
    while (index < count) {
      const mine = index++;
      results.push(await makeRequest(mine).catch((error) => ({ status: 0, ms: 0, error: String(error) })));
    }
  });
  const started = performance.now();
  await Promise.all(workers);
  const wallMs = performance.now() - started;

  const ok = results.filter((r) => r.status >= 200 && r.status < 400);
  const limited = results.filter((r) => r.status === 429);
  const failed = results.filter((r) => r.status >= 500 || r.status === 0);
  const timings = ok.map((r) => r.ms);

  const summary = {
    label,
    requests: count,
    ok: ok.length,
    rateLimited: limited.length,
    failed: failed.length,
    wallMs: Math.round(wallMs),
    rps: Math.round((count / wallMs) * 1000),
    p50: Math.round(percentile(timings, 50)),
    p95: Math.round(percentile(timings, 95)),
    max: Math.round(Math.max(0, ...timings)),
  };
  console.log(
    `  ${label.padEnd(28)} ${String(summary.requests).padStart(4)} req · ${String(summary.rps).padStart(4)} rps · ` +
      `p50 ${String(summary.p50).padStart(4)} ms · p95 ${String(summary.p95).padStart(4)} ms · ` +
      `${summary.failed ? `✗ ${summary.failed} failed` : '✓ no 5xx'}${summary.rateLimited ? ` · ${summary.rateLimited} rate-limited` : ''}`,
  );
  return summary;
}

async function main() {
  console.log(`Load smoke against ${API} (concurrency ${CONCURRENCY})\n`);

  const adminToken = await login(ADMIN.email, ADMIN.password, 'ADMIN');
  const customerToken = await login(CUSTOMER.email, CUSTOMER.password, 'CUSTOMER');

  const results = [];

  results.push(
    await burst('public health/liveness', CONCURRENCY * 2, () => call('/health/live')),
  );

  results.push(
    await burst('address autocomplete', CONCURRENCY, (i) =>
      call(`/maps/places?q=${['lekki', 'yaba', 'ikoyi', 'surulere'][i % 4]}`),
    ),
  );

  results.push(
    await burst('quotes (pricing engine)', CONCURRENCY, () =>
      call('/deliveries/quote', {
        method: 'POST',
        token: customerToken,
        body: {
          deliveryType: 'STANDARD',
          pickup: { ...PICKUP, contactName: 'Load Smoke', contactPhone: '+2348039876543' },
          destination: { ...DEST, contactName: 'Load Smoke', contactPhone: '+2348069876543' },
          packageCategory: 'DOCUMENTS',
          packageWeightKg: 0.5,
        },
      }),
    ),
  );

  results.push(
    await burst('staff dashboard reads', Math.round(CONCURRENCY / 2), () =>
      call('/admin/dispatch/board', { token: adminToken }),
    ),
  );

  /* ── the report question ──────────────────────────────────────────────────── */
  console.log('\n  While a report renders, is the API still answering?');
  const from = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const to = new Date().toISOString();
  const queued = await call('/admin/reports', {
    method: 'POST',
    token: adminToken,
    body: { type: 'DAILY_DELIVERIES', format: 'PDF', from, to },
  });
  if (queued.status !== 201) throw new Error(`could not queue a report: ${queued.status}`);

  const probes = [];
  let status = queued.body.status;
  for (let attempt = 0; attempt < 40 && status !== 'READY' && status !== 'FAILED'; attempt += 1) {
    probes.push(await call('/health/live'));
    probes.push(await call('/admin/dispatch/board', { token: adminToken }));
    const job = await call(`/admin/reports/${queued.body.id}`, { token: adminToken });
    status = job.body.status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const probeTimes = probes.map((probe) => probe.ms);
  const worst = Math.round(Math.max(0, ...probeTimes));
  const reportQueuedMs = Math.round(queued.ms);

  console.log(
    `  queue response ${reportQueuedMs} ms · report ${status} · ${probes.length} probes during render · ` +
      `p95 ${Math.round(percentile(probeTimes, 95))} ms · worst ${worst} ms`,
  );

  const failures = results.filter((result) => result.failed > 0);
  const blocked = worst > 2000;
  console.log('\nVerdict');
  console.log(`  ${failures.length === 0 ? '✓' : '✗'} no 5xx under burst`);
  console.log(`  ${blocked ? '✗' : '✓'} the API kept answering while a report rendered (worst ${worst} ms)`);
  console.log(`  ${reportQueuedMs < 2000 ? '✓' : '✗'} queueing a report did not wait for the file (${reportQueuedMs} ms)`);

  if (failures.length > 0 || blocked || reportQueuedMs >= 2000) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
