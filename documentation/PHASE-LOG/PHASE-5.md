# Phase 5 — The admin command centre

**Date completed:** 5 November 2026
**Status:** ✅ Complete — 172 automated tests passing (23 new), every screen driven in a real browser
against the real API and the real database.

---

## 1. The rule that shaped this phase

> **No number on the dashboard may be typed by a developer.**

Every card, chart, table and total in the admin portal is a SQL aggregate computed at request time.
If the database is empty, the screen reads zero — which is the honest answer, and exactly how the very
first screenshot in this phase looked before any delivery existed.

The proof is in the test suite: a scenario is written straight into Postgres with known figures
(one delivered job at ₦3,201.50 with a ₦640.30 commission, one cancelled job, one job still waiting),
and the endpoint must return exactly those numbers.

```
✓ reports exactly the scenario that was written to the database
    total 3 · delivered 1 · cancelled 1 · awaiting 1 · successRate 50 · avgDeliveryMinutes 40
    gross ₦3,201.50 · commission ₦640.30 · rider net ₦2,561.20 · margin ₦640.30
✓ lists every live zone, including the quiet ones
✓ builds a daily series that agrees with the money card
✓ honours the date range instead of ignoring it
```

---

## 2. What was built

### Backend (`backend/src/admin/`)

| File | What it does |
|---|---|
| `admin-dashboard.service.ts` | `overview(range)` — status group-bys, revenue/commission sums, rider availability, zone table, a `date_trunc` daily series, average delivery minutes, latest six bookings |
| `admin-deliveries.service.ts` | `list` (search/status/rider/date + pagination), `detail` (assignments, timeline, proof), `assign` (manual or reassign), `cancel`, `exportCsv` |
| `admin-accounts.service.ts` | customers with DB-summed spend, suspend/reactivate, staff list, roles, create staff, staff suspend/reactivate |
| `admin-pricing.service.ts` | pricing rules and zones, fee edits in naira → integer kobo |
| `admin-ops.controller.ts` | 14 permission-checked routes |
| `admin.service.ts` *(extended)* | the audit trail now carries the actor's name and filters by action |

**Sixteen routes, each with its own permission.** Reading the dashboard is not the same right as
assigning a job, editing a price or suspending an account:

```
GET  /admin/dashboard              dashboard:read
GET  /admin/deliveries             delivery:read
GET  /admin/deliveries/export.csv  delivery:export
GET  /admin/deliveries/:id         delivery:read
POST /admin/deliveries/:id/assign  delivery:assign
POST /admin/deliveries/:id/cancel  delivery:cancel
GET  /admin/customers              customer:read
POST /admin/customers/:id/status   customer:suspend
GET  /admin/team                   staff:read
GET  /admin/roles                  staff:read
POST /admin/team                   staff:write
POST /admin/team/:id/status        staff:write
GET  /admin/pricing                pricing:read
POST /admin/pricing/rules/:id      pricing:write
GET  /admin/audit-logs             audit:read
GET  /admin/riders…                rider:read / rider:approve   (Phase 4, now surfaced in the UI)
```

### Frontend (`frontend/src/pages/admin/`)

| Screen | What an operator can do |
|---|---|
| **Overview** | Eight live KPI cards, a revenue/volume trend, a status breakdown, zone performance, latest bookings, and a 7/30/90-day range selector that re-queries |
| **Deliveries** | Search, filter by any of the ten statuses, page through results, open one job, assign or reassign a rider, cancel with a reason, export the filtered list to CSV |
| **Riders** | The onboarding queue by tab, one application with every document, approve/reject each document, approve/reject/suspend the rider |
| **Customers** | Search and filter accounts, lifetime spend summed from the delivery table, suspend/reactivate |
| **Pricing** | Every rule and zone, edit fees in naira, commission percentage |
| **Staff & roles** | Roster, create a staff account with roles, suspend/reactivate, and the full permission matrix |
| **Audit trail** | Filter by action, see who did what with before/after JSON |

Finance is deliberately **still a placeholder**: the ledger, wallets and withdrawals arrive in Phase 7.
Nothing is faked to fill the gap.

---

## 3. Decisions worth remembering

**Suspension has teeth.** Suspending a customer or a staff member calls
`TokenService.revokeAllForUser`, so the refresh-token family dies immediately — the person cannot keep
working on a session they already had. The test asserts both halves:

```
✓ kills the session and blocks the next sign-in until reactivated
    201 SUSPENDED · sessionsRevoked ≥ 1 · existing token now 401/403 · next login 403 "suspended"
✓ refuses to let an admin suspend themselves or the last super admin
    409 SELF_ACTION_FORBIDDEN · 409 LAST_SUPER_ADMIN
```

