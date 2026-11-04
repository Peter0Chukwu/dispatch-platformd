# Phase 1 — Foundation, Database & Design System

**Date completed:** 4 November 2026
**Status:** ✅ Complete — all checks pass. Awaiting approval to begin Phase 2.

---

## 1. What now exists (in plain language)

You have a real, running full-stack system:

- A **PostgreSQL 17 database** with 49 tables, 43 enums, 147 indexes and hard database-level guards on money.
- A **NestJS API** (TypeScript) that boots only if its configuration is valid, fingerprints every request, and answers `GET /api/v1/health` — a check that actually queries the database and Redis on every call.
- A **React + TypeScript + Tailwind frontend** with a 20-component design system and a styleguide page, wired to the API through a dev proxy (same-origin, cookie-safe).
- A **shared package** (`@dispatch/shared`) imported by *both* sides: enums, the delivery state machine, money helpers, Nigerian phone validation and Zod validation schemas. This is how the frontend and backend are prevented from disagreeing.
- **Seed data that is real configuration, not fake activity**: 37 permissions, 5 staff roles, 1 branch, 3 service zones, 1 active pricing rule, 16 ledger accounts, 16 system settings, 5 FAQs, and 1 super administrator.
- **25 automated tests** that pass against the real database and Redis.

There are **no fake customers, riders, deliveries, payments or dashboard numbers** anywhere in the system.

---

## 2. Features completed

| Area | Delivered |
|---|---|
| Infrastructure | PostgreSQL 17.11 + Redis 8.0.2 installed and started by `scripts/dev-env-up.sh` (idempotent) |
| Database | Full Prisma schema → 2 migrations applied; CHECK constraints and partial indexes added by hand |
| Seed | Idempotent seed of roles, permissions, ledger accounts, zones, pricing, settings, FAQs, super admin, wallets |
| API shell | Config validation at boot, Helmet, CORS allowlist, request-id middleware, Zod validation pipe, global error filter, structured logging, graceful shutdown, health + liveness endpoints |
| Shared package | Enums, state machine, money in kobo, NG phone normaliser, Zod schemas for auth + delivery booking, permission matrix |
| Frontend | Vite + React 19 + Tailwind design system, 20 components, styleguide, portal landing page with live system checks, dev-mode banner, API client with typed errors |
| Tooling | npm workspaces, pinned dependency versions, Vitest + Supertest wired through SWC (so NestJS DI works in tests), typecheck scripts |
| Docs | Architecture (v1.0), database draft, phase log, smoke script |

---

## 3. Files created

```
dispatch-platform/
├── package.json                     npm workspaces + root scripts
├── tsconfig.base.json               shared compiler settings
├── .env.example                     every environment variable, documented
├── .gitignore                       (includes .env — secrets never committed)
├── README.md
├── scripts/
│   ├── dev-env-up.sh                starts/installs Postgres + Redis, creates DBs
│   └── smoke.sh                     end-to-end health check
├── packages/shared/
│   ├── package.json · tsconfig.json
│   └── src/
│       ├── enums.ts                 12 shared enums + UI labels + tones
│       ├── state-machine.ts         THE delivery lifecycle transition table
│       ├── money.ts                 kobo helpers (nairaToKobo, formatNaira, percentOfKobo…)
│       ├── constants/index.ts       37 permissions, 5 roles, role→permission matrix, categories, states
│       ├── schemas/{common,auth,delivery}.ts   Zod schemas shared with the forms
│       ├── validators/phone.ts      Nigerian number normalisation → E.164
│       └── index.ts
├── backend/
│   ├── package.json · tsconfig.json · tsconfig.build.json · nest-cli.json · vitest.config.ts
│   ├── .env                         local dev secrets (GIT-IGNORED)
│   ├── prisma/
│   │   ├── schema.prisma            48 models, 43 enums
│   │   ├── migrations/
│   │   │   ├── 20261104121629_init/migration.sql
│   │   │   └── 20261104121700_integrity_constraints/migration.sql
│   │   ├── seed.ts
│   │   └── seed-data/{company,zones,ledger}.ts   ← EDIT ZONES/PRICES HERE
│   └── src/
│       ├── main.ts                  helmet, CORS, prefix, shutdown, listen 0.0.0.0
│       ├── app.module.ts            global modules + middleware
│       ├── config/{env.config,app.config,app-config.module}.ts
│       ├── common/
│       │   ├── errors/app-error.ts          AppError + error codes
│       │   ├── filters/all-exceptions.filter.ts
│       │   ├── pipes/zod-validation.pipe.ts
│       │   ├── decorators/zod.decorators.ts @ZodBody @ZodQuery @ZodParam
│       │   ├── interceptors/logging.interceptor.ts
│       │   └── middleware/request-id.middleware.ts
│       ├── infra/prisma/{prisma.service,prisma.module}.ts
│       ├── infra/redis/{redis.service,redis.module}.ts
│       └── health/{health.controller,health.module}.ts
│   └── test/
│       ├── setup-env.ts · money.spec.ts · state-machine.spec.ts
│       ├── schema-sync.spec.ts       guards Prisma ↔ shared enum drift
│       └── health.e2e.spec.ts        boots the real app, real DB, real Redis
├── frontend/
│   ├── index.html · vite.config.ts · tailwind.config.ts · postcss.config.js · tsconfig.json
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── styles/globals.css
│       ├── lib/{api.ts,queryClient.ts,cn.ts}
│       ├── hooks/useHealth.ts
│       ├── components/layout/DevModeBanner.tsx
│       ├── components/ui/           20 components + index barrel
│       └── pages/{LandingPage,StyleGuidePage,PortalPlaceholder}.tsx
└── docs/{ARCHITECTURE.md,DATABASE-DRAFT.prisma}
```

