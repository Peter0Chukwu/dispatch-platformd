import { Link } from 'react-router-dom';
import { Badge } from '../components/ui';
import { useHealth } from '../hooks/useHealth';

const PORTALS = [
  {
    to: '/app',
    name: 'Customer',
    tagline: 'Book a rider, track your package, pay securely.',
    phase: 'Live tracking',
    accent: 'from-accent-500 to-accent-700',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z" />
        <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      </svg>
    ),
  },
  {
    to: '/rider',
    name: 'Rider',
    tagline: 'Accept deliveries, navigate, get paid.',
    phase: 'Jobs & earnings',
    accent: 'from-brand-600 to-brand-800',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M8.5 17.5h7l-2-9h-4l-2 9Zm4-9V5h4" />
      </svg>
    ),
  },
  {
    to: '/admin',
    name: 'Admin',
    tagline: 'Live operations, finance, riders and reports.',
    phase: 'Operations & finance',
    accent: 'from-ink-700 to-ink-900',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 4-6" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  const health = useHealth();

  return (
    <div className="min-h-screen bg-brand-950">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500 text-brand-950">
              <svg width="24" height="24" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 23h20M10 23v-9h8l5 5v4" />
                <circle cx="12" cy="25" r="1.6" fill="currentColor" stroke="none" />
                <circle cx="22" cy="25" r="1.6" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <div>
              <p className="text-lg font-bold text-white">Dispatch Platform</p>
              <p className="text-xs text-brand-300">Rider &amp; logistics management · Lagos, Nigeria</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <HealthBadge
              state={health.isPending ? 'loading' : health.isError ? 'down' : health.data.status}
              detail={health.data ? `API ${health.data.version} · DB ${health.data.checks.database.latencyMs}ms` : undefined}
            />
            <Link
              to="/styleguide"
              className="rounded-lg border border-brand-700 px-3 py-2 text-sm font-medium text-brand-200 transition-colors hover:border-brand-500 hover:text-white"
            >
              Design system
            </Link>
          </div>
        </header>

        <section className="mt-14 max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            One platform.
            <br />
            <span className="text-accent-400">Three portals.</span> One database.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-brand-200 sm:text-lg">
            Customer bookings, rider operations and administrative control all read from and write to the same
            PostgreSQL database through the same authenticated API. Every figure on every screen is computed from real
            records — no placeholder statistics.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge tone="brand">NestJS 11 · Prisma 6 · PostgreSQL 17</Badge>
            <Badge tone="brand">React 19 · TanStack Query · Tailwind</Badge>
            <Badge tone="brand">Naira (₦) · Africa/Lagos</Badge>
          </div>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {PORTALS.map((portal) => (
            <Link
              key={portal.to}
              to={portal.to}
              className="group relative overflow-hidden rounded-2xl border border-brand-800 bg-brand-900/60 p-5 transition-all hover:-translate-y-0.5 hover:border-brand-600"
            >
              <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${portal.accent} text-white`}>
                {portal.icon}
              </div>
              <p className="text-base font-semibold text-white">{portal.name} portal</p>
              <p className="mt-1 text-sm leading-relaxed text-brand-300">{portal.tagline}</p>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-brand-400">
                Built in {portal.phase}
              </p>
              <span className="absolute right-5 top-5 text-brand-500 transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-brand-800 bg-brand-900/40 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-brand-300">Live system checks</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Check label="API" ok={!health.isError} value={health.data?.environment ?? '—'} />
            <Check
              label="PostgreSQL"
              ok={health.data?.checks.database.ok}
              value={health.data ? `${health.data.checks.database.latencyMs}ms` : '—'}
            />
            <Check
              label="Redis"
              ok={health.data?.checks.redis.ok}
              value={health.data ? `${health.data.checks.redis.latencyMs}ms` : '—'}
            />
            <Check
              label="Uptime"
              ok={!!health.data}
              value={health.data ? formatUptime(health.data.uptimeSeconds) : '—'}
            />
          </div>
          <p className="mt-4 text-xs text-brand-400">
            These values come from <code className="rounded bg-brand-950 px-1 py-0.5 text-brand-300">GET /api/v1/health</code>,
            which queries the database and Redis on every request.
          </p>
        </section>

        <footer className="mt-12 border-t border-brand-800 pt-6 text-xs text-brand-400">
          Built through Phase 8 — authentication, bookings, dispatch, rider jobs, payments and the double-entry
          ledger, and live tracking with a public share link. Reports and deployment hardening are next.
        </footer>
      </div>
    </div>
  );
}

function HealthBadge({ state, detail }: { state: 'loading' | 'down' | 'ok' | 'degraded'; detail?: string }) {
  const map = {
    loading: { text: 'Checking…', cls: 'bg-brand-800 text-brand-200' },
    down: { text: 'API unreachable', cls: 'bg-danger-500/20 text-danger-200 ring-1 ring-danger-500/40' },
    ok: { text: 'All systems operational', cls: 'bg-accent-500/15 text-accent-300 ring-1 ring-accent-500/40' },
    degraded: { text: 'Degraded', cls: 'bg-warning-500/20 text-warning-200 ring-1 ring-warning-500/40' },
  }[state];
  return (
    <span className={`hidden items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium sm:flex ${map.cls}`} title={detail}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {map.text}
    </span>
  );
}

function Check({ label, ok, value }: { label: string; ok?: boolean; value: string }) {
  return (
    <div className="rounded-xl border border-brand-800 bg-brand-950/50 px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-brand-300">{label}</span>
        <span
          className={`h-2 w-2 rounded-full ${ok === undefined ? 'bg-brand-600' : ok ? 'bg-accent-400' : 'bg-danger-400'}`}
        />
      </div>
      <p className="mt-1.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
