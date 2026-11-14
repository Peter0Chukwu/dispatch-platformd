import { Link } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';

/** 404. Plain words, one way out. */
export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-950 px-5 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <BrandMark size="lg" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">Page not found</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          This page has moved or never existed
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-brand-300">
          Check the link, or start again from the home page — your account and deliveries are untouched.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex h-11 items-center rounded-xl bg-accent-500 px-5 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Back to home
          </Link>
          <Link
            to="/app"
            className="inline-flex h-11 items-center rounded-xl border border-brand-700 px-5 text-sm font-semibold text-brand-100 transition-colors hover:border-brand-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            My deliveries
          </Link>
        </div>
      </div>
    </div>
  );
}
