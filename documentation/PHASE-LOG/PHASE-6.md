# Phase 6 — The dispatch engine

**Date completed:** 5 November 2026
**Status:** ✅ Complete — 193 automated tests passing (21 new), the engine driven end to end in a real
browser over a real Socket.IO connection.

---

## 1. The rule that shaped this phase

> **A booking must find a rider without anyone watching the screen.**

Phase 4 built the offer race: three riders are asked at once and exactly one can win. Phase 6 makes that
race run itself, widen when nobody answers, and — when it truly runs out of riders — say so out loud
instead of going quiet.

```
booking placed
  → round 1: nearest ≤ 5 km, 3 riders, offers pushed over the socket (+ SMS)
  → nobody accepted (expired or rejected)
  → round 2: ≤ 12 km, riders not asked in the previous round
  → round 3: ≤ 25 km
  → round 4: the whole branch
  → still nobody? raise DISPATCH_EXHAUSTED for the desk, and stop
```

Two invariants hold the whole way through:

* **A rider who said no is never asked about that job again.** Rejections are permanent per delivery.
* **The round is data, not memory.** It lives on `deliveries.dispatchRound`, so it survives restarts,
  deploys, and any number of API processes — and a round that found nobody still counts, which is what
  lets the search widen instead of retrying the same empty radius forever.

---

## 2. What was built

### Backend

| File | What it does |
|---|---|
| `src/dispatch/dispatch.service.ts` | The engine: `roundInfo`, `findCandidates` (eligibility + scoring), `offerDelivery`, `reject`, `accept`, `sweepExpired`, `tick`, `offerWaitingDeliveries` |
| `src/dispatch/dispatch.scheduler.ts` | 5-second heartbeat, `unref()`ed so it never holds a process open, `DISPATCH_SCHEDULER=off` kill switch |
| `src/dispatch/dispatch.module.ts` | Provides the service and the scheduler |
| `src/realtime/realtime.gateway.ts` | `/live` namespace, token handshake, rooms, `offer:new` / `offer:revoked` / `delivery:new` / `delivery:updated` / `dispatch:exhausted` / `session:revoked` |
| `src/realtime/realtime.types.ts` | Event names and payload shapes shared by every caller |
| `src/admin/admin-dispatch.service.ts` | The dispatch board: waiting jobs, rounds, radii, live offers, history; `runNow` |
| `src/admin/admin-ops.controller.ts` | `GET /admin/dispatch/board`, `POST /admin/dispatch/deliveries/:id/run` |
| `prisma/migrations/20261105064509_dispatch_rounds/` | `deliveries.dispatchRound`, `deliveries.lastRoundAt` |

**Candidate scoring.** Distance to the pickup, plus a 25 km penalty for a stale location ping, plus a
small 3 km penalty for being outside the delivery's zone. The zone penalty is deliberately small: a free
rider two streets away beats a zone match across the lagoon.

**Eligibility is a hard filter, not a score.** Approved documents, `APPROVED` application, `ONLINE`
availability, active user account, and fewer than `DISPATCH_MAX_ACTIVE_PER_RIDER` jobs already in hand.
A rider at capacity is never offered work — that is a test, not a hope.

**One lock per delivery.** `dispatch:round:<id>` is taken with `SET PX 15000 NX` before a round runs, so
two API processes (or a double click) cannot double-offer. A concurrent `tick()` test drives two calls
simultaneously and asserts one round, one set of offers.

**The exhausted alert fires once.** `dispatch:alerted:<id>` in Redis holds for ten minutes, so a job
nobody can take raises one `AdminAlert` for the desk rather than one per heartbeat.

**SMS as the safety net.** Every offer also goes out over `MessagingService` (console in development) for
the rider whose app is not open. It is fire-and-forget: a messaging failure must never cost a delivery
its offer.

### Frontend

| Screen | What it does now |
|---|---|
| **Dispatch board** (`/admin/dispatch`) | Waiting jobs oldest-first, round *n* of 4, the radius in force, live offers with a countdown, who has already been asked, and two escapes: *Run round* and *Assign* |
| **Rider · Offers** | A pushed offer appears (and a withdrawn one disappears) without a refresh |
| **Rider · Active job** | Follows the server if the office cancels or reassigns under the rider's feet |
| **Customer · Delivery detail** | Status changes arrive while the page is open |
| **Admin · Overview / Deliveries** | Counters and the board refresh themselves as jobs move |

`src/lib/live.ts` holds one socket per tab, opened when a session exists and closed on sign-out. The
token is supplied through Socket.IO's `auth` callback, which runs on every (re)connection — so a
reconnect after a token rotation still authenticates, and a tab that slept for an hour rotates the
refresh cookie itself instead of connecting as nobody.

**The badge is honest.** `LiveIndicator` in the portal header reads *Live* only while the socket is
actually connected, and *Reconnecting* when it is not. Screens fall back to refetching on navigation, so
a dropped socket degrades to "slightly stale" rather than "silently wrong".

---

## 3. Decisions worth remembering

**The socket is notification-only.** Every push says *something changed*; the screen then refetches
through the REST API. A socket message can never invent state, because the truth is still whatever
Postgres will return. This is why the live channel needed no new authorisation model — every action is
still a REST call with a bearer token and a permission check.

**Rooms, not broadcasts.** `user:<id>`, `rider:<id>`, `customer:<id>`, `staff:dispatch`,
`delivery:<id>` (joined via `subscribe:delivery`, which checks ownership). Dispatch traffic is tested to
be invisible to riders and customers, and a customer cannot subscribe to somebody else's delivery.

