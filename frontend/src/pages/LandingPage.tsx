import { Link } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';

/**
 * The public front door.
 *
 * Two doors, not three: a stranger can sign up to send, or sign up to ride.
 * Staff arrive by invitation, so there is no "admin login" here to tempt anyone.
 *
 * This page is written for the customer standing in Ring Road market with a
 * parcel in their hand — not for a developer reading the repository.
 */

const STEPS = [
  {
    number: '1',
    title: 'Tell us where it is going',
    body: 'Pickup, drop-off and a photo of the parcel. The price appears before you pay anything — no haggling at the door.',
  },
  {
    number: '2',
    title: 'A nearby rider accepts',
    body: 'Riders within 10–20 km of your pickup are alerted. The first to accept is the one who comes.',
  },
  {
    number: '3',
    title: 'Follow it to the doorstep',
    body: 'Live map, status updates at every step, and a photo taken at handover so you know it arrived.',
  },
];

const REASONS = [
  {
    title: 'The price before you pay',
    body: 'Your fare is worked out from the real distance and your zone, and shown in full before you confirm. What you see is what you pay.',
  },
  {
    title: 'Riders we have checked',
    body: 'Every rider uploads their details and documents, and a person reviews them. Nobody rides for us unverified.',
  },
  {
    title: 'Your number stays yours',
    body: 'Call or chat your rider from inside the app. Neither side ever sees the other’s phone number, and that does not change after delivery.',
  },
  {
    title: 'Proof at handover',
    body: 'The rider photographs the handover and the recipient signs off with a code, so “it was delivered” is something you can check.',
  },
];

const AREAS = [
  { name: 'City centre', detail: 'Ring Road, New Benin, Akpakpava, GRA, Siluko Road' },
  { name: 'Ugbowo', detail: 'UNIBEN, UBTH, Uselu and the Lagos Road corridor' },
  { name: 'Ikpoba Hill', detail: 'Ikpoba Hill, Aduwawa and the Benin–Auchi Road' },
  { name: 'Sapele Road', detail: 'Airport Road, Sapele Road and Oregbeni' },
];

const FAQS = [
  {
    q: 'How is the price decided?',
    a: 'From where the rider picks up and where they drop off: a base fare for the zone, plus a rate per kilometre, plus anything extra you choose — express, same-day or an additional stop. It is calculated before you confirm, so there are no surprises later.',
  },
  {
    q: 'How quickly will a rider come?',
    a: 'Riders near your pickup are alerted the moment you book. In most parts of Benin City a rider accepts within a few minutes; if nobody accepts, the request widens to more riders and you are told what is happening.',
  },
  {
    q: 'Do I need an account to send a package?',
    a: 'Yes, and it takes under a minute to create. It is what keeps your addresses, receipts and delivery history in one place — and it is how we know who to call if something goes wrong.',
  },
  {
    q: 'Can the person receiving the package follow it too?',
    a: 'Yes. Share the tracking link from your delivery page and they can watch the rider move without seeing your account or your number.',
  },
  {
    q: 'What happens if something is damaged or missing?',
    a: 'Open the delivery in your account and report it. Every step — who picked it up, when it moved, the handover photo — is recorded against that delivery, so complaints are settled from facts rather than argument.',
  },
];

