import { Link } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';

/** Split-screen shell for every authentication screen. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-50 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      <aside className="relative hidden overflow-hidden bg-brand-950 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link to="/" className="flex items-center gap-3">
          <BrandMark size="md" />
          <span className="text-lg font-bold text-white">Traders Welfare Logistics</span>
        </Link>

        <div>
          <h2 className="text-3xl font-bold leading-tight text-white">
            Every delivery,
            <br />
            <span className="text-accent-400">under control.</span>
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-brand-300">
            One account, one source of truth. Book riders, track packages live and manage the whole operation from
            the same platform.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-brand-200">
            {[
              'Prices calculated on the server, never in the browser',
              'Rider locations shared only while online and on a delivery',
              'Every financial action written to an auditable ledger',
            ].map((item) => (
              <li key={item} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-brand-400">Benin City, Edo State · Naira (₦) · Africa/Lagos</p>
      </aside>

      <main className="flex min-h-screen flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-brand-700 lg:hidden">
            ← Traders Welfare Logistics
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-ink-600">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