**The desk cannot bypass a rule with a button.** *Run round now* calls the same `offerDelivery` the
heartbeat calls. It skips the wait, not the rules: it refuses (409) while an offer is live, and refuses
(409) once the schedule is spent — pointing the dispatcher at manual assignment instead.

**The schedule is finite.** `offerDelivery` itself refuses to start a ninth round on a job that has
already been round the whole branch. A delivery that reached that state needs a decision, not another
offer — so even the post-completion sweep cannot silently resurrect it. (Test: *does not restart an
exhausted delivery when a rider comes free*.)

**Suspension still has teeth online.** Suspending an account revokes the refresh family **and** closes
the sockets in `user:<id>` with `session:revoked`; the app clears itself instead of showing stale data
until some click fails.

**Routes, wiring and proxies are part of the feature.** The Vite dev server now proxies `/socket.io`
with `ws: true` — without it the socket silently degrades to polling or never connects.

---

## 4. Bugs found and fixed while building

| Symptom | Cause | Fix |
|---|---|---|
| Every push silently did nothing | the guard checked `server.sockets.adapter`, but a gateway with a namespace receives the **Namespace**, whose adapter hangs off `namespace.adapter` | check both shapes; a live push is now verified in a real browser and in the socket test |
| The search never widened past 5 km | round bookkeeping was derived from `asked / batchSize`, so a round that found nobody recorded nothing | `deliveries.dispatchRound` column, incremented by `closeRound()` even for an empty round |
| Round 3 re-offered only one rider instead of the earlier batch | the previous batch was excluded by `rows.slice(0, batchSize)` on a *descending* list | exclusion is now "asked in the round that just ended", recorded per offer in `scoreBreakdown.round` |
| `POST /rider/availability` returned 409 in a test | the fixture approved the rider without documents; going online requires APPROVED documents | the fixture now uploads documents and starts the rider OFFLINE |
| Customer suspension returned 500 in the HTTP test harness | `this.server` is undefined when no listener exists; `revokeUser` threw | guard every gateway method on an attached adapter |
| A job could reach round 6 of 4 | the post-completion sweep called `offerDelivery` directly, past the cap | `offerDelivery` refuses an exhausted delivery |
| The board's last column was clipped | six columns with long labels in a 1440 px viewport | consolidated to four: delivery + charge + waiting, route, search + holder, actions |

---

## 5. Verified in a real browser

`scripts/capture-phase6.mjs` signs in as the seeded super admin and rider, against the running API:

```
✓ 01-dispatch-board.png   4 waiting · 3 offers out · rounds 2, 3, 4 of 4 · LIVE badge on
✓ 02-rider-offers.png     3 offers in hand with a live countdown (114 s), earnings net of commission
✓ 03-rider-no-offers.png  the rider passes everything; the list empties by itself
✓ 04-exhausted.png        the heartbeat spends the remaining rounds; counters and badges go red
✓ 05-manual-assign.png    the drawer: approved-rider picker, reason, timeline, "RDR-00001 rejected · auto"
✓ 06-delivery-history.png the delivered job's record, from offer to proof of delivery
```

Data comes from `scripts/seed-demo-phase6.mjs`, which drives the public API only (no database writes):
it books jobs, moves the rider online/offline, completes one job with photo proof, and lets the engine
exhaust another. Screenshots were taken with `DISPATCH_OFFER_TIMEOUT_SECONDS=120` so the countdown is
legible; the shipped default is 45 s and `backend/.env` uses 20 s.

---

## 6. Test suite

```
Test Files  12 passed (12)
     Tests  193 passed (193)
  Duration  ~35 s
```

New this phase — `backend/test/dispatch-engine.e2e.spec.ts` (21 tests), on a real listening server with
`socket.io-client`:

**The first round** — the three closest riders are offered a booking, ranked by distance; a rider in the
delivery zone wins a near-tie; a round that finds nobody is still recorded so the search can widen.

**Escalation** — a batch expiring asks different riders without duplicating rows; later rounds come back
to the first batch instead of giving up; a decliner is never asked again and the desk gets exactly one
`DISPATCH_EXHAUSTED`; two concurrent `tick()` calls produce one round and one set of offers; an exhausted
delivery is not restarted when a rider comes free.

**The live channel** — the pushed offer reaches the chosen rider and only them; a withdrawal reaches the
losers the moment somebody accepts; a socket without a token is refused with a reason; a customer cannot
subscribe to someone else's delivery; a rider never sees staff or customer traffic; signing out
everywhere closes the socket with `session:revoked`.

**The engine and the rest of the system** — work waiting for a rider is offered the moment a rider comes
online; busy, suspended, unapproved and at-capacity riders are never offered anything.

**The dispatch board** — the board shows round, radius and who was asked; *Run round now* places an offer
and refuses while an offer is live; it refuses a delivery that already has a rider; support may read the
board but not run a round; customers and riders are refused entirely.

---

## 7. What Phase 7 does next

**Payments, wallet and ledger.** Paystack + Flutterwave initialisation and verification, webhooks with
signature verification, dedupe and re-verification, wallet top-ups and deductions, the double-entry
ledger behind every naira, commission splits on `DELIVERED`, refunds, withdrawal approval and Paystack
transfer payouts, reconciliation, and the development-mode banner that keeps simulated money honest.
The finance screen left as a placeholder in Phase 5 is built there.