---

## 4. Database changes

**Migrations applied:** 2 (`init`, `integrity_constraints`).

**Tables (49):** users, customers, riders, staff, roles, permissions, role_permissions, staff_roles, staff_branches, refresh_tokens, verification_tokens, addresses, branches, service_zones, vehicles, rider_documents, rider_locations, deliveries, delivery_items, delivery_stops, delivery_assignments, delivery_status_history, delivery_proofs, reviews, complaints, support_tickets, ticket_messages, faqs, payments, payment_webhooks, refunds, wallets, wallet_transactions, ledger_accounts, journal_entries, ledger_lines, rider_earnings, rider_adjustments, withdrawals, pricing_rules, promotions, promo_redemptions, expenses, notifications, admin_alerts, report_requests, audit_logs, system_settings, _prisma_migrations.

**Integrity rules enforced by PostgreSQL itself (not just app code):**
- `wallets.balanceKobo >= 0` (a wallet can never go negative)
- each `ledger_lines` row is a debit XOR a credit
- `payments.amountKobo > 0`, `withdrawals.amountKobo > 0`, delivery charges ≥ 0
- `reviews.rating BETWEEN 1 AND 5`
- `rider_earnings.netKobo = gross − commission + bonus − penalty`
- partial indexes for the dispatch hot path (online+approved riders), the active-delivery queue, and scheduled pending deliveries

**Proven, not assumed:** the test *"enforces the money constraint at database level"* attempts to insert a wallet with `-1` kobo and asserts the database rejects it.

---

## 5. API endpoints created

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | Full status: DB latency, Redis latency, integration modes, uptime |
| GET | `/api/v1/health/live` | Liveness probe (no dependencies) |
| * | any unknown path | Uniform error envelope `{ error: { code, message, details, requestId, timestamp } }` |

---

## 6. Commands you need

Run these from the project root (`/home/user/dispatch-platform`):

```bash
# 1. Once per session — start PostgreSQL + Redis (installs them if missing)
npm run env:up

# 2. Install dependencies (only after a fresh clone)
npm install

# 3. Build the shared package (required before API/web; `npm run dev` does it for you)
npm run build:shared

# 4. Apply database migrations
npm run db:migrate

# 5. Seed configuration data (safe to run repeatedly)
npm run db:seed

# 6. Run both servers (API :4000, web :5173)
npm run dev

# 7. Run the API only
npm run dev:api

# 8. Run the test suite
npm test

# 9. Open the database browser (Prisma Studio)
npm run db:studio

# 10. Smoke-check a running stack
./scripts/smoke.sh
```

**Important for this sandbox:** the PostgreSQL and Redis *server processes* do not survive between sessions, and their data directories live outside the project folder. At the start of each session run `npm run env:up` — it restarts both services and re-creates the databases if they are gone. Your migration and seed scripts make the database reproducible in seconds.

### Verify it yourself

1. `npm run env:up && npm run db:migrate && npm run db:seed`
2. `npm run dev`
3. Open **http://localhost:5173** → the landing page shows four live system checks (API, PostgreSQL, Redis, uptime) reading from the real `/health` endpoint.
4. Open **http://localhost:5173/styleguide** → click *Open modal*, *Cancel delivery…* and *Show success toast*; all interactive.
5. `./scripts/smoke.sh` → prints the health JSON and the 404 contract.
6. `npm test` → 25 passing tests.