const PORTALS = [
  {
    to: '/register',
    signIn: '/login?portal=customer',
    name: 'Send a package',
    cta: 'Sign up as a Customer',
    tagline: 'Book a rider, watch your parcel move, and pay only what you were quoted.',
    points: ['Photo your parcel and book in a minute', 'Follow the rider live on the map', 'Chat or call without sharing your number'],
    accent: 'from-accent-500 to-accent-700',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    tagline: 'Take jobs near you, accept or decline freely, and withdraw your earnings whenever you like.',
    points: ['Jobs offered within 10–20 km of you', 'Documents reviewed once, by a person', 'Earnings in your wallet, ready to withdraw'],
    accent: 'from-brand-600 to-brand-800',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="17.5" r="3.5" />
        <circle cx="18.5" cy="17.5" r="3.5" />
        <path d="M8.5 17.5h7l-2-9h-4l-2 9Zm4-9V5h4" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-brand-950">
      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <header className="border-b border-brand-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-3">
            <BrandMark size="md" />
            <span className="leading-tight">
              <span className="block text-sm font-bold text-white sm:text-base">Traders Welfare Logistics</span>
              <span className="block text-[11px] text-brand-300">Benin City, Edo State</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              to="/login?portal=customer"
              className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-brand-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="inline-flex h-10 items-center rounded-xl bg-accent-500 px-4 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Book a delivery
            </Link>
          </nav>
        </div>
      </header>

      {/* ── hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pt-14 pb-4 sm:pt-20">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-400">Same-day delivery in Benin City</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl">
          Send it across town,
          <br />
          <span className="text-accent-400">without sending it with a stranger.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-brand-200 sm:text-lg">
          A rider collects from your shop, market stall or home and takes it where it is going — with the fare agreed
          before you pay, the rider’s details checked before they ride, and the whole journey visible from your phone.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-12 items-center rounded-xl bg-accent-500 px-6 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Send a package
          </Link>
          <Link
            to="/register-rider"
            className="inline-flex h-12 items-center rounded-xl border border-brand-700 px-6 text-sm font-semibold text-brand-100 transition-colors hover:border-brand-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            Ride with us
          </Link>
        </div>

        <p className="mt-6 text-sm text-brand-400">
          Covering Ring Road · Ugbowo · Ikpoba Hill · Sapele Road and the streets between them
        </p>
      </section>

      {/* ── how it works ────────────────────────────────────────────────── */}
      <section aria-labelledby="how-it-works" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <h2 id="how-it-works" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Three steps, one rider
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="rounded-2xl border border-brand-800 bg-brand-900/40 p-5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/15 text-sm font-bold text-accent-300">
                {step.number}
              </span>
              <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-300">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── why us ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="why-us" className="border-y border-brand-900/80 bg-brand-900/20">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <h2 id="why-us" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Why traders ride with us
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {REASONS.map((reason) => (
              <div key={reason.title} className="flex gap-3.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{reason.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-brand-300">{reason.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── coverage ────────────────────────────────────────────────────── */}
      <section aria-labelledby="coverage" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="coverage" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Where we deliver
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-brand-300">
              Our riders work Benin City and the roads out of it. If your street is not listed, book anyway — the fare is
              worked out from the actual distance.
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AREAS.map((area) => (
            <div key={area.name} className="rounded-2xl border border-brand-800 bg-brand-900/40 p-5">
              <p className="text-sm font-semibold text-white">{area.name}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-brand-300">{area.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── the two doors ───────────────────────────────────────────────── */}
      <section aria-labelledby="join" className="border-t border-brand-900/80 bg-brand-900/20">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <h2 id="join" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Two ways in
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {PORTALS.map((portal) => (
              <div key={portal.to} className="rounded-2xl border border-brand-800 bg-brand-900/60 p-5">
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
          </div>
        </div>
      </section>

      {/* ── questions ───────────────────────────────────────────────────── */}
      <section aria-labelledby="questions" className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
        <h2 id="questions" className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Questions people ask
        </h2>
        <div className="mt-6 divide-y divide-brand-800 border-y border-brand-800">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-white marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
                {faq.q}
                <span className="shrink-0 text-brand-400 transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-2.5 text-sm leading-relaxed text-brand-300">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── closing ─────────────────────────────────────────────────────── */}
      <section className="border-t border-brand-900/80 bg-brand-900/30">
        <div className="mx-auto max-w-6xl px-5 py-14 text-center sm:py-16">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Ready when you are</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-brand-300">
            Create an account in a minute and send your first package today. Riders earn on every completed delivery and
            withdraw from their wallet whenever they choose.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex h-12 items-center rounded-xl bg-accent-500 px-6 text-sm font-semibold text-brand-950 transition-colors hover:bg-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Send a package
            </Link>
            <Link
              to="/register-rider"
              className="inline-flex h-12 items-center rounded-xl border border-brand-700 px-6 text-sm font-semibold text-brand-100 transition-colors hover:border-brand-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              Become a rider
            </Link>
          </div>
        </div>
      </section>

      {/* ── footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-brand-900/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <div>
              <p className="text-sm font-semibold text-white">Traders Welfare Logistics</p>
              <p className="text-xs text-brand-400">Benin City, Edo State · Prices in naira (₦)</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-brand-300">
            <Link to="/login?portal=customer" className="transition-colors hover:text-white">
              Customer sign in
            </Link>
            <Link to="/login?portal=rider" className="transition-colors hover:text-white">
              Rider sign in
            </Link>
            <span className="text-brand-500">Staff access is by invitation</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
