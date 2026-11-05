# Dispatch & Logistics Platform

A complete dispatch-rider and logistics management platform for a Nigerian dispatch company:
**Customer portal · Rider portal · Admin command centre** — one backend, one database, real records.

> **Current status: Phase 5 complete** — foundation, authentication/RBAC, customer booking with a
> server-side pricing engine, the rider portal (onboarding, offer race, delivery workflow, earnings ledger),
> and now the **admin command centre**: a live dashboard computed entirely in SQL, a delivery board with
> manual assignment and cancellation, rider and customer management, pricing, staff & roles, and the audit
> trail. 172 automated tests passing. Phase 6 (dispatch engine) is next.
>
> Phase logs: [`PHASE-1`](documentation/PHASE-LOG/PHASE-1.md) · [`PHASE-2`](documentation/PHASE-LOG/PHASE-2.md)
> · [`PHASE-3`](documentation/PHASE-LOG/PHASE-3.md) · [`PHASE-4`](documentation/PHASE-LOG/PHASE-4.md)
> · [`PHASE-5`](documentation/PHASE-LOG/PHASE-5.md)
> · Visual build report: [`documentation/BUILD-REPORT.html`](documentation/BUILD-REPORT.html)

## Documentation

| Document | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, portal communication, API surface, folder structure, 10-phase roadmap, external services, risks |
| [`docs/DATABASE-DRAFT.prisma`](docs/DATABASE-DRAFT.prisma) | The full database design (review copy) |
| [`documentation/PHASE-LOG/PHASE-5.md`](documentation/PHASE-LOG/PHASE-5.md) | Phase 5: admin command centre — dashboard, deliveries, riders, customers, pricing, staff, audit |
| [`documentation/PHASE-LOG/PHASE-4.md`](documentation/PHASE-LOG/PHASE-4.md) | Phase 4: rider portal, the offer race, the delivery workflow, earnings |
| [`documentation/PHASE-LOG/PHASE-3.md`](documentation/PHASE-LOG/PHASE-3.md) | Phase 3: pricing engine, booking API, cancellation — how a price is built |
| [`documentation/PHASE-LOG/PHASE-2.md`](documentation/PHASE-LOG/PHASE-2.md) | Phase 2: auth, sessions, RBAC, audit — files, endpoints, tests, bugs fixed |
| [`documentation/PHASE-LOG/PHASE-1.md`](documentation/PHASE-LOG/PHASE-1.md) | Phase 1: schema, seed, API shell, design system |
| [`documentation/BUILD-REPORT.html`](documentation/BUILD-REPORT.html) | Self-contained visual report with real screenshots |

## How to see what has been built

1. **Live preview panel** — any server I start (web app on port 5173, API on port 4000) appears there as a
   clickable live app. A `localhost` link only works *inside* the sandbox, never from your own computer.
2. **`documentation/BUILD-REPORT.html`** — a single self-contained page with real screenshots and live
   database statistics. Opens in the file viewer; needs no server and no network.
3. **`screenshots/`** — the individual PNGs (regenerate with `node scripts/capture-screenshots.mjs`).

A cold sandbox (new session) loses installed packages and running processes, never your code.
`npm run setup` rebuilds everything in one command.

## Quick start

```bash
npm run env:up        # start PostgreSQL 17 + Redis 8 (installs them if missing)
npm install           # install workspace dependencies
npm run db:migrate    # apply migrations
npm run db:seed       # seed roles, permissions, ledger accounts, zones, pricing, super admin
npm run dev           # API → http://localhost:4000 · Web → http://localhost:5173
```

Then open:
- **http://localhost:5173** — portal landing page with live system checks
- **http://localhost:5173/styleguide** — the design system
- **http://localhost:4000/** — the API index: live Postgres/Redis checks and every route the server registered
- **http://localhost:4000/api/v1/health** — the same checks as JSON

```bash
npm test              # 149 tests (dispatch race, rider workflow, admin review, pricing, booking, auth, RBAC)
./scripts/smoke.sh    # end-to-end smoke check of a running stack
```

## Layout

```
frontend/            React 19 + TypeScript + Vite + Tailwind  (3 portals, 20 UI components)
backend/             NestJS 11 + Prisma 6                    (REST API, ready for Socket.IO + BullMQ)
packages/shared/      Zod schemas, enums, state machine, kobo money helpers — used by both sides
documentation/        Architecture, phase logs, runbook (coming)
scripts/              dev-environment + smoke-test scripts
docs/                 Architecture and database design
```

## Conventions you must not break

1. **Money is integer kobo.** ₦1,500.00 = `150000`. No floats, ever (`packages/shared/src/money.ts`).
2. **The backend is the authority.** Frontend validation is UX; Zod schemas run again on the server.
3. **Status changes go through the shared state machine** (`packages/shared/src/state-machine.ts`).
4. **Secrets live in `backend/.env` only** — never in frontend code, never committed.
5. **Nothing fake.** If a feature is not built, the UI says so; it does not show invented numbers.
6. **Access tokens live in memory, refresh tokens in HttpOnly cookies.** Never put a token in
   `localStorage` — that is one XSS away from a full account takeover.
7. **Every new route must declare its permissions.** The global guards require auth by default; use
   `@Public()` deliberately and `@RequirePermissions(...)` on anything sensitive.
8. **The client never sends a price.** The server quotes, recalculates on confirm, and freezes the
   breakdown onto the row. Never trust an amount that arrived over HTTP.

## Environment notes (this sandbox)

PostgreSQL and Redis run natively (no Docker here). Their data directories are outside the
project, so **run `npm run env:up` at the start of each session** — migrations and seed rebuild
the schema in seconds.
