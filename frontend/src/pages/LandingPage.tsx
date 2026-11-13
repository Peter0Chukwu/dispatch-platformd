import { Link } from 'react-router-dom';
import { Badge } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { useHealth } from '../hooks/useHealth';

/**
 * TWO DOORS, NOT THREE.
 *
 * The admin portal used to be advertised here like any other way in. Staff are
 * not the public: they arrive by invitation, and an "Admin portal" tile on the
 * front page is an invitation to try. What is left is what a stranger can
 * legitimately do — sign up to send, or sign up to ride.
 */
const PORTALS = [
  {
    to: '/register',
    signIn: '/login?portal=customer',
    name: 'Send a package',
    cta: 'Sign up as a Customer',
    tagline: 'Book a rider, watch your package move, pay securely.',
    points: ['Photo your parcel, riders nearby are alerted', 'Track live from pickup to doorstep', 'Chat and call without swapping numbers'],
    accent: 'from-accent-500 to-accent-700',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Z" />
        <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      </svg>
    ),
  },
  {
    to: '/register-rider',
    signIn: '/login?portal=rider',
    name: 'Earn on the road',
    cta: 'Sign up as a Rider',
    tagline: 'Get jobs near you, accept or decline, get paid into your wallet.',
    points: ['Offers within 10–20 km of where you are', 'Your documents reviewed once, by a person', 'Withdraw earnings whenever you like'],
    accent: 'from-brand-600 to-brand-800',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M8.5 17.5h7l-2-9h-4l-2 9Zm4-9V5h4" />
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
            <BrandMark size="lg" />
            <div>
              <p className="text-lg font-bold text-white">Traders Welfare Logistics</p>
              <p className="text-xs text-brand-300">Rider &amp; logistics management · Benin City, Edo State</p>
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
            Send a package,
            <br />
            <span className="text-accent-400">or deliver one.</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-brand-200 sm:text-lg">
            Book a rider in a few taps, or earn by riding for us. Both sides of every delivery read from and write to
            the same database through the same authenticated API, so the price you are quoted is the price the rider is
            paid against — computed from real records, never placeholder figures.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Badge tone="brand">NestJS 11 · Prisma 6 · PostgreSQL 17</Badge>
            <Badge tone="brand">React 19 · TanStack Query · Tailwind</Badge>
            <Badge tone="brand">Naira (₦) · Africa/Lagos</Badge>
          </div>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          {PORTALS.map((portal) => (
            <div
              key={portal.to}
              className="relative overflow-hidden rounded-2xl border border-brand-800 bg-brand-900/60 p-5"
            >
              <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${portal.accent} text-white`}>
                {portal.icon}
              </div>
              <p className="text-base font-semibold text-white">{portal.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-brand-300">{portal.tagline}</p>
              <ul className="mt-3 space-y-1.5 text-[13px] text-brand-200">
                {portal.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-400" />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Link
                  to={portal.to}
                  className="inline-flex h-10 items-center rounded-xl bg-accent-500 px-4 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {portal.cta}
                </Link>
                <Link
                  to={portal.signIn}
                  className="inline-flex h-10 items-center rounded-xl border border-brand-700 px-4 text-sm font-medium text-brand-200 transition-colors hover:border-brand-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  Sign in
                </Link>
              </div>
            </div>
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
          Traders Welfare Logistics · Benin City, Edo State · Prices in Naira, times in Africa/Lagos. Staff accounts are
          created by invitation from a super admin — there is no public way in.
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
