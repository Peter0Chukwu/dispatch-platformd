import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';

/**
 * A human-readable index at the API root.
 *
 * Why this exists: `/` used to answer `404 {"code":"NOT_FOUND"}`. The API is
 * JSON-only, which is fine for machines but looks like a broken deployment to
 * anyone who opens the host in a browser (including a preview panel).
 *
 * The page is not a mock-up: the dependency checks are executed on every request,
 * and the route table is read from the router that Nest actually built — if a
 * route is added or removed, this page changes with it.
 */

type Check = { ok: boolean; latencyMs: number };

export interface RenderIndexOptions {
  appName: string;
  apiPrefix: string;
  nodeEnv: string;
  apiPort: number;
  startedAt: number;
  checks: { database: Check; redis: Check };
  routes: Array<{ method: string; path: string }>;
  integrations: Record<string, string>;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Reads the routes Nest registered, straight from the underlying Express router. */
export function collectRoutes(app: INestApplication): Array<{ method: string; path: string }> {
  // Express 5 exposes `router`; Express 4 exposed `_router`. Support both rather
  // than pinning this to whichever version happens to be installed.
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = instance.router?.stack ?? instance._router?.stack ?? [];

  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>) {
    if (!layer.route) continue;
    const { path, methods } = layer.route;
    // Skip this page's own handler: it is not part of the API surface.
    if (path === '/' || path === '') continue;
    for (const [method, enabled] of Object.entries(methods)) {
      if (!enabled || method === '_all') continue;
      routes.push({ method: method.toUpperCase(), path });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

export function renderIndexPage(options: RenderIndexOptions): string {
  const { database, redis } = options.checks;
  const healthy = database.ok && redis.ok;
  const uptime = Math.floor((Date.now() - options.startedAt) / 1000);
  const uptimeText =
    uptime >= 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : uptime >= 60 ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : `${uptime}s`;

  const pill = (ok: boolean, label: string, detail: string) => `
      <span class="pill ${ok ? 'ok' : 'bad'}">
        <span class="dot"></span>${escapeHtml(label)}
        <span class="pill-detail">${escapeHtml(detail)}</span>
      </span>`;

  const groups = new Map<string, Array<{ method: string; path: string }>>();
  for (const route of options.routes) {
    // Group by the first path segment after the prefix: /api/v1/auth/... → auth
    const rest = route.path.replace(new RegExp(`^/${options.apiPrefix}/?`), '');
    const group = rest.split('/')[0] || 'root';
    groups.set(group, [...(groups.get(group) ?? []), route]);
  }

  const groupRows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, routes]) => {
      const rows = routes
        .map(
          (route) => `<tr>
            <td class="method m-${route.method.toLowerCase()}">${route.method}</td>
            <td class="path"><code>${escapeHtml(route.path)}</code></td>
          </tr>`,
        )
        .join('');
      return `<tr class="group"><td colspan="2">${escapeHtml(group)}</td></tr>${rows}`;
    })
    .join('');