---

## 7. Decisions made this phase (and why)

| Decision | Reason |
|---|---|
| **Money stored as integer kobo (BigInt)** | Floats lose money: `0.1 + 0.2 ≠ 0.3`. Kept integer end-to-end, serialised as strings over JSON. |
| **Zod shared between frontend and backend** instead of class-validator | One definition of "valid delivery" used by the form *and* the API. Custom `ZodValidationPipe` written instead of a wrapper library — no dependency-version risk. |
| **One shared state-machine table** | The UI can only offer transitions the API accepts, and the API cannot be bypassed by a crafted request. |
| **Denormalised `deliveries.riderId` + full `delivery_assignments` history** | Fast dashboards, plus an auditable record of every offer a rider received or rejected. |
| **`branchId` on operational rows from day one** | Multi-branch later becomes data, not a refactor. |
| **npm workspaces**, no Turborepo/Nx | Already installed; a beginner can understand it. |
| **Vitest compiled through SWC** | Vitest's default esbuild transform does not emit decorator metadata, which silently breaks NestJS dependency injection in tests. SWC restores parity with the production build. |
| **Vite aliases `@dispatch/shared` → TypeScript source** | Avoids CommonJS interop issues in Rollup and gives HMR when shared schemas change. The API still consumes the compiled `dist/`. |
| **No global `ValidationPipe`** | Removed once: it pulls in `class-validator`, which we deliberately do not use. Zod pipes handle validation. |
| **Request-id as middleware, not interceptor** | Interceptors do not run for unmatched routes; middleware gives every response, including 404s, a traceable id. |
| **Honest portal placeholders** | You asked for no fake dashboards. Each portal route states its phase and plan until it is built. |

---

## 8. Issues found and fixed during the phase

1. **Prisma kept stale build output** — `incremental: true` plus `deleteOutDir` made `tsc` believe `dist/` was current after it had been deleted, so only 3 of 15 files were emitted. Removed `incremental`.
2. **NestJS DI failed under Vitest** — missing decorator metadata (see decisions table). Fixed with SWC.
3. **`AppConfig` unresolved in `HealthController`** — fixed by making it a `@Global()` module (`AppConfigModule`).
4. **Rollup could not see named exports** from the compiled shared package — fixed with the Vite source alias.
5. **Deprecated-but-harmless warning:** `package.json#prisma` seed config warns on Prisma 6.19. Will move to `prisma.config.ts` when we upgrade past Prisma 6 (not now — avoid churn).
6. **`npm audit` reports 16 advisories (4 critical) in the dev dependency tree** (transitive packages under the Nest CLI / Vite toolchain). Not shipped to production runtime, but this is logged as an open item and will be addressed in Phase 10 with `npm audit --production` review and version bumps.

---

## 9. Outstanding issues / known limitations (deliberate)

- **Postgres/Redis do not persist between sandbox sessions** — run `npm run env:up` at the start of each session (data is rebuildable from migrations + seed).
- **`docker-compose.yml` is not written yet** — scheduled for Phase 10, once there is an API worth deploying.
- **No separate test database yet** — integration tests currently run against `dispatch_dev`. Phase 2 introduces a `_test` database with per-run truncation so tests can create users without polluting development data.
- **Maps, SMS and email are all in stub/console mode** — by design until Phase 7–8. The frontend shows a permanent development-mode banner so nobody mistakes simulated behaviour for real.
- **Zones and prices are placeholders** — awaiting your real list; edit `backend/prisma/seed-data/zones.ts` and re-run `npm run db:seed` (or change them in the admin UI in Phase 5).
- **No authentication yet** — the super admin exists in the database but cannot log in until Phase 2. The API has no protected routes yet, so nothing is exposed.

---

## 10. What Phase 2 will deliver

Authentication and access control, end to end:

- Argon2id hashing, JWT access tokens (15 min) + rotating refresh tokens with reuse detection
- Email verification, phone OTP, password reset
- `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermission()`, and ownership checks derived from the seeded permission matrix
- Login / register / verify screens for all three portals, with route guards
- Audit logging of sensitive actions
- Tests: valid + invalid login, expired token, refresh rotation and reuse, rider hitting an admin endpoint (403), permission matrix per role, brute-force rate limiting (429)

**Reply "start Phase 2"** to proceed.