**Manual assignment is an override, and overrides are recorded.** A dispatcher assigning a job
expires any live offer, freezes the `commissionSnapshot` to the rider who will actually carry it,
writes a `MANUAL` assignment row, a status-history row, frees the previous rider if they have nothing
else, and writes an audit entry. Capacity and approval are checked first: `RIDER_NOT_APPROVED`,
`RIDER_INACTIVE`, `RIDER_BUSY`.

**Money is BigInt kobo everywhere.** Sums, commissions and margins are aggregated as integers and
formatted once, at the edge. Fees are *edited* in naira — what an operator thinks in — and converted
exactly once on the server.

**Rules that protect the books.** A minimum fee lower than the base fee is refused; commission above
100% is refused; negative fees are refused. The seeded rule has `min === base`, which is why the test
raises both together — the guard is deliberate, not incidental.

**CSV is a spreadsheet, not a screenshot.** Quotes are doubled, addresses containing commas stay in one
cell, money appears in both kobo and naira, and the export honours exactly the filters on screen
(`GET /admin/deliveries/export.csv?status=DELIVERED` → header + one row). Capped at 10 000 rows.

**One envelope for every admin list.** `{ data, meta: { page, pageSize, total, totalPages } }` — the
Phase 4 rider list was moved to it so the whole admin API behaves the same way.

**Charts are code-split.** Recharts is ~400 kB; the admin screens load through `React.lazy`, so a
customer or rider never downloads it. Entry bundle: 500 kB (150 kB gzip), admin overview: 402 kB on demand.

---

## 4. Bugs found and fixed while building

| Symptom | Cause | Fix |
|---|---|---|
| `Nest can't resolve dependencies of AdminAccountsService (…?, PasswordService)` | `TokenService`/`PasswordService` live in `AuthModule` | `AdminModule imports: [AuthModule]` |
| Dashboard chart showed revenue for jobs that were never delivered | the daily query summed `chargeKobo` for every status while the KPI summed only `DELIVERED` | both now filter `WHERE status = 'DELIVERED'`; a test asserts the two agree |
| `successRate` read `0%` with nothing finished | 0-of-0 was rounded into a real-looking failure rate | returns `null` → the UI shows `—` |
| Zones table vanished on a quiet day | the zone list was derived from delivered jobs | every active zone is listed, zeros included |
| Pricing update rejected with 422 | the seeded rule has `min === base`; raising the base alone breaks the floor rule | test raises both — proving the guard works |
| Latest-bookings and deliveries tables clipped their last column | too many columns for the viewport; `overflow-x-auto` hid the action button | trimmed to the columns that matter; zone/booked moved to the detail modal |

---

## 5. Verified in a real browser

`scripts/capture-phase5.mjs` signs in as the seeded super admin and drives every screen against the
running API — no stubs:

```
✓ 01-overview.png        ₦3,201.50 gross · ₦640.50 commission · 100% success · 1 delivered · 1 waiting
✓ 02-deliveries.png      both jobs, one DELIVERED with a rider, one PENDING "unassigned"
✓ 03-deliveries-filtered.png   status=PENDING → 1 row
✓ 04-delivery-detail.png timeline PENDING by customer · offer to RDR-00001 expired · Assign / Cancel
✓ 05-riders.png          approved roster
✓ 06-customers.png       1 customer, spend summed from delivered jobs
✓ 07-pricing.png         the seeded Lagos rule: ₦1,500 base, ₦130/km, 2 free km, 20% commission
✓ 08-staff.png           super admin + the permission matrix for all six roles
✓ 09-audit.png           29 real events with actor names, IPs and before/after
```

The revenue on the dashboard is there because a delivery was actually completed through the rider
portal first (`scripts/capture-phase4.mjs`), not because a number was seeded.

---

## 6. Test suite

```
Test Files  11 passed (11)
     Tests  172 passed (172)
  Duration  ~31 s
```

New this phase — `backend/test/admin.e2e.spec.ts` (18 tests) covering:

- dashboard figures against a written scenario, zone coverage, chart/KPI agreement, date-range filtering
- a support agent may read the dashboard and the delivery list, and is refused (403) on assign,
  customer suspension, pricing and staff creation — with the rows verified unchanged afterwards
- customers and riders are refused by the admin API entirely
- suspension: session revoked, sign-in blocked, reactivation works
- self-suspension and last-super-admin guards
- manual assignment: frozen commission, MANUAL/ACCEPTED row, staff history row, audit entry,
  rider becomes `ON_DELIVERY`; unapproved rider 409, finished job 409
- cancellation with a required reason; delivered jobs refuse cancellation
- CSV shape, escaping and filter fidelity
- pricing: naira → kobo conversion, audit row, and the three refusals

---

## 7. What Phase 6 does next

Phase 6 is the **dispatch engine**: automatic offer batching with real-time push, re-offer when a rider
rejects or the clock runs out, zone-aware assignment, and Socket.IO so offers appear without a refresh.
The manual override built here is the fallback for when the engine cannot place a job.