  const integrationList = Object.entries(options.integrations)
    .map(([name, mode]) => `<li><strong>${escapeHtml(name)}</strong> <span class="mode">${escapeHtml(mode)}</span></li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.appName)} API</title>
<style>
  :root { --ink:#0F172A; --muted:#64748B; --line:#E2E8F0; --brand:#0B1F3A; --accent:#039855; --danger:#D92D20; }
  * { box-sizing: border-box; }
  body { margin:0; background:#F8FAFC; color:var(--ink);
         font:15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 40px 24px 64px; }
  header { border-left: 4px solid var(--accent); padding-left: 16px; margin-bottom: 28px; }
  h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: -0.02em; }
  .sub { color: var(--muted); font-size: 14px; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 28px; }
  .pill { display:inline-flex; align-items:center; gap:8px; background:#fff; border:1px solid var(--line);
          border-radius:999px; padding:6px 14px; font-size:13px; font-weight:600; }
  .pill.ok { color:var(--accent); border-color:#C7E9D8; background:#F2FBF6; }
  .pill.bad { color:var(--danger); border-color:#F7D2CD; background:#FEF4F3; }
  .dot { width:8px; height:8px; border-radius:50%; background:currentColor; }
  .pill-detail { color:var(--muted); font-weight:500; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px 22px; margin-bottom:18px; }
  .card h2 { margin:0 0 4px; font-size:16px; }
  .card p.lead { margin:0 0 14px; color:var(--muted); font-size:13.5px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  tr.group td { background:#F1F5F9; font-weight:700; font-size:12px; text-transform:uppercase;
                letter-spacing:0.06em; color:var(--muted); padding:8px 10px; }
  td { padding:6px 10px; border-top:1px solid #F1F5F9; vertical-align:top; }
  td.method { width:74px; font:600 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:0.04em; }
  .m-get { color:#175CD3; } .m-post { color:#039855; } .m-patch,.m-put { color:#B54708; } .m-delete { color:#D92D20; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; }
  ul.integrations { list-style:none; margin:0; padding:0; display:flex; flex-wrap:wrap; gap:10px 26px; font-size:13px; }
  .mode { color:var(--muted); font-family: ui-monospace, Menlo, monospace; font-size:12px; }
  a { color:#1F3F6D; }
  .foot { color:var(--muted); font-size:12.5px; margin-top:28px; text-align:center; }
  .hint { background:#EEF8FF; border:1px solid #B2DDFF; color:#175CD3; border-radius:12px;
          padding:12px 14px; font-size:13px; margin-bottom:18px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>${escapeHtml(options.appName)} — API</h1>
      <p class="sub">NestJS REST API · prefix <code>/${escapeHtml(options.apiPrefix)}</code> · port ${options.apiPort} · ${escapeHtml(options.nodeEnv)}</p>
    </header>

    <div class="pills">
      ${pill(healthy, healthy ? 'All dependencies healthy' : 'Degraded', `${healthy ? '' : 'check below · '}uptime ${uptimeText}`)}
      ${pill(database.ok, 'PostgreSQL', database.ok ? `${database.latencyMs} ms` : 'unreachable')}
      ${pill(redis.ok, 'Redis', redis.ok ? `${redis.latencyMs} ms` : 'unreachable')}
    </div>

    <div class="hint">
      This is an API, not a website — every endpoint below answers JSON. The machine-readable health
      check lives at <a href="/${escapeHtml(options.apiPrefix)}/health">/${escapeHtml(options.apiPrefix)}/health</a>.
      The customer, rider and admin screens run on the web app (port 5173 when it is started).
    </div>

    <div class="card">
      <h2>External services</h2>
      <p class="lead">Reported by the server's own configuration, not by the page.</p>
      <ul class="integrations">${integrationList}</ul>
    </div>

    <div class="card">
      <h2>Routes the server actually registered (${options.routes.length})</h2>
      <p class="lead">Read from the live router at request time, so this list cannot drift from the code.</p>
      <table>
        ${groupRows}
      </table>
    </div>

    <p class="foot">
      Generated per request by <code>src/common/api-index-page.ts</code> · checks run against
      PostgreSQL and Redis every time this page is loaded.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Registers the index page at `/` on any booted application.
 *
 * Called from `main.ts` and from the test helper, so the page is exercised by the
 * suite instead of only existing in the production bootstrap path.
 */
export function registerIndexPage(
  app: INestApplication,
  options: { appName: string; apiPrefix: string; nodeEnv: string; apiPort: number },
): void {
  const startedAt = Date.now();
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const express = app.getHttpAdapter().getInstance() as {
    get(path: string, handler: (req: unknown, res: IndexResponse) => void): void;
  };

  express.get('/', (_req: unknown, res: IndexResponse) => {
    void (async () => {
      const [database, redisCheck] = await Promise.all([prisma.ping(), redis.ping()]);
      const checks = { database, redis: redisCheck };
      res
        .type('html')
        .set('Cache-Control', 'no-store')
        .send(
          renderIndexPage({
            ...options,
            startedAt,
            checks,
            routes: collectRoutes(app),
            // The page only ever states what the server is configured to use.
            integrations: {
              payments: process.env.PAYMENTS_MODE ?? 'DEVELOPMENT',
              maps: process.env.MAPS_PROVIDER ?? 'STUB',
              sms: process.env.SMS_MODE ?? 'CONSOLE',
              email: process.env.EMAIL_MODE ?? 'CONSOLE',
            },
          }),
        );
    })();
  });
}

interface IndexResponse {
  type(value: string): IndexResponse;
  set(field: string, value: string): IndexResponse;
  send(body: string): void;
}
